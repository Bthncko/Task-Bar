//! 7.8: uygulama listesini yoklama yerine pencere olaylarıyla yenile.
//!
//! `SetWinEventHook` (WINEVENT_OUTOFCONTEXT: olaylar bu iş parçacığının mesaj
//! döngüsüne gelir, kendi sürecimiz hariç). İlgili bir olayda uygulamalar
//! servisi uyandırılır; servis art arda gelenleri tek listelemede birleştirir.
//!
//! Gürültüyü azaltmak için yalnızca pencere nesnesinin kendisine ait olaylar
//! (OBJID_WINDOW + CHILDID_SELF) ve:
//! - ön plan değişimi (odak çizgisi),
//! - görünen / gizlenmeyen üst düzey pencereler (yeni pencere),
//! - listedeki pencerelerin kapanması, gizlenmesi, başlığının değişmesi.
//!
//! Stil değişimi gibi olayı olmayan nadir durumları servisin seyrek yoklaması yakalar.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::WindowsAndMessaging::{
    CHILDID_SELF, DispatchMessageW, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND,
    GA_ROOT, GetAncestor, GetMessageW, IsWindowVisible, MSG, OBJID_WINDOW, TranslateMessage,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

use super::apps::AppsService;
use crate::win::hwnd_to_id;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Şu an dock'ta listelenen pencereler (servis her listelemede günceller).
static KNOWN: Mutex<Option<HashSet<isize>>> = Mutex::new(None);

/// Uygulamalar servisi listeyi yeniledikçe çağırır.
pub fn set_known(hwnds: impl IntoIterator<Item = isize>) {
    *KNOWN.lock().unwrap() = Some(hwnds.into_iter().collect());
}

fn is_known(hwnd: HWND) -> bool {
    KNOWN
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|k| k.contains(&hwnd_to_id(hwnd)))
}

fn is_visible_top_level(hwnd: HWND) -> bool {
    unsafe { GetAncestor(hwnd, GA_ROOT) == hwnd && IsWindowVisible(hwnd).as_bool() }
}

pub fn spawn(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let spawned = std::thread::Builder::new()
        .name("apps-events".into())
        .spawn(|| unsafe {
            for (min, max) in [
                (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                // DESTROY, SHOW, HIDE ardışık (0x8001–0x8003).
                (EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE),
                (EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED),
            ] {
                if SetWinEventHook(
                    min,
                    max,
                    None,
                    Some(on_event),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                )
                .is_invalid()
                {
                    eprintln!("[apps] olay kancası kurulamadı ({min:#x}–{max:#x})");
                }
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    if let Err(e) = spawned {
        eprintln!("apps-events başlatılamadı: {e}");
    }
}

unsafe extern "system" fn on_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object != OBJID_WINDOW.0 || id_child != CHILDID_SELF as i32 || hwnd.is_invalid() {
        return;
    }
    if event == EVENT_SYSTEM_FOREGROUND {
        crate::win::appbar::on_foreground_changed();
    }
    let relevant = match event {
        EVENT_SYSTEM_FOREGROUND => true,
        EVENT_OBJECT_SHOW | EVENT_OBJECT_UNCLOAKED => is_visible_top_level(hwnd),
        EVENT_OBJECT_DESTROY | EVENT_OBJECT_HIDE | EVENT_OBJECT_CLOAKED => is_known(hwnd),
        // Başlık: listede olanlar ya da başlık alınca listeye girecek olanlar.
        EVENT_OBJECT_NAMECHANGE => is_known(hwnd) || is_visible_top_level(hwnd),
        _ => false,
    };
    if relevant && let Some(app) = APP.get() {
        app.state::<AppsService>().refresh_soon();
    }
}
