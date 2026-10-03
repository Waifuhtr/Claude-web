---
title: Agent Web
emoji: 💬
colorFrom: gray
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Agent Web (self-hosted, HF Space)

Claude ile çalışan, telefondan ve bilgisayardan kullanılabilen, parola korumalı,
çok oturumlu ve (Storage Bucket bağlıysa) kalıcı kişisel bir çalışma alanı.
Arka planda Claude Agent SDK çalışır; yani Claude gerçek araçları kullanır:
dosya okuma/düzenleme, komut çalıştırma, web erişimi ve MCP sunucuları.

- **Sohbet (varsayılan ekran):** claude.ai benzeri arayüz. Yanıtlar canlı
  akar; düşünme özetleri, komut/dosya araç kartları, düzenlemelerin farkı
  (diff) ve görev listesi görünür.
  - Yazma alanının altındaki düğmelerden **model**, **effort** (Düşük →
    Maksimum) ve **izin modu** (Her işlemde sor / Düzenlemeleri otomatik kabul
    et / Plan modu / Otomatik / Tüm izinleri atla) seçilir; değişiklik çalışan
    konuşmaya anında uygulanır.
  - İzin istekleri, Claude'un soruları ve plan onayı dokunulabilir kartlar
    olarak gelir.
  - Mesaja dosya ve görsel eklenebilir; araçların aldığı ekran görüntüleri
    sohbette görünür. Her yanıtın yanında süre ve harcanan token yazar.
  - Claude da sana dosya gönderebilir ("bunu txt olarak at"): sohbette
    indirme kartı olarak çıkar, metin dosyaları sohbetten çıkmadan okunur.
  - Yanıtı ■ ile durdurabilir, ✎ ile yeni sohbet başlatabilirsin. Konuşmalar
    sunucuda saklanır; sayfayı kapatıp açınca kaldığın yerden devam eder.
- **Terminal sekmesi:** tmux + xterm.js ile gerçek kabuk ve `claude` CLI'si.
  İlk giriş (login) ve elle komutlar için. Mobilde Esc/Tab/^C/ok/Enter tuş
  çubuğu vardır.
- **Çoklu oturum:** Her oturumun kendi klasörü (`$WORKSPACE_ROOT/<isim>`),
  sohbeti ve terminali olur.
- **MCP:** Eklediğin sunucular hem sohbette hem terminalde kullanılır.
  Model menüsündeki **MCP sunucuları** ekranı her sunucunun durumunu
  gösterir; giriş isteyen (OAuth) sunuculara oradaki **Giriş yap** ile
  telefondan da bağlanılır, istemediğin sunucuyu **Kaldır** ile kalıcı olarak
  silebilirsin. Claude'a eklettiğin sunucular kalıcı klasöre kurulur
  (`~/mcp-servers`); `/tmp`'ye kurulmuş olanlar işaretlenir ve **Kalıcı kur**
  ile düzeltilir.
- **GitHub:** GitHub MCP, `gh` ve `git push` aynı token'la çalışır: Terminal'de
  bir kez `gh auth login` (telefonda kodla giriş) ya da `GITHUB_TOKEN` secret'ı.
- **Hazır tarayıcı:** İmajda Google Chrome ve Playwright MCP kurulu gelir;
  her oturumda elle ayar yapmadan web sayfalarında gezinebilir.
- **Ekran sekmesi (sanal ekran, isteğe bağlı):** `AGENTWEB_DISPLAY=1` ile
  açılır; konteynerdeki sanal masaüstünü canlı gösterir, telefondan dokunarak
  kontrol edilir ve Claude da aynı ekranı görüp kullanabilir. Ekran
  görüntüleri çok token harcadığı için varsayılan olarak kapalıdır.
- **Token tasarrufu (bilgi kaybı olmadan):** Kullanılmayan araçlar
  yüklenmez, tekrarlayan araç tanımları kaldırıldı; rtk yalnızca çıktısı
  kayıpsız kısalabilen komutlarda (git status, npm script'leri) devrededir.
- **Kalıcılık:** `/data` yoluna bir Storage Bucket bağlıysa `HOME` otomatik
  olarak oraya yönlendirilir (giriş bilgisi, sohbet geçmişi, MCP ayarları ve
  proje dosyaları kalıcı olur). Bucket yoksa her yeniden başlatmada sıfırlanır.
  Bucket'ı **private** yap: içinde giriş bilgilerin ve sohbetlerin durur.

Kurulum, secret'lar, Claude girişi, sohbet ayarları ve MCP için
[`docs/SETUP.md`](docs/SETUP.md)'ye bakın.

## Hızlı başlangıç

1. Bu repoyu Docker SDK ile oluşturulmuş bir HF Space'e yükleyin.
2. Space Settings > **Variables and secrets** kısmına en az `APP_PASSWORD`
   secret'ını ekleyin.
3. Parolayla giriş yapıp bir oturum oluşturun. İlk seferde **Terminal**
   sekmesinde `claude` yazıp Claude hesabınızla giriş yapın (ya da
   `ANTHROPIC_API_KEY` secret'ı tanımlayın).
4. **Sohbet** sekmesine dönüp yazmaya başlayın.

## Ağ kısıtlaması (önemli)

HF Space'lerde dışarı giden trafik sadece **80, 443 ve 8080** portlarına
gidebilir; başka porta giden istekler platform tarafında engellenir. HTTP(S)
tabanlı MCP sunucuları ve git/npm/pip https üzerinden çalışır; ham TCP
gerektiren entegrasyonlar (doğrudan veritabanı portu, ssh://git vb.) için
Cloudflare Tunnel / Tailscale gibi 443 üzerinden tünelleyen bir çözüm
gerekir. Ayrıntı: `docs/SETUP.md`.

> Bu proje Anthropic'in resmi bir ürünü değildir; Claude Agent SDK ile
> yapılmış, kendi hesabınızla kişisel kullanım için bir arayüzdür.
