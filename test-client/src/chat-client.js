import WebSocket from 'ws';
import EventEmitter from 'events';

export class ChatClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.currentChannel = null;
        this.chatWs = null;
        this.presenceWs = null;
        this.sessionToken = null;
        this.heartbeatInterval = null;
        this.channels = new Map(); // channelId -> channel info
        this.messagesByChannel = new Map(); // channelId -> messages[]
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
            case 'channels_list':
                this.channels.clear();
                message.channels.forEach(channel => {
                    this.channels.set(channel.channel_id, channel);
                });
                this.emit('channels_updated', Array.from(this.channels.values()));
                break;

            case 'channel_created':
                this.channels.set(message.channel.channel_id, message.channel);
                this.emit('channel_created', message.channel);
                break;

            case 'chat_message':
                this.emit('message', {
                    channelId: message.channel_id,
                    userId: message.user_id,
                    content: message.content,
                    timestamp: message.created_at
                });
                break;

            case 'channel_joined':
                this.currentChannel = message.channelId;
                this.emit('channel_joined', {
                    channelId: message.channelId,
                    messages: message.messages,
                    participants: message.participants
                });
                break;

            case 'channel_left':
                if (this.currentChannel === message.channelId) {
                    this.currentChannel = null;
                }
                this.emit('channel_left', message.channelId);
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

    async joinChannel(channelId) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        this.chatWs.send(JSON.stringify({
            type: 'join_channel',
            channelId
        }));
    }

    async leaveChannel(channelId) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        this.chatWs.send(JSON.stringify({
            type: 'leave_channel',
            channelId
        }));
    }

    async sendMessage(content, metadata = {}) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        if (!this.currentChannel) {
            throw new Error('Join a channel first');
        }

        this.chatWs.send(JSON.stringify({
            type: 'chat_message',
            channelId: this.currentChannel,
            content,
            metadata
        }));
    }

    async markChannelRead(channelId) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        this.chatWs.send(JSON.stringify({
            type: 'mark_channel_read',
            channelId
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

    async createChannel(name, participants = []) {
        if (!this.chatWs) {
            throw new Error('Not connected to chat server');
        }

        this.chatWs.send(JSON.stringify({
            type: 'create_channel',
            name,
            participants
        }));
    }

    handleMessage(message) {
        if (message.type === 'chat_message') {
            const channelMessages = this.messagesByChannel.get(message.channel_id) || [];
            channelMessages.push(message);
            
            // Sort by string comparison of Snowflake IDs
            channelMessages.sort((a, b) => a.message_id.localeCompare(b.message_id));
            
            this.messagesByChannel.set(message.channel_id, channelMessages);
            this.emit('message', message);
        }
        // ... handle other message types
    }

    async getChannelHistory(channelId, beforeId = null, limit = 50) {
        const messages = await this.fetchMessages(channelId, beforeId, limit);
        
        // Update local message store
        let channelMessages = this.messagesByChannel.get(channelId) || [];
        channelMessages = [...messages, ...channelMessages];
        channelMessages.sort((a, b) => a.message_id.localeCompare(b.message_id));
        this.messagesByChannel.set(channelId, channelMessages);
        
        return messages;
    }

    async fetchMessages(channelId, beforeId = null, limit = 50) {
        const url = new URL(`${this.config.apiUrl}/channels/${channelId}/messages`);
        if (beforeId) url.searchParams.set('before', beforeId);
        if (limit) url.searchParams.set('limit', limit);

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${this.sessionToken}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch messages');
        }

        return await response.json();
    }
}
