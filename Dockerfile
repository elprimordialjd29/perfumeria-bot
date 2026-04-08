FROM node:20-slim

# Instalar Chromium para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Decirle a Puppeteer que use el Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV TZ=America/Bogota

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "bot.js"]
