import { PresenceServer } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';
import { DAL } from './dal.js';
import { Logger } from '@rtc/shared/logger';

const logger = new Logger({
    serviceName: 'presence-server',
    serviceId: process.env.SERVICE_ID || '1',
    logstashHost: process.env.LOGSTASH_HOST,
    logstashPort: parseInt(process.env.LOGSTASH_PORT || '5000')
});

const serviceDiscovery = new ServiceDiscovery(logger);

try {
    await serviceDiscovery.init();
} catch (error) {
    logger.error('Failed to initialize service discovery:', { error });
    process.exit(1);
}

const dal = new DAL(logger);

try {
    await dal.init();
} catch (error) {
    logger.error('Failed to initialize DAL:', { error });
    process.exit(1);
}

const server = new PresenceServer(dal, serviceDiscovery, logger);

try {
    await server.init();
} catch (error) {
    logger.error('Failed to start presence server:', { error });
    process.exit(1);
}