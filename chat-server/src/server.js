import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import ip from 'ip';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { Kafka, Partitioners } from 'kafkajs';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

export class ChatServer {
    constructor(dal, serviceDiscovery, idGenerator, serverId, logger) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.server });

        this.clients = new Map();
        this.dal = dal;
        this.serviceDiscovery = serviceDiscovery;
        this.idGenerator = idGenerator;
        this.serverId = serverId;
        this.logger = logger;

        const kafka = new Kafka({
            clientId: `chat-server-${this.serverId}`,
            brokers: [process.env.KAFKA_BROKER],
            producer: {
                maxInFlightRequests: 5,
                idempotent: true,
                acks: 1, // Only wait for leader acknowledgment for better throughput
                compression: 'snappy', // Faster than gzip
                createPartitioner: Partitioners.LegacyPartitioner,
                partitionerConfig: {
                    maxRandomBytes: 0
                },
                // Add batching configuration
                batchSize: 16384, // 16KB
                linger: 50 // 50ms to allow batching
            }
        });
        this.producer = kafka.producer({
            allowAutoTopicCreation: false
        });

        this.redis = new Redis({
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
        });
    }

    async init() {
        await this.#readJwtSecret();
        await this.producer.connect();
        this.logger.info('Connected to Kafka producer');

        this.#setupWebSocket();
        this.#setupServer();
        this.#setupGracefulShutdown();
    }

    async #readJwtSecret() {
        this.JWT_SECRET = await fs.readFile(process.env.JWT_SECRET_FILE, 'utf8');
    }

    #setupServer() {
        const port = process.env.PORT;

        this.app.post('/dispatch-message', express.json(), async (req, res) => {
            const message = req.body;
            this.logger.debug(`Dispatching message to user ${message.target_user_id}`);
            try {
                await this.#deliverMessage(message);
                res.status(200).send('Message dispatched');
            } catch (error) {
                this.logger.error('Error dispatching message:', { error: error.message, stack: error.stack });
                res.status(500).send('Failed to dispatch message');
            }
        });

        this.server.listen(port, () => {
            this.logger.info(`Chat server ${this.serverId} is running on port ${port}`);
        });
    }

    #setupWebSocket() {
        this.subscribedChannels = new Map();

        this.wss.on('connection', async (ws, req) => {
            try {
                const token = new URL(req.url, 'ws://localhost').searchParams.get('token');
                if (!token) {
                    ws.close(3000, 'No authentication token provided');
                    return;
                }

                const decoded = await this.#verifyToken(token);
                const userId = decoded.username;

                this.clients.set(userId, ws);
                this.subscribedChannels.set(userId, new Set());

                this.logger.info(`Client connected: ${userId}`);

                this.redis.hmset(`user:${userId}`, {
                    serverId: this.serverId,
                    host: ip.address(),
                    port: process.env.PORT
                });

                // Send user's channels on connect
                const channels = await this.dal.getUserChannels(userId);
                ws.send(JSON.stringify({
                    type: 'channels_list',
                    channels
                }));

                ws.on('message', async (message) => {
                    try {
                        await this.#handleMessage(userId, message);
                    } catch (error) {
                        this.logger.error('Error handling message:', { 
                            error: error.message, 
                            stack: error.stack,
                            userId,
                            message: message.toString()
                        });
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Failed to process message'
                        }));
                    }
                });

                ws.on('close', async () => {
                    this.clients.delete(userId);
                    this.subscribedChannels.delete(userId);
                    this.logger.info(`Client disconnected: ${userId}`);
                    await this.redis.del(`user:${userId}`);
                });

            } catch (error) {
                this.logger.error('WebSocket connection error:', { error: error.message, stack: error.stack });
                ws.close(3000, 'Authentication failed');
            }
        });
    }

    async #handleMessage(userId, message) {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'create_channel':
                await this.#handleCreateChannel(userId, data.name, data.participants);
                break;

            case 'join_channel':
                await this.#handleJoinChannel(userId, data.channelId);
                break;

            case 'leave_channel':
                await this.#handleLeaveChannel(userId, data.channelId);
                break;

            case 'chat_message':
                await this.#handleChatMessage(userId, data.channelId, data.content, data.metadata);
                break;

            case 'mark_channel_read':
                await this.#handleMarkChannelRead(userId, data.channelId);
                break;

            default:
                throw new Error(`Unknown message type: ${data.type}`);
        }
    }

    async #handleCreateChannel(userId, name, participants = []) {
        // Using UUID v4 for channel IDs as they:
        // 1. Don't need to be ordered like message IDs
        // 2. Shouldn't be guessable/predictable for security
        // 3. Can be generated without coordination
        const channelId = randomUUID();
        
        const channel = {
            channel_id: channelId,
            type: participants.length > 0 ? 'group' : 'direct',
            created_at: new Date(),
            metadata: {
                creator_id: userId,
                name: name || 'Unnamed Channel'
            }
        };

        await this.dal.createChannel(channel);

        // Add creator as first participant
        await this.dal.addChannelParticipant(channel.channel_id, userId, 'admin');

        // Add other participants if provided
        for (const participantId of participants) {
            await this.dal.addChannelParticipant(channel.channel_id, participantId, 'member');
        }

        // Add channel to user_channels for all participants
        const allParticipants = [userId, ...participants];
        for (const participantId of allParticipants) {
            await this.dal.addUserToChannel(
                participantId,
                channel.channel_id,
                channel.type,
                name || 'Unnamed Channel',
                channel.type === 'direct',
                Array.from(new Set(allParticipants.filter(id => id !== participantId)))
            );
        }

        // Notify creator of success
        const ws = this.clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'channel_created',
                channel: {
                    ...channel,
                    participants: allParticipants
                }
            }));
        }

        // Auto-join the creator to the channel
        await this.#handleJoinChannel(userId, channel.channel_id);
    }

    async #handleJoinChannel(userId, channelId) {
        const channel = await this.dal.getChannel(channelId);
        if (!channel) {
            throw new Error('Channel not found');
        }

        const userChannels = this.subscribedChannels.get(userId);
        if (userChannels) {
            userChannels.add(channelId);
        }

        const messages = await this.dal.getChannelMessages(channelId);
        const participants = await this.dal.getChannelParticipants(channelId);

        const ws = this.clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'channel_joined',
                channelId,
                messages: messages.reverse(),
                participants
            }));
        }
    }

    async #handleLeaveChannel(userId, channelId) {
        await this.dal.removeChannelParticipant(channelId, userId);
        await this.dal.removeUserChannel(userId, channelId);

        const userChannels = this.subscribedChannels.get(userId);
        if (userChannels) {
            userChannels.delete(channelId);
        }

        const ws = this.clients.get(userId);
        if (ws) {
            ws.send(JSON.stringify({
                type: 'channel_left',
                channelId
            }));
        }

        const participants = await this.dal.getChannelParticipants(channelId);
        const message = {
            channel_id: channelId,
            type: 'system',
            content: `${userId} has left the channel`,
            created_at: new Date(),
            metadata: {
                event: 'user_left',
                user_id: userId
            }
        };

        // Fan out the system message to remaining participants
        const queueMessages = participants.map(participant => ({
            key: participant.user_id,
            value: JSON.stringify({
                ...message,
                sender_id: 'system',
                target_user_id: participant.user_id
            }),
            timestamp: Date.now()
        }));

        try {
            await this.producer.send({
                topic: 'chat-messages',
                messages: queueMessages,
                timeout: 30000
            });
        } catch (error) {
            console.error('Failed to send leave notification:', error);
            // Don't throw here as the main leave operation was successful
        }
    }

    async #handleChatMessage(userId, channelId, content, metadata = {}) {
        const messageId = this.idGenerator.generate();

        this.logger.debug(`Storing message ${messageId} for channel ${channelId}`, {
            userId,
            channelId,
            messageId
        });

        const storedMessage = await this.dal.storeMessage(
            channelId,
            messageId,
            userId,
            content,
            metadata
        );

        await this.broadcastToChannel(channelId, {
            type: 'chat_message',
            ...storedMessage
        });
    }

    async broadcastToChannel(channelId, message) {
        const participants = await this.dal.getChannelParticipants(channelId);
        
        const kafkaMessages = participants.map(participant => ({
            key: participant.user_id,
            value: JSON.stringify({
                ...message,
                sender_id: message.user_id,
                target_user_id: participant.user_id
            }),
            timestamp: Date.now()
        }));

        try {
            await this.producer.send({
                topic: 'chat-messages',
                messages: kafkaMessages,
                timeout: 30000
            });
        } catch (error) {
            this.logger.error('Failed to broadcast message:', { 
                error: error.message, 
                stack: error.stack,
                channelId
            });
            throw error;
        }
    }

    async #handleMarkChannelRead(userId, channelId) {
        await this.dal.updateUserChannelLastRead(userId, channelId);
    }

    async #deliverMessage(message) {
        const ws = this.clients.get(message.target_user_id);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'chat_message',
                ...message,
                user_id: message.sender_id
            }));
            return true;
        } else {
            this.logger.debug(`User ${message.target_user_id} not connected to this server or connection not open`);
            return false;
        }
    }

    #verifyToken(token) {
        if (!this.JWT_SECRET) {
            throw new Error('JWT secret not initialized');
        }

        return new Promise((resolve, reject) => {
            jwt.verify(token, this.JWT_SECRET, (err, decoded) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(decoded);
                }
            });
        });
    }

    #setupGracefulShutdown() {
        const shutdown = async () => {
            this.logger.info('Shutting down chat server...');

            const userIds = Array.from(this.clients.keys());

            for (const userId of userIds) {
                await this.redis.del(`user:${userId}`);
            }
            this.redis.disconnect();

            this.producer.disconnect();

            this.serviceDiscovery.close();

            await this.dal.close();

            this.wss.clients.forEach((client) => {
                client.close(1000, 'Server shutting down');
            });

            this.server.close(() => {
                this.logger.info('Server shutdown complete');
                this.logger.close();
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }

    async getChannelHistory(channelId, beforeId = null, limit = 50) {
        return await this.dal.getChannelMessages(channelId, limit, beforeId);
    }
}