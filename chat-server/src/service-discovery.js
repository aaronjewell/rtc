import zookeeper from 'node-zookeeper-client';
import ip from 'ip';

export class ServiceDiscovery {
    constructor() {
        this.client = zookeeper.createClient(process.env.SERVICE_DISCOVERY_HOST);
        this.basePath = '/chat-service';
        this.serverIdPath = '/chat-service/server-ids';
        this.MAX_SERVER_ID = 1023; // Keep 10-bit limit for Snowflake IDs
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.client.once('connected', async () => {
                console.log('Connected to Zookeeper');
                try {
                    await this.ensurePaths();
                    const serverId = await this.claimServerId();
                    await this.registerService(serverId);
                    resolve(serverId);
                } catch (error) {
                    reject(error);
                }
            });

            this.client.on('error', (error) => {
                console.error('Zookeeper connection error:', error);
                reject(error);
            });

            this.client.connect();
        });
    }

    async ensurePaths() {
        await this.createNode(this.basePath, null, zookeeper.CreateMode.PERSISTENT);
        await this.createNode(this.serverIdPath, null, zookeeper.CreateMode.PERSISTENT);
    }

    async claimServerId() {
        const path = await new Promise((resolve, reject) => {
            this.client.create(
                `${this.serverIdPath}/id-`,
                null,
                zookeeper.CreateMode.EPHEMERAL_SEQUENTIAL,
                (error, path) => error ? reject(error) : resolve(path)
            );
        });

        // Extract sequence number and map to server ID range
        const seq = parseInt(path.split('-').pop(), 10);
        const serverId = seq % (this.MAX_SERVER_ID + 1);
        
        console.log(`Claimed server ID ${serverId} (sequence: ${seq}, path: ${path})`);
        return serverId;
    }

    async registerService(serverId) {
        const serverPath = `${this.basePath}/${serverId}`;
        const serverData = JSON.stringify({
            id: serverId,
            host: ip.address(),
            port: process.env.PORT,
            timestamp: Date.now()
        });

        try {
            await this.createNode(
                serverPath, 
                Buffer.from(serverData), 
                zookeeper.CreateMode.EPHEMERAL
            );
            console.log(`Registered chat server ${serverId} in Zookeeper`);
        } catch (error) {
            console.error('Failed to register with Zookeeper:', error);
            throw error;
        }
    }

    createNode(path, data, mode) {
        return new Promise((resolve, reject) => {
            this.client.create(
                path,
                data,
                mode,
                (error) => {
                    if (error) {
                        if (error.getCode() === zookeeper.Exception.NODE_EXISTS) {
                            resolve();
                        } else {
                            reject(error);
                        }
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    close() {
        this.client.close();
    }
}