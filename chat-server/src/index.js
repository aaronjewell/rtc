import { ChatServer } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';
import { DAL } from './dal.js';
import { IdGenerator } from './id-generator.js';

try {
    const serviceDiscovery = new ServiceDiscovery();
    const serverId = await serviceDiscovery.init();
    console.log(`Assigned server ID: ${serverId}`);

    const idGenerator = new IdGenerator(serverId);

    const dal = new DAL();
    await dal.init();

    // Create chat server with all dependencies
    const server = new ChatServer(dal, serviceDiscovery, idGenerator, serverId);
    await server.init();
} catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
}