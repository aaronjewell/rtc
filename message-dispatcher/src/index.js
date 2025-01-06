import { Kafka } from 'kafkajs';
import { Redis } from 'ioredis';

const kafka = new Kafka({
    clientId: 'message-dispatcher',
    brokers: [process.env.KAFKA_BROKER],
    consumer: {
        maxInFlightRequests: 5,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        maxBytesPerPartition: 1048576, // 1MB
        retry: {
            initialRetryTime: 100,
            maxRetryTime: 3000
        },
        readUncommitted: false,
        maxWaitTimeInMs: 100,
        fetch: {
            min: 16384, // 16KB minimum
            max: 1048576, // 1MB maximum
            maxWaitTimeMs: 100
        }
    }
});

const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
});

async function getUserServer(userId) {
    const serverInfo = await redis.hgetall(`user:${userId}`);
    if (!serverInfo || !serverInfo.host || !serverInfo.port) {
        return null;
    }
    return serverInfo;
}

async function dispatchMessageBatch(messages) {
    // Group messages by server
    const serverGroups = new Map();
    
    for (const message of messages) {
        const userId = message.target_user_id;
        const serverInfo = await getUserServer(userId);
        
        if (!serverInfo) {
            console.log(`No server found for user ${userId}`);
            continue;
        }

        const serverKey = `${serverInfo.host}:${serverInfo.port}`;
        if (!serverGroups.has(serverKey)) {
            serverGroups.set(serverKey, { serverInfo, messages: [] });
        }
        serverGroups.get(serverKey).messages.push(message);
    }

    // Dispatch messages in parallel, grouped by server
    const dispatchPromises = Array.from(serverGroups.values()).map(async ({ serverInfo, messages }) => {
        try {
            const url = `http://${serverInfo.host}:${serverInfo.port}/dispatch-message`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ messages }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            console.log(`Batch of ${messages.length} messages dispatched to server ${serverInfo.host}:${serverInfo.port}`);
        } catch (error) {
            console.error(`Failed to dispatch batch to server ${serverInfo.host}:${serverInfo.port}:`, error.message);
        }
    });

    await Promise.all(dispatchPromises);
}

async function run() {
    const consumer = kafka.consumer({ 
        groupId: 'message-dispatcher-group',
        partitionAssignmentStrategy: ['cooperative-sticky'],
        readUncommitted: false,
        maxBytesPerPartition: 1048576,
        sessionTimeout: 30000
    });
    
    await consumer.connect();
    console.log('Connected to Kafka');

    await consumer.subscribe({ 
        topic: 'chat-messages',
        fromBeginning: false
    });

    // Message batch processing
    let messageBatch = [];
    let batchTimeout = null;

    const processBatch = async () => {
        if (messageBatch.length > 0) {
            const batch = messageBatch;
            messageBatch = [];
            await dispatchMessageBatch(batch);
        }
    };

    await consumer.run({
        autoCommit: true,
        autoCommitInterval: 5000,
        autoCommitThreshold: 100,
        eachMessage: async ({ topic, partition, message }) => {
            const chatMessage = JSON.parse(message.value.toString());
            
            messageBatch.push(chatMessage);

            // Process batch if it reaches threshold
            if (messageBatch.length >= 100) {
                if (batchTimeout) {
                    clearTimeout(batchTimeout);
                    batchTimeout = null;
                }
                await processBatch();
            } else if (!batchTimeout) {
                // Set timeout to process partial batch
                batchTimeout = setTimeout(async () => {
                    batchTimeout = null;
                    await processBatch();
                }, 100); // 100ms max delay
            }
        }
    });
}

// Graceful shutdown
function setupGracefulShutdown() {
    const shutdown = async () => {
        console.log('Shutting down...');
        // Process any remaining messages
        if (messageBatch && messageBatch.length > 0) {
            await processBatch();
        }
        await redis.quit();
        process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

setupGracefulShutdown();
run().catch(console.error);
