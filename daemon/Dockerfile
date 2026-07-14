FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache docker-cli bash python3 && npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
