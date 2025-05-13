# 1. Base image with Node.js
FROM node:18-bullseye-slim

# 2. Install system libraries required by Puppeteer/Chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ca-certificates \
     fonts-liberation \
     gconf-service \
     libasound2 \
     libatk1.0-0 \
     libc6 \
     libcairo2 \
     libcups2 \
     libdbus-1-3 \
     libexpat1 \
     libfontconfig1 \
     libgcc1 \
     libgconf-2-4 \
     libgdk-pixbuf2.0-0 \
     libglib2.0-0 \
     libgtk-3-0 \
     libnspr4 \
     libnss3 \
     libpango-1.0-0 \
     libpangocairo-1.0-0 \
     libstdc++6 \
     libx11-6 \
     libx11-xcb1 \
     libxcb1 \
     libxcomposite1 \
     libxcursor1 \
     libxdamage1 \
     libxext6 \
     libxfixes3 \
     libxi6 \
     libxrandr2 \
     libxrender1 \
     libxss1 \
     libxtst6 \
     lsb-release \
     wget \
  && rm -rf /var/lib/apt/lists/*

# 3. Set working directory
WORKDIR /opt/csp-checker

# 4. Copy scripts and package manifest, then install dependencies
COPY health-csp.py health-csp.js package.json ./
RUN npm install --production

# 5. Default entrypoint: run the Python crawler against the mounted NGINX config
ENTRYPOINT ["python3", "health-csp.py", \
            "--script", "health-csp.js", \
            "--nginx-config-dir", "/etc/nginx/conf.d/http/servers/"]