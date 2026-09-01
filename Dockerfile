FROM node:24-bookworm

# Basic packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       python3-pip \
       ffmpeg \
       git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp + PO Token provider plugin
RUN pip3 install \
    --break-system-packages \
    --no-cache-dir \
    -U \
    yt-dlp \
    bgutil-ytdlp-pot-provider

WORKDIR /app

# Install application dependencies
COPY package*.json ./

RUN npm install --omit=dev

# Copy application
COPY . .

# Build PO Token HTTP provider
RUN git clone --depth 1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil-provider \
    && cd /opt/bgutil-provider/server \
    && npm ci \
    && npx tsc

ENV NODE_ENV=production

ENV YTDLP_PATH=/usr/local/bin/yt-dlp

# Tell yt-dlp where the PO Token server will run
ENV YT_DLP_POT_PROVIDER_URL=http://127.0.0.1:4416

EXPOSE 10000

# Start PO Token server and then the main Node server
CMD ["sh", "-c", "node /opt/bgutil-provider/server/build/main.js & sleep 3 && npm start"]