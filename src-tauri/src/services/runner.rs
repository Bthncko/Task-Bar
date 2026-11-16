//! Servis iskeleti (bölüm 2, 9): her servis kendi iş parçacığında.
//!
//! İş parçacığı COM'u başlatır, durum okuma işlevini (`make` ile iş parçacığı
//! içinde kurulur, COM nesneleri dışarı sızmaz) çağırır, durum değiştiyse
//! önbelleğe yazıp olayı yayınlar. İşlev şu durumlarda yeniden çalışır:
//! - bir komut gelince (`send`),
//! - Windows bir değişiklik bildirince (`Waker::wake`, 7.8: yoklama yerine olay),
//! - yedek yoklama aralığı dolunca (olay kaçarsa diye seyrek).
//!
//! Okuma hatası `None`/varsayılan durum demektir: servis düşse de dock ayakta
//! kalır, widget "yok" gösterir.

use std::sync::Mutex;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

/// Art arda gelen bildirimleri tek okumada birleştirme süresi.
const COALESCE: Duration = Duration::from_millis(30);

enum Msg<C> {
    Cmd(C),
    Wake,
}

/// Olay işleyicilerinden servisi "şimdi oku" diye uyandırır. Herhangi bir iş
/// parçacığından (COM / WinRT geri çağrıları) çağrılabilir; hemen döner.
pub struct Waker<C>(Sender<Msg<C>>);

impl<C> Clone for Waker<C> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<C> Waker<C> {
    pub fn wake(&self) {
        let _ = self.0.send(Msg::Wake);
    }
}

pub struct ServiceHandle<S, C> {
    state: Mutex<S>,
    commands: Mutex<Sender<Msg<C>>>,
}

impl<S: Clone, C> ServiceHandle<S, C> {
    /// Son bilinen durum (`get_<şey>` komutları için).
    pub fn get(&self) -> S {
        self.state.lock().unwrap().clone()
    }

    pub fn send(&self, cmd: C) {
        let _ = self.commands.lock().unwrap().send(Msg::Cmd(cmd));
    }

    pub fn wake(&self) {
        let _ = self.commands.lock().unwrap().send(Msg::Wake);
    }
}

/// `make`, servisin iş parçacığında bir kez çağrılır; aldığı `Waker`'ı Windows
/// olaylarına bağlayabilir. `interval` yedek yoklama aralığıdır.
pub fn spawn<S, C, M, T>(
    app: &AppHandle,
    name: &str,
    event: &'static str,
    interval: Duration,
    initial: S,
    make: M,
) where
    S: Clone + PartialEq + Serialize + Send + Sync + 'static,
    C: Send + 'static,
    M: FnOnce(Waker<C>) -> T + Send + 'static,
    T: FnMut(Option<C>) -> S,
{
    let (tx, rx) = mpsc::channel::<Msg<C>>();
    let waker = Waker(tx.clone());
    app.manage(ServiceHandle {
        state: Mutex::new(initial),
        commands: Mutex::new(tx),
    });
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name(name.to_string())
        .spawn(move || {
            // WinRT ve Core Audio için.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let mut tick = make(waker);
            let mut pending: Option<C> = None;
            loop {
                let next = tick(pending.take());
                let handle = app.state::<ServiceHandle<S, C>>();
                let changed = {
                    let mut state = handle.state.lock().unwrap();
                    if *state != next {
                        *state = next.clone();
                        true
                    } else {
                        false
                    }
                };
                if changed {
                    let _ = app.emit(event, &next);
                }
                match rx.recv_timeout(interval) {
                    Ok(Msg::Cmd(cmd)) => pending = Some(cmd),
                    Ok(Msg::Wake) => {
                        // Bir değişiklik çoğu zaman birkaç bildirimle gelir: birleştir.
                        std::thread::sleep(COALESCE);
                        while let Ok(msg) = rx.try_recv() {
                            if let Msg::Cmd(cmd) = msg {
                                pending = Some(cmd);
                                break;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    if let Err(e) = spawned {
        eprintln!("{name} servisi başlatılamadı: {e}");
    }
}
