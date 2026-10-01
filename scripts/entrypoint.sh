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
  export HOME="${HOME:-/home/node}"
  export WORKSPACE_ROOT="$HOME/workspace"
  mkdir -p "$WORKSPACE_ROOT"
  echo "[entrypoint] UYARI: /data baglanmis bir Storage Bucket degil (ya da hic bagli degil)."
  echo "[entrypoint] Kalicilik KAPALI: container yeniden basladiginda (uyku/redeploy) TUM oturum verisi ve giris bilgisi silinecek."
fi

mkdir -p "$HOME/.claude"

if ! grep -q "Agent Web terminali" "$HOME/.bashrc" 2>/dev/null; then
  # Eski surumun karsilama satirini temizle (kalici HOME'da iki kez gorunmesin).
  if [ -f "$HOME/.bashrc" ]; then
    sed -i '/Claude Code Web hazir/d' "$HOME/.bashrc"
  fi
  cat >> "$HOME/.bashrc" <<'EOF'
echo "Agent Web terminali. Claude Code'u baslatmak icin: claude"
EOF
fi

# Roblox Studio (Vinegar) destegi kaldirildi: eski surumun kalici HOME'da
# biraktigi veriyi (Wine/Studio dosyalari ve Roblox giris yedegi dahil) sil.
for old in \
  "$HOME/.config/agentweb/roblox" \
  "$HOME/.config/vinegar" \
  "$HOME/.local/share/agentweb-roblox" \
  "$HOME/.robloxstudio-mcp" \
  "$HOME/.local/state/robloxstudio-mcp"; do
  if [ -e "$old" ]; then
    rm -rf -- "$old" && echo "[entrypoint] Eski Roblox verisi silindi: $old"
  fi
done
rmdir "$HOME/.config/agentweb" 2>/dev/null || true

# git, github.com icin GitHub MCP ile ayni token'i kullansin (GH_TOKEN /
# GITHUB_TOKEN secret'i ya da `gh auth login`). Kendi ayarin varsa dokunulmaz.
helper="!/app/scripts/git-credential-github"
current_helpers="$(git config --global --get-all credential.https://github.com.helper 2>/dev/null || true)"
if [ -z "$current_helpers" ]; then
  git config --global credential.https://github.com.helper "$helper" \
    || echo "[entrypoint] UYARI: git icin GitHub kimlik yardimcisi ayarlanamadi."
fi

# MCP sunuculari (Playwright tarayici, Agent Web araclari, GitHub) her oturumda
# ayni ayarlarla: ~/.claude.json icinde kullanici kapsamli tanim. rtk: Bash
# ciktilarini kisaltan hook. Hata verirlerse uygulama yine acilir.
node /app/scripts/setup-mcp.js || echo "[entrypoint] UYARI: MCP varsayilanlari uygulanamadi."
node /app/scripts/setup-rtk.js || echo "[entrypoint] UYARI: rtk ayarlanamadi."

exec node /app/server/index.js
