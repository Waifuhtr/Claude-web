# Kurulum Rehberi

## 1. Space'i oluşturma

1. huggingface.co'da **New Space** > SDK olarak **Docker** seçin.
2. Bu repodaki tüm dosyaları (`Dockerfile`, `server/`, `public/`,
   `claude-config/`, `scripts/`, `package.json`, `package-lock.json`,
   `README.md`, `docs/`) Space reposunun kök dizinine yükleyin (repoyu
   klonlayıp `git push` ile ya da web arayüzünden dosya dosya yükleyerek).
   `package-lock.json` önemlidir: Docker build'i `npm ci` ile tam olarak test
   edilmiş sürümleri kurar.
3. Space **Settings > Hardware** kısmından yeterli donanımı seçin (32GB RAM /
   8 vCPU gibi bir kredi/pay-as-you-go donanımı sorunsuz çalışır). Varsayılan
   `cpu-basic` de çalışır ama 48 saat hareketsizlikte uyur ve özel uyku süresi
   ayarlanamaz.

## 2. Secrets (Settings > Variables and secrets)

| İsim | Zorunlu mu | Açıklama |
|---|---|---|
| `APP_PASSWORD` | **Evet** | Web arayüzüne giriş parolası. Bu olmadan sunucu başlamaz. |
| `SESSION_SECRET` | Önerilir | Giriş cookie'sini imzalamak için rastgele bir metin (örnek: `openssl rand -hex 32` çıktısı). Girmezseniz her yeniden başlatmada geçici olarak üretilir ve her restart'ta yeniden parola girmeniz gerekir. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Opsiyonel | Aşağıda "Claude kimlik doğrulama" B yöntemine bakın. |
| `ANTHROPIC_API_KEY` | Opsiyonel | Abonelik yerine API key ile (kullandıkça ödemeli) çalışmak isterseniz. Tanımlıysa sohbet ve terminal abonelik yerine bunu kullanır. |

Bu değerleri **Secret** olarak ekleyin, **Variable** olarak değil (Variable'lar
herkese açık okunur ve Space kopyalandığında taşınır). `APP_PASSWORD` ve
`SESSION_SECRET` Claude'un çalıştırdığı komutlara ve terminale hiç
aktarılmaz.

## 3. Claude kimlik doğrulama

Claude aboneliğiniz (Pro/Max) varsa API key almanız gerekmez: Claude Code,
hesabınıza OAuth ile giriş yapıp abonelik kotanızı kullanabilir. claude.ai'a
Google ile giriyor olmanız sorun değildir; bu sadece claude.ai'ın kendi giriş
sayfasındaki yöntemdir.

Sohbet ekranı ve terminal **aynı giriş bilgisini** (`~/.claude`) kullanır;
terminalde bir kez giriş yapmanız ikisi için de yeterlidir.

Container'da tarayıcı olmadığı için CLI otomatik yönlendirme yapamaz; bunun
yerine size bir **kod** gösterip terminale yapıştırmanızı ister. Bu,
container/SSH ortamları için CLI'nin beklenen davranışıdır.

**A) En basit — terminalden giriş:**
Bir oturum açın, **Terminal** sekmesine geçip `claude` yazın. CLI bir URL
gösterir; bu URL'yi istediğiniz cihazda açıp claude.ai'a Google ile giriş
yapın. Ekranda çıkan **kodu** kopyalayıp terminaldeki "Paste code here if
prompted" satırına yapıştırın. Storage Bucket bağlıysa bu giriş kalıcı olur.
Sonra **Sohbet** sekmesine dönebilirsiniz.

**B) Daha sağlam — önceden token üretme:**
Aynı akışı `claude setup-token` ile çalıştırın (Space'in terminalinde ya da
kendi bilgisayarınızda). Komutun sonunda yazdırılan token'ı
`CLAUDE_CODE_OAUTH_TOKEN` secret'ına yapıştırın. Böylece Storage Bucket olmasa
bile her yeniden başlatmada otomatik giriş yapılır. Token yaklaşık 1 yıl
geçerlidir.

**C) API key:** console.anthropic.com'dan bir API key alıp
`ANTHROPIC_API_KEY` secret'ına ekleyin. Kullanım, aboneliğinizden değil API
hesabınızdan ücretlendirilir.

Hangi yöntemin kullanıldığını sohbet ekranında model düğmesine dokunup en
alttaki **Kimlik** satırından görebilirsiniz ("claude.ai girişi (abonelik)"
veya "API key").

> **Not:** Anthropic'in Agent SDK dokümanı, önceden onay alınmadıkça üçüncü
> taraf ürünlerin kullanıcılarına claude.ai girişi / abonelik limitleri
> sunmasına izin vermediğini belirtir. Bu proje yalnızca **kendi hesabınızla,
> kendi kişisel kullanımınız** için tasarlanmıştır; Space'i başkalarının
> kullanımına açmayın. Tamamen resmi yolu tercih ederseniz C yöntemini (API
> key) kullanın.

Kaynak: [Claude Code kimlik doğrulama dokümantasyonu](https://code.claude.com/docs/en/authentication.md).

## 4. Sohbet ekranını kullanma

- **Model düğmesi** (yazma alanının altında solda): Model listesini açar.
  Liste, ilk mesajdan sonra Claude Code'un bu hesap için bildirdiği
  modellerle güncellenir; eski sürümler **Diğer modeller** altındadır.
  - **Effort:** Claude'un ne kadar derin düşüneceği. *Varsayılan* modelin
    kendi seviyesidir; *Düşük* en hızlısı, *Çok yüksek* kodlama ve uzun
    işler için önerilen, *Maksimum* en kapsamlısıdır. Effort desteklemeyen
    modellerde (ör. Haiku) bu satır pasif görünür.
- **İzin modu düğmesi** (kalkan simgeli):
  - *Her işlemde sor:* dosya düzenleme ve komutlardan önce onay kartı çıkar.
  - *Düzenlemeleri otomatik kabul et:* dosya düzenlemeleri sorulmaz, komutlar
    sorulur.
  - *Plan modu:* Claude hiçbir şeyi değiştirmez, önce plan hazırlar; plan
    kartından "Onayla" dediğinizde uygulamaya geçer.
  - *Otomatik:* bir güvenlik sınıflandırıcısı izinleri sizin yerinize verir
    (sadece destekleyen modellerde görünür).
  - *Tüm izinleri atla:* hiçbir şey sorulmaz. İki kez dokunarak onaylanır;
    sadece güvendiğiniz işlerde kullanın.
  - Yeni oturumlar son seçilen model ve effort ile, ama her zaman *Her
    işlemde sor* moduyla başlar.
- **İzin kartları:** *İzin ver*, *Reddet* ve (Claude Code öneriyorsa) *Her
  zaman izin ver*. "Her zaman" kuralı Claude Code'un önerdiği yere (genellikle
  o oturum klasörünün `.claude/settings.local.json` dosyası) kaydedilir.
  Claude Code bir işlemi riskli olarak işaretlerse, yanlışlıkla onay olmasın
  diye *İzin ver* iki dokunuş ister.
- **Sorular:** Claude seçenekli bir soru sorarsa seçip *Gönder*'e basın ya da
  *Diğer…* ile kendi cevabınızı yazın.
- **Durdurma ve yeni sohbet:** Yanıt sürerken gönder düğmesi ■ olur; dokununca
  durur ve o ana kadar yazılanlar kalır. Üst çubuktaki ✎ yeni bir sohbet
  başlatır (klasördeki dosyalar silinmez).
- **Kullanım limiti:** Abonelik limitine yaklaşınca yazma alanının üstünde bir
  uyarı ve sıfırlanma saati görünür.
- Bilgisayarda **Enter** gönderir, **Shift+Enter** yeni satır açar; telefonda
  Enter yeni satırdır, gönder düğmesini kullanın.

## 5. Kalıcılık (Storage Bucket)

Bucket bağlı değilse **hiçbir şey** (giriş bilgisi, sohbet geçmişi, MCP
ayarları, proje dosyaları) bir sonraki restart'ta hayatta kalmaz —
`scripts/entrypoint.sh` bunu loglarda açıkça uyarır.

Bucket eklemek için: Space **Settings > Storage** > bir Storage Bucket
oluşturup `/data` yoluna bağlayın. Sunucu, `/data`'nın gerçekten ayrı bir
mount olup olmadığını otomatik algılar (cihaz kimliği karşılaştırması) ve
algılarsa `HOME`'u `/data/home`'a yönlendirir. Sohbet geçmişi
`$HOME/.cc-web/chats/` altında tutulur.

## 6. MCP sunucuları

### Sunucu listesi nereden geliyor?

Claude Code her oturumun MCP sunucularını dört yerden toplar:

| Nerede | Kapsam | Hangi oturumlarda |
|---|---|---|
| `~/.claude.json` → en üstteki `mcpServers` | kullanıcı (`--scope user`) | **tüm oturumlar** |
| `~/.claude.json` → `projects["<klasör>"].mcpServers` | yerel (`claude mcp add`'in **varsayılanı**) | **sadece o oturumun klasörü** |
| `<oturum klasörü>/.mcp.json` | proje | o klasör; ilk kullanımda onay ister |
| claude.ai hesabınızdaki bağlayıcılar (Context7, Firecrawl…) | claude.ai | tüm oturumlar |

Bir oturumda eklediğiniz sunucunun başka oturumda görünmemesinin nedeni
genelde budur: `claude mcp add` kapsam belirtilmezse sunucuyu sadece o
klasöre ekler. Tüm oturumlarda olsun istediğiniz sunucuyu kullanıcı
kapsamıyla ekleyin, örneğin:

```bash
claude mcp add --scope user github -e GITHUB_PERSONAL_ACCESS_TOKEN=buraya-token -- npx -y @modelcontextprotocol/server-github
```

Storage Bucket bağlıysa `~/.claude.json` ve oturum klasörleri kalıcıdır; MCP
tanımları ve onaylar restart'tan sonra da durur.

### Hazır tarayıcı: Playwright MCP

İmajda Google Chrome ve sabit sürümlü `@playwright/mcp` kurulu gelir. Her
açılışta `scripts/setup-mcp.js`, `~/.claude.json`'a kullanıcı kapsamlı şu
tanımı yazar; böylece **her oturumda, hiçbir elle ayar yapmadan** tarayıcı
araçları (`browser_navigate`, `browser_snapshot`, `browser_click`…) hazırdır:

```json
"playwright": {
  "type": "stdio",
  "command": "playwright-mcp",
  "args": ["--browser=chrome", "--headless", "--isolated", "--no-sandbox"]
}
```

- `--headless`: Space'te ekran yok.
- `--no-sandbox`: konteynerlerde Chrome'un kendi sandbox'ı genelde çalışmaz
  (Playwright MCP, `chrome` kanalında onu varsayılan olarak açar).
- `--isolated`: tarayıcı profili bellekte tutulur; aynı anda çalışan oturumlar
  aynı profil klasörü için çakışmaz. Karşılığında tarayıcıdaki girişler
  (cookie'ler) tarayıcı kapanınca silinir.

Daha önce elle eklenmiş Playwright tanımları (ör. `--browser=chromium` ile,
klasöre özel olanlar dahil) ilk açılışta bir kez bu tanıma çevrilir; eski dosya
`~/.claude.json.agentweb-backup` olarak saklanır. Tanımı sonradan kendiniz
değiştirirseniz ya da `claude mcp remove playwright -s user` ile kaldırırsanız
uygulama ona bir daha dokunmaz.

### Durumu görme ve yeniden başlatma

Sohbette model düğmesine dokunup **MCP sunucuları** satırını açın: her
sunucunun durumu (Bağlı / Hata / Giriş gerekli), kapsamı ve hata mesajı
görünür. Hatalı bir sunucuyu **Yeniden bağlan** ile tekrar deneyebilirsiniz.

MCP ayarları Claude başlarken okunur. `~/.claude.json` ya da `.mcp.json`'ı
değiştirdikten sonra aynı ekrandaki **Claude'u yeniden başlat**'a dokunun:
konuşma korunur, bir sonraki mesajla birlikte yeni ayarlar yüklenir.

### Proje `.mcp.json` dosyası ve onay

Her yeni oturum klasörüne `claude-config/mcp.example.json`'dan bir
`.mcp.json` kopyalanır (varsayılan: sadece `filesystem` sunucusu). Claude Code
güvenlik gereği bu dosyadaki sunucuları ilk kez kullanmadan önce onay ister;
sohbet ekranında bu onay penceresi çıkmadığı için yeni bir sunucu ekledikten
sonra o oturumun **Terminal** sekmesinde bir kez `claude` açıp onaylayın.

API key/token gerektiren sunucular için değeri Space Secret olarak tanımlayıp
`env` içinde o değişkene referans vermeyi deneyin; çalışmazsa değeri dosyaya
yazıp Storage Bucket sayesinde kalıcı tutabilirsiniz. `npx`/`uvx` ile çalışan
MCP sunucuları ilk çalıştırmada paketi otomatik indirir (443 üzerinden).

## 7. Ağ kısıtlaması

HF Space'lerin dışarı giden trafiği sadece **80, 443, 8080** portlarına
gidebilir. Pratikte:

- Çalışır: HTTP(S) API'ler, `git clone https://...`, npm/pip/uvx paket
  kurulumu, HTTP/SSE tabanlı veya stdio+HTTPS çağrılı MCP sunucuları.
- Çalışmaz: `ssh://` git remote'ları, doğrudan veritabanı portları (5432,
  6379, ...), özel TCP/UDP protokolleri. Bu tür bir ihtiyaç için Cloudflare
  Tunnel veya Tailscale gibi 443 üzerinden tünelleyen bir katman kullanın.

## 8. Sorun giderme

- **Space açılmıyor / hemen kapanıyor:** Space'in **Logs** sekmesine bakın;
  `entrypoint.sh` ve sunucu açıklayıcı Türkçe mesajlar yazar (özellikle
  `APP_PASSWORD` eksikse açıkça belirtir).
- **Sohbette "Kimlik doğrulama başarısız":** Terminal sekmesinde `claude`
  yazıp giriş yapın (bkz. bölüm 3) ya da `ANTHROPIC_API_KEY` tanımlayın.
- **"Seçilen model bu hesapta kullanılamıyor":** Model düğmesinden başka bir
  model (ör. Varsayılan) seçin.
- **"Önceki konuşma devam ettirilemedi, yeni bir konuşma başlatıldı":**
  Claude'un konuşma kaydı bulunamadı (genelde Storage Bucket olmadan yapılan
  bir restart sonrası). Ekrandaki geçmiş durur ama Claude eski konuşmayı
  hatırlamaz.
- **Bağlantı koptu uyarısı:** Sayfa kendiliğinden yeniden bağlanır. Oturum
  süresi dolduysa giriş sayfasına yönlendirilirsiniz; `SESSION_SECRET`
  sabitlenmemişse her restart sonrası yeniden giriş gerekir.
- **Playwright: "Chromium distribution 'chrome' is not found":** Space yeni
  Dockerfile ile yeniden build edilmemiş. Settings > **Factory rebuild** yapın;
  Chrome build sırasında kurulur.
- **Terminalde `claude` bulunamıyor:** Docker imajında `npm install -g
  @anthropic-ai/claude-code` build aşamasında çalışır; build loglarını
  kontrol edin.
