import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

export class PresenceServer {
    constructor(dal, serviceDiscovery) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.heartbeatInterval = 30000; // 30 seconds
        this.clients = new Map();
        this.serviceDiscovery = serviceDiscovery;
        this.dal = dal;
    }

    async init() {
        try {
            await this.#readJwtSecret();

            this.#setupWebSocket();
            this.#setupServer();
            this.#setupGracefulShutdown();

            this.#startHeartbeat();
        } catch (error) {
            console.error('Failed to start server:', error);
            throw error;
        }
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
                    ws.close(4001, 'No authentication token provided');
                    return;
                }

                const decoded = await this.#verifyToken(token);
                const userId = decoded.username;

                const clientInfo = {
                    ws,
                    userId,
                    status: 'online',
                    lastSeen: new Date(),
                    deviceInfo: req.headers['user-agent'] || 'unknown'
                };

                this.clients.set(userId, clientInfo);

                await this.#updatePresence(userId, 'online');

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

                ws.on('close', async () => {
                    await this.#handleDisconnection(userId);
                });

                await this.sendInitialPresenceData(ws);

            } catch (error) {
                console.error('WebSocket connection error:', error);
                ws.close(4002, 'Authentication failed');
            }
        });
    }

    async #handleMessage(userId, message) {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'status_update':
                await this.#handleStatusUpdate(userId, data.status);
                break;

            case 'subscribe':
                await this.#handleSubscribe(userId, data.userIds);
                break;

            case 'heartbeat':
                await this.#handleHeartbeat(userId);
                break;

            default:
                throw new Error('Unknown message type');
        }
    }

    async #handleStatusUpdate(userId, status) {
        const deviceInfo = this.clients.get(userId)?.deviceInfo || 'unknown';
        const serverId = this.serviceDiscovery.getServerId();
        await this.dal.updatePresence(userId, status, deviceInfo, serverId);
        
        this.#broadcastStatus(userId, status);
    }

    async #handleSubscribe(userId, userIds) {
        const client = this.clients.get(userId);
        if (!client) return;

        const presenceData = await this.dal.getPresenceData(userIds);
        
        client.ws.send(JSON.stringify({
            type: 'presence_update',
            presence: presenceData
        }));
    }

    async #handleHeartbeat(userId) {
        const client = this.clients.get(userId);
        if (client) {
            client.lastSeen = new Date();
            await this.#updatePresence(userId, client.status);
        }
    }

    async #handleDisconnection(userId) {
        const client = this.clients.get(userId);
        if (client) {
            this.clients.delete(userId);
            console.log(`Client disconnected: ${userId}`);
        }
    }

    async #updatePresence(userId, status) {
        await this.dal.updatePresence(userId, status);

        this.#broadcastStatus(userId, status);
    }

    #broadcastStatus(userId, status) {
        const update = {
            type: 'presence_update',
            presence: [{
                user_id: userId,
                status: status,
                last_seen: new Date()
            }]
        };

        this.clients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify(update));
            }
        });
    }

    async sendInitialPresenceData(ws) {
        const onlineUsers = await this.dal.getUsersByStatus('online');

        ws.send(JSON.stringify({
            type: 'initial_presence',
            presence: onlineUsers
        }));
    }

    #startHeartbeat() {
        setInterval(() => {
            const now = Date.now();
            this.clients.forEach((client, userId) => {
                if (now - client.lastSeen.getTime() > this.heartbeatInterval * 2) {
                    // Client hasn't sent heartbeat, consider them disconnected
                    this.#handleDisconnection(userId);
                }
            });
        }, this.heartbeatInterval);
    }

    #verifyToken(token) {
        if (!this.JWT_SECRET) {
            throw new Error('JWT secret not initialized');
        }

        return new Promise((resolve, reject) => {
            jwt.verify(token, this.JWT_SECRET, (err, decoded) => {
                if (err) reject(err);
                else resolve(decoded);
            });
        });
    }

    #setupGracefulShutdown() {
        const shutdown = async () => {
            console.log('Shutting down presence server...');
            
            this.wss.clients.forEach((client) => {
                client.close(1000, 'Server shutting down');
            });

            // Update all users' status to offline
            for (const [userId] of this.clients) {
                await this.#updatePresence(userId, 'offline');
            }

            await this.dal.close();

            this.serviceDiscovery.close();

            this.server.close(() => {
                console.log('Server shutdown complete');
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}