import express from 'express';
import fs from 'fs/promises';
import mysql from 'mysql2/promise';

export class API {
    constructor() {
        this.app = express();

        this.registerMiddleware();
        this.registerRoutes();
    }

    registerMiddleware() {
        this.app.use(express.json());
    }

    registerRoutes() {
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok' });
        });
    }

    async init() {
        const dbPassword = await fs.readFile(process.env.DB_PASSWORD_FILE, 'utf8');

        this.db = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: dbPassword,
            database: process.env.DB_DATABASE,
        });
    }
}