FROM node:24-bookworm

# System packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
        git \
        ca-certificates \
    && pip3 install --break-system-packages -U yt-dlp \
    && pip3 install --break-system-packages -U bgutil-ytdlp-pot-provider \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install application dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Install bgutil PO Token provider
RUN git clone --depth 1 --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm ci \
    && npx tsc

# Copy application
COPY . .

# Environment
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV POT_PROVIDER_URL=http://127.0.0.1:4416

EXPOSE 10000

# Start PO Token provider + downloader server
CMD ["sh", "-c", "node /opt/bgutil-ytdlp-pot-provider/server/build/main.js & sleep 3 && npm start"]
