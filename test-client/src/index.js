import { ChatClient } from './chat-client.js';
import readline from 'readline';
import chalk from 'chalk';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    try {
        const client = new ChatClient({
            apiUrl: 'http://localhost:80',
            username: process.env.TEST_USERNAME || 'testuser',
            password: process.env.TEST_PASSWORD || 'testpassword'
        });

        client.on('connected', () => {
            console.log(chalk.green('✓ Connected to servers'));
            showHelp();
        });

        client.on('channels_updated', (channels) => {
            console.log(chalk.blue('\nYour channels:'));
            channels.forEach(channel => {
                const type = channel.is_direct ? 'DM' : 'Group';
                console.log(chalk.blue(`${channel.channel_id} (${type}): ${channel.channel_name || 'Unnamed channel'}`));
            });
            rl.prompt(true);
        });

        client.on('message', (message) => {
            console.log(chalk.cyan(`\n[${message.channelId}] ${message.userId}: ${message.content}`));
            rl.prompt(true);
        });

        client.on('channel_joined', (data) => {
            console.log(chalk.green(`\nJoined channel: ${data.channelId}`));
            console.log(chalk.green('Participants:', data.participants.map(p => p.user_id).join(', ')));
            if (data.messages.length > 0) {
                console.log(chalk.yellow('\nRecent messages:'));
                data.messages.forEach(msg => {
                    console.log(chalk.cyan(`${msg.user_id}: ${msg.content}`));
                });
            }
            rl.prompt(true);
        });

        client.on('channel_left', (channelId) => {
            console.log(chalk.yellow(`\nLeft channel: ${channelId}`));
            rl.prompt(true);
        });

        client.on('presence', (update) => {
            console.log(chalk.yellow(`\n${update.user_id} is now ${update.status}`));
            rl.prompt(true);
        });

        client.on('error', (error) => {
            console.error(chalk.red(`\nError: ${error.message}`));
            rl.prompt(true);
        });

        client.on('channel_created', (channel) => {
            console.log(chalk.green(`\nCreated new channel: ${channel.metadata.name} (${channel.channel_id})`));
            console.log(chalk.green('Participants:', channel.participants.join(', ')));
            rl.prompt(true);
        });

        await client.connect();

        rl.on('line', async (input) => {
            if (!input.startsWith('/')) {
                // Treat as message to current channel
                try {
                    await client.sendMessage(input);
                } catch (error) {
                    console.error(chalk.red(`Error: ${error.message}`));
                }
                rl.prompt(true);
                return;
            }

            try {
                await handleCommand(input, client);
            } catch (error) {
                console.error(chalk.red(`Error: ${error.message}`));
            }
            rl.prompt(true);
        });

    } catch (error) {
        console.error(chalk.red('Failed to start client:', error.message));
        process.exit(1);
    }
}

function showHelp() {
    console.log(chalk.green('\nAvailable commands:'));
    console.log('/help - Show this help message');
    console.log('/create <name> [participant1 participant2 ...] - Create a new channel');
    console.log('/join <channelId> - Join a channel');
    console.log('/leave <channelId> - Leave a channel');
    console.log('/msg <message> - Send message to current channel');
    console.log('/read <channelId> - Mark channel as read');
    console.log('/status <status> - Update your presence status');
    console.log('/quit - Exit the application');
    console.log('\nOr just type a message to send to the current channel');
    rl.prompt(true);
}

async function handleCommand(input, client) {
    if (!input) return;

    const [command, ...args] = input.slice(1).split(' ');

    switch (command) {
        case 'help':
            showHelp();
            break;

        case 'create':
            if (!args[0]) {
                throw new Error('Channel name required');
            }
            const [name, ...participants] = args;
            await client.createChannel(name, participants);
            break;

        case 'join':
            if (!args[0]) {
                throw new Error('Channel ID required');
            }
            await client.joinChannel(args[0]);
            break;

        case 'leave':
            if (!args[0]) {
                throw new Error('Channel ID required');
            }
            await client.leaveChannel(args[0]);
            break;

        case 'msg':
            if (!args.length) {
                throw new Error('Message required');
            }
            await client.sendMessage(args.join(' '));
            break;

        case 'read':
            if (!args[0]) {
                throw new Error('Channel ID required');
            }
            await client.markChannelRead(args[0]);
            console.log(chalk.green(`Marked channel ${args[0]} as read`));
            break;

        case 'status':
            if (!args[0]) {
                throw new Error('Status required');
            }
            await client.updateStatus(args[0]);
            console.log(chalk.green(`Status updated to: ${args[0]}`));
            break;

        case 'quit':
            await client.disconnect();
            console.log(chalk.green('Goodbye!'));
            process.exit(0);
            break;

        default:
            console.log(chalk.red('Unknown command. Type /help for available commands.'));
    }
}

try {
    await main();
} catch (error) {
    console.error(error);
}