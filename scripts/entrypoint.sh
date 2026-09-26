#!/bin/bash
set -euo pipefail

DATA_DIR="/data"
PERSIST=0

# /data'nin gercekten baglanmis bir Storage Bucket olup olmadigini anlamak icin
# device id'sini kok dosya sistemiyle karsilastiriyoruz. Sadece "dizin var mi"
# kontrolu yaniltici olur: bucket bagli degilse bile mkdir ile ayni isimde
# gecici (restart'ta silinen) bir dizin olusabilir.
if [ -d "$DATA_DIR" ]; then
  root_dev="$(stat -c %d / 2>/dev/null || echo root)"
  data_dev="$(stat -c %d "$DATA_DIR" 2>/dev/null || echo data)"
  if [ "$root_dev" != "$data_dev" ]; then
    PERSIST=1
  fi
fi

if [ "$PERSIST" = "1" ]; then
  export HOME="$DATA_DIR/home"
  export WORKSPACE_ROOT="$DATA_DIR/workspace"
  mkdir -p "$HOME" "$WORKSPACE_ROOT"
  echo "[entrypoint] Storage Bucket algilandi -> kalicilik AKTIF (HOME=$HOME)"
else
  export HOME="${HOME:-/home/appuser}"
  export WORKSPACE_ROOT="$HOME/workspace"
  mkdir -p "$WORKSPACE_ROOT"
  echo "[entrypoint] UYARI: /data baglanmis bir Storage Bucket degil (ya da hic bagli degil)."
  echo "[entrypoint] Kalicilik KAPALI: container yeniden basladiginda (uyku/redeploy) TUM oturum verisi ve giris bilgisi silinecek."
fi

mkdir -p "$HOME/.claude"

if [ ! -f "$HOME/.bashrc" ] || ! grep -q "Claude Code Web hazir" "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<'EOF'
echo "Claude Code Web hazir. Baslatmak icin: claude"
EOF
fi

exec node /app/server/index.js
