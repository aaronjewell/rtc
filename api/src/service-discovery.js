import zookeeper from 'node-zookeeper-client';

export class ServiceDiscovery {
    constructor() {
        this.client = zookeeper.createClient(process.env.SERVICE_DISCOVERY_HOST);
    }

    async init() {
        return new Promise((resolve, reject) => {
            this.client.once('connected', () => {
                console.log('Connected to Zookeeper');
                resolve();
            });

            this.client.on('error', (err) => {
                console.error('Zookeeper connection error:', err);
                reject(err);
            });

            this.client.connect();
        });
    }

    async getAvailableServers(servicePath) {
        try {
            const children = await new Promise((resolve, reject) => {
                this.client.getChildren(
                    servicePath,
                    null,
                    (error, children) => error ? reject(error) : resolve(children)
                );
            });

            const servers = await Promise.all(children.map(async child => {
                try {
                    const data = await new Promise((resolve, reject) => {
                        this.client.getData(
                            `${servicePath}/${child}`,
                            null,
                            (error, data) => error ? reject(error) : resolve(data)
                        );
                    });

                    if (!data) {
                        console.warn(`No data found for server ${child}`);
                        return null;
                    }

                    try {
                        const serverInfo = JSON.parse(data.toString());
                        if (!serverInfo.host || !serverInfo.port || serverInfo.id === undefined) {
                            console.warn(`Invalid server data for ${child}:`, serverInfo);
                            return null;
                        }
                        return serverInfo;
                    } catch (parseError) {
                        console.error(`Failed to parse server data for ${child}:`, parseError);
                        return null;
                    }
                } catch (error) {
                    console.error(`Failed to get data for server ${child}:`, error);
                    return null;
                }
            }));

            return servers.filter(server => server !== null);
        } catch (error) {
            console.error(`Failed to get available servers from ${servicePath}:`, error);
            return [];
        }
    }

    getName() {
        return this.client.getState().name;
    }

    getCode() {
        return this.client.getState().code;
    }

    selectOptimalServer(servers) {
        if (!servers || servers.length === 0) {
            return null;
        }

        // For now, just return the first valid server
        // TODO: Implement better selection strategy based on load/latency
        return servers[0];
    }

    close() {
        this.client.close();
    }
}