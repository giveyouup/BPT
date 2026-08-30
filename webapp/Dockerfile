# Stage 1: Install prod dependencies (compile native modules)
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev \
  # Strip better-sqlite3 build artifacts not needed at runtime
  && rm -rf node_modules/better-sqlite3/src \
             node_modules/better-sqlite3/deps \
             node_modules/better-sqlite3/prebuilds \
  # Strip docs, tests, type source, and source maps from all packages
  && find node_modules -maxdepth 2 \( \
       -name "*.md" -o -name "*.markdown" -o -name "CHANGELOG*" \
       -o -name "LICENSE*" -o -name "NOTICE*" -o -name "README*" \
       -o -name "*.map" \
     \) -delete \
  && find node_modules -maxdepth 3 -type d \( \
       -name "test" -o -name "tests" -o -name "__tests__" -o -name "docs" \
     \) -exec rm -rf {} + 2>/dev/null || true

# Stage 2: Build frontend + server
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:all

# Stage 3: Production image
FROM node:20-bookworm-slim
WORKDIR /app
# tesseract-ocr + python3/pip: runtime for the vendored PCR-PDF OCR pipeline
# (server/pcr-pdf/parse_pcr_pdf.py, invoked as a subprocess by pdfParser.ts).
# Debian/glibc avoids the musllinux-wheel uncertainty PyMuPDF has on Alpine.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY server/pcr-pdf ./dist-server/server/pcr-pdf
RUN pip install --no-cache-dir --break-system-packages \
      -r dist-server/server/pcr-pdf/requirements.txt
COPY package.json ./
EXPOSE 3001
ENV DATA_DIR=/opt/stacks/BPT
ENV PORT=3001
CMD ["node", "dist-server/server/index.js"]
