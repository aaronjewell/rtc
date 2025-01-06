import { Client } from 'cassandra-driver';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
    contactPoints: [process.env.KV_STORE_HOST],
    localDataCenter: 'datacenter1',
    protocolOptions: { port: 9042 },
});

async function waitForCassandra(retries = 30, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            await client.connect();
            console.log('Successfully connected to Cassandra');
            return true;
        } catch (error) {
            console.log(`Cassandra not ready (attempt ${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Failed to connect to Cassandra');
}

async function runMigrations() {
    try {
        await waitForCassandra();

        await client.execute(`
            CREATE KEYSPACE IF NOT EXISTS ${process.env.KV_KEYSPACE}
            WITH replication = {
                'class': 'SimpleStrategy',
                'replication_factor': 1
            }
        `);

        await client.execute(`
            CREATE TABLE IF NOT EXISTS ${process.env.KV_KEYSPACE}.migrations (
                version text PRIMARY KEY,
                applied_at timestamp
            )
        `);

        await client.execute(`USE ${process.env.KV_KEYSPACE}`);

        const { rows: appliedMigrations } = await client.execute(
            `SELECT version FROM ${process.env.KV_KEYSPACE}.migrations`
        );
        const applied = new Set(appliedMigrations.map(r => r.version));

        const migrationFiles = await readdir(join(__dirname, 'migrations'));
        migrationFiles.sort();

        for (const file of migrationFiles) {
            const version = file.split('_')[0];
            if (!applied.has(version)) {
                console.log(`Applying migration ${file}...`);

                const migration = await import(`./migrations/${file}`);
                await migration.up(client);

                await client.execute(
                    'INSERT INTO migrations (version, applied_at) VALUES (?, ?)',
                    [version, new Date()]
                );

                console.log(`Migration ${file} completed`);
            }
        }

        console.log('All chat-server migrations completed successfully');
    } catch (error) {
        throw error;
    } finally {
        await client.shutdown();
    }
}

try {
    await runMigrations();
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
}