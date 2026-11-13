# Use lightweight Node environment
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy your application code
COPY . .

# The port your Express server listens on
EXPOSE 3000

# Start the API
CMD ["node", "server.js"]