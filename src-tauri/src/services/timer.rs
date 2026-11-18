//! Zamanlayıcı / pomodoro (8.8). Durum Rust'ta: dock sayfası yenilense de sürer.
//!
//! Sayfa her saniye olay beklemez: çalışırken bitiş anı (`endsAt`, Unix ms)
//! gönderilir, geri sayım sayfada hesaplanır. Bitişte kendi bildirim kartımız
//! ve Windows'un bildirim sesi.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const TIMER_CHANGED: &str = "timer://changed";

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    /// Kurulan süre (sn); 0 = kurulmadı.
    pub total: u32,
    /// Duraklatılmışken kalan (ms).
    pub remaining_ms: u64,
    /// Çalışırken bitiş anı (Unix ms).
    pub ends_at: Option<u64>,
    /// Süre doldu (sıfırlanana / yeniden başlatılana dek).
    pub finished: bool,
}

static STATE: Mutex<TimerState> = Mutex::new(TimerState {
    total: 0,
    remaining_ms: 0,
    ends_at: None,
    finished: false,
});
/// Her başlat / duraklat / sıfırla artırır: eski bekleme iş parçacıkları bitişi
/// bildirmesin.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn update(f: impl FnOnce(&mut TimerState)) -> TimerState {
    let next = {
        let mut s = STATE.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut s);
        s.clone()
    };
    if let Some(app) = APP.get() {
        let _ = app.emit(TIMER_CHANGED, &next);
    }
    next
}

pub fn get() -> TimerState {
    STATE.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

pub fn start(seconds: u32) {
    let seconds = seconds.clamp(1, 24 * 3600);
    update(|s| {
        s.total = seconds;
        s.remaining_ms = u64::from(seconds) * 1000;
        s.ends_at = None;
        s.finished = false;
    });
    resume();
}

pub fn resume() {
    let state = update(|s| {
        if s.ends_at.is_none() && s.remaining_ms > 0 {
            s.ends_at = Some(now_ms() + s.remaining_ms);
            s.finished = false;
        }
    });
    if let Some(end) = state.ends_at {
        schedule(end);
    }
}

pub fn pause() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    update(|s| {
        if let Some(end) = s.ends_at.take() {
            s.remaining_ms = end.saturating_sub(now_ms());
        }
    });
}

pub fn reset() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    update(|s| {
        s.ends_at = None;
        s.remaining_ms = u64::from(s.total) * 1000;
        s.finished = false;
    });
}

fn schedule(end: u64) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        // Parçalı bekle, saate bak: bilgisayar uykudayken geçen süre tek uzun
        // `sleep` içinde sayılmayabilir (uyanınca bitiş gecikirdi); iptal de
        // en geç bir parça sonra fark edilir.
        loop {
            if GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let left = end.saturating_sub(now_ms());
            if left == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(left.min(2000)));
        }
        let state = update(|s| {
            s.ends_at = None;
            s.remaining_ms = 0;
            s.finished = true;
        });
        if let Some(app) = APP.get() {
            super::notifications::show_local(
                app,
                "Zamanlayıcı",
                "Süre doldu",
                &format!("{} tamamlandı.", minutes(state.total)),
            );
        }
    });
}

fn minutes(seconds: u32) -> String {
    match (seconds / 60, seconds % 60) {
        (0, s) => format!("{s} sn"),
        (m, 0) => format!("{m} dakika"),
        (m, s) => format!("{m} dk {s} sn"),
    }
}

#[cfg(test)]
mod tests {
    use super::minutes;

    #[test]
    fn minute_labels() {
        assert_eq!(minutes(25 * 60), "25 dakika");
        assert_eq!(minutes(45), "45 sn");
        assert_eq!(minutes(90), "1 dk 30 sn");
    }
}
