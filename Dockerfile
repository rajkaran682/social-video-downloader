FROM node:24-bookworm

# System packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       python3-pip \
       ffmpeg \
       git \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp and the matching PO Token plugin
RUN python3 -m pip install \
    --break-system-packages \
    --no-cache-dir \
    "yt-dlp" \
    "bgutil-ytdlp-pot-provider==1.3.1"

WORKDIR /app

# Application dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Build the PO Token HTTP provider
RUN git clone \
    --depth 1 \
    --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil-provider \
    && cd /opt/bgutil-provider/server \
    && npm ci \
    && npx tsc

# Application
COPY . .

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV POT_PROVIDER_URL=http://127.0.0.1:4416

EXPOSE 10000

# Start PO Token provider first, then the downloader API
CMD ["sh", "-c", "node /opt/bgutil-provider/server/build/main.js & PROVIDER_PID=$!; sleep 5; if ! kill -0 $PROVIDER_PID 2>/dev/null; then echo 'PO Token provider failed to start'; exit 1; fi; exec npm start"]