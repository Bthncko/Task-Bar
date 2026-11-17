//! Wi-Fi ağları ve Bluetooth aygıtları (dock tarzı paneller için).
//!
//! Wi-Fi: WinRT `Windows.Devices.WiFi` (tarama, bağlanma, kesme). Belgeye göre
//! paketli uygulamada `wiFiControl` yeteneği ve kullanıcının konum izni
//! gerekiyor; izin yoksa "erişim reddedildi" döner. Denendi (bu makinede,
//! paketsiz): erişim Allowed, tarama 31 ağ döndürdü. Hata olursa panel
//! Windows'un Wi-Fi sayfasını açar.
//!
//! Bluetooth: eşleşmiş aygıtlar ve bağlantı durumu (`BluetoothDevice`,
//! `BluetoothLEDevice`). Eşleşmiş bir aygıtı bağlamanın / ayırmanın açık bir
//! API'si yok; panel bunun için Windows'un Bluetooth sayfasını açar.
//!
//! İşlevler engelleyicidir (tarama birkaç saniye sürer): komutlar ayrı iş
//! parçacığında çağırır. Ağ adları ve aygıt adları günlüğe yazılmaz.

use std::collections::HashMap;

use serde::Serialize;
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
use windows::Devices::Enumeration::DeviceInformation;
use windows::Devices::WiFi::{WiFiAdapter, WiFiConnectionStatus, WiFiReconnectionKind};
use windows::Networking::Connectivity::{NetworkAuthenticationType, NetworkInformation};
use windows::Security::Credentials::PasswordCredential;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
use windows::core::HSTRING;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0–4 çubuk.
    pub bars: u8,
    /// Şifre ister (kurumsal ağlar hariç).
    pub secured: bool,
    /// Kullanıcı adı isteyen kurumsal ağ: panel Windows ayarlarını açar.
    pub enterprise: bool,
    /// Daha önce bağlanılmış (kayıtlı profil var).
    pub saved: bool,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtDevice {
    pub name: String,
    pub connected: bool,
    /// "audio", "input", "phone" ya da "other" (ikon için).
    pub kind: &'static str,
}

fn com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

fn adapter() -> Result<WiFiAdapter, String> {
    let list = WiFiAdapter::FindAllAdaptersAsync()
        .and_then(|o| o.join())
        .map_err(|e| e.message())?;
    list.GetAt(0)
        .map_err(|_| "Wi-Fi bağdaştırıcısı yok".to_string())
}

/// Tarar ve ağları (aynı ad bir kez, en güçlü sinyalle) döndürür.
pub fn scan() -> Result<Vec<WifiNetwork>, String> {
    com();
    let adapter = adapter()?;
    adapter
        .ScanAsync()
        .and_then(|o| o.join())
        .map_err(|e| e.message())?;
    let report = adapter
        .NetworkReport()
        .and_then(|r| r.AvailableNetworks())
        .map_err(|e| e.message())?;

    let connected = NetworkInformation::GetInternetConnectionProfile()
        .ok()
        .filter(|p| p.IsWlanConnectionProfile().unwrap_or(false))
        .and_then(|p| p.WlanConnectionProfileDetails().ok())
        .and_then(|d| d.GetConnectedSsid().ok())
        .map(|s| s.to_string());
    let saved: Vec<String> = NetworkInformation::GetConnectionProfiles()
        .map(|list| {
            list.into_iter()
                .filter(|p| p.IsWlanConnectionProfile().unwrap_or(false))
                .filter_map(|p| p.ProfileName().ok().map(|n| n.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut by_ssid: HashMap<String, WifiNetwork> = HashMap::new();
    for i in 0..report.Size().unwrap_or(0) {
        let Ok(net) = report.GetAt(i) else { continue };
        let ssid = net.Ssid().map(|s| s.to_string()).unwrap_or_default();
        if ssid.is_empty() || net.IsWiFiDirect().unwrap_or(false) {
            continue;
        }
        let auth = net
            .SecuritySettings()
            .and_then(|s| s.NetworkAuthenticationType())
            .unwrap_or(NetworkAuthenticationType::Unknown);
        let enterprise = matches!(
            auth,
            NetworkAuthenticationType::Wpa
                | NetworkAuthenticationType::Rsna
                | NetworkAuthenticationType::Wpa3Enterprise
                | NetworkAuthenticationType::Wpa3Enterprise192Bits
        );
        let open = matches!(
            auth,
            NetworkAuthenticationType::None
                | NetworkAuthenticationType::Open80211
                | NetworkAuthenticationType::Owe
        );
        let entry = WifiNetwork {
            bars: net.SignalBars().unwrap_or(0).min(4),
            secured: !open && !enterprise,
            enterprise,
            saved: saved.contains(&ssid),
            connected: connected.as_deref() == Some(ssid.as_str()),
            ssid: ssid.clone(),
        };
        match by_ssid.get(&ssid) {
            Some(prev) if prev.bars >= entry.bars => {}
            _ => {
                by_ssid.insert(ssid, entry);
            }
        }
    }
    let mut list: Vec<WifiNetwork> = by_ssid.into_values().collect();
    // Bağlı en üstte, sonra kayıtlılar, sonra sinyale göre.
    list.sort_by(|a, b| {
        b.connected
            .cmp(&a.connected)
            .then(b.saved.cmp(&a.saved))
            .then(b.bars.cmp(&a.bars))
            .then(a.ssid.to_lowercase().cmp(&b.ssid.to_lowercase()))
    });
    Ok(list)
}

/// Son taramadaki ağa bağlanır. Şifreli ve kayıtsız ağda `password` gerekir;
/// yoksa "password_required" hatası döner (panel şifre sorar).
pub fn connect(ssid: &str, password: Option<&str>) -> Result<(), String> {
    com();
    let adapter = adapter()?;
    let report = adapter
        .NetworkReport()
        .and_then(|r| r.AvailableNetworks())
        .map_err(|e| e.message())?;
    let network = (0..report.Size().unwrap_or(0))
        .filter_map(|i| report.GetAt(i).ok())
        .filter(|n| n.Ssid().map(|s| s.to_string()).as_deref() == Ok(ssid))
        .max_by_key(|n| n.SignalBars().unwrap_or(0))
        .ok_or("ağ artık görünmüyor")?;
    let op = match password {
        Some(p) => {
            let cred = PasswordCredential::new().map_err(|e| e.message())?;
            cred.SetPassword(&HSTRING::from(p))
                .map_err(|e| e.message())?;
            adapter.ConnectWithPasswordCredentialAsync(
                &network,
                WiFiReconnectionKind::Automatic,
                &cred,
            )
        }
        None => adapter.ConnectAsync(&network, WiFiReconnectionKind::Automatic),
    };
    let status = op
        .and_then(|o| o.join())
        .and_then(|r| r.ConnectionStatus())
        .map_err(|e| e.message())?;
    match status {
        WiFiConnectionStatus::Success => Ok(()),
        WiFiConnectionStatus::InvalidCredential if password.is_none() => {
            Err("password_required".into())
        }
        WiFiConnectionStatus::InvalidCredential => Err("Şifre yanlış".into()),
        WiFiConnectionStatus::NetworkNotAvailable => Err("Ağ artık görünmüyor".into()),
        WiFiConnectionStatus::Timeout => Err("Bağlantı zaman aşımına uğradı".into()),
        WiFiConnectionStatus::AccessRevoked => Err("Erişim reddedildi".into()),
        WiFiConnectionStatus::UnsupportedAuthenticationProtocol => {
            Err("Bu ağın güvenlik türü desteklenmiyor".into())
        }
        _ => Err("Bağlanılamadı".into()),
    }
}

pub fn disconnect() -> Result<(), String> {
    com();
    adapter()?.Disconnect().map_err(|e| e.message())
}

/// Eşleşmiş Bluetooth aygıtları (klasik ve düşük enerji), bağlılar önce.
pub fn bt_devices() -> Result<Vec<BtDevice>, String> {
    com();
    let mut out: Vec<BtDevice> = Vec::new();
    let classic = BluetoothDevice::GetDeviceSelectorFromPairingState(true)
        .and_then(|s| DeviceInformation::FindAllAsyncAqsFilter(&s))
        .and_then(|o| o.join())
        .map_err(|e| e.message())?;
    for info in classic {
        let Ok(id) = info.Id() else { continue };
        let Ok(device) = BluetoothDevice::FromIdAsync(&id).and_then(|o| o.join()) else {
            continue;
        };
        let kind = match device
            .ClassOfDevice()
            .and_then(|c| c.MajorClass())
            .map(|m| m.0)
        {
            Ok(4) => "audio", // AudioVideo
            Ok(5) => "input", // Peripheral (klavye, fare)
            Ok(2) => "phone", // Phone
            _ => "other",
        };
        out.push(BtDevice {
            name: device.Name().map(|n| n.to_string()).unwrap_or_default(),
            connected: device.ConnectionStatus() == Ok(BluetoothConnectionStatus::Connected),
            kind,
        });
    }
    if let Ok(le) = BluetoothLEDevice::GetDeviceSelectorFromPairingState(true)
        .and_then(|s| DeviceInformation::FindAllAsyncAqsFilter(&s))
        .and_then(|o| o.join())
    {
        for info in le {
            let Ok(id) = info.Id() else { continue };
            let Ok(device) = BluetoothLEDevice::FromIdAsync(&id).and_then(|o| o.join()) else {
                continue;
            };
            let name = device.Name().map(|n| n.to_string()).unwrap_or_default();
            let connected = device.ConnectionStatus() == Ok(BluetoothConnectionStatus::Connected);
            // Aynı aygıt iki listede de olabilir (çift modlu): bağlıysa işaretle.
            if let Some(existing) = out.iter_mut().find(|d| d.name == name) {
                existing.connected |= connected;
                continue;
            }
            out.push(BtDevice {
                name,
                connected,
                kind: "input",
            });
        }
    }
    out.retain(|d| !d.name.is_empty());
    out.sort_by(|a, b| {
        b.connected
            .cmp(&a.connected)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}
