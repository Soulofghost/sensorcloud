FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    SQLITE_DB_PATH=/app/data/sensorcloud.db

RUN apk add --no-cache curl

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

WORKDIR /app
COPY backend /app/backend
COPY frontend /app/frontend

RUN mkdir -p /app/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/v1/health || exit 1

WORKDIR /app/backend
CMD ["node", "src/server.js"]
