import { Client } from 'cassandra-driver';

export class DAL {
    constructor() {
        this.cassandra = new Client({
            contactPoints: [process.env.KV_STORE_HOST],
            localDataCenter: 'datacenter1',
            keyspace: 'chat_system',
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
                
                const queries = [
                    `CREATE KEYSPACE IF NOT EXISTS chat_system 
                     WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
                    
                    `CREATE TABLE IF NOT EXISTS chat_system.messages (
                        room_id text,
                        message_id timeuuid,
                        user_id text,
                        content text,
                        timestamp timestamp,
                        PRIMARY KEY ((room_id), message_id)
                    ) WITH CLUSTERING ORDER BY (message_id DESC)`,
                    
                    `CREATE TABLE IF NOT EXISTS chat_system.rooms (
                        room_id text PRIMARY KEY,
                        name text,
                        created_at timestamp
                    )`
                ];

                // Test connection first
                await this.cassandra.connect();
                console.log('Connected to Cassandra successfully');

                // Execute schema creation queries
                for (const query of queries) {
                    await this.cassandra.execute(query);
                }
                
                console.log('Cassandra schema initialized successfully');
                return;

            } catch (error) {
                console.error(`Failed to connect to Cassandra (attempt ${attempt}/${maxRetries}):`, error.message);
                
                if (attempt === maxRetries) {
                    throw new Error(`Failed to connect to Cassandra after ${maxRetries} attempts`);
                }
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    async getRoom(roomId) {
        const result = await this.cassandra.execute(
            'SELECT * FROM chat_system.rooms WHERE room_id = ?',
            [roomId],
            { prepare: true }
        );

        return result.rows.length > 0 ? result.rows[0] : null;
    }

    async getRecentMessages(roomId, limit = 50) {
        const result = await this.cassandra.execute(
            'SELECT * FROM chat_system.messages WHERE room_id = ? LIMIT ?',
            [roomId, limit],
            { prepare: true }
        );

        return result.rows;
    }

    async storeMessage(roomId, userId, content) {
        await this.cassandra.execute(
            'INSERT INTO chat_system.messages (room_id, message_id, user_id, content, timestamp) VALUES (?, now(), ?, ?, toTimestamp(now()))',
            [roomId, userId, content],
            { prepare: true }
        );
    }

    async close() {
        await this.cassandra.shutdown();
    }
}