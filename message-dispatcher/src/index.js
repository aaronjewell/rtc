import { Kafka } from 'kafkajs';
import express from 'express';
import Redis from 'ioredis';
import { Logger } from '@rtc/shared/logger';

const logger = new Logger({
    serviceName: 'message-dispatcher',
    serviceId: process.env.SERVICE_ID || '1',
    logstashHost: process.env.LOGSTASH_HOST,
    logstashPort: parseInt(process.env.LOGSTASH_PORT || '5000')
});

async function checkHealth(redis, consumer) {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        components: {
            kafka: 'unknown',
            redis: 'unknown',
        }
    };

    try {
        // Check Redis
        const redisStatus = await redis.ping();
        health.components.redis = redisStatus === 'PONG' ? 'ok' : 'error';
    } catch (error) {
        health.components.redis = 'error';
        health.status = 'error';
        logger.error('Redis health check failed', { error: error.message });
    }

    try {
        // Check Kafka consumer
        const isConnected = consumer.connection?.connected ?? false;
        health.components.kafka = isConnected ? 'ok' : 'error';
        if (!isConnected) {
            health.status = 'error';
        }
    } catch (error) {
        health.components.kafka = 'error';
        health.status = 'error';
        logger.error('Kafka health check failed', { error: error.message });
    }

    return health;
}

async function initialize() {
    logger.info('Initialized message dispatcher');

    const kafka = new Kafka({
        clientId: `message-dispatcher`,
        brokers: [process.env.KAFKA_BROKER]
    });

    const consumer = kafka.consumer({ 
        groupId: 'message-dispatcher-group',
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        rebalanceTimeout: 60000,
        maxWaitTimeInMs: 50,
        maxBytesPerPartition: 1048576,
        retry: {
            initialRetryTime: 100,
            retries: 8
        }
    });

    const redis = new Redis(process.env.REDIS_HOST);

    let server = null;
    try {
        // Setup express server for health checks
        const app = express();
        app.get('/health', async (req, res) => {
            const health = await checkHealth(redis, consumer);
            res.status(health.status === 'ok' ? 200 : 503).json(health);
        });
        
        server = app.listen(process.env.PORT, () => {
            logger.info(`Health check server started on port ${process.env.PORT}`);
        });

        server.on('error', (error) => {
            logger.error('Health check server error', { 
                error: error.message,
                stack: error.stack 
            });
            // Don't fail initialization if health check server fails
            server = null;
        });
    } catch (error) {
        logger.error('Failed to start health check server', { 
            error: error.message,
            stack: error.stack 
        });
        // Continue without health check server
    }

    return { kafka, consumer, redis, server };
}

async function dispatchMessage(message, redis) {
    try {
        const messageData = JSON.parse(message.value.toString());
        const { target_user_id } = messageData;

        const serverInfo = await redis.hgetall(`user:${target_user_id}`);
        if (!serverInfo || !serverInfo.host) {
            logger.info(`No server found for user ${target_user_id}`);
            return;
        }

        logger.info(`Dispatching message to server ${serverInfo.host}:${serverInfo.port}`);

        const response = await fetch(`http://${serverInfo.host}:${serverInfo.port}/dispatch-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageData)
        });

        if (!response.ok) {
            throw new Error(`Failed to dispatch message: ${response.statusText}`);
        }
    } catch (error) {
        logger.error('Error dispatching message:', { error });
    }
}

async function run() {
    try {
        const { consumer, redis, server } = await initialize();
        
        await consumer.connect();
        logger.info('Connected to Kafka');

        await consumer.subscribe({ 
            topic: 'chat-messages', 
            fromBeginning: false
        });

        await consumer.run({
            autoCommit: true,
            autoCommitInterval: 5000,
            autoCommitThreshold: 100,
            eachMessage: async ({ message }) => {
                await dispatchMessage(message, redis);
            }
        });

        logger.info(`Message dispatcher is running`);

        // Graceful shutdown
        const shutdown = async () => {
            logger.info(`Shutting down message dispatcher...`);
            try {
                await consumer.disconnect();
                redis.disconnect();
                server.close();
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown:', { error });
                process.exit(1);
            }
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error) {
        logger.error('Failed to start message dispatcher:', { error });
        process.exit(1);
    }
}

try {
    run();
} catch (error) {
    logger.error('Fatal error during startup', { error });
    process.exit(1);
}