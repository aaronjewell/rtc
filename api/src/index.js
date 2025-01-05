import { API } from './server.js';

const server = new API();

try {
    const port = process.env.PORT;

    await server.init();

    server.app.listen(port, () => {
        console.log(`API listening on port ${port}`);
    });
} catch (error) {
    console.error('Failed to initialize API:', error);
    process.exit(1);
}