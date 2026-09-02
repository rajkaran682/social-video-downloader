FROM node:24-bookworm

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

COPY package*.json ./
RUN npm install --omit=dev

# Build bgutil HTTP PO Token server
RUN git clone --depth 1 --branch 1.3.1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci \
    && npx tsc

COPY . .

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV POT_PROVIDER_URL=http://127.0.0.1:4416

EXPOSE 10000

CMD ["sh", "-c", "node /opt/bgutil/server/build/main.js & POT_PID=$!; sleep 5; echo '===== YT-DLP VERSION ====='; yt-dlp --version; echo '===== YT-DLP PLUGINS ====='; yt-dlp -v --simulate https://youtu.be/rirmp7ZQvXs 2>&1 | head -80; echo '===== STARTING APP ====='; npm start; kill $POT_PID"]
