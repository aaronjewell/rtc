import bcrypt from 'bcrypt';
import express from 'express';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';

export class API {
    constructor(dal, serviceDiscovery, logger) {
        this.app = express();
        this.server = null;
        this.dal = dal;
        this.serviceDiscovery = serviceDiscovery;
        this.logger = logger;

        this.#registerMiddleware();
        this.#registerRoutes();
        this.#setupGracefulShutdown();
    }

    async init() {
        this.JWT_SECRET = await fs.readFile(process.env.JWT_SECRET_FILE, 'utf8');

        this.server = this.app.listen(process.env.PORT, () => {
            this.logger.info(`API listening on port ${process.env.PORT}`);
        });
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
                        connected: this.serviceDiscovery.getCode() === 3
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
                this.logger.error('Health check failed:', { error: error.message, stack: error.stack });
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
                this.logger.debug('Authentication attempt', { username });

                const isValid = await this.#validateCredentials({ username, password });

                if (!isValid) {
                    this.logger.warn('Invalid credentials', { username });
                    return res.status(401).json({ error: 'Invalid credentials' });
                }

                await this.dal.updateLastLogin(username);

                const sessionToken = await this.#generateSessionToken(username);

                const [chatServers, presenceServers] = await Promise.all([
                    this.serviceDiscovery.getAvailableServers('/chat-service'),
                    this.serviceDiscovery.getAvailableServers('/presence-service')
                ]);

                if (!chatServers.length || !presenceServers.length) {
                    this.logger.error('No available servers', { chatServers: chatServers.length, presenceServers: presenceServers.length });
                    return res.status(503).json({ error: 'No available servers' });
                }

                const validChatServers = chatServers.filter(server => 
                    server && server.host && server.port && server.id !== undefined
                );

                const validPresenceServers = presenceServers.filter(server => 
                    server && server.host && server.port && server.id !== undefined
                );

                if (!validChatServers.length || !validPresenceServers.length) {
                    this.logger.error('Invalid server configuration', { chatServers, presenceServers });
                    return res.status(503).json({ error: 'Invalid server configuration' });
                }

                const selectedChatServer = this.serviceDiscovery.selectOptimalServer(validChatServers);
                const selectedPresenceServer = this.serviceDiscovery.selectOptimalServer(validPresenceServers);

                if (!selectedChatServer || !selectedPresenceServer) {
                    this.logger.error('Failed to select servers', { 
                        chatServer: !!selectedChatServer, 
                        presenceServer: !!selectedPresenceServer 
                    });
                    return res.status(503).json({ error: 'Failed to select available servers' });
                }

                this.logger.info('Authentication successful', { 
                    username,
                    chatServer: selectedChatServer.id,
                    presenceServer: selectedPresenceServer.id
                });

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
                this.logger.error('Authentication error:', { error: error.message, stack: error.stack });
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
            this.logger.info('Shutting down API...');

            this.serviceDiscovery.close();
            await this.dal.close();

            this.server.close(() => {
                this.logger.info('API shutdown complete');
                this.logger.close();
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
}