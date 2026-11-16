//! Servis iskeleti (bölüm 2, 9): her servis kendi iş parçacığında.
//!
//! İş parçacığı COM'u başlatır, durum okuma işlevini (`make` ile iş parçacığı
//! içinde kurulur, COM nesneleri dışarı sızmaz) belirli aralıklarla çağırır,
//! durum değiştiyse önbelleğe yazıp olayı yayınlar. Komutlar kanal ile gelir
//! ve işlevi hemen yeniden çalıştırır. Okuma hatası `None`/varsayılan durum
//! demektir: servis düşse de dock ayakta kalır, widget "yok" gösterir.

use std::sync::Mutex;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

pub struct ServiceHandle<S, C> {
    state: Mutex<S>,
    commands: Mutex<Sender<C>>,
}

impl<S: Clone, C> ServiceHandle<S, C> {
    /// Son bilinen durum (`get_<şey>` komutları için).
    pub fn get(&self) -> S {
        self.state.lock().unwrap().clone()
    }

    pub fn send(&self, cmd: C) {
        let _ = self.commands.lock().unwrap().send(cmd);
    }
}

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
    M: FnOnce() -> T + Send + 'static,
    T: FnMut(Option<C>) -> S,
{
    let (tx, rx) = mpsc::channel::<C>();
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
            let mut tick = make();
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
                    Ok(cmd) => pending = Some(cmd),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    if let Err(e) = spawned {
        eprintln!("{name} servisi başlatılamadı: {e}");
    }
}
