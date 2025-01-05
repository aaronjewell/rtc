import bcrypt from 'bcrypt';
import express from 'express';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';

export class API {
    constructor(dal) {
        this.app = express();
        this.dal = dal;

        this.#registerMiddleware();
        this.#registerRoutes();
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

                res.json({
                    sessionToken,
                    servers: {
                        // TODO: get from service discovery
                        chat: {
                            host: 'localhost',
                            port: 8080,
                            id: 'chat-1'
                        },
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
}