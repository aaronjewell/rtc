# Real-Time Chat System

A scalable real-time chat system using Node.js, WebSocket, Kafka, Redis, and Cassandra.

## Setup

### Required Secret Files

Before starting the services, you need to create the following secret files:

```
secrets/
├── jwt_secret.txt        # Secret key for JWT token signing (random string)
├── db_password.txt       # Password for MySQL database
├── db_root_password.txt  # Password for MySQL root user
```

Example secret file contents:
```bash
# jwt_secret.txt
your-256-bit-secret

# db_password.txt
your-db-password

# db_root_password.txt
your-db-root-password
```

### Running the Services

1. Create the required secret files as shown above
2. Start the services:
```bash
docker-compose up
```
3. Run the test client:
```bash
cd test-client
npm install
npm start
```

## Test Client Usage

The test client provides a command-line interface for testing the chat system. Here are the available commands:

```bash
# Channel Creation
/create MyChannel              # Create a new group channel
/create "Team Chat" user1 user2 user3  # Create channel with participants

# Basic messaging
/join <channelId>     # Join a channel
Hello, world!         # Send a message to current channel
/leave <channelId>    # Leave a channel

# Channel management
/read <channelId>     # Mark a channel as read
/msg <message>        # Explicitly send a message (alternative to just typing)

# Presence
/status <status>      # Update presence status (online, away, busy, etc.)
/quit                 # Exit the client
```

When you start the client, you'll see a list of your available channels. You can join any channel and start sending messages immediately.

## Architecture

The system consists of several components:

- **Chat Server**: Handles WebSocket connections and real-time message delivery
- **API Server**: Handles authentication and server discovery
- **Message Dispatcher**: Routes messages to chat servers
- **Presence Service**: Tracks user online status
- **Service Discovery**: Zookeeper for server registration and discovery
- **Message Queue**: Kafka for reliable message delivery
- **Cache**: Redis for user to chat server mapping
- **Database**: Cassandra for persistent storage

## Features

- Real-time messaging using WebSockets
- Channel-based communication (group & direct messages)
- Message persistence in Cassandra
- Distributed message delivery via Kafka
- Scalable architecture with multiple chat servers
- Service discovery using Zookeeper
- JWT-based authentication
- User presence tracking
- Message read receipts
- Channel participant management
- Command-line interface for testing
- Automatic channel list updates
- Message batching for better performance

## Message Types

### Client to Server
- `create_channel`: Create a new channel
- `join_channel`: Join an existing channel
- `leave_channel`: Leave a channel
- `chat_message`: Send a message to a channel
- `mark_channel_read`: Mark messages in a channel as read

### Server to Client
- `channels_list`: List of user's channels
- `channel_joined`: Confirmation of joining a channel
- `channel_left`: Confirmation of leaving a channel
- `chat_message`: Incoming message
- `error`: Error notification
