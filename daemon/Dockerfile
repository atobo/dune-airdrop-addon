FROM node:20-alpine

# Create a non-root user
RUN addgroup -S duneapp && adduser -S duneapp -G duneapp

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache docker-cli bash python3 && npm install --omit=dev

COPY . .
RUN chown -R duneapp:duneapp /app

USER duneapp

CMD ["node", "index.js"]
