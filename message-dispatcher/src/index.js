import { Kafka } from 'kafkajs';
import { Redis } from 'ioredis';

const kafka = new Kafka({
    clientId: 'message-dispatcher',
    brokers: [process.env.KAFKA_BROKER]
});

const consumer = kafka.consumer({ 
    groupId: 'message-dispatcher-group',
    sessionTimeout: 30000,
    heartbeatInterval: 3000
});

const redis = new Redis(process.env.REDIS_HOST);

async function dispatchMessage(message) {
    try {
        const messageData = JSON.parse(message.value.toString());
        const { target_user_id } = messageData;

        const serverInfo = await redis.hgetall(`user:${target_user_id}`);
        if (!serverInfo || !serverInfo.host) {
            console.log(`No server found for user ${target_user_id}`);
            return;
        }

        const response = await fetch(`http://${serverInfo.host}:${serverInfo.port}/dispatch-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageData)
        });

        if (!response.ok) {
            throw new Error(`Failed to dispatch message: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error dispatching message:', error);
    }
}

async function run() {
    await consumer.connect();
    await consumer.subscribe({ topic: 'chat-messages', fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
            await dispatchMessage(message);
        }
    });
}

run().catch(console.error);
