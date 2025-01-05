import { ChatServer } from './server.js';

const server = new ChatServer();

try {
    await server.init()
} catch (error) {
    console.error('Failed to start chat server:', error);
    process.exit(1);
}