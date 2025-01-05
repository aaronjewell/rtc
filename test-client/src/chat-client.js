import WebSocket from 'ws';
import EventEmitter from 'events';

export class ChatClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.currentRoom = null;
        this.chatWs = null;
        this.presenceWs = null;
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
            await this.connectToPresenceServer(servers.presence);

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

            ws.on('message', (data) => {
                const message = JSON.parse(data);
                this.handleChatMessage(message);
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

    async connectToPresenceServer(serverInfo) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(
                `ws://${serverInfo.host}:${serverInfo.port}/presence?token=${this.sessionToken}`
            );

            ws.on('open', () => {
                this.presenceWs = ws;
                resolve();
            });

            ws.on('message', (data) => {
                const message = JSON.parse(data);
                this.handlePresenceMessage(message);
            });

            ws.on('error', (error) => {
                this.emit('error', new Error(`Presence server error: ${error.message}`));
            });

            ws.on('close', () => {
                this.presenceWs = null;
                this.emit('error', new Error('Disconnected from presence server'));
            });
        });
    }

    handleChatMessage(message) {
        switch (message.type) {
            case 'chat_message':
                this.emit('message', message);
                break;

            case 'room_history':
                message.messages.forEach(msg => {
                    this.emit('message', msg);
                });
                break;

            case 'error':
                this.emit('error', new Error(message.error));
                break;
        }
    }

    handlePresenceMessage(message) {
        switch (message.type) {
            case 'presence_update':
                message.presence.forEach(presence => {
                    this.emit('presence', presence);
                });
                break;

            case 'error':
                this.emit('error', new Error(message.error));
                break;
        }
    }

    async joinRoom(roomId) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        this.currentRoom = roomId;
        this.chatWs.send(JSON.stringify({
            type: 'join_room',
            roomId
        }));
    }

    async sendMessage(content) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        if (!this.currentRoom) {
            throw new Error('Join a room first');
        }

        this.chatWs.send(JSON.stringify({
            type: 'chat_message',
            roomId: this.currentRoom,
            content
        }));
    }

    async updateStatus(status) {
        if (!this.presenceWs) {
            throw new Error('Not connected to presence server');
        }

        this.presenceWs.send(JSON.stringify({
            type: 'status_update',
            status
        }));
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.presenceWs) {
                this.presenceWs.send(JSON.stringify({ type: 'heartbeat' }));
            }
        }, 25000); // Send heartbeat every 25 seconds
    }

    async disconnect() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        if (this.chatWs) {
            this.chatWs.close();
        }

        if (this.presenceWs) {
            this.presenceWs.close();
        }
    }
}
