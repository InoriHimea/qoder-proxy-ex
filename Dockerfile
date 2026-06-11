FROM node:20-slim

ENV PATH="/usr/local/bin:${PATH}"

# Install qodercli and qoderclicn globally
# node:20-slim is Debian-based (glibc) which is required by qodercli's Bun runtime.
RUN npm install -g @qoder-ai/qodercli @qodercn-ai/qoderclicn \
  && qodercli --version || true \
  && qoderclicn --version || true

# Disable qodercli auto-updates so it never tries to download a new version
# on startup inside the container (saves memory, eliminates update-induced delays).
RUN mkdir -p /root/.qoder \
  && echo '{"autoUpdates":false}' > /root/.qoder.json

WORKDIR /app

# Install production deps first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

EXPOSE 3000

ENV NODE_ENV=production

# Use a Node.js health check — no wget/curl needed, works on any base image
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',_=>process.exit(1))"

CMD ["node", "src/server.js"]
