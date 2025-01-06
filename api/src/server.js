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
            const health = {
                status: 'ok',
                timestamp: new Date().toISOString(),
                service: 'api-server',
                zookeeper: this.serviceDiscovery.getName(),
            };

            res.json(health);
        });

        this.app.get('/health/details', async (req, res) => {
            try {
                const [chatServers, presenceServers] = await Promise.all([
                    this.serviceDiscovery.getAvailableServers('/chat-service'),
                    this.serviceDiscovery.getAvailableServers('/presence-service')
                ]);

                const health = {
                    status: 'ok',
                    timestamp: new Date().toISOString(),
                    service: 'api-server',
                    zookeeper: {
                        status: this.serviceDiscovery.getName(),
                        connected: this.serviceDiscovery.getCode() === 3 // 3 = SYNC_CONNECTED
                    },
                    services: {
                        chat: {
                            available: chatServers.length,
                            servers: chatServers
                        },
                        presence: {
                            available: presenceServers.length,
                            servers: presenceServers
                        }
                    }
                };

                res.json(health);
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    timestamp: new Date().toISOString(),
                    error: error.message
                });
            }
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

                // Ensure server data is properly parsed and has required fields
                const validChatServers = chatServers.filter(server => 
                    server && server.host && server.port && server.id !== undefined
                );

                const validPresenceServers = presenceServers.filter(server => 
                    server && server.host && server.port && server.id !== undefined
                );

                if (!validChatServers.length || !validPresenceServers.length) {
                    console.error('Invalid server data:', { chatServers, presenceServers });
                    return res.status(503).json({ error: 'Invalid server configuration' });
                }

                const selectedChatServer = this.serviceDiscovery.selectOptimalServer(validChatServers);
                const selectedPresenceServer = this.serviceDiscovery.selectOptimalServer(validPresenceServers);

                if (!selectedChatServer || !selectedPresenceServer) {
                    return res.status(503).json({ error: 'Failed to select available servers' });
                }

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

            this.app.close(() => {
                console.log('API shutdown complete');
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}