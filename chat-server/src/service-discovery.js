import zookeeper from 'node-zookeeper-client';
import ip from 'ip';

export class ServiceDiscovery {
    constructor() {
        this.client = zookeeper.createClient(process.env.SERVICE_DISCOVERY_HOST);
        this.basePath = '/chat-service';
        this.serverIdPath = '/chat-service/server-ids';
        this.port = process.env.PORT;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.client.once('connected', async () => {
                console.log('Connected to Zookeeper');
                try {
                    await this.ensurePaths();
                    const serverId = await this.assignServerId();
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

    async assignServerId() {
        const path = await new Promise((resolve, reject) => {
            this.client.create(
                `${this.serverIdPath}/id-`,
                null,
                zookeeper.CreateMode.EPHEMERAL_SEQUENTIAL,
                (error, path) => error ? reject(error) : resolve(path)
            );
        });

        const serverId = parseInt(path.split('-').pop(), 10);
        if (serverId > 1023) {
            throw new Error('Server ID exceeds maximum value (1023)');
        }

        console.log(`Assigned server ID: ${serverId}`);
        return serverId;
    }

    async registerService(serverId) {
        const serverPath = `${this.basePath}/${serverId}`;
        const serverData = JSON.stringify({
            id: serverId,
            host: ip.address(),
            port: this.port,
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