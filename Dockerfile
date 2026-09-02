FROM node:24-bookworm

# System packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp + EJS support
RUN pip3 install --break-system-packages -U "yt-dlp[default]"

# IMPORTANT:
# Keep bgutil plugin and server on the SAME version
RUN pip3 install --break-system-packages -U "bgutil-ytdlp-pot-provider==1.3.1"

# Build bgutil PO Token provider server
RUN git clone --depth 1 --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci \
    && npx tsc

# App directory
WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application
COPY . .

# Environment
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV POT_PROVIDER_URL=http://127.0.0.1:4416

# Render uses PORT automatically
EXPOSE 10000

# Start PO Token server first, test yt-dlp, then start app
CMD ["sh", "-c", "node /opt/bgutil/server/build/main.js & POT_PID=$!; sleep 5; echo '===== BGUTIL STARTED ====='; echo '===== YT-DLP VERSION ====='; yt-dlp --version; echo '===== NODE VERSION ====='; node --version; echo '===== EJS + MWEB TEST ====='; yt-dlp --js-runtimes node --remote-components ejs:github --extractor-args 'youtube:player_client=mweb' --extractor-args 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416' -v --simulate 'https://youtu.be/rirmp7ZQvXs' 2>&1 | head -150; echo '===== STARTING APP ====='; npm start; kill $POT_PID"]
