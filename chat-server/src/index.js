import { ChatServer } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';
import { DAL } from './dal.js';
import { v4 as uuidv4 } from 'uuid';

const serverId = process.env.SERVER_ID + '-' + uuidv4();

const serviceDiscovery = new ServiceDiscovery(serverId);

try {
    await serviceDiscovery.init();
} catch (error) {
    console.error('Failed to initialize service discovery:', error);
    process.exit(1);
}

const dal = new DAL();

try {
    await dal.init();
} catch (error) {
    console.error('Failed to initialize DAL:', error);
    process.exit(1);
}

const server = new ChatServer(dal, serviceDiscovery, serverId);

try {
    await server.init()
} catch (error) {
    console.error('Failed to start chat server:', error);
    process.exit(1);
}