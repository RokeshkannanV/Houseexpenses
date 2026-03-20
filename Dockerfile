# Use a Node image that includes Chrome dependencies
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of your app
COPY . .

# Environment variables
ENV RENDER=true
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the server
CMD [ "node", "server.js" ]
