# Kurulum Rehberi

## 1. Space'i oluşturma

1. huggingface.co'da **New Space** > SDK olarak **Docker** seçin.
2. Bu repodaki tüm dosyaları (`Dockerfile`, `server/`, `public/`,
   `scripts/`, `package.json`, `package-lock.json`, `README.md`, `docs/`)
   Space reposunun kök dizinine yükleyin (repoyu
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
| `GITHUB_TOKEN` | Opsiyonel | GitHub için kişisel erişim token'ı (bkz. bölüm 6). GitHub MCP, `gh` ve `git push` bunu kullanır. Terminal'den `gh auth login` yapacaksanız gerekmez. |

Bu değerleri **Secret** olarak ekleyin, **Variable** olarak değil (Variable'lar
herkese açık okunur ve Space kopyalandığında taşınır). `APP_PASSWORD` ve
`SESSION_SECRET` Claude'un çalıştırdığı komutlara ve terminale hiç
aktarılmaz.

İsteğe bağlı ayarlar (gizli değiller; **Variable** olarak eklenebilir):

| İsim | Varsayılan | Açıklama |
|---|---|---|
| `AGENTWEB_DISPLAY` | kapalı | `1` yapılırsa sanal ekran ve **Ekran** sekmesi açılır (bkz. bölüm 5). |
| `SCREEN_RESOLUTION` | `1440x900` | Sanal ekranın çözünürlüğü. |
| `AGENTWEB_RTK` | açık | `0` yapılırsa rtk (Bash çıktısı kısaltma) tamamen kapanır (bkz. bölüm 9). |
| `AGENTWEB_PUBLIC_URL` | — | Space'i kendi alan adınızla kullanıyorsanız (ör. `https://agent.example.com`), MCP girişlerinden dönüş adresi. Normalde gerekmez. |

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

## 5. Sanal ekran (Ekran sekmesi, isteğe bağlı)

Sanal ekran **varsayılan olarak kapalıdır**: Claude'un ekran araçları her
ekran görüntüsünde binlerce token harcar ve kullanım limitini hızla doldurur.
Gerekirse Space **Settings > Variables** kısmına `AGENTWEB_DISPLAY=1`
ekleyin; Space yeniden başlayınca üst çubukta **Ekran** sekmesi görünür.
Kapalıyken sekme gizlidir ve Claude'a ekran araçları hiç sunulmaz.

Açıldığında konteynerde bir sanal ekran (Xvfb, varsayılan 1440×900) çalışır.
Claude'un ve terminalin açtığı grafik programlar (ör. tarayıcı) bu ekrana
çizilir. **Ekran** sekmesi onu canlı gösterir ve kontrol etmeni sağlar
(noVNC; görüntü yalnızca parolalı oturumundan, Space'in kendi adresi
üzerinden gelir).

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
- **Menü:** tarayıcıyı başlatma; uzak panodaki metni kopyalama; yeniden
  bağlanma ve ekranı yeniden başlatma (açık tüm pencereleri kapatır).
- **Claude'un ekran araçları:** `agentweb` MCP sunucusu Claude'a ekran
  görüntüsü alma, tıklama, sürükleme, yazma, tuşa basma, kaydırma, pencere
  listeleme/öne alma ve uygulama başlatma araçları verir. Ekran görüntüsü ve
  pencere listesi sormadan çalışır; ekranı değiştiren araçlar izin kartı
  çıkarır ("Her zaman izin ver" ile o oturum için kalıcı yapabilirsin).
- `SCREEN_RESOLUTION` (ör. `1280x800`) ekranın boyutunu belirler; ekran kartı
  olmadığı için büyük çözünürlük yavaşlatır.

> Roblox Studio (Vinegar) desteği kaldırıldı: Studio'nun her tıklamadan önce
> ekran görüntüsü isteyen MCP'si limiti çok hızlı tüketiyordu. Eski sürümün
> kalıcı HOME'da bıraktığı Roblox/Vinegar verisi (Roblox giriş yedeği dahil)
> ilk açılışta otomatik silinir; `robloxstudio` MCP tanımı da kaldırılır.

## 6. GitHub ve giriş isteyen MCP sunucuları

### GitHub (MCP, `gh` ve `git push`)

GitHub'ın MCP sunucusu (`api.githubcopilot.com/mcp`) başka uygulamaların
OAuth ile giriş yapmasına izin vermez ("dinamik istemci kaydı" yok); Claude
Code'da "Giriş yap"/`/mcp` ile bağlanmaya çalışınca *Incompatible auth server:
does not support dynamic client registration* hatası bundan gelir. Bu yüzden
Agent Web GitHub'a **token** ile bağlanır ve aynı token'ı üç yerde kullanır:
GitHub MCP (`github` sunucusu, tüm oturumlarda hazır tanımlı), `gh` komutu ve
`git push/pull/clone` (github.com için kimlik yardımcısı). İki yoldan birini
seçin:

**A) Telefondan, token oluşturmadan — `gh auth login`:**

1. Bir oturumda **Terminal** sekmesine geçip `gh auth login` yazın.
2. Sorulara: *GitHub.com* → *HTTPS* → *Authenticate Git…: Yes* → *Login with
   a web browser*. Ekranda 8 haneli bir kod çıkar.
3. Telefonda `https://github.com/login/device` adresini açıp kodu girin ve
   izin verin. Terminal "Logged in as …" der.
4. **Sohbet** sekmesinde model düğmesi → **MCP sunucuları** → `github`
   satırında **Yeniden bağlan**'a dokunun (Claude çalışmıyorsa önce *Claude'u
   başlat ve güncel durumu al*). Durum *Bağlı* olur.

Storage Bucket bağlıysa giriş kalıcıdır (`~/.config/gh`).

**B) Secret ile — `GITHUB_TOKEN`:**

1. GitHub → *Settings → Developer settings → Fine-grained tokens* sayfasında
   bir token oluşturun; sadece gereken depoları seçin. İzinler: *Contents*,
   *Pull requests*, *Issues* (Read and write), *Metadata* (Read).
2. Space **Settings > Variables and secrets**'a `GITHUB_TOKEN` adıyla
   **Secret** olarak ekleyin. Space yeniden başlar; GitHub MCP, `gh` ve `git`
   hemen çalışır.

Notlar:

- Token hiçbir dosyaya yazılmaz: GitHub MCP her bağlanışta
  `scripts/github-mcp-headers` ile, git ise `scripts/git-credential-github`
  ile token'ı ortamdan (`GH_TOKEN`/`GITHUB_TOKEN`) ya da `gh` girişinden alır.
  Claude'un komutları da token'ı görebilir (git/`gh` için gerekli); bu yüzden
  sadece gereken depolara yetkili bir token kullanın.
- Kendi `github` MCP tanımınız token'ı kendi başlığında taşıyorsa ona
  dokunulmaz. Sadece token'sız (çalışamayan) eski OAuth tanımları ilk
  açılışta bu tanıma çevrilir. Kaldırmak için:
  `claude mcp remove github -s user`.
- GitHub MCP'nin araçları çoktur ama Claude Code araç tanımlarını gerektiğinde
  yükler (bkz. bölüm 9); bağlı olması her mesajda büyük bir maliyet getirmez.

### Giriş isteyen diğer MCP sunucuları (OAuth)

Linear, Notion, Sentry, Atlassian gibi uzak MCP sunucuları ilk kullanımda
hesap girişi ister (MCP listesinde *Giriş gerekli*). Claude Code'un kendi
giriş akışı tarayıcıyı `http://localhost:<port>/callback` adresine döndürür;
bu adres telefondan açılamadığı için girişler eskiden yarıda kalıyordu. Artık:

1. Model düğmesi → **MCP sunucuları** → ilgili satırda **Giriş yap**.
2. **Giriş sayfasını aç ↗** yeni sekmede sağlayıcının giriş sayfasını açar;
   giriş yapıp izin verin.
3. Sağlayıcı sizi Agent Web'in `/oauth/callback` adresine geri gönderir,
   "Giriş tamamlandı" sayfası çıkar; sekmeyi kapatıp geri dönün. Sunucu
   kendiliğinden yeniden bağlanır (*Bağlı*).

Bazı sağlayıcılar sadece `localhost` dönüş adresine izin verir. O zaman ekran
bunu söyler: girişten sonra tarayıcı "sayfaya ulaşılamıyor" der; o sayfanın
adres çubuğundaki adresin **tamamını** kopyalayıp MCP ekranındaki kutuya
yapıştırın ve **Gönder**'e dokunun. claude.ai bağlayıcıları (Context7 gibi)
claude.ai'ın kendi sayfasında bağlanır; bitince **Yeniden bağlan**.

`/oauth/callback` adresi parola istemez (dönüş başka bir siteden geldiği için
giriş cookie'si gönderilmez); yalnızca uygulamadan başlatılmış, süresi
dolmamış (15 dakika) bir girişin tek kullanımlık `state` değerini kabul eder.

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
claude mcp add --scope user --transport http linear https://mcp.linear.app/mcp
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
değiştirirseniz ya da kaldırırsanız (MCP ekranındaki **Kaldır** veya
`claude mcp remove playwright -s user`) uygulama ona bir daha dokunmaz.

Aynı şekilde iki sunucu daha tüm oturumlara tanımlanır:

| İsim | Ne yapar |
|---|---|
| `agentweb` | Agent Web'in kendi araçları: `share_file` (sohbete dosya gönderme); sanal ekran açıksa ekran araçları da (bkz. bölüm 5). |
| `github` | GitHub MCP, token ile (bkz. bölüm 6). Token yoksa *Giriş gerekli* görünür; zararsızdır. |

Eski sürümün eklediği `robloxstudio` tanımı, değiştirilmemişse ilk açılışta
kaldırılır. Bu üç hazır sunucu da kaldırılabilir; kaldırdığınız restart'tan
sonra geri eklenmez.

### Durumu görme ve yeniden başlatma

Sohbette model düğmesine dokunup **MCP sunucuları** satırını açın: her
sunucunun durumu (Bağlı / Hata / Giriş gerekli), kapsamı ve hata mesajı
görünür. Hatalı bir sunucuyu **Yeniden bağlan** ile tekrar deneyebilir, giriş
isteyenlere **Giriş yap** ile bağlanabilirsiniz (bölüm 6). Claude o an
çalışmıyorsa **Claude'u başlat ve güncel durumu al** mesaj göndermeden
başlatır.

MCP ayarları Claude başlarken okunur. `~/.claude.json` ya da `.mcp.json`'ı
değiştirdikten sonra aynı ekrandaki **Claude'u yeniden başlat**'a dokunun:
konuşma korunur, bir sonraki mesajla birlikte yeni ayarlar yüklenir.

### Sunucuyu kalıcı olarak kaldırma ya da kapatma

Aynı ekranda her sunucunun adının altında bir düğme vardır:

- **Kaldır** (kullanıcı, yerel ve proje kapsamındaki sunucular): sunucu
  tanımlı olduğu dosyadan silinir; restart'tan sonra da geri gelmez. Dokununca
  satırda ne olacağı yazar, **Kaldır** ile onaylarsınız (**Vazgeç** hiçbir şeyi
  değiştirmez). Neyin silindiği kapsama göre değişir:

  | Kapsam (satırda yazan) | Silindiği yer | Etkisi |
  |---|---|---|
  | tüm oturumlar | `~/.claude.json` → `mcpServers` | tüm oturumlardan gider |
  | sadece bu klasör | `~/.claude.json` → `projects["<klasör>"]` | sadece bu oturumdan gider |
  | bu klasörün .mcp.json'u | `<oturum klasörü>/.mcp.json` | dosyadan silinir |

  Arka planda Terminal'deki `claude mcp remove --scope <kapsam> <isim>` ile
  aynı işlem çalışır. Claude boştaysa hemen yeniden başlatılır (konuşma
  korunur) ve sunucu listeden düşer; o an yanıt veriyorsa yanıt kesilmez, yanıt
  bitince yeniden başlar. Kullanıcı kapsamındaki bir sunucu kaldırılınca boşta
  bekleyen diğer oturumlar da bir sonraki mesajda onsuz başlar. Dosya bozuksa
  ya da yazılamıyorsa hata satırda görünür ve hiçbir şey silinmez.

  Geri eklemek için Terminal'de `claude mcp add` kullanın (örnek yukarıda).
  Hazır sunucular (`playwright`, `agentweb`, `github`) tek komutla, hazır
  ayarlarıyla geri gelir; ardından **Claude'u yeniden başlat**'a dokunun:

  ```bash
  node /app/scripts/setup-mcp.js --restore playwright
  ```

- **Kapat** (claude.ai bağlayıcıları: Context7, Firecrawl…): bu sunucular
  claude.ai hesabınızda tanımlı olduğu için buradan silinemez. **Kapat** onu bu
  oturumda kapatır ve **Aç**'a dokunana kadar kapalı kalır (Claude Code bunu
  klasörün ayarında saklar). Tüm oturumlardan kaldırmak için claude.ai'da
  **Ayarlar → Bağlayıcılar** (onay panelindeki bağlantı oraya götürür).

Eklentilerden (plugin) ya da yönetici ayarlarından gelen sunucularda düğme
yoktur; onlar kendi yerlerinden yönetilir.

### Proje `.mcp.json` dosyası ve onay

Bir oturum klasörüne `.mcp.json` koyarsanız içindeki sunucular o oturumda
yüklenir. Claude Code güvenlik gereği bu dosyadaki sunucuları ilk kez
kullanmadan önce onay ister; sohbet ekranında bu onay penceresi çıkmadığı
için yeni bir sunucu ekledikten sonra o oturumun **Terminal** sekmesinde bir
kez `claude` açıp onaylayın.

Eski sürümler her yeni oturum klasörüne `filesystem` sunuculu bir `.mcp.json`
kopyalıyordu. Bu sunucu Claude Code'un kendi dosya araçlarını (Read, Write,
Edit, Glob, Grep) tekrarladığı için kaldırıldı; hiç değiştirilmemiş eski
kopyalar oturum açılırken silinir, değiştirdikleriniz kalır.

API key/token gerektiren sunucular için değeri Space Secret olarak tanımlayıp
yapılandırmada `${DEGISKEN_ADI}` biçiminde referans verin (Claude Code
`command`, `args`, `env`, `url` ve `headers` içindeki ortam değişkenlerini
açar). `npx`/`uvx` ile çalışan MCP sunucuları ilk çalıştırmada paketi
otomatik indirir (443 üzerinden).

## 9. Token tasarrufu

Hiçbiri Claude'un gördüğü bilgiyi azaltmaz:

- **Kaldırılan yükler:** Roblox Studio MCP (her istekte binlerce token'lık
  talimat ve araç listesi) ve tekrarlayan `filesystem` sunucusu kaldırıldı;
  sanal ekran kapalıyken ekran araçları ve ekranla ilgili sistem notu hiç
  gönderilmez.
- **Claude Code'un kendi varsayılanları (ayar gerekmez):** MCP araçlarının
  tanımları her istekte gönderilmez, Claude gerektiğinde arayıp yükler (tool
  search). Abonelikle (claude.ai girişi) kullanırken Claude Code ana
  konuşmanın önbelleğini normalde 1 saat tutar; yarım saatlik bir aradan
  sonra devam etmek konuşmayı baştan ücretlendirmez (ek kullanım kredisine
  geçildiğinde Claude Code bunu 5 dakikaya indirir). Çok büyük MCP çıktıları sohbete gömülmek yerine dosyaya
  yazılır ve Claude ihtiyaç duyduğu kısmını okur.
- **rtk (güvenli mod):** [rtk](https://github.com/rtk-ai/rtk), Bash
  komutlarının çıktısını Claude okumadan önce kısaltan bir araçtır. Çoğu
  filtresi özet çıkarır (ör. test hatalarını birkaç satıra indirir, `head
  -20`'yi "akıllı" bir alıntıya çevirir, `git push` çıktısını "ok"a indirir);
  bu bilgi kaybı demek olduğundan Agent Web onu yalnızca çıktısı aynı bilgiyi
  taşıyan komutlarda açar: `git status`, `git add` ve npm/npx ile script
  çalıştırma (sadece npm'in kendi başlık, uyarı ve bildirim satırları gider,
  programın çıktısı aynen kalır). Okuma, arama, listeleme, diff/log,
  indirme, test, lint ve derleme komutları rtk'ye hiç uğramaz. Ayarlar
  `~/.config/rtk/config.toml`'dadır; oradaki listeden komut çıkararak
  tasarrufu artırabilirsiniz (o komutların çıktısı rtk'nin özetine döner).
  Tamamen kapatmak için `AGENTWEB_RTK=0`. Ne kadar kazandırdığını terminalde
  `rtk gain` gösterir. rtk izin sorma akışını değiştirmez: komut yine izin
  kartıyla sorulur (kartta komutun başında `rtk` görünür).

## 10. Ağ kısıtlaması

HF Space'lerin dışarı giden trafiği sadece **80, 443, 8080** portlarına
gidebilir. Pratikte:

- Çalışır: HTTP(S) API'ler, `git clone https://...`, npm/pip/uvx paket
  kurulumu, HTTP/SSE tabanlı veya stdio+HTTPS çağrılı MCP sunucuları.
- Çalışmaz: `ssh://` git remote'ları, doğrudan veritabanı portları (5432,
  6379, ...), özel TCP/UDP protokolleri. Bu tür bir ihtiyaç için Cloudflare
  Tunnel veya Tailscale gibi 443 üzerinden tünelleyen bir katman kullanın.

## 11. Sorun giderme

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
- **GitHub MCP *Giriş gerekli* ya da 401 hatası:** Token yok ya da geçersiz.
  Terminal'de `gh auth status` ile kontrol edin; `gh auth login` yapın ya da
  `GITHUB_TOKEN` secret'ını yenileyin, sonra MCP ekranında **Yeniden bağlan**
  (bölüm 6). "dynamic client registration" hatası GitHub'ın OAuth'u
  desteklememesinden gelir; token yolunu kullanın.
- **`git push` parola soruyor / 403:** Token'ın o depoya *Contents: Read and
  write* izni olmalı. `git config --global --get-all
  credential.https://github.com.helper` Agent Web'in yardımcısını
  göstermeli (kendi yardımcınız varsa ona dokunulmaz).
- **Bir MCP girişi "tanınmadı ya da süresi doldu" diyor:** Giriş 15 dakika
  içinde tamamlanmalı ve Claude arada yeniden başlamamalı. MCP ekranından
  **Giriş yap**'a yeniden dokunun.
- **rtk'nin bir komutu bozduğunu düşünüyorsanız:** Komutun başına
  `RTK_DISABLED=1` ekleyin ya da rtk'yi `AGENTWEB_RTK=0` ile kapatın.
