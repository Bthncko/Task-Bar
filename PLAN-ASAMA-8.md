# Aşama 8 — Eksik Kabuk Özellikleri ve Yeni Widget'lar

Aşama 0–7 bitti. Bu belge, Windows çubuğu gizlendiği için eksik kalan kabuk
işlevlerini (tepsi, bildirimler, önizleme) ve yeni widget'ları kapsar.

> **Dürüstlük notu:** Hiçbir şey Windows'ta denenmedi; API adları ve GUID'ler
> hafızamdan. **(doğrula)** işaretli her şeyi resmi dokümandan kontrol et.
> **Deneme** yazan paketlerde önce 20–30 dakikalık küçük bir kanıt yap; tutmazsa
> pakette yazan yedek yola geç, zorlama.

## Sıra ve özet

Kolay ve değeri yüksek olanlar önce, büyük yeniden yapılandırmalar sonda.

| Paket | İş | Zorluk | Risk |
|---|---|---|---|
| 8.0 | Açık kalan kontroller | Kolay | — |
| 8.1 | Ortak altyapı | Kolay | — |
| 8.2 | Sistem düğmeleri (bildirim, hızlı ayarlar ...) | Kolay | Düşük |
| 8.3 | Pencere önizlemesi | Orta | Düşük |
| 8.4 | Sistem izleyici | Kolay | Düşük |
| 8.5 | Ses paneli: çıkış değiştirici + mikrofon | Orta | Orta (belgelenmemiş API) |
| 8.6 | Tepsi erişimi | Zor | **Yüksek** |
| 8.7 | Sürükle-bırak | Orta | Orta |
| 8.8 | Küçük widget'lar | Kolay–Orta | Düşük |
| 8.9 | AI kullanımı | Orta | Orta (belgelenmemiş dosya biçimi) |
| 8.10 | Otomatik gizlenme | Orta | Orta |
| 8.11 | Çoklu monitör — **iptal** (2026-11-18: tek ekran, kullanılmayacak) | Zor | Orta (büyük yeniden yapılandırma) |

Her paket sonunda: çalıştır, göster, onay, commit. Boşta CPU (~%2) her paketten
sonra yeniden ölçülür; yükseldiyse paket bitmemiştir.

---

## 8.0 Açık kalan kontroller
- [ ] %100 / %125 / %150 ekran ölçeğinde yerleşim, bulanıklık, panel konumu
- [ ] Kurulum dosyası yeniden üretildi, temiz bir kullanıcı hesabında kuruldu
- [ ] 24 saat açık: başlangıç/bitiş bellek ve GDI nesne sayısı not edildi

**Bitti:** Üçü de raporlandı; sızıntı varsa giderildi.

---

## 8.1 Ortak altyapı

Widget sayısı artacak; önce zemini hazırla.

- [ ] **Tembel servisler:** Bir servis yalnızca widget'ı yerleşimde (ya da paneli
      açık) ise çalışır. `runner.rs`'e başlat/durdur; config değişince yeniden
      değerlendir. Yerleşimde olmayan widget sıfır CPU harcar.
- [ ] **Widget kataloğu:** `WidgetDefinition`'a `category` ve `description`.
      Ayarlar → Widget'lar'da kategoriye göre gruplu "ekle" listesi.
- [ ] **Tuş gönderme yardımcı fonksiyonu:** `launcher.rs`'teki Win tuşu kodu
      genelleştirilir: `send_chord(&[VK_LWIN, VK_N])`.
- [ ] **Monitör farkındalığı:** `popup.rs` panel konumunu `primary_monitor_rect`
      yerine çapanın bulunduğu monitörden hesaplar (8.11'e hazırlık).
- [ ] Yeni config alanlarının hepsi `serde(default)`; eski dosya bozulmaz.

**Bitti:** Mevcut davranış aynı; yerleşimden çıkarılan widget'ın servisi duruyor.

---

## 8.2 Sistem düğmeleri

Windows'un kendi panellerini açan düğmeler. Hepsi tuş kombinasyonu gönderir.

| Düğme | Gönderilen | Not |
|---|---|---|
| Bildirim merkezi | Win+N | |
| Hızlı ayarlar | Win+A | |
| Görev görünümü | Win+Tab | |
| Arama | Win+S | |
| Pano geçmişi | Win+V | Windows'ta kapalıysa açma önerisi çıkar |
| Ekran alıntısı | Win+Shift+S | ya da `ms-screenclip:` **(doğrula)** |
| Masaüstünü göster | Win+D | |

- Yeni widget: `system` — seçilen düğmeler `Pill`/`IconButton` olarak dizilir.
  Config: `widgets.system.buttons: ["notifications","quickSettings", ...]`.
- Varsayılan: bildirim + hızlı ayarlar, sağ bölümün sonunda.
- Saat karosuna sağ tık → bildirim merkezi (Windows alışkanlığı).
- Kullanıcı o anda Ctrl/Shift/Alt basılı tutuyorsa kombinasyon bozulur; göndermeden
  önce `GetAsyncKeyState` ile bak, basılıysa bırakılmasını bekle.

**Bilinen sınır:** Okunmamış bildirim sayısını göstermenin güvenilir bir yolunu
bilmiyorum (`UserNotificationListener` paket kimliği isteyebilir **(doğrula)**).
Sayı rozeti bu pakette yok.

**Bitti:** Her düğme Windows çubuğu gizliyken doğru paneli açıyor.

---

## 8.3 Pencere önizlemesi

İkonun üzerinde bekleyince pencerelerin canlı küçük resimleri.

**Yapı:**
- Yeni Tauri penceresi `preview`: şeffaf, üstte, odak almaz (dock stili).
- İçerik HTML: her pencere için kart (başlık satırı + kapat düğmesi + boş bir
  küçük resim alanı).
- Küçük resimler DWM ile çizilir: frontend her alanın dikdörtgenini (fiziksel
  piksel) Rust'a bildirir, Rust `DwmRegisterThumbnail` + `DwmUpdateThumbnailProperties`
  ile oraya yerleştirir. Altyapı `win/window_fx.rs`'te var; oradan ortak fonksiyon çıkar.
- DWM küçük resmi HTML'in **üstüne** çizilir **(doğrula)**; bu yüzden kapat
  düğmesi küçük resmin üstünde değil, başlık satırında durur.
- En-boy oranı: `DwmQueryThumbnailSourceSize`; kart yüksekliği sabit ~120 px,
  genişlik orana göre (en çok 220).

**Davranış:**
| Olay | Sonuç |
|---|---|
| İkonda 350 ms bekleme | Önizleme açılır (isim balonunun yerine) |
| Başka ikona geçiş | Gecikmesiz içerik değişir |
| İkondan önizlemeye geçiş | 200 ms tolerans, kapanmaz |
| Karta tık | Pencere öne gelir, önizleme kapanır |
| Kapat düğmesi / orta tık | Pencere kapanır, kart animasyonla çıkar |
| Kapalı (yalnızca sabit) uygulama | Önizleme yok, isim balonu |
| Panel açıkken ya da sürükleme sırasında | Önizleme açılmaz |

- Simge durumundaki pencerede DWM boş görüntü verebilir **(doğrula)** → o kartta
  büyük uygulama ikonu + başlık gösterilir.
- Çok pencere (8+): kartlar küçülür, sonra yatay kayar.
- Kapanışta tüm küçük resimler `DwmUnregisterThumbnail` ile bırakılır (sızıntı riski).
- Config: `widgets.apps.previews: true`, `previewDelayMs: 350`.

**Bitti:** 3 pencereli bir uygulamada üç canlı önizleme; tıklama, kapatma ve
ikonlar arası geçiş takılmasız; 50 aç-kapa sonrası bellek artmıyor.

---

## 8.4 Sistem izleyici

**Rust — `services/sysmon.rs`:**
| Veri | Kaynak |
|---|---|
| CPU % | `GetSystemTimes` iki örnek arası fark |
| RAM | `GlobalMemoryStatusEx` |
| Ağ indirme/yükleme | `GetIfTable2`, etkin ve geri döngü olmayan arayüzlerin bayt sayaçları farkı **(doğrula)** |
| Disk | `GetDiskFreeSpaceExW` (yalnızca panel açıkken) |
| En çok kullanan 5 süreç | `K32EnumProcesses` + `GetProcessTimes` (yalnızca panel açıkken) |

- Örnekleme: çubukta 2 sn, panel açıkken 1 sn. Widget yerleşimde değilse servis kapalı.
- GPU kullanımı PDH sayaçlarıyla mümkün ama zahmetli; **isteğe bağlı**, sona bırak.
- Sıcaklık: sürücüsüz güvenilir bir yol bilmiyorum. **Yok.**
- Yeni bağımlılık ekleme (`sysinfo` yerine doğrudan Win32); `windows` crate'ine
  gereken özellikler eklenir (`Win32_System_SystemInformation`,
  `Win32_NetworkManagement_IpHelper`, `Win32_System_ProcessStatus` **(doğrula)**).

**Çubuk karosu** (`soft`, ~120 px): üç görünüm, ayardan seçilir:
- `compact`: "CPU 12% · RAM 48%"
- `bars`: iki ince `Meter`
- `net`: ↓ 2,4 MB/sn ↑ 0,3 MB/sn

%90 üstünde değer `--warn` rengine döner.

**Panel** (~320 px): CPU için son 60 örneğin çizgi grafiği (SVG `polyline`,
kütüphane yok), RAM kullanılan/toplam, ağ hızları, diskler, süreç listesi.
Altta "Görev Yöneticisi" bağlantısı (`taskmgr.exe`).

**Bitti:** Değerler Görev Yöneticisi'yle ±birkaç puan tutuyor; widget açıkken
boşta CPU artışı ölçülemeyecek kadar küçük.

---

## 8.5 Ses paneli: çıkış değiştirici ve mikrofon

**Aygıt listesi (belgeli):** `IMMDeviceEnumerator::EnumAudioEndpoints(eRender,
DEVICE_STATE_ACTIVE)` + `PKEY_Device_FriendlyName`; varsayılanın kimliği
`GetDefaultAudioEndpoint` ile.

**Varsayılanı değiştirme (belgelenmemiş) — deneme:**
Açık bir API yok. Yaygın araçların kullandığı `IPolicyConfig` COM arayüzü var.
`windows` crate'inde yok; arayüzü elle tanımlamak gerekir.
- Hatırladığım kimlikler — **mutlaka doğrula**, yanlış olabilir:
  CLSID `870af99c-171d-4f9e-af0d-e63df40c2bc9`,
  IID `f8679f50-850a-41cf-9c72-430f290290c8`.
- Sanal tablo sırası kritik; yanlış sıra çökme demek. Açık kaynak bir
  uygulamadan (ör. EarTrumpet, SoundSwitch) sırayı doğrula.
- Üç rol için de çağır: `eConsole`, `eMultimedia`, `eCommunications`.
- **Yedek:** Çalışmazsa satıra tıklamak `ms-settings:sound` açar.

**Mikrofon (belgeli):** `eCapture` varsayılan uç noktasında
`IAudioEndpointVolume::SetMute`. Mevcut `audio.rs` deseninin kopyası.

**Panel** (ses karosuna tıkla, ~300 px):
1. Ana ses: büyük `Meter` + sessiz düğmesi.
2. "Çıkış" listesi: aygıtlar, etkin olanda onay işareti; tıklayınca geçiş.
3. "Giriş": varsayılan mikrofon, seviye, sessiz düğmesi.
4. Altta "Ses karıştırıcısı" → `ms-settings:apps-volume`.

**İsteğe bağlı v2:** uygulama başına ses (`IAudioSessionManager2` →
`ISimpleAudioVolume`), her uygulama için ikon + kaydırıcı.

**Yeni widget:** `mic` — tek düğme, sessizken kırmızı. Genel kısayol atanabilir
(`tauri-plugin-global-shortcut`), varsayılan boş.

**Bitti:** Kulaklık ↔ hoparlör geçişi panelden yapılıyor ve Windows ayarlarında
da değişmiş görünüyor; mikrofon düğmesi Discord/Teams'te duyulur sonuç veriyor.

---

## 8.6 Tepsi erişimi — deneme

En riskli paket. Yollar, deneme sırasıyla:

**A. Windows'un taşma penceresini açtırmak**
Win+B tepsiye odaklanır, Enter "gizli simgeler" penceresini açar.
Bilinmeyen: Windows çubuğu gizliyken bu pencere açılıyor mu, nerede açılıyor?
- [ ] Deneme: çubuk gizliyken Win+B, Enter gönder; sonucu gözle.
- Açılıyor ve kullanılabilir yerdeyse: `system` widget'ına "Tepsi" düğmesi. Bitti.

**B. Windows çubuğunu geçici gösterme (güvenli yedek)**
"Tepsi" düğmesine basınca: dock aşağı kayar, `Shell_TrayWnd` gösterilir.
İmleç çubuktan çıkıp 1 sn geçince ya da başka pencere öne gelince tersine döner.
- `taskbar.rs`'teki "yeniden gizle" mantığı bu süre boyunca duraklatılır.
- Çirkin ama kesin çalışır; her tepsi işlevi (sağ tık menüleri dahil) tam.

**C. Kendi tepsi ikonlarımızı çizmek (şimdilik önermiyorum)**
- Eski yöntem (Explorer'ın araç çubuğunu süreçler arası okumak) yeni Windows 11
  sürümlerinde çalışmıyor sanıyorum **(doğrula)**.
- UI Automation ile tepsi düğmelerinin adları okunup tıklanabilir, ama ikon
  görüntüsü ve sağ tık menüsü alınamaz.
- Tam çözüm: kendi tepsi penceremizi kaydedip `Shell_NotifyIcon` mesajlarını
  karşılamak (alternatif kabukların yöntemi). Rust'ta sıfırdan haftalar sürer,
  kırılgandır.

**Karar:** A tutarsa A, tutmazsa B. C ayrı bir proje; bu aşamada yok.

**Bitti:** Discord/Steam gibi tepside yaşayan bir uygulamanın menüsüne
fareyle, Windows çubuğunu kalıcı açmadan ulaşılıyor.

---

## 8.7 Sürükle-bırak — deneme

Tauri pencere sürükle-bırak olaylarını (giriş/üzerinde/bırakma/çıkış, dosya
yolları ve konum) verir **(doğrula: Tauri 2 `onDragDropEvent`, `dragDropEnabled`)**.
- [ ] Deneme: olaylar odak almayan (`WS_EX_NOACTIVATE`) ve bölgeyle kırpılmış
      dock penceresine ulaşıyor mu? Ulaşmıyorsa paket ertelenir.

| Hareket | Sonuç |
|---|---|
| Dosyayla açık uygulama ikonunda 500 ms bekleme | Pencere öne gelir; kullanıcı dosyayı pencereye bırakır |
| Dosyayı sabit/kapalı uygulamaya bırakma | Uygulama dosyayla başlatılır (`ShellExecuteW` parametreli; Mağaza uygulamalarında yok) |
| `.exe` / `.lnk` dosyasını boş alana bırakma | Sabitlenir |
| Sürükleme boyunca | Dock genişlemiş bölgede kalır, hedef ikon vurgulanır, büyütme efekti çalışır |

**Ek: ikonları dock içinde sıralama** — sabit ikonu basılı tutup sürükle;
komşular kayar, bırakınca `config.widgets.apps.pinned` sırası yazılır. Tarayıcı
sürükle-bırak API'si yerine işaretçi olaylarıyla (büyütme efektiyle çakışmasın).
Dock dışına sürükleyip bırakmak sabitlemeyi kaldırır (küçük "puf" animasyonu).

**Bitti:** Bir resim dosyası Gezgin'den sürüklenip dock üzerinden açık bir
uygulamanın penceresine bırakılabiliyor.

---

## 8.8 Küçük widget'lar

| Widget | Nasıl | Zorluk |
|---|---|---|
| **Zamanlayıcı / pomodoro** | Durum Rust'ta (pencere yenilense de sürer). Çubukta geri sayım + halka; panelde hazır süreler (5/15/25/50), başlat/duraklat/sıfırla. Bitince karo yanıp söner + sistem bildirimi. | Kolay |
| **Sıradaki etkinlik** | Mevcut ICS verisinden "Toplantı · 12 dk sonra". 10 dk kala vurgu rengi. Etkinlik yoksa gizlenir. Tıkla → takvim paneli. | Kolay |
| **Ekran görüntüsü** | 8.2'deki düğme; ayrı widget değil. | — |
| **Geri dönüşüm kutusu** | `SHQueryRecycleBinW` ile öğe sayısı (60 sn). Tıkla → `shell:RecycleBinFolder`. Sağ tık → "Boşalt" (**onay sorarak**, `SHEmptyRecycleBinW`). | Kolay |
| **Dünya saati** | Seçilen şehirler için saat; `Intl` saat dilimleriyle, yalnızca frontend. | Kolay |
| **Parlaklık** | Dizüstü ekranı: WMI `WmiMonitorBrightnessMethods`. Harici monitör: DDC/CI (`SetVCPFeature`). İkisi de **(doğrula)**; desteklenmiyorsa widget gizlenir. | Orta |
| **Gece ışığı** | Açık bir API bilmiyorum. Yalnızca `ms-settings:nightlight` açan düğme. | Kolay |
| **Klavye düzeni** | `GetKeyboardLayout` ile "TR/EN"; tıkla → Win+Space. | Kolay |

Her biri kendi klasöründe, 8.1 kataloğunda görünür, varsayılan olarak **kapalı**.
Hepsini bir arada yapma; her widget ayrı commit.

**Bitti:** Sekiz maddenin her biri ya çalışıyor ya da "desteklenmiyor" diye
bilinçli olarak işaretlendi.

---

## 8.9 AI kullanımı

Abonelik limitleri için resmi bir API bilmiyorum. Bu paket **tahmin** gösterir;
arayüzde de öyle yazar.

**Kaynak 1 — Claude Code yerel kayıtları:**
- `%USERPROFILE%\.claude\projects\**\*.jsonl`; satırlarda zaman damgası ve
  `usage` (girdi/çıktı/önbellek token'ları) olduğunu sanıyorum. Biçim
  belgelenmemiş, sürümle değişebilir **(doğrula: önce gerçek bir dosyaya bak)**.
- Önce resmi bir yol var mı kontrol et (Claude Code dokümanı: kullanım komutu,
  durum satırı verisi). Varsa onu kullan, dosya ayrıştırmayı bırak.
- Okuma artımlı: dosya başına son konum saklanır; her seferinde baştan okunmaz.
  60 sn'de bir ya da dosya değişim bildirimiyle.
- Hesap: son 5 saat ve son 7 gün toplamı. Yüzde için limit bilinmediğinden
  kullanıcı ayarlardan kendi "bütçe"sini girer; girmezse ham sayı gösterilir.
- Ayrıştırma hatasında widget "veri okunamadı" der, çökmez.

**Kaynak 2 — API faturalı hesaplar (isteğe bağlı):** Sağlayıcıların yönetici
kullanım uç noktaları **(doğrula)**. Anahtar, Spotify'daki gibi DPAPI ile şifreli
saklanır. Abonelik kullanıcıları için işe yaramaz.

**Yapılmayacak:** Tarayıcı oturum çereziyle resmi olmayan uç noktaları çağırmak
(kırılgan, kullanım koşullarına aykırı olabilir). ChatGPT için yerel bir kaynak
bilmiyorum; **yok**.

**Arayüz:** Çubukta iki ince çubuk ("5 sa" ve "Hafta") + yüzde. Panelde günlük
kullanım grafiği (7 gün), model bazında döküm, "tahmindir" notu.

**Bitti:** Bir Claude Code oturumundan sonra sayılar artıyor; kayıt klasörü
yokken widget sessizce gizleniyor.

---

## 8.10 Otomatik gizlenme

Config: `autoHide: "never" | "always" | "smart"`.
- `always`: dock gizli durur, imleç kenara gelince çıkar.
- `smart`: yalnızca bir pencere dock alanıyla çakışıyorsa gizlenir.

**Mekanik:**
1. Mod açıkken AppBar kaydı kaldırılır (`ABM_REMOVE`) → pencereler tüm ekranı kullanır.
2. Gizlenme: CSS ile kenara kayma (200 ms), sonra pencere bölgesi kenarda
   2 px'lik tetik şeridine indirilir.
3. İmleç şeride girince 100 ms sonra bölge açılır, dock kayarak gelir.
4. İmleç dock'tan çıkınca 600 ms sonra gizlenir; panel, önizleme, sağ tık
   menüsü ya da sürükleme varken gizlenmez.

Bölge artık üç durumlu: tetik şeridi / çubuk / genişlemiş. `placement.rs`
`set_expanded` buna göre yeniden yazılır.

- `smart` için pencere konumları zaten `app_events.rs`'te izleniyor; çakışma
  hesabı oradan beslenir.
- Windows çubuğu da otomatik gizli ve aynı kenarda; gizli olduğu için
  tetiklenmemesi gerekir **(doğrula)**. Tetikleniyorsa mod yalnızca üst kenarda sunulur.
- Tam ekran mantığı aynen kalır ve önceliklidir.

**Bitti:** `always` modunda tam ekran olmayan büyütülmüş pencere tüm ekranı
kaplıyor; imleç alta inince dock geliyor, 20 denemede takılma yok.

---

## 8.11 Çoklu monitör

> **İptal edildi (2026-11-18).** Kullanıcı tek ekran kullanıyor; "zaten
> kullanılmayacak". Aşağıdaki plan ileride gerekirse diye duruyor.

Config: `monitors: "primary" | "all"`, `secondaryContent: "same" | "appsOnly"`,
`appsPerMonitor: false` (açıksa her dock yalnızca kendi ekranındaki pencereleri gösterir).

**Yeniden yapılandırma (asıl iş):**
- `placement.rs`, `appbar.rs`, `backdrop.rs` şu an tek pencere ve birincil
  monitör varsayıyor. Hepsi "dock örneği" yapısına taşınır:
  `{ pencere, monitör, ölçek, AppBar durumu, arka plan şeridi }`.
- Dock pencereleri dinamik oluşturulur (`dock-0`, `dock-1` ...); `tauri.conf.json`
  içindeki sabit `dock` tanımı kalkar.

**Parçalar:**
- [ ] Monitör listesi + `WM_DISPLAYCHANGE`'te karşılaştır: eklenen için pencere
      aç, çıkarılan için kapat ve AppBar kaydını sil
- [ ] Her dock kendi AppBar'ı; tam ekran bildirimi dock başına gelir
- [ ] Her monitörün duvar kâğıdı ayrı (`IDesktopWallpaper` monitör kimliğiyle)
- [ ] Her monitörün DPI ölçeği ayrı; ikon/ölçü hesapları dock başına
- [ ] `Shell_SecondaryTrayWnd` gizleniyor (mevcut kodu doğrula)
- [ ] Panel ve önizleme, tıklanan dock'un monitöründe açılır
- [ ] `appsPerMonitor`: `MonitorFromWindow` ile süzme; pencere ekran
      değiştirince güncelleme
- [ ] Olaylar tüm dock pencerelerine yayınlanır; komutlar pencereden bağımsız

**Maliyet:** Her dock ayrı bir WebView2 işlemi; bellek monitör başına artar
(miktarı bilmiyorum, ölç). `secondaryContent: "appsOnly"` hafif tutar.

**Bitti:** İkinci monitör takılıp çıkarılınca dock belirip kayboluyor, hiçbir
ekranda ayrılmış boş şerit kalmıyor; tek monitörde davranış ve bellek değişmedi.

---

## Bu aşamada bilinçli olarak yok

| Konu | Neden |
|---|---|
| Uygulama rozetleri (okunmamış sayısı) | Güvenilir bir yol bilmiyorum |
| Kendi tepsi ikonlarımız (8.6-C) | Ayrı proje büyüklüğünde |
| Atlama listeleri (son dosyalar) | Karmaşık, belgelenmemiş ayrıntılar |
| Donanım sıcaklıkları | Sürücü gerektirir |
| ChatGPT limitleri | Kaynak yok |
| Otomatik güncelleme, kod imzalama | Kişisel kullanımda gereksiz |

---

## Riskler

| Paket | Risk | Önlem |
|---|---|---|
| 8.5 | `IPolicyConfig` yanlış tanımlanırsa çökme | Ayrı iş parçacığı, `ms-settings:sound` yedeği, kimlik ve sıra doğrulaması |
| 8.6 | A yolu çalışmayabilir | B yolu hazır |
| 8.7 | Sürükleme olayları dock'a ulaşmayabilir | Önce deneme; olmazsa paket ertelenir |
| 8.9 | Kayıt biçimi değişir | Toleranslı ayrıştırma, "tahmin" etiketi |
| 8.10 | Üç durumlu bölge mevcut genişleme mantığını bozar | Önce `never` modunda gerileme testi |
| 8.11 | Tek pencere varsayımı her yerde | En sona bırakıldı; öncesinde commit, ayrı dalda çalış |
| Genel | Widget arttıkça boşta CPU yükselir | 8.1 tembel servisler; her pakette ölçüm |

---

## VS Code'daki Claude'a verilecek istem

```text
Plan dosyası repo kökünde: PLAN-ASAMA-8.md (dal: claude/windows-vscode-project-plan-ggrjt9). Yerelde yoksa önce git pull origin claude/windows-vscode-project-plan-ggrjt9 çalıştır. Dosyayı oku ve yalnızca 8.0 paketini uygula. (doğrula) işaretli yerleri resmi dokümandan kontrol et; "deneme" yazan paketlerde önce küçük kanıtı yapıp sonucu bana söyle. Bitince çalıştır, göster, ben onaylayınca commit et.
```

Sonraki paketlerde yalnızca `8.0` yerine `8.1`, `8.2` ... yaz.
