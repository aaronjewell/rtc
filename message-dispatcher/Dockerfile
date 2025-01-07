FROM node:22-alpine

WORKDIR /app

# Copy shared library first
COPY shared /app/shared
WORKDIR /app/shared
RUN npm install

# Move back to app directory and install dependencies
WORKDIR /app/message-dispatcher
COPY message-dispatcher/package*.json ./
RUN npm install

# Copy application code
COPY message-dispatcher/. .

EXPOSE 8080
CMD ["node", "src/index.js"]