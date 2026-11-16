import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { BluetoothIcon, WifiIcon } from "../icons";
import shared from "../shared.module.css";

const EMPTY = { wifi: null, bluetooth: null, ssid: null, signal: null };

type Kind = "wifi" | "bluetooth";

export function RadiosBar() {
  const radios = useService(commands.getRadios, events.radios) ?? EMPTY;

  // Tıkla: Windows'un kendi paneli (görev çubuğundaki gibi). Sağ tık: ayar sayfası.
  const openPanel = (kind: Kind) => () =>
    commands.openQuickSettings(kind).catch(report("open_quick_settings"));
  const openSettings = (kind: Kind) => (e: React.MouseEvent) => {
    e.preventDefault();
    commands.openSystemSettings(kind).catch(report("open_system_settings"));
  };

  const { wifi, bluetooth } = radios;
  if (!wifi && !bluetooth) return null;

  const wifiTitle = !wifi
    ? ""
    : wifi.disabled
      ? "Wi-Fi donanımdan kapalı"
      : !wifi.on
        ? "Wi-Fi kapalı"
        : radios.ssid
          ? `Wi-Fi: ${radios.ssid}`
          : "Wi-Fi açık, bağlı değil";

  return (
    <div className={shared.item}>
      {wifi && (
        <button
          type="button"
          className={shared.iconButton}
          title={`${wifiTitle} (sağ tık: ayarlar)`}
          aria-label={wifiTitle}
          onClick={openPanel("wifi")}
          onContextMenu={openSettings("wifi")}
        >
          <span className={wifi.on ? undefined : shared.dim}>
            <WifiIcon bars={radios.ssid ? (radios.signal ?? 5) : 0} off={!wifi.on} />
          </span>
        </button>
      )}
      {bluetooth && (
        <button
          type="button"
          className={shared.iconButton}
          title={`Bluetooth ${bluetooth.disabled ? "donanımdan kapalı" : bluetooth.on ? "açık" : "kapalı"} (sağ tık: ayarlar)`}
          aria-label="Bluetooth"
          onClick={openPanel("bluetooth")}
          onContextMenu={openSettings("bluetooth")}
        >
          <span className={bluetooth.on ? undefined : shared.dim}>
            <BluetoothIcon off={!bluetooth.on} />
          </span>
        </button>
      )}
    </div>
  );
}
