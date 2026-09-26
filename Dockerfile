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

RUN npm install -g @anthropic-ai/claude-code

RUN useradd -m -u 1000 -s /bin/bash appuser

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY claude-config ./claude-config
COPY scripts ./scripts
RUN chmod +x scripts/entrypoint.sh

RUN mkdir -p /home/appuser/workspace \
    && chown -R appuser:appuser /app /home/appuser

USER appuser
ENV HOME=/home/appuser
ENV PATH="/home/appuser/.local/bin:${PATH}"

EXPOSE 7860

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
