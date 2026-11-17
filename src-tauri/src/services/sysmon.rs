//! Sistem izleyici (8.4): CPU, RAM, ağ hızı; panel açıkken diskler ve en çok
//! işlemci kullanan süreçler. Doğrudan Win32, yeni bağımlılık yok.
//!
//! Doğrulandı (Microsoft Learn):
//! - `GetSystemTimes`: çekirdek süresi boşta geçen süreyi de içerir; meşgul
//!   = (çekirdek + kullanıcı) − boşta.
//! - `GetIfTable2` tablosu `FreeMibTable` ile bırakılır. Sayaçlar hatasız
//!   alınan / gönderilen baytlar. Aynı trafik filtre ve sanal arayüzlerde de
//!   sayılır; yalnızca çalışan, donanım olan, filtre olmayan ve geri döngü
//!   olmayan arayüzler toplanır (ayıklama kuralı belgede yok, bizim seçimimiz).
//!
//! Görev Yöneticisi Windows 10'dan beri CPU'yu "işlemci yardımcı programı"
//! sayacıyla gösterir (turbo frekansı hesaba katar); buradaki "işlemci
//! süresi" yoğun yükte ondan birkaç puan düşük kalabilir.
//!
//! Örnekleme: çubuk için 2 sn, panel açıkken (`detail`) 1 sn.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use windows::Win32::Foundation::{CloseHandle, FILETIME};
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives};
use windows::Win32::System::ProcessStatus::{
    K32EnumProcesses, K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetProcessTimes, GetSystemTimes, OpenProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{PCWSTR, PWSTR};

use super::runner::{self, Waker};
use crate::win::wide;

pub const SYSMON_CHANGED: &str = "sysmon://changed";
/// Servisin kendi saati: panel açıkken her tur, kapalıyken iki turda bir okunur.
const TICK: Duration = Duration::from_secs(1);
const BAR_EVERY: Duration = Duration::from_millis(1900);
/// Panelin CPU grafiğindeki örnek sayısı.
const HISTORY: usize = 60;
const TOP: usize = 5;
/// `GetDriveTypeW`: yerel sabit disk.
const DRIVE_FIXED: u32 = 3;
const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SysState {
    /// 0–100, tam sayı (gereksiz olay olmasın).
    pub cpu: u8,
    pub ram_used: u64,
    pub ram_total: u64,
    /// Bayt / sn.
    pub net_down: u64,
    pub net_up: u64,
    /// Son örneklerin CPU yüzdesi (eskiden yeniye).
    pub history: Vec<u8>,
    /// Yalnızca panel açıkken dolu.
    pub disks: Vec<Disk>,
    pub processes: Vec<Proc>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    /// "C:".
    pub root: String,
    pub used: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    /// Exe adı (uzantısız); aynı adlı süreçler toplanır.
    pub name: String,
    /// Tüm çekirdeklerin yüzdesi (Görev Yöneticisi gibi).
    pub cpu: f32,
    /// Çalışma kümesi, bayt.
    pub memory: u64,
}

/// Panel açıldı / kapandı.
pub struct Detail(pub bool);

pub type SysmonService = runner::ServiceHandle<Option<SysState>, Detail>;

pub fn spawn(app: &AppHandle) {
    runner::spawn(
        app,
        "sysmon",
        SYSMON_CHANGED,
        TICK,
        None,
        |_waker: Waker<Detail>| {
            let mut sampler = Sampler::default();
            move |cmd: Option<Detail>| {
                if let Some(Detail(on)) = cmd {
                    sampler.detail = on;
                    if !on {
                        sampler.procs.clear();
                    }
                }
                sampler.sample()
            }
        },
    );
}

#[derive(Default)]
struct Sampler {
    detail: bool,
    last: Option<Instant>,
    cpu: Option<(u64, u64)>,
    net: Option<(u64, u64, Instant)>,
    history: Vec<u8>,
    /// pid → (işlemci süresi toplamı 100 ns, örnek anı).
    procs: HashMap<u32, (u64, Instant)>,
    state: Option<SysState>,
}

impl Sampler {
    fn sample(&mut self) -> Option<SysState> {
        // Çubuk için iki saniyede bir yeter; panel açıkken her saniye.
        if !self.detail
            && let Some(at) = self.last
            && at.elapsed() < BAR_EVERY
        {
            return self.state.clone();
        }
        self.last = Some(Instant::now());

        let cpu = self.cpu_percent().unwrap_or(0);
        self.history.push(cpu);
        if self.history.len() > HISTORY {
            self.history.remove(0);
        }
        let (ram_used, ram_total) = memory().unwrap_or((0, 0));
        let (net_down, net_up) = self.net_rate();
        let (disks, processes) = if self.detail {
            (disks(), self.top_processes())
        } else {
            (Vec::new(), Vec::new())
        };
        self.state = Some(SysState {
            cpu,
            ram_used,
            ram_total,
            net_down,
            net_up,
            history: self.history.clone(),
            disks,
            processes,
        });
        self.state.clone()
    }

    fn cpu_percent(&mut self) -> Option<u8> {
        let (mut idle, mut kernel, mut user) = Default::default();
        unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).ok()? };
        let idle = ft(idle);
        let total = ft(kernel) + ft(user); // çekirdek boşta süresini de içerir
        let prev = self.cpu.replace((idle, total));
        let (pidle, ptotal) = prev?;
        let dt = total.saturating_sub(ptotal);
        if dt == 0 {
            return self.state.as_ref().map(|s| s.cpu);
        }
        let busy = dt.saturating_sub(idle.saturating_sub(pidle));
        Some(
            ((busy as f64 / dt as f64) * 100.0)
                .round()
                .clamp(0.0, 100.0) as u8,
        )
    }

    fn net_rate(&mut self) -> (u64, u64) {
        let Some((down, up)) = net_octets() else {
            return (0, 0);
        };
        let now = Instant::now();
        let prev = self.net.replace((down, up, now));
        let Some((pd, pu, at)) = prev else {
            return (0, 0);
        };
        let secs = now.duration_since(at).as_secs_f64();
        if secs <= 0.0 {
            return (0, 0);
        }
        // Arayüz kapanıp açılınca sayaç sıfırlanabilir: eksiye düşmesin.
        (
            (down.saturating_sub(pd) as f64 / secs) as u64,
            (up.saturating_sub(pu) as f64 / secs) as u64,
        )
    }

    /// En çok işlemci kullanan süreçler (aynı adlılar toplanır). İlk açılışta
    /// karşılaştıracak örnek yok: işlemci 0, bellek dolu.
    fn top_processes(&mut self) -> Vec<Proc> {
        let cores = std::thread::available_parallelism().map_or(1, |n| n.get()) as f64;
        let now = Instant::now();
        let mut seen = HashMap::new();
        let mut by_name: HashMap<String, Proc> = HashMap::new();
        for pid in pids() {
            let Some((name, time, memory)) = process_info(pid) else {
                continue;
            };
            let cpu = match self.procs.get(&pid) {
                Some(&(prev, at)) => {
                    let wall = now.duration_since(at).as_secs_f64() * 1e7; // 100 ns
                    if wall > 0.0 {
                        (time.saturating_sub(prev) as f64 / wall / cores * 100.0) as f32
                    } else {
                        0.0
                    }
                }
                None => 0.0,
            };
            seen.insert(pid, (time, now));
            let entry = by_name.entry(name.to_lowercase()).or_insert(Proc {
                name,
                cpu: 0.0,
                memory: 0,
            });
            entry.cpu += cpu;
            entry.memory += memory;
        }
        self.procs = seen;
        let mut list: Vec<Proc> = by_name.into_values().collect();
        list.sort_by(|a, b| {
            b.cpu
                .total_cmp(&a.cpu)
                .then_with(|| b.memory.cmp(&a.memory))
        });
        list.truncate(TOP);
        for p in &mut list {
            p.cpu = (p.cpu * 10.0).round() / 10.0;
        }
        list
    }
}

fn ft(t: FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}

fn memory() -> Option<(u64, u64)> {
    let mut status = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut status).ok()? };
    Some((
        status.ullTotalPhys - status.ullAvailPhys,
        status.ullTotalPhys,
    ))
}

/// Gerçek ağ arayüzlerinin toplam alınan / gönderilen baytı.
fn net_octets() -> Option<(u64, u64)> {
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return None;
        }
        let count = (*table).NumEntries as usize;
        // Satırlar tablonun sonunda dizi; `Table[1]` yalnızca başlangıç.
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), count);
        let (mut down, mut up) = (0u64, 0u64);
        for row in rows {
            let flags = row.InterfaceAndOperStatusFlags._bitfield;
            let hardware = flags & 0b01 != 0; // HardwareInterface
            let filter = flags & 0b10 != 0; // FilterInterface
            if row.OperStatus == IfOperStatusUp
                && hardware
                && !filter
                && row.Type != IF_TYPE_SOFTWARE_LOOPBACK
            {
                down += row.InOctets;
                up += row.OutOctets;
            }
        }
        FreeMibTable(table as *const _);
        Some((down, up))
    }
}

fn disks() -> Vec<Disk> {
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .filter_map(|i| {
            let root = format!("{}:\\", (b'A' + i) as char);
            let w = wide(&root);
            unsafe {
                if GetDriveTypeW(PCWSTR(w.as_ptr())) != DRIVE_FIXED {
                    return None;
                }
                let (mut free, mut total) = (0u64, 0u64);
                GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), None, Some(&mut total), Some(&mut free))
                    .ok()?;
                Some(Disk {
                    root: root.trim_end_matches('\\').to_string(),
                    used: total.saturating_sub(free),
                    total,
                })
            }
        })
        .collect()
}

fn pids() -> Vec<u32> {
    let mut buf = vec![0u32; 2048];
    let mut needed = 0u32;
    unsafe {
        if !K32EnumProcesses(buf.as_mut_ptr(), (buf.len() * 4) as u32, &mut needed).as_bool() {
            return Vec::new();
        }
    }
    buf.truncate(needed as usize / 4);
    buf.retain(|&p| p != 0);
    buf
}

/// (ad, işlemci süresi 100 ns, çalışma kümesi). Korumalı süreçler atlanır.
fn process_info(pid: u32) -> Option<(String, u64, u64)> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let result = (|| {
            let (mut c, mut e, mut k, mut u) = Default::default();
            GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u).ok()?;
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
                .ok()?;
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let name = std::path::Path::new(&path)
                .file_stem()?
                .to_string_lossy()
                .into_owned();
            let mut mem = PROCESS_MEMORY_COUNTERS {
                cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                ..Default::default()
            };
            let memory = if K32GetProcessMemoryInfo(h, &mut mem, mem.cb).as_bool() {
                mem.WorkingSetSize as u64
            } else {
                0
            };
            Some((name, ft(k) + ft(u), memory))
        })();
        let _ = CloseHandle(h);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_memory_and_network() {
        let (used, total) = memory().unwrap();
        assert!(total > 0 && used <= total);
        assert!(net_octets().is_some());
        assert!(!disks().is_empty());
    }

    #[test]
    fn cpu_percent_needs_two_samples() {
        let mut s = Sampler::default();
        assert_eq!(s.cpu_percent(), None);
        std::thread::sleep(Duration::from_millis(50));
        let v = s.cpu_percent();
        assert!(v.is_none_or(|v| v <= 100));
    }
}
