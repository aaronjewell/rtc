import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import ip from 'ip';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { Kafka } from 'kafkajs';
import { Redis } from 'ioredis';

export class ChatServer {
    constructor(dal, serviceDiscovery, serverId) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.serverId = serverId;
        this.clients = new Map();
        this.dal = dal;
        this.serviceDiscovery = serviceDiscovery;

        const kafka = new Kafka({
            clientId: `chat-server-${this.serverId}`,
            brokers: [process.env.KAFKA_BROKER]
        });
        this.producer = kafka.producer();

        this.redis = new Redis({
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
        });
    }

    async init() {
        await this.#readJwtSecret();
        await this.producer.connect();

        this.#setupWebSocket();
        this.#setupServer();
        this.#setupGracefulShutdown();
    }

    async #readJwtSecret() {
        this.JWT_SECRET = await fs.readFile(process.env.JWT_SECRET_FILE, 'utf8');
    }

    #setupServer() {
        const port = process.env.PORT;

        this.app.post('/dispatch-message', express.json(), (req, res) => {
            const message = req.body;
            console.log(`Dispatching message to ${message.user_id}`, message);

            this.#deliverMessage(message);

            res.status(200).send('Message dispatched');
        });

        this.server.listen(port, () => {
            console.log(`Chat server ${process.env.SERVER_ID} is running on port ${port}`);
        });
    }

    #setupWebSocket() {
        this.rooms = new Map();

        this.wss.on('connection', async (ws, req) => {
            try {
                const token = new URL(req.url, 'ws://localhost').searchParams.get('token');
                if (!token) {
                    ws.close(3000, 'No authentication token provided');
                    return;
                }

                const decoded = await this.#verifyToken(token);
                const userId = decoded.username;

                this.clients.set(userId, ws);

                console.log(`Client connected: ${userId}`);

                this.redis.hmset(`user:${userId}`, {
                    serverId: this.serverId,
                    host: ip.address(),
                    port: process.env.PORT
                });

                ws.on('message', async (message) => {
                    try {
                        await this.#handleMessage(userId, message);
                    } catch (error) {
                        console.error('Error handling message:', error);
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Failed to process message'
                        }));
                    }
                });

                ws.on('close', async () => {
                    this.clients.delete(userId);
                    console.log(`Client disconnected: ${userId}`);

                    for (const [roomId, users] of this.rooms) {
                        if (users.has(userId)) {
                            users.delete(userId);
                            await this.redis.srem(`room:${roomId}`, userId);
                        }
                    }

                    await this.redis.del(`user:${userId}`);
                });

            } catch (error) {
                console.error('WebSocket connection error:', error);
                ws.close(3000, 'Authentication failed');
            }
        });
    }

    async #handleMessage(userId, message) {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join_room':
                await this.#handleJoinRoom(userId, data.roomId);
                break;

            case 'chat_message':
                await this.#handleChatMessage(userId, data.roomId, data.content);
                break;

            case 'typing':
                // TODO: Implement this
                break;

            default:
                throw new Error('Unknown message type');
        }
    }

    async #handleJoinRoom(userId, roomId) {
        const room = await this.dal.getRoom(roomId);

        if (!room) {
            throw new Error('Room not found');
        }

        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, new Set());
        }

        this.rooms.get(roomId).add(userId);

        const messages = await this.dal.getRecentMessages(roomId);

        await this.redis.sadd(`room:${roomId}`, userId);

        const ws = this.clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'room_history',
                roomId,
                messages: messages.reverse()
            }));
        }
    }

    async #handleChatMessage(userId, roomId, content) {
        const message = await this.dal.storeMessage(roomId, userId, content);

        console.log(`Delivering message to room ${roomId}`, JSON.stringify(message));

        await this.producer.send({
            topic: 'chat-messages',
            messages: [{ key: roomId, value: JSON.stringify(message) }]
        });
    }

    async #deliverMessage(message) {
        const ws = this.clients.get(message.user_id);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'chat_message', ...message }));
        } else {
            console.error(`Failed to deliver message to ${message.user_id}`, message);
        }
    }

    #verifyToken(token) {
        if (!this.JWT_SECRET) {
            throw new Error('JWT secret not initialized');
        }

        return new Promise((resolve, reject) => {
            jwt.verify(token, this.JWT_SECRET, (err, decoded) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(decoded);
                }
            });
        });
    }

    #setupGracefulShutdown() {
        const shutdown = async () => {
            console.log('Shutting down chat server...');

            const userIds = Array.from(this.clients.keys());

            for (const userId of userIds) {
                await this.redis.del(`user:${userId}`);
            }
            this.redis.disconnect();

            this.producer.disconnect();

            this.serviceDiscovery.close();

            await this.dal.close();
            
            this.wss.clients.forEach((client) => {
                client.close(1000, 'Server shutting down');
            });

            this.server.close(() => {
                console.log('Server shutdown complete');
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}