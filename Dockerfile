# Production Dockerfile for Outbox Labs
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root and package dependencies
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN npm ci

# Copy all source code
COPY . .

# Generate Prisma client and build both backend & frontend
RUN npm run db:generate
RUN npm run build

# Runner stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy compiled artifacts, prisma schemas and migrations
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN chown -R node:node /app
USER node

EXPOSE 7860

CMD ["node", "backend/dist/server.js"]
