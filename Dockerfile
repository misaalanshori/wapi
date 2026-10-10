FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
RUN npm run build

FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_PATH=/usr/local/lib/node_modules

# 1. System APT packages
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       bash ca-certificates git python3 python3-pip python3-venv make g++ \
       tmux ffmpeg imagemagick tesseract-ocr tesseract-ocr-ind python3-pil libimage-exiftool-perl \
       jq yq ripgrep fd-find fzf sqlite3 unzip zip p7zip-full pandoc poppler-utils qpdf \
       dnsutils whois nmap netcat-openbsd mtr-tiny traceroute httpie wget curl aria2 lynx w3m \
       tree file bc xxd bsdextrautils rsync zstd brotli htop espeak-ng sox \
  && ln -sf $(which fdfind) /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

# 2. Python automation and research packages
RUN pip3 install --no-cache-dir --break-system-packages \
       playwright "requests>=2.32.0" httpx beautifulsoup4 lxml lxml_html_clean trafilatura pandas openpyxl matplotlib pillow pytesseract pyyaml rich tqdm selenium

# 3. Playwright Chromium browser & OS dependencies
RUN python3 -m playwright install --with-deps chromium \
  && chmod -R 777 /ms-playwright

# 4. Global Node packages
RUN npm install -g --force playwright ws axios cheerio

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false
COPY --from=builder /app/dist/ ./dist/
COPY pi-agent-home/ ./pi-agent-home/

ENTRYPOINT ["node", "dist/index.js"]
