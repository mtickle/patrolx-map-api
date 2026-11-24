# Use lightweight Node environment
FROM node:22-alpine

# Patch Alpine base packages (openssl/zlib/musl) and update bundled npm
RUN apk update && apk upgrade --no-cache && npm install -g npm@latest

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy your application code
COPY . .

# The port your Express server listens on
EXPOSE 3000

# Start the API
CMD ["node", "server.js"]