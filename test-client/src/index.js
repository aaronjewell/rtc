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

        client.on('message', (message) => {
            console.log(chalk.cyan(`\n${message.user_id}: ${message.content}`));
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

        await client.connect();

        rl.on('line', async (input) => {
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
    console.log('/join <roomId> - Join a chat room');
    console.log('/msg <message> - Send message to current room');
    console.log('/status <status> - Update your presence status');
    console.log('/quit - Exit the application');
    rl.prompt(true);
}

async function handleCommand(input, client) {
    if (!input) return;

    const [command, ...args] = input.slice(1).split(' ');

    switch (command) {
        case 'help':
            showHelp();
            break;

        case 'join':
            if (!args[0]) {
                throw new Error('Room ID required');
            }
            await client.joinRoom(args[0]);
            console.log(chalk.green(`Joined room: ${args[0]}`));
            break;

        case 'msg':
            if (!args.length) {
                throw new Error('Message required');
            }
            await client.sendMessage(args.join(' '));
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
    await main()
} catch (error) {
    console.error(error)
}