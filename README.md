To run the project, you need to have Docker and Docker Compose installed.

1. Clone the repository
2. Run `docker-compose up -d` to start the services
3. Run `npm install && npm start` in the `test-client` directory to start the client

The system supports both direct messages (DMs) and group channels. When you start the client, you'll see a list of your available channels.

Example usage:

```
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

Features:
- Real-time messaging with WebSocket connections
- Support for both direct messages and group channels
- Channel creation with optional participants
- Channel participant tracking
- Message history on channel join
- Read status tracking
- Presence status updates
- Command-line interface for testing
- Automatic channel list updates
- Message batching for better performance

Message Types:
- Text messages with optional metadata
- System messages (join/leave/create notifications)
- Presence updates
- Channel status updates

The client supports:
- Connecting to both chat and presence servers
- Creating and managing channels
- Managing multiple channels simultaneously
- Sending/receiving messages
- Updating presence status
- Viewing presence updates
- Viewing channel participants
- Marking channels as read
- Heartbeat to maintain connection
