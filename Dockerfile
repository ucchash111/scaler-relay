FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

# Ensure config directory exists
RUN mkdir -p config

CMD ["node", "src/index.js"]
