import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

export class ChatServer {
    constructor(dal, serviceDiscovery) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.clients = new Map();
        this.dal = dal;
        this.serviceDiscovery = serviceDiscovery;
    }

    async init() {
        await this.#readJwtSecret();

        this.#setupWebSocket();
        this.#setupServer();
        this.#setupGracefulShutdown();
    }

    async #readJwtSecret() {
        this.JWT_SECRET = await fs.readFile(process.env.JWT_SECRET_FILE, 'utf8');
    }

    #setupServer() {
        const port = process.env.PORT;

        this.server.listen(port, () => {
            console.log(`Chat server ${process.env.SERVER_ID} is running on port ${port}`);
        });
    }

    #setupWebSocket() {
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

                ws.on('close', () => {
                    this.clients.delete(userId);
                    console.log(`Client disconnected: ${userId}`);
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
                await this.#handleTypingIndicator(userId, data.roomId, data.isTyping);
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

        const messages = await this.dal.getRecentMessages(roomId);

        const ws = this.clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'room_history',
                roomId,
                messages: messages
            }));
        }
    }

    async #handleChatMessage(userId, roomId, content) {
        await this.dal.storeMessage(roomId, userId, content);

        // Broadcast to all clients in the room
        const message = {
            type: 'chat_message',
            roomId,
            userId,
            content,
            timestamp: Date.now()
        };

        this.#broadcast(roomId, message);
    }

    async #handleTypingIndicator(userId, roomId, isTyping) {
        this.#broadcast(roomId, {
            type: 'typing_indicator',
            roomId,
            userId,
            isTyping
        });
    }

    #broadcast(roomId, message) {
        // TODO: track which users are in which rooms
        // and only broadcast to those users
        this.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
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