# 1. Use a lightweight Alpine image with Node.js
FROM node:lts-alpine

# 2. Install Chromium and required system libraries for Puppeteer
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

# 3. Tell Puppeteer to use the system Chromium and skip its own download
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# 4. Create a non-root user for running Chromium in its sandbox
RUN addgroup -S pptruser \
 && adduser  -S -G pptruser pptruser \
 && mkdir -p /opt/csp-checker \
 && chown -R pptruser:pptruser /opt/csp-checker

# 5. Switch to that user
USER pptruser

# 6. Set working directory
WORKDIR /opt/csp-checker

# 7. Copy application code and install production dependencies
COPY --chown=pptruser:pptruser ./files ./
RUN npm install --omit=dev && npm cache clean --force

# 8. Launch the crawler; health-csp.js internally passes the necessary --no-sandbox flags
ENTRYPOINT ["node", "health-csp.js"]
