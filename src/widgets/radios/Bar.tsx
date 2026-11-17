import { commands, events, report, type RadioInfo } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { BluetoothIcon, ChevronIcon, WifiIcon } from "../icons";
import { SplitPill, Tile } from "../ui";

const EMPTY = { wifi: null, bluetooth: null, ssid: null, signal: null };

type Kind = "wifi" | "bluetooth";

export function RadiosBar() {
  const radios = useService(commands.getRadios, events.radios) ?? EMPTY;
  const { wifi, bluetooth } = radios;
  if (!wifi && !bluetooth) return null;

  const wifiState = !wifi
    ? ""
    : wifi.disabled
      ? "Wi-Fi donanımdan kapalı"
      : !wifi.on
        ? "Wi-Fi kapalı"
        : radios.ssid
          ? `Wi-Fi: ${radios.ssid}`
          : "Wi-Fi açık, bağlı değil";
  const btState = !bluetooth
    ? ""
    : `Bluetooth ${bluetooth.disabled ? "donanımdan kapalı" : bluetooth.on ? "açık" : "kapalı"}`;

  return (
    <Tile variant="plain">
      {wifi && (
        <Radio
          kind="wifi"
          info={wifi}
          name="Wi-Fi"
          state={wifiState}
          icon={<WifiIcon bars={radios.ssid ? (radios.signal ?? 5) : 0} off={!wifi.on} />}
        />
      )}
      {bluetooth && (
        <Radio
          kind="bluetooth"
          info={bluetooth}
          name="Bluetooth"
          state={btState}
          icon={<BluetoothIcon off={!bluetooth.on} />}
        />
      )}
    </Tile>
  );
}

/**
 * Sol yarı: aç/kapat. Ok: Windows'un kendi paneli (ağ listesi / hızlı ayarlar).
 * Sağ tık: Ayarlar'daki sayfa.
 */
function Radio({
  kind,
  info,
  name,
  state,
  icon,
}: {
  kind: Kind;
  info: RadioInfo;
  name: string;
  state: string;
  icon: React.ReactNode;
}) {
  return (
    <SplitPill
      active={info.on}
      disabled={info.disabled}
      title={`${state}\nSağ tık: ${name} ayarları`}
      label={`${name} ${info.on ? "kapat" : "aç"}`}
      arrowLabel={`${name} panelini aç`}
      icon={icon}
      arrow={<ChevronIcon size={13} />}
      onToggle={() => commands.setRadio(kind, !info.on).catch(report("set_radio"))}
      onArrow={(e) => togglePopup(`radios/${kind}`, e.currentTarget)}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings(kind).catch(report("open_system_settings"));
      }}
    />
  );
}
