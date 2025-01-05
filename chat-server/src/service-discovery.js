import zookeeper from 'node-zookeeper-client';
import ip from 'ip';

export class ServiceDiscovery {
    constructor() {
        this.client = zookeeper.createClient(process.env.SERVICE_DISCOVERY_HOST);
        this.basePath = '/chat-service';
        this.serverId = process.env.SERVER_ID;
        this.port = process.env.PORT;
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.client.once('connected', () => {
                console.log('Connected to Zookeeper');
                this.registerService().then(resolve).catch(reject);
            });

            this.client.on('error', (error) => {
                console.error('Zookeeper connection error:', error);
                reject(error);
            });

            this.client.connect();
        });
    }

    async registerService() {
        const serverPath = `${this.basePath}/${this.serverId}`;
        const serverData = JSON.stringify({
            id: this.serverId,
            host: ip.address(),
            port: this.port,
            timestamp: Date.now()
        });

        try {
            // Ensure base path exists
            await this.createNode(this.basePath, null, zookeeper.CreateMode.PERSISTENT);
            
            // Register this server (ephemeral node - removes when connection drops)
            await this.createNode(
                serverPath, 
                Buffer.from(serverData), 
                zookeeper.CreateMode.EPHEMERAL
            );

            console.log(`Registered chat server ${this.serverId} in Zookeeper`);
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
                        // Ignore if node already exists
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