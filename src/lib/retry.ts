/**
 * Açılış yarışı: tauri.conf.json'daki pencereler Rust'ın `setup`'ı durumları
 * (`app.manage`) kaydetmeden yüklenebiliyor; kurulu sürümde sayfa daha hızlı
 * açıldığı için ilk `get_*` çağrısı "state not managed" ile düşüyordu ve dock
 * boş kalıyordu. İlk okumalar başarısız olursa artan aralıklarla yeniden denenir
 * (toplam ~10 sn); sonra hata bildirilir.
 */
const DELAYS_MS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000];

export async function withRetry<T>(get: () => Promise<T>, alive: () => boolean = () => true) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, DELAYS_MS[attempt - 1]));
      if (!alive()) throw lastError;
    }
    try {
      return await get();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
