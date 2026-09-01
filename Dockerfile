FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       python3-pip \
       ffmpeg \
       git \
       unzip \
    && pip3 install --break-system-packages --no-cache-dir -U \
       yt-dlp \
       bgutil-ytdlp-pot-provider \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 10000

CMD ["npm", "start"]
