import WebSocket from 'ws';
import EventEmitter from 'events';

export class ChatClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.chatWs = null;
        this.sessionToken = null;
        this.heartbeatInterval = null;
    }

    async connect() {
        try {
            const response = await fetch(`${this.config.apiUrl}/auth`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: this.config.username,
                    password: this.config.password
                })
            });

            if (!response.ok) {
                throw new Error('Authentication failed');
            }

            const { sessionToken, servers } = await response.json();
            this.sessionToken = sessionToken;

            await this.connectToChatServer(servers.chat);

            this.emit('connected');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async connectToChatServer(serverInfo) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(
                `ws://${serverInfo.host}:${serverInfo.port}/chat?token=${this.sessionToken}`
            );

            ws.on('open', () => {
                this.chatWs = ws;
                resolve();
            });

            ws.on('error', (error) => {
                this.emit('error', new Error(`Chat server error: ${error.message}`));
            });

            ws.on('close', () => {
                this.chatWs = null;
                this.emit('error', new Error('Disconnected from chat server'));
            });
        });
    }

    async disconnect() {
        if (this.chatWs) {
            this.chatWs.close();
        }
    }
}