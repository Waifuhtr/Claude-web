# ---- Vinegar: Roblox Studio'yu Linux'ta (Wine ile) calistiran baslatici ----
# Hazir Linux ikilisi dagitilmiyor (yalnizca Flatpak), bu yuzden surumu sabit
# kaynak koddan derlenir. GTK 4.18 / libadwaita 1.6 istedigi icin hem bu asama
# hem de calisma imaji Debian 13 (trixie) tabanlidir.
FROM golang:1.26-trixie AS vinegar
ARG VINEGAR_VERSION=v1.9.4
RUN apt-get update && apt-get install -y --no-install-recommends \
        g++ \
        make \
        pkg-config \
        gettext \
        libglib2.0-dev-bin \
        libvulkan-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$VINEGAR_VERSION" https://github.com/vinegarhq/vinegar /src/vinegar
WORKDIR /src/vinegar
RUN make && make install DESTDIR=/out PREFIX=/usr

# ---- Agent Web ----
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

# Google Chrome: Playwright MCP'nin tarayicisi (/opt/google/chrome/chrome).
# Kurulumu root ister; bu yuzden calisma aninda degil burada kurulur ve her
# konteynerde hazir olur. Noto CJK/emoji fontlari, ekran goruntulerinde
# Japonca/Korece/Cince metinlerin ve emojilerin kutu olarak cikmamasi icin.
RUN curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb fonts-noto-cjk fonts-noto-color-emoji \
    && rm -f /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# Sanal ekran (Ekran sekmesi) ve Roblox Studio (Vinegar + Wine) calisma zamani:
# Xvfb (ekran), openbox (pencere yoneticisi), x11vnc (tarayiciya goruntu),
# xdotool + xclip + ImageMagick (Claude'un ekran araclari), GTK4/libadwaita (Vinegar'in
# arayuzu), Mesa (ekran karti olmadan yazilimla OpenGL/Vulkan) ve Wine'in
# kullandigi kutuphaneler. Wine'in kendisini Vinegar ilk acilista indirir.
# Ikinci listedekiler istege bagli: biri bulunamazsa derleme yine de biter.
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
        shared-mime-info \
        libgtk-4-1 \
        libadwaita-1-0 \
        adwaita-icon-theme \
        hicolor-icon-theme \
        libgl1-mesa-dri \
        libglx-mesa0 \
        libegl1 \
        mesa-vulkan-drivers \
        libvulkan1 \
        libfreetype6 \
        libfontconfig1 \
        fonts-liberation \
        fonts-dejavu-core \
        libx11-6 \
        libxext6 \
        libxrender1 \
        libxrandr2 \
        libxi6 \
        libxcursor1 \
        libxcomposite1 \
        libxinerama1 \
        libxfixes3 \
        libxkbcommon0 \
        libdbus-1-3 \
        libwayland-client0 \
        libunwind8 \
        libkrb5-3 \
        libgssapi-krb5-2 \
        libusb-1.0-0 \
        libpulse0 \
        xz-utils \
        pci.ids \
    && for pkg in libgnutls30t64 libasound2t64 libcups2t64 libxkbregistry0 libpcsclite1 \
                  libsdl2-2.0-0 libgphoto2-6t64 libpcap0.8t64 libv4l-0t64 libsane1; do \
         apt-get install -y --no-install-recommends "$pkg" \
           || echo "[docker] istege bagli paket atlandi: $pkg"; \
       done \
    && rm -rf /var/lib/apt/lists/*

# Vinegar: gercek ikili /usr/lib/vinegar/vinegar; PATH'teki `vinegar` Agent
# Web'in sarmalayicisidir (scripts/vinegar).
COPY --from=vinegar /out/usr/ /usr/
RUN mkdir -p /usr/lib/vinegar \
    && mv /usr/bin/vinegar /usr/lib/vinegar/vinegar \
    && update-mime-database /usr/share/mime

# MCP sunuculari, surumleri sabit: Playwright (tarayici) ve Roblox Studio MCP.
# scripts/setup-mcp.js onlari tum oturumlar icin tanimlar.
RUN npm install -g @playwright/mcp@0.0.82 @chrrxs/robloxstudio-mcp@3.1.6 && npm cache clean --force

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

# Web arayuzunden yuklenen dosyalarda calistirma izni kaybolabilir; burada verilir.
# /var/lib/agentweb: Roblox/Wine verisi ve tarayici profili (yerel disk).
RUN chmod +x scripts/entrypoint.sh scripts/agentweb-mcp.js scripts/vinegar scripts/roblox-studio \
        scripts/roblox-studio-exe scripts/roblox-mcp scripts/browser \
    && ln -sf /app/scripts/vinegar /usr/local/bin/vinegar \
    && ln -sf /app/scripts/roblox-studio /usr/local/bin/roblox-studio \
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

EXPOSE 7860

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
