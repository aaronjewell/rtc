import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

export class ChatServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.clients = new Map();
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