FROM node:24-alpine

WORKDIR /app

# Install build tools needed for better-sqlite3 and pnpm
RUN apk add --no-cache python3 make g++ && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN pnpm run build

# Data directory for SQLite
RUN mkdir -p /app/data

CMD ["node", "dist/index.js"]
