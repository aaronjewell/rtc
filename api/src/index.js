import { API } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';
import { DAL } from './dal.js';
import { Logger } from '@rtc/shared/logger';

try {
    const serviceDiscovery = new ServiceDiscovery();
    await serviceDiscovery.init();

    const logger = new Logger({
        serviceName: 'api',
        serviceId: process.env.SERVER_ID || '1',
        logstashHost: process.env.LOGSTASH_HOST || 'logstash',
        logstashPort: parseInt(process.env.LOGSTASH_PORT || '5000', 10)
    });

    logger.info('Initializing API server');

    const dal = new DAL();
    await dal.init();
    logger.info('DAL initialized');

    const api = new API(dal, serviceDiscovery, logger);
    await api.init();
    logger.info('API server initialized and running');

} catch (error) {
    console.error('Failed to initialize API:', error);
    process.exit(1);
}