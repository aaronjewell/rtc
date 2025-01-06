export const up = async (client) => {
    const migrations = [
        `CREATE TABLE IF NOT EXISTS channels (
            channel_id uuid,
            type text,
            created_at timestamp,
            metadata map<text, text>,
            PRIMARY KEY (channel_id)
        )`,

        `CREATE TABLE IF NOT EXISTS user_channels (
            user_id text,
            channel_id uuid,
            last_read_at timestamp,
            channel_type text,
            channel_name text,
            is_direct boolean,
            other_participants set<text>,
            PRIMARY KEY ((user_id), channel_id)
        )`,

        `CREATE TABLE IF NOT EXISTS channel_participants (
            channel_id uuid,
            user_id text,
            joined_at timestamp,
            role text,
            PRIMARY KEY ((channel_id), user_id)
        )`,

        `CREATE TABLE IF NOT EXISTS channel_messages (
            channel_id uuid,
            message_id bigint,
            user_id text,
            content text,
            created_at timestamp,
            metadata map<text, text>,
            PRIMARY KEY ((channel_id), message_id)
        ) WITH CLUSTERING ORDER BY (message_id DESC)`
    ];

    for (const migration of migrations) {
        await client.execute(migration);
    }
};

export const down = async (client) => {
    const migrations = [
        `DROP TABLE IF EXISTS user_channels`,
        `DROP TABLE IF EXISTS channel_messages`,
        `DROP TABLE IF EXISTS channel_participants`,
        `DROP TABLE IF EXISTS channels`,
    ];

    for (const migration of migrations) {
        await client.execute(migration);
    }
};