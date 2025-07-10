FROM node:22-alpine3.21

WORKDIR /app

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    font-noto-emoji \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    imagemagick

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package*.json ./
COPY local.conf /etc/fonts/local.conf

RUN npm ci

COPY ./lib/** ./lib/

EXPOSE 5000

CMD ["npm", "start"]