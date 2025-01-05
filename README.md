To run the project, you need to have Docker and Docker Compose installed.

1. Clone the repository
2. Run `docker-compose up -d` to start the services
2. Create a test room in Cassandra (automatically done in development mode)
    - `docker exec -it $(docker ps -q -f name=cassandra) cqlsh`

```cassandra
-- Insert a test room
USE chat_system;
INSERT INTO rooms (room_id, name, created_at) 
VALUES ('test-room', 'Test Room', toTimestamp(now()));
```
3. Run `npm install && npm start` in the `test-client` directory to start the client

Example usage:

```
/join test-room    # Join the test room
Hello, world!      # Send a message
/status away       # Update presence status
/quit             # Exit the client
```

The client supports:
- Connecting to both the chat and presence servers
- Joining rooms
- Sending/receiving messages
- Updating presence status
- Viewing presence updates
- Heartbeat to maintain connection
- Command-line interface for testing
