# Use a full Node image to handle SQLite compilation
FROM node:20-slim

# Install system dependencies for Chrome and SQLite build tools
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    python3 \
    make \
    g++ \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libadwaita-1-0 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Latest Chrome for Puppeteer
RUN apt-get update && apt-get install -y google-chrome-stable || \
    (wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    apt-get update && apt-get install -y google-chrome-stable)

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with build from source
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
