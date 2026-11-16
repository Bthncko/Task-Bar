import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { BluetoothIcon, WifiIcon } from "../icons";
import { Dim, IconButton, Tile } from "../ui";

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

  // (7.5'te iki Pill olacak: aç/kapat │ ayarlar.)
  return (
    <Tile variant="plain">
      {wifi && (
        <IconButton
          title={`${wifiTitle} (sağ tık: ayarlar)`}
          aria-label={wifiTitle}
          onClick={openPanel("wifi")}
          onContextMenu={openSettings("wifi")}
        >
          {wifi.on ? (
            <WifiIcon bars={radios.ssid ? (radios.signal ?? 5) : 0} off={false} />
          ) : (
            <Dim>
              <WifiIcon bars={0} off />
            </Dim>
          )}
        </IconButton>
      )}
      {bluetooth && (
        <IconButton
          title={`Bluetooth ${bluetooth.disabled ? "donanımdan kapalı" : bluetooth.on ? "açık" : "kapalı"} (sağ tık: ayarlar)`}
          aria-label="Bluetooth"
          onClick={openPanel("bluetooth")}
          onContextMenu={openSettings("bluetooth")}
        >
          {bluetooth.on ? (
            <BluetoothIcon off={false} />
          ) : (
            <Dim>
              <BluetoothIcon off />
            </Dim>
          )}
        </IconButton>
      )}
    </Tile>
  );
}
