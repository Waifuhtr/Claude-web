# Agent Web container

- This Hugging Face Space container restarts often (sleep, updates, rebuilds). Only `$HOME` and the session folders under `$WORKSPACE_ROOT` are kept, and only when a Storage Bucket is mounted at /data (`$HOME` is then /data/home). /tmp, /usr, /opt, /app and every other path are reset to the image on restart.
- Install anything that must stay under `$HOME`, never in /tmp. Give an MCP server that needs files (git clone, build, virtualenv) its own folder `~/mcp-servers/<name>` and register it with that absolute path. `npx -y <pkg>` and `uvx <pkg>` need no install; `npm install -g` and `uv tool install` put programs in `~/.local/bin` (kept, on PATH).
- Register MCP servers with `claude mcp add --scope user` so every session gets them, unless the user wants one only for the current folder.
- A running Claude loads MCP changes when it restarts. In the Agent Web chat the user restarts it from the model button → "MCP sunucuları" → "Claude'u yeniden başlat".
