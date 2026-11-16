# Aşama 7 — Modern Arayüz ve Cila

Hedef: videodaki gibi cam görünümlü, karo (tile) tabanlı, akıcı animasyonlu bir dock.
Bu belge `PLAN.md` Aşama 7'nin yerine geçer.

> **Dürüstlük notu:** Görsel ölçüler videonun 720p karelerinden gözle çıkarıldı;
> kesin değil, başlangıç değeridir. Hiçbir şey Windows'ta denenmedi.
> **(doğrula)** işaretli yerleri kontrol et. Aynı ürünün adını, logosunu ve
> görsellerini kopyalama; bu belge yalnızca genel görsel dili tarif eder.

> **Ön koşul:** Depoda Aşama 6 yok (`SettingsWindow.tsx` hâlâ boş, son commit
> Aşama 5). Tema ayarları (7.9) ayarlar penceresine bağlı. Aşama 6 yerelde
> bittiyse önce onu gönder; bitmediyse 7.1–7.8 ondan bağımsız yapılabilir.

---

## A. Videodan çıkarılan tasarım dili

| Öğe | Gözlem |
|---|---|
| Çubuk | Ekran kenarına yapışık değil; altta ~8 px, yanlarda boşlukla **yüzüyor**. Köşe ~16 px. Koyu yarı saydam cam, arkada bulanık duvar kâğıdı. 1 px açık renk kenar, üstte daha parlak. |
| Widget | Her widget kendi **karosu**: köşe ~10 px, çubuktan biraz daha açık ya da **renkli** zemin. |
| Uygulama ikonları | Durgunken zeminsiz. Üzerine gelince büyür ve arkasında yarı saydam beyaz yuvarlak kare belirir. Altında küçük nokta (açık uygulama). |
| Müzik | Kapak renginden türeyen sıcak degrade karo. Üstte ortalı "Şarkı · Sanatçı", altta üç kontrol. |
| Hava | Gök mavisi degrade karo. Solda durum + şehir, sağda **ince** yazılmış büyük derece, renkli ikon karodan hafif taşıyor. |
| Saat | "3:42" kalın ve büyük, yanında soluk küçük saniye, altında küçük tarih. |
| Hızlı kontroller | Vurgu renginde ince çerçeveli hap düğmeler (ikon │ ok). Ses: ikon + "Hoparlör" + sağda yüzde, altında **kalın** dolgu çubuğu. Pil: vurgu renginde dolu karo, üstü dalgalı sıvı, ortada sayı. |
| Paneller | Neredeyse opak koyu yüzey (#1c1c1e civarı), köşe ~16 px, ince kenar. İç gruplar bir kademe açık gömme kutularda. |
| Takvim paneli | Geniş, iki sütun: solda ay ızgarası (her gün ayrı yuvarlak karo, bugün vurgu çerçeveli), sağda "Bugün" listesi (saat sütunu, renkli ikon, başlık + soluk kaynak). |
| Yazı | Inter benzeri, sıkı harf aralığı, başlıklar kalın, sayılar eş genişlikli. |

Videodaki "bir widget parlarken diğerlerinin sönmesi" reklam kurgusu; uygulamaya girmez.

---

## B. Temel karar: cam efekti nasıl yapılacak

Mevcut pencere `SetWindowRgn` ile kırpılıyor ve ikonlar çubuğun dışına taşıyor.
Bu, sistem akriliğini zorlaştırır: akrilik **tüm pencere dikdörtgenini** doldurur,
yuvarlak köşe ve taşan ikonlarla uyuşmaz.

| Yol | Artı | Eksi |
|---|---|---|
| **1. Duvar kâğıdı camı (önerilen)** — Rust duvar kâğıdının çubuk arkasındaki şeridini kırpar, bulanıklaştırır, CSS arka plan olarak verir | Şekil tamamen CSS'te: her köşe yarıçapı, pürüzsüz kenar, taşan ikonlarla sorun yok. Mevcut pencere yapısı değişmez. | Arkaya sürüklenen pencereyi bulanıklaştırmaz, yalnızca duvar kâğıdını gösterir. AppBar yer ayırdığı için çubuğun arkası neredeyse hep duvar kâğıdıdır. |
| 2. Gerçek akrilik + ayrı arka plan penceresi | Arkadaki her şeyi bulanıklaştırır | İkinci pencere, eşzamanlama, köşe yarıçapı Windows'un 8 px'ine sınırlı ya da tırtıklı; odak almayan pencerede akriliğin sönük kalma ihtimali **(doğrula)** |
| 3. Düz yarı saydam (şimdiki) | Sıfır risk | Cam hissi yok |

**Karar:** 1. yol. Çalışmazsa 3. yol + gürültü dokusu + kenar parlaması yine modern görünür.
Paneller zaten neredeyse opak; onlarda bulanıklık yok.

---

## C. Tasarım değişkenleri (`src/styles/tokens.css` yeniden yazılır)

```css
:root {
  /* Ölçü — placement.rs ile aynı tutulmalı */
  --bar-height: 64px;        /* ayrılan şerit: 4 üst pay + 52 çubuk + 8 alt boşluk */
  --bar-visual: 52px;
  --bar-gap-edge: 8px;
  --bar-gap-side: 12px;
  --bar-pad: 6px;
  --tile-h: 40px;
  --icon-size: 40px;
  --icon-gap: 6px;
  --group-gap: 8px;
  --magnify-pad: 44px;

  /* Yüzeyler */
  --glass-tint: 18 20 28;            /* rgb üçlüsü */
  --glass-alpha: 0.55;               /* Rust parlaklığa göre günceller */
  --glass-border: rgba(255,255,255,0.10);
  --glass-highlight: rgba(255,255,255,0.22);
  --tile: rgba(255,255,255,0.06);
  --tile-hover: rgba(255,255,255,0.10);
  --tile-press: rgba(255,255,255,0.14);
  --panel: rgba(27,28,32,0.98);
  --panel-inset: rgba(255,255,255,0.045);
  --hairline: rgba(255,255,255,0.07);

  /* Metin */
  --text: rgba(255,255,255,0.94);
  --text-2: rgba(255,255,255,0.62);
  --text-3: rgba(255,255,255,0.38);

  /* Renk */
  --accent: #3b9eff;
  --accent-soft: color-mix(in srgb, var(--accent) 18%, transparent);
  --danger: #ff5a52;
  --ok: #34d17b;
  --warn: #ffb340;

  /* Biçim */
  --r-bar: 16px;
  --r-tile: 10px;
  --r-pill: 999px;
  --r-panel: 16px;
  --r-inset: 12px;

  /* Yazı */
  --font: "Inter Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --fs-xs: 10.5px;  --fs-sm: 12px;  --fs-md: 13px;  --fs-lg: 15px;
  --fs-xl: 20px;    --fs-2xl: 28px;
  --tracking-tight: -0.02em;

  /* Hareket */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --t-fast: 120ms;  --t-med: 200ms;  --t-slow: 400ms;

  /* Gölge */
  --shadow-bar: 0 2px 8px rgba(0,0,0,0.35);
  --shadow-panel: 0 12px 32px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
}
```

- `BAR_HEIGHT` 56 → 64 ve `MAGNIFY_PAD` 40 → 44 olur; `placement.rs` ve AppBar birlikte güncellenir.
- Bileşenlerde sabit renk/ölçü yazılmaz, yalnızca değişken kullanılır.
- **Yazı tipi:** Inter Variable, `@fontsource-variable/inter` paketiyle yerel gömülür
  (ağdan çekilmez). Lisansı SIL OFL olduğuna inanıyorum **(doğrula)**.
  İstemezsen Segoe UI Variable yeterli.
- Sayı içeren her yerde `font-variant-numeric: tabular-nums`.

---

## D. İş paketleri

Sırayla yap; her paketin sonunda çalıştır, gözle karşılaştır, commit et.

### 7.1 Temel: değişkenler, yazı tipi, ölçüler
- [ ] `tokens.css` bölüm C'ye göre yenilendi
- [ ] Inter gömüldü, `global.css`'te `-webkit-font-smoothing: antialiased`
- [ ] `placement.rs` sabitleri + AppBar yüksekliği 64'e çekildi
- [ ] Eski değişken adları (`--bar-bg`, `--surface`, `--text-dim`, `--radius` ...)
      tüm CSS modüllerinde yenileriyle değiştirildi
- [ ] `theme.ts` yeni değişkenleri yazıyor

**Bitti:** Uygulama eskisi gibi çalışıyor, görünüm bozulmadı, pencereler çubuğun altına girmiyor.

### 7.2 Cam çubuk

**Rust — `services/backdrop.rs` (yeni):**
1. Duvar kâğıdı yolunu al: `IDesktopWallpaper::GetWallpaper` + `GetPosition`
   (doldur/sığdır/uzat) **(doğrula)**. Yol boşsa (düz renk) `GetBackgroundColor`.
   Yedek: `%APPDATA%\Microsoft\Windows\Themes\TranscodedWallpaper` **(doğrula)**.
2. Görseli `image` crate'i ile aç (`jpeg` özelliğini ekle), monitöre "doldur"
   hesabıyla oturt, çubuğun ekran dikdörtgenini kırp.
3. Şeridi ~1/6 boyuta küçült, bulanıklaştır (`imageops::blur`, sigma ~6),
   JPEG → base64.
4. Şeridin ortalama parlaklığını (0–1) hesapla.
5. `get_backdrop` komutu + `backdrop://changed` olayı: `{ image, luma }`.
6. Değişimi izle: 5 sn'de bir yol + dosya değişim zamanı kontrolü
   (v2: `WM_SETTINGCHANGE`). Çözünürlük değişiminde yeniden üret.

Küçültülmüş şerit üzerinde bulanıklık ucuzdur; CSS `filter: blur` kullanma
(her karede GPU maliyeti).

**CSS — `DockWindow.module.css`:**

```css
.bar {
  position: absolute;
  left: var(--bar-gap-side); right: var(--bar-gap-side);
  bottom: var(--bar-gap-edge);
  height: var(--bar-visual);
  padding: var(--bar-pad);
  border-radius: var(--r-bar);
  background:
    var(--noise),                                             /* gürültü dokusu */
    linear-gradient(rgb(var(--glass-tint) / var(--glass-alpha)) 0 0),
    var(--backdrop, none) center / 100% 100% no-repeat,       /* bulanık duvar kâğıdı */
    rgb(var(--glass-tint));
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    inset 0 0 0 1px var(--glass-border),
    var(--shadow-bar);
}
```

- `--noise`: 64×64 `feTurbulence` SVG'si, data URI, opaklık ~0.04. Degrade
  bantlanmasını önler ve cam dokusu verir.
- `--glass-alpha = 0.45 + 0.30 · luma` — açık duvar kâğıdında metin okunur kalsın
  (hedef kontrast ≥ 4.5:1).
- Arka plan değişince 400 ms çapraz geçiş (iki katman, `opacity`).
- Gölge pencere bölgesiyle kırpılır; bu yüzden gölge küçük tutuldu (8 px boşluğa sığar).
- Üst kenar (`top`) düzeni için aynı kurallar aynalanır.

**Bitti:** Çubuk yüzüyor, köşeler pürüzsüz, duvar kâğıdını değiştirince birkaç
saniyede uyum sağlıyor, beyaz duvar kâğıdında yazılar okunuyor.

### 7.3 Karo sistemi

`src/widgets/ui/` altında ortak parçalar; widget'lar kendi zemin/çerçeve CSS'ini yazmaz.

| Bileşen | Görev |
|---|---|
| `Tile` | Karo. `variant`: `plain` (zeminsiz), `soft` (`--tile`), `tinted` (`--tile-color` degradesi), `solid` (vurgu). `interactive` ise hover/basılı durumları. |
| `IconButton` | 28 px yuvarlak düğme, hover zemini. |
| `Pill` | Hap düğme; `active` iken vurgu çerçevesi + `--accent-soft` zemin. |
| `Meter` | Kalın dolgu çubuğu (yükseklik 8, tam yuvarlak). |
| `Divider` | Dikey ince çizgi (gruplar arası). |

```css
.tile {
  height: var(--tile-h);
  border-radius: var(--r-tile);
  padding: 0 10px;
  display: flex; align-items: center; gap: 8px;
  transition: background-color var(--t-fast), transform var(--t-fast) var(--ease-out);
}
.soft { background: var(--tile); box-shadow: inset 0 0 0 1px var(--hairline); }
.tinted {
  background: linear-gradient(160deg,
    color-mix(in srgb, var(--tile-color) 92%, white),
    color-mix(in srgb, var(--tile-color) 80%, black));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
}
.interactive:hover  { background-color: var(--tile-hover); }
.interactive:active { transform: scale(0.97); }
```

- `shared.module.css` bu bileşenlere taşınır ve silinir.
- Çizgi ikonlar: mevcut `widgets/icons.tsx` kalır; çizgi kalınlığı 1.8 → 1.6,
  hepsi aynı ızgarada. Eksik ikon için tek set kullan (Lucide; lisansı ISC
  olduğuna inanıyorum **(doğrula)**).

**Bitti:** Tüm widget'lar aynı yükseklik, köşe ve hover davranışını paylaşıyor.

### 7.4 Uygulama ikonları
- [ ] Durgunken zeminsiz; hover'da arkada `rgba(255,255,255,0.12)` yuvarlak kare
      (köşe = ikon boyutunun %24'ü), ikonla birlikte ölçeklenir
- [ ] Başlat düğmesi: koyu karo (`rgba(0,0,0,0.35)`) içinde
- [ ] Nokta: 4 px, vurgu renginde; odaktaki uygulamada 12 px genişliğinde çizgiye
      uzar (genişlik geçişi 200 ms)
- [ ] İkon gölgesi: `drop-shadow(0 2px 4px rgba(0,0,0,0.35))`
- [ ] **İsim balonu:** hover'da ikonun üstünde küçük koyu etiket, 400 ms gecikmeyle
      (pencere genişlemiş bölgedeyken çizilir)
- [ ] **Başlatma zıplaması:** tıklanan kapalı uygulama, penceresi görünene kadar
      (en çok 3 sn) `translateY` ile zıplar
- [ ] Yeni açılan uygulama: ikon `scale 0 → 1` + genişlik 0 → tam (yay eğrisi);
      kapanan tersine
- [ ] Sabit ve açık uygulamalar arasında `Divider`
- [ ] İkon çıkarımı 256 → 128 px (bellek; 72 px gösterim için yeterli)

**Bitti:** Videonun ilk karesindeki görünüm: büyüyen ikonlar cam karelerin içinde,
komşular yumuşakça itiliyor, 60 fps.

### 7.5 Widget'ların yeniden tasarımı

**Saat** — `plain` karo, iki satır:
- Üst: saat `--fs-lg`+ kalın, yanında soluk küçük saniye (ayarla açılır; açıksa
  saniyelik zamanlayıcı, kapalıysa dakikalık).
- Alt: `--fs-xs`, `--text-2`, "Sal 20 Eki".

**Müzik** — `tinted` karo, genişlik 200–260:
- `--tile-color` = kapağın baskın rengi (`averageColor.ts`), doygunluğu biraz
  artır, çok açık/koyu renkleri sınırla ki beyaz metin okunsun.
- Düzen A (videodaki): üstte ortalı tek satır "Şarkı · Sanatçı", altta üç kontrol.
- Düzen B (mevcut): solda kapak, ortada iki satır, sağda kontroller.
  A ile başla; 40 px yükseklikte sıkışırsa B'ye dön.
- Uzun başlık: kenarlarda soluklaşma maskesi; hover'da yavaş kayan yazı.
- Şarkı değişince: metin çapraz geçiş 200 ms, renk geçişi 400 ms.
- Oturum yoksa karo genişlik + opaklık animasyonuyla kaybolur.

**Hava** — `tinted` karo, renk duruma göre:

| Durum | Gündüz | Gece |
|---|---|---|
| Açık / parçalı | #3b9eff | #27408b |
| Bulutlu / sis | #6f7f95 | #3a4354 |
| Yağmur | #4a6fa5 | #2c3e63 |
| Kar | #8fb4d9 | #4a5f7d |
| Fırtına | #4b4a7a | #2b2a4a |

- Solda iki satır (durum kalın, şehir soluk), sağda derece `--fs-xl`, ağırlık 300.
- Renkli hava ikonu sağda, karodan 4 px taşar. Kaynak: Meteocons veya Fluent
  Emoji (ikisinin de MIT olduğuna inanıyorum **(doğrula)**); yoksa `wmo.ts`
  için 8–10 basit SVG çiz.
- Gündüz/gece: Open-Meteo `is_day` alanı **(doğrula)**.

**Wi-Fi / Bluetooth** — iki `Pill`: sol yarı aç/kapat, ince ayraç, sağ yarı ok
(ayarları açar). Açıkken vurgu çerçevesi, kapalıyken `--text-3`.

**Ses** — `soft` karo, genişlik ~170, iki satır:
- Üst: ikon + aygıt adı (kırpılır) + sağda yüzde.
- Alt: `Meter`. Sürükleme ve tekerlek çalışır; hover'da çubuk 8 → 10 px kalınlaşır.
- Sessizde ikon değişir, dolgu `--text-3` olur.

**Pil** — `solid` karo, 44×40:
- Doluluk yüzdesi kadar yükselen sıvı; üst kenarı SVG dalga.
- Dalga **yalnızca şarj olurken** hareket eder (boşta CPU harcamasın).
- Renk: >%20 vurgu, ≤%20 `--warn`, ≤%10 `--danger`. Ortada kalın sayı.

**Bitti:** Çubuğun ekran görüntüsü videonun "Hello, smart dock" karesiyle yan
yana konunca aynı aileden görünüyor.

### 7.6 Paneller

**Ortak kabuk — `PopupWindow`:**
- [ ] Yüzey `--panel`, köşe `--r-panel`, kenar `inset 0 0 0 1px var(--hairline)`
      + `inset 0 1px 0 rgba(255,255,255,0.08)`
- [ ] Gölge için pencere panelden her yönde 16 px büyük; `popup.rs` konum ve
      boyut hesabı bu payı hesaba katar
- [ ] Ortak başlık: başlık solda, eylemler + kapat sağda
- [ ] İnce, yalnızca hover'da görünen kaydırma çubuğu
- [ ] **Açılış:** `opacity 0→1`, `scale 0.96→1`, `translateY 8px→0`, 180 ms
      `--ease-out`; `transform-origin` çapaya (tıklanan widget'a) doğru
- [ ] **Kapanış:** 120 ms ters animasyon, **sonra** pencere gizlenir
      (frontend animasyonu bitirip `hide_popup` çağırır; Rust doğrudan gizlemez)

**Hava paneli** (genişlik ~340):
1. Başlık: şehir kalın + "Değiştir" vurgu renkli bağlantı + kapat.
2. Büyük ikon + `--fs-2xl` derece; altında "Parçalı bulutlu · Y 19° D 11°".
3. Saatlik şerit: `--panel-inset` zeminli yuvarlak kutu, 7 sütun (saat / ikon / derece), ilk sütun "Şimdi" kalın.
4. Günlük liste: gün adı / ikon / düşük (soluk) / yüksek (kalın), satır arası ince çizgi.
   İsteğe bağlı: düşük–yüksek arası sıcaklık aralığı çubuğu.

**Takvim paneli** (genişlik ~620, iki sütun):
- Sol: "Ekim 2026" kalın başlık; hafta günleri hap etiketler; her gün ayrı karo
  (`--panel-inset`, köşe 10). Bugün: vurgu çerçevesi + dolu vurgu daire içinde sayı.
  Etkinlik olan günde renkli noktalar (en çok 3, fazlası "+2").
  Diğer ayın günleri `--text-3`.
- Sağ: "Bugün" + etkinlik sayısı; satırlar: saat sütunu (soluk, sağa hizalı),
  takvim renginde küçük kare ikon, başlık kalın + konum soluk. Geçmiş etkinlikler
  soluk. Boşsa "Bugün etkinlik yok".
- Üst sağ: "Bugün" bağlantısı, ‹ › okları, kapat.
- Ay değişiminde ızgara yatay kayarak geçer (200 ms).
- Güne tıklayınca sağ sütun o günü gösterir.

Videodaki "yeni etkinlik ekle" alanı ICS salt okunur olduğu için **yok**.

**Bitti:** Paneller videodaki hava ve takvim kareleriyle aynı yapıda; açılıp
kapanırken kesinti yok.

### 7.7 Hareket ve mikro etkileşimler

| Etkileşim | Süre | Eğri | Not |
|---|---|---|---|
| Hover zemin | 120 ms | ease | |
| Basma | 120 ms | ease-out | `scale(0.97)` |
| Büyütme | sürekli | üstel yumuşatma | mevcut `magnify.ts` |
| Widget belirme/kaybolma | 250 ms | ease-out | genişlik + opaklık |
| Panel aç / kapat | 180 / 120 ms | ease-out | |
| Renk geçişleri | 400 ms | ease | müzik, hava, arka plan |
| Dock açılışı | 450 ms | ease-out | alttan kayma + opaklık, ikonlar 20 ms arayla |
| Tam ekrana giriş/çıkış | 200 ms | ease-out | aşağı kayarak |
| Düğme ikon değişimi (oynat↔duraklat) | 150 ms | ease | çapraz geçiş + hafif ölçek |

Kurallar:
- Yalnızca `transform` ve `opacity` canlandırılır; genişlik animasyonu yalnızca
  widget ekleme/çıkarmada.
- Sürekli dönen animasyon yok (pil dalgası hariç, o da yalnızca şarjda).
- `prefers-reduced-motion` açıkken tüm süreler 0, büyütme kapalı.
- Kütüphane ekleme; CSS geçişleri + mevcut rAF yeterli.

### 7.8 Performans ve sağlamlık (arayüz dışı cila)
- [ ] Yoklamaları olaylara çevir:
  - `apps.rs` 750 ms → `SetWinEventHook`
  - `audio.rs` 500 ms → `IAudioEndpointVolumeCallback` + `IMMNotificationClient`
  - `media.rs` 1 sn → `CurrentSessionChanged` / `MediaPropertiesChanged` / `PlaybackInfoChanged`
  - `radios.rs` 2 sn → `Radio.StateChanged` **(doğrula)**
  - `power.rs` 30 sn kalabilir
- [ ] Boşta CPU: Görev Yöneticisi'nde 5 dakika izle, hedef ~%0
- [ ] Hover sırasında kare hızı: DevTools Performance ile, hedef 60 fps
- [ ] Bellek: 24 saat açık bırak; başlangıç ve bitiş değerini not et. GDI nesne
      sayısına da bak (ikon çıkarımı sızdırabilir)
- [ ] Çok uygulama (20+) açıkken çubuk taşmıyor: ikonlar küçülür ya da kaydırılır
- [ ] %100 / %125 / %150 ölçekte bulanıklık ve hizalama kontrolü
- [ ] `npm run tauri build` kurulum dosyası üretiyor, temiz makinede açılıyor

### 7.9 Tema ayarları (Aşama 6'ya bağlı)

`config.theme` genişler (Rust'ta `serde(default)` ile eski dosyalar bozulmaz):

```json
{
  "accent": "auto",
  "glass": "wallpaper",
  "tintAlpha": 0.55,
  "radius": 16,
  "scale": 1.0,
  "font": "inter",
  "showSeconds": false,
  "reduceMotion": "system"
}
```

- `accent: "auto"` → Windows vurgu rengi (`UISettings.GetColorValue` ya da
  `DwmGetColorizationColor` **(doğrula)**).
- `glass`: `"wallpaper"` | `"flat"`.
- `scale`: tüm ölçü değişkenlerini çarpar (0.85–1.25); `placement.rs` de aynı
  çarpanı kullanır.
- Ayarlar penceresinde değişiklik anında önizlenir.

---

## E. Kabul listesi (Aşama 7 bitti sayılır)

- [ ] Çubuk yüzüyor, cam görünümlü, kenarında ışık çizgisi var
- [ ] Her widget karo sisteminde; elle yazılmış tek tük zemin/çerçeve kalmadı
- [ ] İkon büyütme, isim balonu, başlatma zıplaması çalışıyor
- [ ] Müzik ve hava karoları içeriğe göre renkleniyor
- [ ] Paneller animasyonla açılıp kapanıyor, gölgeli
- [ ] Açık renk duvar kâğıdında her metin okunuyor
- [ ] Boşta CPU ~%0, hover 60 fps
- [ ] Kurulum dosyası çalışıyor

---

## F. Riskler

| Konu | Risk | Önlem |
|---|---|---|
| Duvar kâğıdı yolu | Slayt gösterisi / Spotlight'ta yol alınamayabilir | `TranscodedWallpaper` yedeği; o da olmazsa düz cam |
| Çoklu monitör | Her monitörün duvar kâğıdı ayrı | Yalnızca birincil monitör |
| Gölge kırpılması | Pencere bölgesi gölgeyi keser | Küçük gölge; gerekirse bölgeyi 8 px genişlet |
| Panel gölge payı | Şeffaf pay tıklamayı yutar (16 px) | Kabul edilebilir; panel zaten odak kaybında kapanır |
| 40 px'te iki satır | Müzik/ses/saat sıkışabilir | `--tile-h` 44'e, çubuk 56'ya çıkar |
| Olaylara geçiş | COM geri çağrıları Rust'ta zahmetli | Paket paket geç; her biri için yoklama yedeği kalsın |

---

## G. VS Code'daki Claude'a verilecek istem

> `PLAN-ASAMA-7.md` dosyasını oku. Yalnızca **7.1**'i uygula. (doğrula) işaretli
> yerleri resmi dokümandan kontrol et. Bitince çalıştır, ekran görüntüsünü göster,
> ben onaylayınca commit et.

Sonra sırayla 7.2, 7.3 ... Her pakette aynı istemi paket numarasını değiştirerek
kullan. 7.2 en riskli paket; orada takılırsa B bölümündeki 3. yola dön.
