# Stage 1: Install prod dependencies (compile native modules)
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Build frontend + server
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:all

# Stage 3: Production image
FROM node:20-alpine
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./
EXPOSE 3001
ENV DATA_DIR=/opt/stacks/BPT
ENV PORT=3001
CMD ["node", "dist-server/server/index.js"]
