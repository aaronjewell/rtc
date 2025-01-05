import { Kafka } from 'kafkajs';
import { Redis } from 'ioredis';

const kafka = new Kafka({
    clientId: 'message-dispatcher',
    brokers: [process.env.KAFKA_BROKER],
});

const consumer = kafka.consumer({ groupId: 'message-dispatcher' });
const admin = kafka.admin();

const redis = new Redis({
    host: process.env.REDIS_HOST,
});

async function ensureTopicExists() {
    try {
        await admin.connect();
        const topics = await admin.listTopics();

        if (!topics.includes('chat-messages')) {
            throw new Error('chat-messages topic does not exist');
        }
    } catch (error) {
        console.error(`Failed to ensure chat-messages topic exists`, error);
        throw error;
    } finally {
        await admin.disconnect();
    }
}

async function start() {
    try {
        await ensureTopicExists();
        await consumer.connect();
        await consumer.subscribe({ topic: 'chat-messages' });
        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                const chatMessage = JSON.parse(message.value.toString());

                if (!chatMessage) {
                    console.error(`Received invalid message`, message.value.toString());
                    return;
                }

                const roomUsers = await getRoomUsers(chatMessage.room_id);

                for (const recipientId of roomUsers) {
                    const serverInfo = await redis.hgetall(`user:${recipientId}`);

                    if (serverInfo && serverInfo.serverId) {
                        await sendMessageToServer(serverInfo, chatMessage);
                    } else {
                        // TODO: Handle offline users
                    }
                }
            },
        });
    } catch (error) {
        console.error(`Failed to start message dispatcher`, error);
        process.exit(1);
    }

}

async function getRoomUsers(roomId) {
    return await redis.smembers(`room:${roomId}`);
}

async function sendMessageToServer(serverInfo, chatMessage) {
    try {

        const body = JSON.stringify(chatMessage);


        const response = await fetch(`http://${serverInfo.host}:${serverInfo.port}/dispatch-message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body,
        });

        if (!response.ok) {
            throw new Error(`Failed to send message to server ${serverInfo.serverId} ${serverInfo.host}:${serverInfo.port}`);
        }

        console.log(`Message sent to server ${serverInfo.serverId} ${serverInfo.host}:${serverInfo.port}`, body);
    } catch (error) {
        console.error(`Failed to send message to server ${serverInfo.serverId} ${serverInfo.host}:${serverInfo.port}`);
    }
}

try {
    await start()
} catch (error) {
    console.error(error);
}
