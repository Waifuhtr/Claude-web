FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

# git/tmux: terminal + persistence backbone. python3/pip+uv: MCP sunuculari icin (uvx).
# build-essential: node-pty gibi native modulleri derlemek icin. ripgrep: Claude Code arama araci.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        tmux \
        python3 \
        python3-pip \
        curl \
        ca-certificates \
        build-essential \
        ripgrep \
        openssh-client \
        procps \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages uv

# Google Chrome: Playwright MCP'nin tarayicisi (/opt/google/chrome/chrome).
# Kurulumu root ister; bu yuzden calisma aninda degil burada kurulur ve her
# konteynerde hazir olur. Noto CJK/emoji fontlari, ekran goruntulerinde
# Japonca/Korece/Cince metinlerin ve emojilerin kutu olarak cikmamasi icin.
RUN curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb fonts-noto-cjk fonts-noto-color-emoji \
    && rm -f /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# Playwright MCP sunucusu, surumu sabit. scripts/setup-mcp.js onu tum oturumlar
# icin `playwright-mcp` komutuyla tanimlar.
RUN npm install -g @playwright/mcp@0.0.82 && npm cache clean --force

# Terminal sekmesindeki `claude` komutu (giris/login ve elle kullanim icin).
# Sohbet arayuzu ise package.json'daki Agent SDK'nin kendi Claude Code'unu kullanir;
# ikisi de ayni ~/.claude giris bilgisini paylasir.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# package-lock.json test edilmis surumleri sabitler (npm ci birebir onlari kurar).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY claude-config ./claude-config
COPY scripts ./scripts
RUN chmod +x scripts/entrypoint.sh

RUN mkdir -p /home/node/workspace \
    && chown -R node:node /app /home/node

USER node
ENV HOME=/home/node
ENV PATH="/home/node/.local/bin:${PATH}"

EXPOSE 7860

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
