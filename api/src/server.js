import bcrypt from 'bcrypt';
import express from 'express';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';

export class API {
    constructor(dal, serviceDiscovery) {
        this.app = express();
        this.dal = dal;
        this.serviceDiscovery = serviceDiscovery;

        this.#registerMiddleware();
        this.#registerRoutes();
        this.#setupGracefulShutdown();
    }

    async init() {
        this.JWT_SECRET = await fs.readFile(process.env.JWT_SECRET_FILE, 'utf8');
    }

    #registerMiddleware() {
        this.app.use(express.json());
    }

    #registerRoutes() {
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok' });
        });

        this.app.post('/auth', async (req, res) => {
            try {
                const { username, password } = req.body;

                const isValid = await this.#validateCredentials({ username, password });

                if (!isValid) {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                await this.dal.updateLastLogin(username);

                const sessionToken = await this.#generateSessionToken(req.body.username);

                const [chatServers, presenceServers] = await Promise.all([
                    this.serviceDiscovery.getAvailableServers('/chat-service'),
                    this.serviceDiscovery.getAvailableServers('/presence-service')
                ]);

                if (!chatServers.length || !presenceServers.length) {
                    return res.status(503).json({ error: 'No available servers' });
                }

                const selectedChatServer = this.serviceDiscovery.selectOptimalServer(chatServers);
                const selectedPresenceServer = this.serviceDiscovery.selectOptimalServer(presenceServers);

                res.json({
                    sessionToken,
                    servers: {
                        chat: {
                            host: selectedChatServer.host,
                            port: selectedChatServer.port,
                            id: selectedChatServer.id
                        },
                        presence: {
                            host: selectedPresenceServer.host,
                            port: selectedPresenceServer.port,
                            id: selectedPresenceServer.id
                        }
                    }
                });

            } catch (error) {
                console.error('Auth error:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
    }

    async #validateCredentials({ username, password }) {
        try {
            const user = await this.dal.getUserByUsername(username);

            return await bcrypt.compare(password, user.password);
        } catch (error) {
            console.error('User validation error:', error);
            return false;
        }
    }

    async #generateSessionToken(username) {
        if (!this.JWT_SECRET) {
            throw new Error('JWT secret is not set');
        }

        return jwt.sign(
            {
                username,
                timestamp: Date.now()
            },
            this.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRATION }
        );
    }

    #setupGracefulShutdown() {
        const shutdown = async () => {
            console.log('Shutting down API...');

            this.serviceDiscovery.close();

            await this.dal.close();

            this.server.close(() => {
                console.log('API shutdown complete');
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}