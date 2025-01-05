import express from 'express';

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
}