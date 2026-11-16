# Akıllı Dock

Windows 11 görev çubuğunun yerine geçen, cam görünümlü bir dock. Açık uygulamalar,
saat ve takvim, müzik (Spotify sıradakiler dahil), hava durumu, ses, pil, Wi-Fi ve
Bluetooth tek çubukta.

## Kurulum

1. [Releases](https://github.com/Bthncko/Task-Bar/releases/latest) sayfasından
   `Akilli.Dock_…_x64-setup.exe` dosyasını indir ve çalıştır. Yönetici izni istemez.
2. Windows "Bilgisayarınız korundu" (SmartScreen) uyarısı gösterirse
   **Ek bilgi → Yine de çalıştır**'a tıkla. Uygulama ücretli bir kod imzası
   taşımadığı için bu uyarı çıkıyor.
3. Kurulum bitince dock ekranın altında açılır ve bundan sonra Windows'la birlikte
   başlar.

## İlk ayarlar

- **Windows'un kendi çubuğunu gizlemek için:** dock'un boş bir yerine sağ tıkla →
  **Windows görev çubuğunu gizle**. Dock kapanınca Windows çubuğu geri gelir.
- **Ayarlar:** aynı menüden **Ayarlar…**. Renk, cam, boyut, widget'ların yeri,
  hava durumu şehri, takvim abonelikleri burada.
- **Takvim:** Ayarlar → Saat ve takvim → Google Takvim'in "gizli iCal adresi"ni
  yapıştır. Adres gizlidir, kimseyle paylaşma.

## Güncellemeler

Yeni sürüm çıkınca dock bunu birkaç saat içinde kendisi fark eder, indirir ve kurar:
küçük bir ilerleme penceresi açılır, dock birkaç saniyeliğine kapanıp yeniden açılır.
Ayarlar → Genel → Güncellemeler'den kapatılabilir ya da **Şimdi denetle** ile hemen
denetlenebilir.

## Spotify sıradakiler

Müzik karosuna tıklayınca açılan panelde Spotify'ın sıradaki şarkıları görünür.
Bunun için Spotify Premium ve bir Spotify geliştirici uygulaması gerekir; adımlar
Ayarlar → Müzik sayfasında. İki yol var:

- **Kendi uygulamanı aç** (önerilen): sayfadaki 4 adımı izle, kendi Client ID'ni yapıştır.
- **Arkadaşının uygulamasını kullan:** uygulamanın sahibi seni developer.spotify.com
  → uygulama → **User Management**'a Spotify e-postanla ekler, sen de onun Client
  ID'sini yapıştırırsın. Geliştirme modunda bir uygulamayı en çok 5 kişi kullanabilir.

## Sorun olursa

- **Görev çubuğu kayboldu, geri gelmiyor:** Görev Yöneticisi'nde (Ctrl+Shift+Esc)
  "Akilli Dock"u kapat; çubuk geri gelir. Gelmezse
  [restore-taskbar.ps1](scripts/restore-taskbar.ps1) dosyasını indirip sağ tıkla →
  **PowerShell ile çalıştır**.
- **Kaldırmak:** Windows Ayarlar → Uygulamalar → Yüklü uygulamalar → Akilli Dock →
  Kaldır.

---

## Geliştirme

Tauri 2 (Rust) + React + TypeScript + Vite. Plan: [PLAN.md](PLAN.md),
[PLAN-ASAMA-7.md](PLAN-ASAMA-7.md).

```sh
npm install
npm run tauri dev      # geliştirme
npm run lint && npm run format:check
cd src-tauri && cargo clippy && cargo test
```

### Yeni sürüm çıkarmak

```sh
npm run release 0.3.0
```

Sürüm numarasını her yerde değiştirir, commit'ler, `v0.3.0` etiketini gönderir.
GitHub Actions ([release.yml](.github/workflows/release.yml)) kurulum dosyasını
derleyip imzalar ve Releases'e koyar (~15 dk); kurulu dock'lar `latest.json`
üzerinden kendini günceller.

Güncelleme imzası için depo sırları gerekir (Settings → Secrets and variables →
Actions): `TAURI_SIGNING_PRIVATE_KEY` ve `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Anahtar `%USERPROFILE%\.tauri\akilli-dock.key` dosyasında; **kaybolursa kurulu
dock'lara bir daha güncelleme gönderilemez**, yedeğini sakla.
