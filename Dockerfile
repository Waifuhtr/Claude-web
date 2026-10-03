FROM node:22-trixie-slim

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

# GitHub CLI (gh): PR/issue islemleri ve `gh auth login` (telefonda tek
# seferlik kodla giris). GitHub MCP ve git de bu girisi kullanir
# (scripts/github-mcp-headers, scripts/git-credential-github).
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL -o /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# rtk: gurultulu Bash komutlarinin (kurulum, derleme, test, lint) ciktisini
# Claude okumadan once kisaltir; scripts/setup-rtk.js hook'unu ve bilgi
# kaybetmeyen ayarlarini yazar. Tek statik ikili; surum ve SHA-256 sabit
# (surum yukseltilirken ikisi birlikte degistirilir: release'in checksums.txt'i).
ARG RTK_VERSION=v0.49.0
ARG RTK_SHA256=7278231dfd7e6a730a4ab7f847b195bcf02289c2d57622b0dab75a6411100c8f
RUN set -e; cd /tmp; \
    curl -fsSL -o rtk.tar.gz "https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}/rtk-x86_64-unknown-linux-musl.tar.gz"; \
    echo "${RTK_SHA256}  rtk.tar.gz" | sha256sum -c -; \
    if tar -tzf rtk.tar.gz | grep -qE '^/|(^|/)\.\.(/|$)'; then echo "rtk arsivinde guvensiz yol" >&2; exit 1; fi; \
    mkdir rtk-x; \
    tar -xzf rtk.tar.gz -C rtk-x; \
    install -m 755 rtk-x/rtk /usr/local/bin/rtk; \
    rm -rf rtk-x rtk.tar.gz; \
    rtk --version

# Google Chrome: Playwright MCP'nin tarayicisi (/opt/google/chrome/chrome).
# Kurulumu root ister; bu yuzden calisma aninda degil burada kurulur ve her
# konteynerde hazir olur. Noto CJK/emoji fontlari, ekran goruntulerinde
# Japonca/Korece/Cince metinlerin ve emojilerin kutu olarak cikmamasi icin.
RUN curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb fonts-noto-cjk fonts-noto-color-emoji \
    && rm -f /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# Sanal ekran (Ekran sekmesi; varsayilan kapali, AGENTWEB_DISPLAY=1 ile acilir):
# Xvfb (ekran), openbox (pencere yoneticisi), x11vnc (tarayiciya goruntu),
# xdotool + xclip + ImageMagick (Claude'un ekran araclari).
RUN apt-get update && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        xdotool \
        xclip \
        imagemagick \
        openbox \
        x11-utils \
        xauth \
        dbus \
        dbus-x11 \
        xdg-utils \
        desktop-file-utils \
        fonts-liberation \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Playwright MCP (tarayici), surumu sabit. scripts/setup-mcp.js onu (ve Agent
# Web'in kendi araclarini, GitHub MCP'yi) tum oturumlar icin tanimlar.
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
COPY scripts ./scripts

# Her Claude icin (sohbet ve terminal) yonetilen Claude Code ayarlari, root'a
# ait ve salt okunur: kalicilik notu (CLAUDE.md: MCP sunuculari ve araclar
# /tmp'ye degil HOME'a kurulur) ve /tmp'deki bir MCP sunucusunu kaydetmeyi
# durduran hook (managed-settings.json -> scripts/mcp-tmp-guard).
# profile.d: terminalin login kabugu da ~/.local/bin'i ve npm ayarini alsin.
COPY scripts/claude-managed/ /etc/claude-code/
COPY scripts/agentweb-profile.sh /etc/profile.d/agentweb.sh

# Web arayuzunden yuklenen dosyalarda calistirma izni kaybolabilir; burada verilir.
# /var/lib/agentweb: sanal ekrandaki tarayicinin profili (yerel disk).
RUN chmod +x scripts/entrypoint.sh scripts/agentweb-mcp.js scripts/browser \
        scripts/github-mcp-headers scripts/git-credential-github \
        scripts/mcp-tmp-guard scripts/mcp-tmp-guard.js \
    && chmod 644 /etc/claude-code/CLAUDE.md /etc/claude-code/managed-settings.json /etc/profile.d/agentweb.sh \
    && ln -sf /app/scripts/browser /usr/local/bin/agentweb-browser \
    && install -Dm644 scripts/desktop/agentweb-browser.desktop /usr/share/applications/agentweb-browser.desktop \
    && install -Dm644 scripts/desktop/mimeapps.list /usr/share/applications/mimeapps.list \
    && update-desktop-database /usr/share/applications \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && mkdir -p /var/lib/agentweb

RUN mkdir -p /home/node/workspace \
    && chown -R node:node /app /home/node /var/lib/agentweb

USER node
ENV HOME=/home/node
ENV PATH="/home/node/.local/bin:${PATH}"
# xdg-open ve diger araclar web adreslerini sanal ekrandaki Chrome'da acar.
ENV BROWSER=agentweb-browser
# rtk hicbir zaman kullanim verisi gondermesin.
ENV RTK_TELEMETRY_DISABLED=1

EXPOSE 7860

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
