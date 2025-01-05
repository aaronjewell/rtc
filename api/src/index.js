import { DAL } from './dal.js';
import { API } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';

const port = process.env.PORT;
const dal = new DAL();
const serviceDiscovery = new ServiceDiscovery();

try {
    await dal.init();
} catch (error) {
    console.error('Failed to initialize DAL:', error);
    process.exit(1);
}

try {
    await serviceDiscovery.init();
} catch (error) {
    console.error('Failed to initialize Service Discovery:', error);
    process.exit(1);
}

const server = new API(dal, serviceDiscovery);

try {
    await server.init();
} catch (error) {
    console.error('Failed to initialize API:', error);
    process.exit(1);
}

server.app.listen(port, () => {
    console.log(`API listening on port ${port}`);
});