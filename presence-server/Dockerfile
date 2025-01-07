FROM node:22-alpine

WORKDIR /app

# Copy shared library first
COPY shared /app/shared
WORKDIR /app/shared
RUN npm install

# Move back to app directory and install dependencies
WORKDIR /app/presence-server
COPY presence-server/package*.json ./
RUN npm install

# Copy application code
COPY presence-server/. .

EXPOSE 80
CMD ["node", "src/index.js"]