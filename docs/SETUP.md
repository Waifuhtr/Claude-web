# Kurulum Rehberi

## 1. Space'i olusturma

1. huggingface.co'da **New Space** > SDK olarak **Docker** secin.
2. Bu repodaki tum dosyalari (Dockerfile, server/, public/, claude-config/,
   scripts/, package.json, README.md) Space reposunun kok dizinine
   yukleyin (repoyu klonlayip `git push` ile, veya web arayuzunden dosya
   dosya yukleyerek).
3. Space **Settings > Hardware** kismindan yeterli donanimi secin (32GB RAM /
   8 vCPU gibi bir kredi/pay-as-you-go donanimi sorunsuz calisir). Varsayilan
   `cpu-basic` de calisir ama 48 saat hareketsizlikte uyur ve ozel uyku suresi
   ayarlanamaz.

## 2. Secrets (Settings > Variables and secrets)

| Isim | Zorunlu mu | Aciklama |
|---|---|---|
| `APP_PASSWORD` | **Evet** | Web arayuzune giris parolasi. Bu olmadan sunucu baslamaz. |
| `SESSION_SECRET` | Onerilir | Giris cookie'sini imzalamak icin rastgele bir metin (ornek: `openssl rand -hex 32` ciktisi). Girmezseniz her yeniden baslatmada otomatik/gecici uretilir ve mevcut girisler gecersiz olur — onemli bir sorun degil ama her restart'ta yeniden parola girmeniz gerekir. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Onerilir | Asagida "Claude kimlik dogrulama" bolumune bakin. |
| `ANTHROPIC_API_KEY` | Opsiyonel | Token yerine (ya da ek olarak) API key ile odemeli kullanim isterseniz. |

`APP_PASSWORD` gibi degerleri **Secret** olarak ekleyin, **Variable** olarak degil
(Variable'lar herkese acik okunur ve Space kopyalandiginda tasinir).

## 3. Claude kimlik dogrulama

Claude aboneliginiz (Pro/Max/Team/Enterprise) varsa **API key almaniza
gerek yok** — Claude Code CLI, hesabiniza OAuth ile giris yapip abonelik
kotanizi kullanabilir. claude.ai hesabiniza Google (veya baska bir SSO) ile
giriyor olmaniz **hicbir sorun degil**: bu sadece claude.ai'in kendi login
sayfasindaki kimlik dogrulama yontemi, CLI'nin OAuth degisiminden tamamen
bagimsiz — asagidaki adimlarda claude.ai'a yonlendiginizde Google ile giris
yapmaniz gayet normal calisir.

Container'da yerel bir tarayici olmadigi icin CLI, normal (yerel makinede)
login akisindaki gibi otomatik yonlendirme *yapamaz*; bunun yerine size bir
**kod** gosterip terminale geri yapistirmanizi ister — bu, container/SSH/WSL2
gibi ortamlar icin CLI'nin resmi ve beklenen davranisi, bir seyin bozuk
oldugu anlamina gelmez. Iki yontem var:

**A) En basit — ilk acilista terminalden giris:**
Space ayaga kalktiktan sonra parolayla giris yapin, bir oturum acin ve
terminalde `claude` yazin (veya direkt `claude setup-token`). CLI bir URL
gosterir (bazen `c` tusuna basip URL'yi kopyalamaniz istenir); bu URL'yi
istediginiz cihazda (telefon, laptop, fark etmez) acip claude.ai'a Google ile
giris yapin. Otomatik yonlenemedigi icin ekranda bir **kod** gorunecek; o
kodu kopyalayip terminaldeki "Paste code here if prompted" satirina
yapistirin. Storage Bucket bagliysa bu giris kalici olur, tekrar sormaz.

**B) Daha saglam — onceden token uretme:**
Ayni akisi (yukaridaki gibi URL -> Google login -> kod yapistirma) `claude
setup-token` ile calistirin — bunu Space'in kendi terminalinde de, isterseniz
kendi bilgisayarinizda da yapabilirsiniz, ikisi de ayni sekilde headless
calisir. Komut sonunda ekrana yazdirilan token'i `CLAUDE_CODE_OAUTH_TOKEN`
secret'ina yapistirin. Boylece Storage Bucket olmasa bile her yeniden
baslatmada otomatik giris yapilir. Token yaklasik 1 yil gecerlidir.

Kaynak: [Claude Code kimlik dogrulama dokumantasyonu](https://code.claude.com/docs/en/authentication.md).

## 4. Kalicilik (Storage Bucket)

Bucket bagli degilse **hicbir sey** (giris bilgisi, MCP config'i, proje
dosyalari, konusma gecmisi) bir sonraki restart'ta hayatta kalmaz —
`scripts/entrypoint.sh` bunu loglarda acikca uyarir.

Bucket eklemek icin: Space **Settings > Storage** > bir Storage Bucket
olusturup `/data` yoluna baglayin. Sunucu, `/data`'nin gercekten ayri bir
mount olup olmadigini otomatik algilar (basit bir "dizin var mi" kontrolu
degil — cihaz kimligi karsilastirmasi yapar), algilarsa `HOME`'u otomatik
`/data/home`'a yonlendirir.

## 5. MCP sunuculari ekleme

Her yeni oturum klasorunde (`$WORKSPACE_ROOT/<oturum-adi>/.mcp.json`)
`claude-config/mcp.example.json`'dan kopyalanan bir baslangic dosyasi
bulunur (varsayilan: sadece `filesystem` sunucusu, hicbir ag/kimlik bilgisi
gerektirmez). Terminalden o dosyayi duzenleyip istediginiz sunucuyu
ekleyebilirsiniz, ornegin:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "buraya-token" }
    }
  }
}
```

API key/token gerektiren sunucular icin degeri dogrudan Space Secret olarak
tanimlayip `env` icinde o degiskene referans vermeyi deneyin; calismazsa
degeri gecici olarak dosyaya elle yazip Storage Bucket sayesinde kalici
tutabilirsiniz. `npx`/`uvx` ile calisan MCP sunuculari ilk calistirmada
paketi otomatik indirir (443 uzerinden), ek kuruluma gerek yoktur.

## 6. Ag kisitlamasi

HF Space'lerin outbound trafigi sadece **80, 443, 8080** portlarina
gidebilir. Pratikte:

- Calisir: HTTP(S) API'ler, `git clone https://...`, npm/pip/uvx paket
  kurulumu, HTTP/SSE tabanli veya stdio+HTTPS-cagrili MCP sunuculari.
- Calismaz: `ssh://` git remote'lari, dogrudan veritabani portlari (5432,
  6379, ...), ozel TCP/UDP protokolleri. Bu tur bir ihtiyaciniz olursa
  Cloudflare Tunnel veya Tailscale gibi 443 uzerinden tunelleyen bir katman
  kullanin.

## 7. Sorun giderme

- Space acilmiyor / hemen kapaniyor: Space'in **Logs** sekmesine bakin,
  `entrypoint.sh` ve `server/index.js` konsola aciklayici Turkce mesajlar
  yazar (ozellikle `APP_PASSWORD` eksikse acikca belirtir).
- Terminale baglanamiyorum: Tarayici konsolunda websocket hatasi varsa
  parolayla girisin gecerli oldugundan (cookie) emin olun; `SESSION_SECRET`
  sabitlenmemisse restart sonrasi yeniden giris gerekir.
- `claude` komutu bulunamiyor: Docker imajinda `npm install -g
  @anthropic-ai/claude-code` build asamasinda calisir; imaj build loglarini
  kontrol edin.
