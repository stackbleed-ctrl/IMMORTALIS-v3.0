FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json .
RUN npm install --production --frozen-lockfile 2>/dev/null || npm install --production

# Copy source
COPY server ./server
COPY public ./public

EXPOSE 3000
ENV NODE_ENV=production

# Persistent DB mount point
VOLUME ["/data"]
ENV DB_PATH=/data/immortalis.db

CMD ["node", "server/index.js"]
