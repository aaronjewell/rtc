import zookeeper from 'node-zookeeper-client';

export class ServiceDiscovery {
    constructor() {
        this.client = zookeeper.createClient(process.env.SERVICE_DISCOVERY_HOST);
        this.serverIdPath = '/message-dispatcher/server-ids';
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.client.once('connected', async () => {
                console.log('Connected to Zookeeper');
                try {
                    await this.ensurePaths();
                    const serverId = await this.assignServerId();
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
        await this.createNode('/message-dispatcher', null, zookeeper.CreateMode.PERSISTENT);
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
        console.log(`Assigned server ID: ${serverId}`);
        return serverId;
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

    getState() {
        return this.client.getState()?.name;
    }

    close() {
        this.client.close();
    }
} 