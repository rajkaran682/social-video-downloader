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

# Install latest yt-dlp with JavaScript/EJS support
RUN pip3 install --break-system-packages -U "yt-dlp[default]"

# Install bgutil PO Token provider
RUN pip3 install --break-system-packages -U "bgutil-ytdlp-pot-provider==1.3.1"

# Build bgutil PO Token server
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

# Production environment
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV POT_PROVIDER_URL=http://127.0.0.1:4416

# Render public port
EXPOSE 10000

# Start bgutil and then immediately start the Express app
CMD ["sh", "-c", "node /opt/bgutil/server/build/main.js & POT_PID=$!; sleep 3; echo '===== BGUTIL STARTED ====='; echo '===== YT-DLP VERSION ====='; yt-dlp --version; echo '===== NODE VERSION ====='; node --version; echo '===== STARTING APP ====='; npm start; kill $POT_PID"]