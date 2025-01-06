import { Client } from 'cassandra-driver';

export class DAL {
    constructor() {
        this.cassandra = new Client({
            contactPoints: [process.env.KV_STORE_HOST],
            localDataCenter: 'datacenter1',
            keyspace: process.env.KV_KEYSPACE,
            protocolOptions: { port: 9042 },
            socketOptions: {
                readTimeout: 60000,
                connectTimeout: 60000
            },
            pooling: {
                maxRequestsPerConnection: 32768
            }
        });
    }

    async init() {
        const maxRetries = 10;
        const retryDelay = 5000; // 5 seconds

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Attempting to connect to Cassandra (attempt ${attempt}/${maxRetries})...`);
                await this.cassandra.connect();
                console.log('Connected to Cassandra successfully');
                break;
            } catch (error) {
                console.error(`Failed to connect to Cassandra (attempt ${attempt}/${maxRetries}):`, error.message);

                if (attempt === maxRetries) {
                    throw new Error(`Failed to connect to Cassandra after ${maxRetries} attempts`);
                }

                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    // Channel operations
    async getChannel(channelId) {
        const result = await this.cassandra.execute(
            'SELECT * FROM channels WHERE channel_id = ?',
            [channelId],
            { prepare: true }
        );
        return result.first();
    }

    async createChannel(channel) {
        const { channel_id, type, metadata } = channel;
        await this.cassandra.execute(
            'INSERT INTO channels (channel_id, type, created_at, metadata) VALUES (?, ?, toTimestamp(now()), ?)',
            [channel_id, type, metadata],
            { prepare: true }
        );
        return this.getChannel(channel_id);
    }

    // User channels operations
    async getUserChannels(userId, limit = 50) {
        const result = await this.cassandra.execute(
            'SELECT * FROM user_channels WHERE user_id = ? LIMIT ?',
            [userId, limit],
            { prepare: true }
        );
        return result.rows;
    }

    async addUserToChannel(userId, channelId, channelType, channelName, isDirect, otherParticipants) {
        await this.cassandra.execute(
            'INSERT INTO user_channels (user_id, channel_id, last_read_at, channel_type, channel_name, is_direct, other_participants) VALUES (?, ?, toTimestamp(now()), ?, ?, ?, ?)',
            [userId, channelId, channelType, channelName, isDirect, otherParticipants],
            { prepare: true }
        );
    }

    async updateUserChannelLastRead(userId, channelId) {
        await this.cassandra.execute(
            'UPDATE user_channels SET last_read_at = toTimestamp(now()) WHERE user_id = ? AND channel_id = ?',
            [userId, channelId],
            { prepare: true }
        );
    }

    async removeUserChannel(userId, channelId) {
        await this.cassandra.execute(
            'DELETE FROM user_channels WHERE user_id = ? AND channel_id = ?',
            [userId, channelId],
            { prepare: true }
        );
    }

    // Channel participants operations
    async getChannelParticipants(channelId) {
        const result = await this.cassandra.execute(
            'SELECT * FROM channel_participants WHERE channel_id = ?',
            [channelId],
            { prepare: true }
        );
        return result.rows;
    }

    async addChannelParticipant(channelId, userId, role = 'member') {
        await this.cassandra.execute(
            'INSERT INTO channel_participants (channel_id, user_id, joined_at, role) VALUES (?, ?, toTimestamp(now()), ?)',
            [channelId, userId, role],
            { prepare: true }
        );
    }

    // Message operations
    async getChannelMessages(channelId, limit = 50, beforeMessageId = null) {
        let query = 'SELECT * FROM channel_messages WHERE channel_id = ?';
        const params = [channelId];

        if (beforeMessageId) {
            query += ' AND message_id < ?';
            params.push(beforeMessageId);
        }

        query += ' ORDER BY message_id DESC LIMIT ?';
        params.push(limit);

        const result = await this.cassandra.execute(query, params, { prepare: true });
        return result.rows;
    }

    async storeMessage(channelId, messageId, userId, content, metadata = {}) {
        const query = 'INSERT INTO channel_messages (channel_id, message_id, user_id, content, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?)';
        const params = [channelId, messageId, userId, content, new Date(), metadata];

        await this.cassandra.execute(query, params, { prepare: true });

        return {
            channel_id: channelId,
            message_id: messageId,
            user_id: userId,
            content,
            created_at: new Date(),
            metadata
        };
    }

    async removeChannelParticipant(channelId, userId) {
        await this.cassandra.execute(
            'DELETE FROM channel_participants WHERE channel_id = ? AND user_id = ?',
            [channelId, userId],
            { prepare: true }
        );
    }

    async close() {
        await this.cassandra.shutdown();
    }
}