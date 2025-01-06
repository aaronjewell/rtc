import { randomUUID } from 'crypto';
import { uuidv5 } from 'uuid';

export async function createDirectChannel(user1Id, user2Id) {
    const participants = [user1Id, user2Id].sort();
    
    const channelId = createDirectChannelId(participants[0], participants[1]);

    const channel = {
        channel_id: channelId,
        type: 'direct',
        created_at: new Date(),
        updated_at: new Date(),
        members: participants,
        metadata: {
            is_private: true
        }
    };

    return channel;
}

export async function createGroupChannel(name, creatorId, initialMembers = []) {
    const channel = {
        channel_id: randomUUID(),
        type: 'group',
        name,
        created_at: new Date(),
        updated_at: new Date(),
        members: [creatorId, ...initialMembers],
        metadata: {
            is_private: false,
            creator_id: creatorId
        }
    };

    return channel;
}

function createDirectChannelId(user1Id, user2Id) {
    // Using a UUID v5 with a namespace ensures the same two users 
    // always get the same channel ID
    const namespace = '1b671a64-40d5-491e-99b0-da01ff1f3341'; // Static UUID for direct channels
    const data = `${user1Id}-${user2Id}`;
    return uuidv5(data, namespace);
}