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