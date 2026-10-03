# Agent Web (/etc/profile.d/agentweb.sh): login shells (the Terminal tab) get
# the same setup as the chat's Claude. Programs installed while the Space runs
# (npm install -g, uv tool install) go to ~/.local, which the Storage Bucket
# keeps; /tmp and the system folders are reset on every restart.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) PATH="$HOME/.local/bin:$PATH" ;;
esac
export PATH
export NPM_CONFIG_PREFIX="$HOME/.local"
# The terminal's `claude` (npm, image) does not update itself: with npm
# writing to ~/.local it would put a few hundred MB on the bucket each
# release. Rebuilding the Space installs the latest one.
export DISABLE_AUTOUPDATER=1
