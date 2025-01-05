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

    async getAvailableServers(basePath) {
        return new Promise((resolve, reject) => {
            this.client.getChildren(
                basePath,
                null,
                async (error, children) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    try {
                        const servers = await Promise.all(
                            children.map(child => this.#getServerData(`${basePath}/${child}`))
                        );
                        resolve(servers);
                    } catch (err) {
                        reject(err);
                    }
                }
            );
        });
    }

    async #getServerData(path) {
        return new Promise((resolve, reject) => {
            this.client.getData(
                path,
                null,
                (error, data) => {
                    if (error) {
                        // Handle case where node was deleted
                        if (error.getCode() === zookeeper.Exception.NO_NODE) {
                            resolve(null);
                            return;
                        }
                        reject(error);
                        return;
                    }
                    try {
                        resolve(JSON.parse(data.toString()));
                    } catch (parseError) {
                        console.error(`Failed to parse server data at ${path}:`, parseError);
                        resolve(null);
                    }
                }
            );
        });
    }

    selectOptimalServer(servers) {
        if (!servers || servers.length === 0) {
            return null;
        }

        // TODO: Implement more sophisticated selection based on:
        // - Server load
        // - Geographic proximity
        // - Response time
        // - Connection count
        return servers[Math.floor(Math.random() * servers.length)];
    }

    close() {
        this.client.close();
    }
}