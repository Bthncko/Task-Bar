//! Pil: `GetSystemPowerStatus` (bölüm 6.6), 30 sn yoklama.
//! Pil yoksa (masaüstü PC) durum `None` olur ve widget gizlenir.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use super::runner;

pub const POWER_CHANGED: &str = "power://changed";
const POLL: Duration = Duration::from_secs(30);
/// `BatteryFlag`: sistemde pil yok.
const NO_BATTERY: u8 = 128;
/// `BatteryLifePercent` / `ACLineStatus`: bilinmiyor.
const UNKNOWN: u8 = 255;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PowerState {
    pub percent: u8,
    /// Prize takılı.
    pub plugged: bool,
    /// Şarj oluyor (takılı ve dolmamış).
    pub charging: bool,
}

pub type PowerService = runner::ServiceHandle<Option<PowerState>, ()>;

pub fn spawn(app: &AppHandle) {
    runner::spawn(app, "power", POWER_CHANGED, POLL, None, || {
        |_: Option<()>| {
            let mut status = SYSTEM_POWER_STATUS::default();
            unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
            if status.BatteryFlag & NO_BATTERY != 0 || status.BatteryLifePercent == UNKNOWN {
                return None;
            }
            let plugged = status.ACLineStatus == 1;
            Some(PowerState {
                percent: status.BatteryLifePercent.min(100),
                plugged,
                // BatteryFlag 8 = şarj oluyor.
                charging: status.BatteryFlag & 8 != 0,
            })
        }
    });
}
