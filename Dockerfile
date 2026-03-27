FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

ENV PORT=8686
ENV DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 8686

CMD ["npm", "start"]
