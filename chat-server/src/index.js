import { ChatServer } from './server.js';
import { ServiceDiscovery } from './service-discovery.js';
import { DAL } from './dal.js';
import { IdGenerator } from './id-generator.js';
import { Logger } from '@rtc/shared/logger';

try {
    const serviceDiscovery = new ServiceDiscovery();
    const serverId = await serviceDiscovery.init();
    
    const logger = new Logger({
        serviceName: 'chat-server',
        serviceId: serverId.toString(),
        logstashHost: process.env.LOGSTASH_HOST,
        logstashPort: parseInt(process.env.LOGSTASH_PORT, 10)
    });

    logger.info(`Initializing chat server`, { serverId });

    const idGenerator = new IdGenerator(serverId);

    const dal = new DAL();
    await dal.init();
    logger.info('DAL initialized');

    // Create chat server with all dependencies
    const server = new ChatServer(dal, serviceDiscovery, idGenerator, serverId, logger);
    await server.init();
    logger.info('Chat server initialized and running');

} catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
}