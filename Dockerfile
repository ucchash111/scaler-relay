FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN npm install --production

COPY . .

EXPOSE 3000

# Ensure config directory exists
RUN mkdir -p config

CMD ["node", "src/index.js"]
