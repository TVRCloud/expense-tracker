# Deployment

## Requirements

- Node.js 20+
- MongoDB 6+
- Redis 7+ (optional — app degrades gracefully)
- SMTP server for password reset emails

## Environment variables

Copy `.env.example` to `.env.local` and fill in all values. See the file for descriptions.

Critical variables:
- `MONGODB_URI` — MongoDB connection string
- `NEXTAUTH_SECRET` — must be 32+ random characters
- `NEXTAUTH_URL` — public URL of your deployment

## Build

```bash
yarn build
yarn start
```

The custom `server.ts` must be compiled. The `yarn dev` / `yarn start` scripts use `tsx` (via ts-node) to run it directly.

Add to `package.json` scripts if not present:
```json
"dev": "tsx server.ts",
"start": "NODE_ENV=production tsx server.ts"
```

## Docker

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.ts ./server.ts
EXPOSE 3000
CMD ["yarn", "start"]
```

## Health check

GET `/api/health` — returns `{ status: "ok", timestamp }`. Add this endpoint if needed for container orchestration.

## Scaling

Socket.io requires sticky sessions or a Redis adapter when running multiple instances. Single instance is fine for most self-hosted deployments.
