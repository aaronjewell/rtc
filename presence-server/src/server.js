import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

export class PresenceServer {
    constructor(serviceDiscovery) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.clients = new Map();
        this.serviceDiscovery = serviceDiscovery;
    }

    async init() {
        try {
            await this.#readJwtSecret();

            this.#setupWebSocket();
            this.#setupServer();
            this.#setupGracefulShutdown();

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

                console.log(`Client connected: ${userId}`);

                ws.on('close', async () => {
                    await this.#handleDisconnection(userId);
                });

            } catch (error) {
                console.error('WebSocket connection error:', error);
                ws.close(4002, 'Authentication failed');
            }
        });
    }

    async #handleDisconnection(userId) {
        const client = this.clients.get(userId);
        if (client) {
            this.clients.delete(userId);
            console.log(`Client disconnected: ${userId}`);
        }
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