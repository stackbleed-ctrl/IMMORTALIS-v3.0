FROM node:20-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY index.js ./
COPY index.html ./

# Optional: copy static assets if they exist
COPY *.md ./
COPY *.toml ./

# Data directory for persistence
RUN mkdir -p /data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Set PERSIST_PATH to enable state persistence across restarts
# ENV PERSIST_PATH=/data/state.json

CMD ["node", "index.js"]
