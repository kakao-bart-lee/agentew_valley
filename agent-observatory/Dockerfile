# Use node 20
FROM node:20-slim AS builder

# Set pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy pnpm workspace files
COPY package-lock.json* package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/collectors/package.json ./packages/collectors/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Copy all source files first (required for workspace links)
COPY . .

# Install dependencies
RUN pnpm install

RUN rm -f pnpm-workspace.yaml

RUN cd packages/shared && npx tsc && cd ../collectors && npx tsc && cd ../server && npx tsc && cd ../web && npx tsc

# --- Runtime Stage ---
FROM node:20-slim

WORKDIR /app

RUN npm install -g pnpm

# Copy built artifacts
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/collectors ./packages/collectors
COPY --from=builder /app/packages/server ./packages/server
COPY --from=builder /app/packages/web/dist ./packages/web/dist

# Env vars
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

# Start the server
CMD ["pnpm", "--filter", "@agent-observatory/server", "start"]
