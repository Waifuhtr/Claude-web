# Agent Web: Roblox Studio (Vinegar) ortam degiskenleri. Kaynak olarak yuklenir:
#   . /app/scripts/roblox-env.sh
#
# Vinegar'in buyuk verisi (Wine, Studio, WebView2, Wine prefix) yerel diskte
# tutulur: Storage Bucket gibi ag dosya sistemleri Wine icin yavas kalir ve
# sembolik link gibi gereken ozellikleri desteklemeyebilir. Roblox girisi ve
# Studio ayarlarinin yedegi kalici HOME'dadir (bkz. scripts/vinegar).

: "${DISPLAY:=:99}"
export DISPLAY

if [ -z "${ROBLOX_DATA_HOME:-}" ]; then
  if [ -d /var/lib/agentweb ] && [ -w /var/lib/agentweb ]; then
    ROBLOX_DATA_HOME=/var/lib/agentweb/roblox
  else
    ROBLOX_DATA_HOME="$HOME/.local/share/agentweb-roblox"
  fi
fi
export ROBLOX_DATA_HOME
export XDG_DATA_HOME="$ROBLOX_DATA_HOME/data"
export XDG_CACHE_HOME="$ROBLOX_DATA_HOME/cache"
export ROBLOX_STATE_DIR="${ROBLOX_STATE_DIR:-$HOME/.config/agentweb/roblox}"

# Vinegar, Studio'nun "Local AppData" klasorunu $XDG_DATA_HOME/vinegar/appdata
# yapar; Studio eklentileri oradaki Roblox/Plugins klasorunden yukler.
export MCP_PLUGINS_DIR="${MCP_PLUGINS_DIR:-$XDG_DATA_HOME/vinegar/appdata/Roblox/Plugins}"

# Ekran karti yok: GTK ve Mesa yazilimla cizer (llvmpipe / lavapipe).
export GSK_RENDERER="${GSK_RENDERER:-cairo}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export NO_AT_BRIDGE=1
export GTK_A11Y=none

# Linux'taki mutlak bir yolu Wine'in Z: surucusundeki karsiligina cevirir
# (Studio Windows yolu bekler): /home/x/a.rbxl -> Z:\home\x\a.rbxl
roblox_winpath() {
  printf 'Z:%s' "$1" | tr '/' '\\'
}
