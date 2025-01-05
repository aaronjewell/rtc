import { Client } from 'cassandra-driver';

export class DAL {
    constructor() {
        this.cassandra = new Client({
            contactPoints: [process.env.KV_STORE_HOST],
            localDataCenter: 'datacenter1',
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
                    `CREATE KEYSPACE IF NOT EXISTS presence_system 
                    WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,

                    `USE presence_system;`,
                    
                    `CREATE TABLE IF NOT EXISTS presence_system.user_presence (
                        user_id text PRIMARY KEY,
                        status text,
                        last_seen timestamp,
                        device_info text,
                        server_id text
                    )`,

                    `CREATE INDEX IF NOT EXISTS user_presence_status_idx 
                    ON presence_system.user_presence (status)`,

                    `CREATE TABLE IF NOT EXISTS presence_system.user_status_history (
                        user_id text,
                        timestamp timestamp,
                        status text,
                        PRIMARY KEY (user_id, timestamp)
                    ) WITH CLUSTERING ORDER BY (timestamp DESC)`
                ];

                await this.cassandra.connect();
                console.log('Connected to Cassandra successfully');

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
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    async updatePresence(userId, status, deviceInfo, serverId) {
        const query = `
            INSERT INTO presence_system.user_presence 
            (user_id, status, last_seen, device_info, server_id) 
            VALUES (?, ?, toTimestamp(now()), ?, ?)
        `;
        
        await this.cassandra.execute(query, [
            userId,
            status,
            deviceInfo,
            serverId
        ], { prepare: true });

        // Store in history
        await this.cassandra.execute(`
            INSERT INTO presence_system.user_status_history 
            (user_id, timestamp, status) 
            VALUES (?, toTimestamp(now()), ?)
        `, [userId, status], { prepare: true });
    }

    async getPresenceData(userIds) {
        const query = `
            SELECT user_id, status, last_seen 
            FROM presence_system.user_presence 
            WHERE user_id IN ?
        `;
        
        const result = await this.cassandra.execute(query, [userIds], { prepare: true });
        return result.rows;
    }

    async getUsersByStatus(status) {
        const query = `
            SELECT user_id, status, last_seen 
            FROM presence_system.user_presence 
            WHERE status = ?
        `;
        
        const result = await this.cassandra.execute(query, [status], { prepare: true });
        return result.rows;
    }

    async close() {
        await this.cassandra.shutdown();
    }
}