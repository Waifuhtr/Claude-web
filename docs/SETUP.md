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
  modellerle güncellenir; **Sonnet 5.5** gibi yeni modeller, Claude Code'un
  listesinde henüz olmasalar da her zaman seçilebilir. Eski sürümler **Diğer
  modeller** altındadır.
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
- **Dosya ve görsel ekleme:** Yazma alanının solundaki ataç düğmesiyle (ya da
  bilgisayarda yapıştırarak/sürükleyip bırakarak) mesaja en fazla 10 dosya
  ekleyebilirsiniz (dosya başına 50 MB). Dosyalar oturum klasöründe
  `uploads/` altına kaydedilir ve Claude'a yolları bildirilir; görselleri
  Claude doğrudan görür. 2000 pikselden büyük fotoğraflar gönderilmeden önce
  otomatik küçültülür.
- **Ekran görüntüleri:** Playwright gibi bir araç ekran görüntüsü aldığında
  ya da Claude bir görsel dosyasını okuduğunda görsel, aracın kartında
  görünür; dokununca büyür, bir daha dokununca gerçek boyutta açılır.
- **Claude'dan dosya alma:** "Bunu txt olarak gönder", "raporu dosya olarak
  ver", "projeyi zip'le at" gibi isteklerde Claude dosyayı oluşturup
  `share_file` aracıyla sohbete koyar. Dosya bir indirme kartı olarak görünür:
  **İndir** ile cihazına kaydedersin; metin dosyalarında **Görüntüle** ile
  sohbetten çıkmadan okuyup kopyalayabilirsin, görsellerin küçük önizlemesi
  olur. Dosya başına 50 MB, tek seferde 10 dosya; klasörler önce arşivlenir.
  Paylaşılan kopyalar sohbetle birlikte saklanır (yeni sohbet başlatınca
  silinir); çalışma klasöründeki asıl dosyaya dokunulmaz.
- **Süre ve token:** Claude çalışırken yazma alanının üstünde geçen süre ve
  harcanan token canlı görünür (onay beklerken "Onay bekliyor" yazar). Her
  yanıtın sonundaki satırda süre, okunan (↑) ve yazılan (↓) token yazar;
  satıra dokununca yeni/önbellekten okunan/önbelleğe yazılan token dökümü ve
  kullanılan model açılır. API key ile çalışıyorsanız tahmini maliyet de
  görünür.
- **Kullanım limiti:** Abonelik limitine yaklaşınca yazma alanının üstünde bir
  uyarı ve sıfırlanma saati görünür.
- Bilgisayarda **Enter** gönderir, **Shift+Enter** yeni satır açar; telefonda
  Enter yeni satırdır, gönder düğmesini kullanın.

## 5. Sanal ekran (Ekran sekmesi)

Konteynerde gerçek bir masaüstü yoktur; bunun yerine bir sanal ekran (Xvfb,
varsayılan 1440×900) çalışır. Claude'un ve terminalin açtığı grafik
programlar (Roblox Studio, tarayıcı…) bu ekrana çizilir. Üst çubuktaki
**Ekran** sekmesi onu canlı gösterir ve kontrol etmeni sağlar (noVNC; görüntü
yalnızca parolalı oturumundan, Space'in kendi adresi üzerinden gelir).

- **Telefonda:** Dokun = tıkla, iki parmakla dokun = sağ tık, iki parmakla
  sürükle = fare tekerleği. **1:1** düğmesi görüntüyü gerçek boyuta getirir;
  bu modda tek parmakla sürükleyerek görüntüyü kaydırırsın (dokunmak yine
  tıklar). **Sığdır** tüm ekranı sekmeye sığdırır; bu modda tek parmakla
  sürüklemek fareyle sürüklemek demektir. Telefonu yatay tutmak işi
  kolaylaştırır.
- **Klavye:** Telefonda **Klavye** düğmesi bir yazı kutusu açar: yazıp **Yaz**
  dersen metin tuş tuş gönderilir; **Yapıştır** metni uzak panoya koyup
  Ctrl+V'ye basar (uzun ya da Türkçe karakterli metinler için daha
  güvenilir). **Tuşlar** satırında Esc, Tab, ⌫, Del, Enter, oklar, F5 ve
  basılı kalan Ctrl/Alt/Shift vardır (ör. Ctrl'ye dokunup Klavye'den `s`
  yazınca Ctrl+S gider). Bilgisayarda görüntüye tıklayıp doğrudan klavyeyi
  kullanabilirsin.
- **Menü:** Roblox Studio, Vinegar ayarları ve tarayıcıyı başlatma; uzak
  panodaki metni kopyalama; yeniden bağlanma ve ekranı yeniden başlatma
  (açık tüm pencereleri kapatır).
- **Claude'un ekran araçları:** `agentweb` MCP sunucusu Claude'a ekran
  görüntüsü alma, tıklama, sürükleme, yazma, tuşa basma, kaydırma, pencere
  listeleme/öne alma ve uygulama başlatma araçları verir. Ekran görüntüsü ve
  pencere listesi sormadan çalışır; ekranı değiştiren araçlar izin kartı
  çıkarır ("Her zaman izin ver" ile o oturum için kalıcı yapabilirsin).
- Ayarlar (Space **Variables**): `SCREEN_RESOLUTION` (ör. `1280x800`,
  `1920x1080`; ekran kartı olmadığı için büyük çözünürlük yavaşlatır),
  `AGENTWEB_DISPLAY=0` (sanal ekranı tamamen kapatır).

## 6. Roblox Studio (Vinegar + Roblox Studio MCP)

Roblox Studio Windows programıdır; burada
[Vinegar](https://github.com/vinegarhq/vinegar) ile, Wine üzerinden sanal
ekranda çalışır. Claude ona
[Roblox Studio MCP](https://github.com/Chrrxs/robloxstudio-mcp) (`robloxstudio`
sunucusu) ile bağlanır: yer (place) yapısını okuma/düzenleme, script yazma,
Luau çalıştırma, playtest başlatma, log/ekran görüntüsü/profil alma, asset
arama ve ekleme gibi ~50 araç.

**İlk kurulum (bir kez):**

1. **Ekran** sekmesini aç, **Menü → Roblox Studio'yu başlat**'a dokun (ya da
   sohbette Claude'a "Roblox Studio'yu aç" de). İlk açılışta Vinegar Wine'ı,
   Studio'yu ve WebView2'yi indirip kurar: birkaç dakika sürer, ilerleme
   Vinegar penceresinde görünür.
2. Studio giriş ekranı gelince Roblox hesabınla Ekran sekmesinden giriş yap
   (yazmak için **Klavye**). Parolanı sohbete yazma; Claude'dan da isteme.
   Studio gömülü giriş penceresini açamazsa tarayıcıda giriş ister: sanal
   ekranda Chrome açılır, girişten sonra "Vinegar'ı aç" sorusuna **Aç** de.
3. Studio açılınca MCP eklentisi (MCPPlugin) otomatik yüklü gelir ve Claude'a
   bağlanır. Studio eklenti için izin sorarsa Ekran sekmesinden onayla.
   Sohbette "Studio'ya bağlı mısın?" diye sorarak deneyebilirsin
   (`get_connected_instances`).

**Bilmen gerekenler:**

- **Ekran kartı yok:** Görüntü işlemci (CPU) ile yazılımsal olarak çizilir.
  Studio'nun menüleri ve script düzenleme rahat çalışır; 3B görünüm ve
  playtest yavaş olabilir. Claude işin çoğunu MCP üzerinden (görüntüye
  ihtiyaç duymadan) yapar.
- **3B görünüm siyahsa ya da Studio açılır açılmaz kapanıyorsa:** Menü →
  **Vinegar ayarları** → *Renderer* seçeneğini `D3D11` yap (varsayılan
  `DXVK`), Studio'yu kapatıp yeniden başlat.
- **Nerede ne tutulur:** Wine, Studio ve Wine prefix'i (~2–3 GB) yerel diskte
  (`/var/lib/agentweb/roblox`) durur ve Space yeniden başladığında yeniden
  indirilir. Roblox girişi ve Studio ayarları, Studio normal kapatıldığında
  kalıcı HOME'a (`~/.config/agentweb/roblox/settings.reg`) yedeklenir ve
  sonraki kurulumda geri yüklenir; yani Studio'yu menüden kapatmayı
  alışkanlık edin. Studio'da kaydettiğin `.rbxl` dosyaları `~/Documents`
  altındadır (Storage Bucket varsa kalıcı).
- **Terminal/Claude komutları:** `roblox-studio` (arka planda başlatır),
  `roblox-studio dosya.rbxl` (bir yer dosyasını açar), `vinegar manage`
  (Vinegar ayarları). Günlükler: `/tmp/agentweb-logs/`.
- Studio birden fazla oturumda aynı anda tek bir kopya olarak çalışır; tüm
  oturumlardaki Claude'lar aynı Studio'ya bağlanır (MCP sunucusu ilk açılanı
  ana sunucu yapar, diğerleri ona yönlenir).

## 7. Kalıcılık (Storage Bucket)

Bucket bağlı değilse **hiçbir şey** (giriş bilgisi, sohbet geçmişi, MCP
ayarları, proje dosyaları) bir sonraki restart'ta hayatta kalmaz —
`scripts/entrypoint.sh` bunu loglarda açıkça uyarır.

Bucket eklemek için: Space **Settings > Storage** > bir Storage Bucket
oluşturup `/data` yoluna bağlayın. Sunucu, `/data`'nın gerçekten ayrı bir
mount olup olmadığını otomatik algılar (cihaz kimliği karşılaştırması) ve
algılarsa `HOME`'u `/data/home`'a yönlendirir. Sohbet geçmişi
`$HOME/.cc-web/chats/` altında tutulur.

## 8. MCP sunucuları

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

Aynı şekilde iki sunucu daha tüm oturumlara tanımlanır:

| İsim | Ne yapar |
|---|---|
| `agentweb` | Agent Web'in kendi araçları: `share_file` (sohbete dosya gönderme) ve sanal ekran araçları (bkz. bölüm 5). |
| `robloxstudio` | Roblox Studio MCP (`@chrrxs/robloxstudio-mcp`, sabit sürüm). `scripts/roblox-mcp` sarmalayıcısıyla çalışır; Studio eklentisini Vinegar'ın Studio'sunun eklenti klasörüne kurar (bkz. bölüm 6). |

Daha önce `claude mcp add robloxstudio -- npx -y @chrrxs/robloxstudio-mcp@latest ...`
gibi elle eklenmiş bir tanım varsa ilk açılışta bu sarmalayıcıya çevrilir
(eklentinin doğru klasöre kurulması için gereklidir). Salt okunur
"inspector" sürümüne dokunulmaz. Kullanmak istemezseniz
`claude mcp remove robloxstudio -s user` ile kaldırabilirsiniz.

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

## 9. Ağ kısıtlaması

HF Space'lerin dışarı giden trafiği sadece **80, 443, 8080** portlarına
gidebilir. Pratikte:

- Çalışır: HTTP(S) API'ler, `git clone https://...`, npm/pip/uvx paket
  kurulumu, HTTP/SSE tabanlı veya stdio+HTTPS çağrılı MCP sunucuları.
- Çalışmaz: `ssh://` git remote'ları, doğrudan veritabanı portları (5432,
  6379, ...), özel TCP/UDP protokolleri. Bu tür bir ihtiyaç için Cloudflare
  Tunnel veya Tailscale gibi 443 üzerinden tünelleyen bir katman kullanın.

## 10. Sorun giderme

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
- **Ekran sekmesi "Bu kurulumda sanal ekran yok" diyor:** Space eski
  Dockerfile ile build edilmiş. Settings > **Factory rebuild** yapın.
- **Ekran sekmesi sürekli "yeniden bağlanılıyor":** Menü → **Ekranı yeniden
  başlat**. Düzelmezse terminalde `cat /tmp/agentweb-logs/xvfb.log
  /tmp/agentweb-logs/vnc.log` çıktısına bakın.
- **Roblox Studio açılmıyor:** `cat /tmp/agentweb-logs/roblox_studio.log` ve
  Vinegar'ın kendi günlüğü (`/var/lib/agentweb/roblox/cache/vinegar/logs/`).
  Renderer'ı `D3D11` yapmayı deneyin (bölüm 6). Wine verisini sıfırlamak
  için Vinegar ayarlarındaki *Delete Prefix Data* kullanılabilir.
- **Claude Studio'yu göremiyor:** Studio açık ve giriş yapılmış olmalı.
  Sohbette model düğmesi → **MCP sunucuları**'nda `robloxstudio` *Bağlı*
  görünmeli; değilse **Yeniden bağlan**. Studio'da eklenti panelinde
  bağlantı durumu görünür.
