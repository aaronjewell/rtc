import { PresenceServer } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';
import { DAL } from './dal.js';

const serviceDiscovery = new ServiceDiscovery();


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

const server = new PresenceServer(dal, serviceDiscovery);

try {
    await server.init();
} catch (error) {
    console.error('Failed to start presence server:', error);
    process.exit(1);
}