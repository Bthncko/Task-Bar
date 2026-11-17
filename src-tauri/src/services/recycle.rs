//! Geri dönüşüm kutusu (8.8): öğe sayısı ve boyutu (`SHQueryRecycleBinW`),
//! açma ve boşaltma (`SHEmptyRecycleBinW`, Windows'un kendi onay penceresiyle).

use std::time::Duration;

use serde::Serialize;
use windows::Win32::UI::Shell::{SHEmptyRecycleBinW, SHQUERYRBINFO, SHQueryRecycleBinW};
use windows::core::PCWSTR;

use super::runner;
use crate::error::AppResult;

pub const RECYCLE_CHANGED: &str = "recycle://changed";
const POLL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RecycleState {
    pub items: u64,
    pub bytes: u64,
}

pub type RecycleService = runner::ServiceHandle<Option<RecycleState>, ()>;

pub fn spawn(app: &tauri::AppHandle) {
    runner::spawn(app, "recycle", RECYCLE_CHANGED, POLL, None, |_| {
        |_: Option<()>| query()
    });
}

/// Tüm sürücülerin geri dönüşüm kutuları.
fn query() -> Option<RecycleState> {
    let mut info = SHQUERYRBINFO {
        cbSize: size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.ok()?;
    Some(RecycleState {
        items: info.i64NumItems.max(0) as u64,
        bytes: info.i64Size.max(0) as u64,
    })
}

pub fn open() -> AppResult<()> {
    super::launcher::shell_open("explorer.exe", "shell:RecycleBinFolder", "")
}

/// Windows onay sorar; kullanıcı vazgeçerse de hata dönmez.
pub fn empty() {
    unsafe {
        let _ = SHEmptyRecycleBinW(None, PCWSTR::null(), 0);
    }
}

#[cfg(test)]
mod tests {
    /// Bu makinede (yerel deneme): kutu okunabiliyor.
    #[test]
    #[ignore]
    fn reads_recycle_bin() {
        let state = super::query();
        println!("{state:?}");
        assert!(state.is_some());
    }
}
