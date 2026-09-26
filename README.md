---
title: Claude Code Web
emoji: 🖥️
colorFrom: gray
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Claude Code Web (self-hosted, HF Space)

Bu Space, gercek Claude Code CLI'yi tarayicidan erisilebilen, parola korumali,
coklu-oturumlu ve (Storage Bucket bagliysa) kalici bir terminale donusturur.

- **Terminal:** tmux + node-pty + xterm.js. Gordugunuz sey Claude Code'un
  gercek TUI'si; tarayici sekmesini kapatsaniz bile tmux oturumu container
  ayaktayken calismaya devam eder.
- **Coklu oturum:** Soldaki panelden istediginiz kadar isimli oturum
  acabilirsiniz, her biri kendi calisma klasorune sahiptir
  (`$WORKSPACE_ROOT/<isim>`).
- **MCP:** Her yeni oturum klasorune ornek bir `.mcp.json` kopyalanir;
  dilediginiz MCP sunucusunu oraya ekleyebilirsiniz.
- **Kalicilik:** `/data` yolunda bir Storage Bucket bagliysa `HOME` otomatik
  olarak oraya yonlendirilir (giris bilgisi, MCP config'i, proje dosyalari ve
  Claude'un kendi konusma gecmisi kalici olur). Bucket yoksa her yeniden
  baslatmada sifirlanir.

Kurulum, secrets, Claude kimlik dogrulama ve MCP ekleme adimlari icin
[`docs/SETUP.md`](docs/SETUP.md)'ye bakin.

## Hizli baslangic

1. Bu repoyu Docker SDK ile olusturulmus bir HF Space'e yukleyin.
2. Space Settings > **Variables and secrets** kismina en az `APP_PASSWORD`
   secret'ini ekleyin (bkz. `docs/SETUP.md`).
3. Space ayaga kalktiginda parolayla giris yapin, bir oturum acin ve
   terminalde `claude` yazin.

## Ag kisitlamasi (onemli)

HF Space'lerde outbound trafik sadece **80, 443 ve 8080** portlarina
gidebilir; baska porta giden istekler platform tarafinda bloklanir. HTTP(S)
tabanli MCP sunuculari ve git/npm/pip https uzerinden calisir; ham TCP
gerektiren entegrasyonlar (dogrudan veritabani portu, ssh://git, vb.) icin
Cloudflare Tunnel / Tailscale gibi 443 uzerinden tunelleyen bir cozum
gerekir. Detay: `docs/SETUP.md`.
