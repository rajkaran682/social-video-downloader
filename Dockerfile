FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       python3-pip \
       ffmpeg \
       git \
    && pip3 install --break-system-packages --no-cache-dir -U yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install yt-dlp PO Token provider
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    -U bgutil-ytdlp-pot-provider

# Download provider source and build the token generator
RUN git clone --depth 1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil-ytdlp-pot-provider \
    && cd /opt/bgutil-ytdlp-pot-provider/server \
    && npm install \
    && npx tsc

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

# Tell yt-dlp where the PO Token provider script is
ENV YT_DLP_POT_PROVIDER_SCRIPT=/opt/bgutil-ytdlp-pot-provider/server/build/generate_once.js

EXPOSE 10000

CMD ["npm", "start"]