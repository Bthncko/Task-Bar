import { commands, events, report, type RadioInfo } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { BluetoothIcon, ChevronIcon, EthernetIcon, WifiIcon } from "../icons";
import { SplitPill, Tile } from "../ui";

const EMPTY = { wifi: null, bluetooth: null, ssid: null, signal: null, ethernet: false };
/** Wi-Fi bağdaştırıcısı olmayan bilgisayarda kablolu bağlantının karosu. */
const WIRED_ONLY: RadioInfo = { on: true, disabled: false };

type Kind = "wifi" | "bluetooth";

export function RadiosBar() {
  const radios = useService(commands.getRadios, events.radios) ?? EMPTY;
  const { wifi, bluetooth, ethernet } = radios;
  if (!wifi && !bluetooth && !ethernet) return null;

  const wifiState = !wifi
    ? ""
    : wifi.disabled
      ? "Wi-Fi donanımdan kapalı"
      : !wifi.on
        ? "Wi-Fi kapalı"
        : radios.ssid
          ? `Wi-Fi: ${radios.ssid}`
          : "Wi-Fi açık, bağlı değil";
  // Kablo takılıyken (internet oradan geliyor) Wi-Fi karosu kablolu bağlantıyı
  // gösterir; sol yarı yine Wi-Fi'yi açıp kapatır, ok yine ağ panelini açar.
  const wiredState = !wifi
    ? "Kablolu bağlantı (Ethernet)"
    : `Kablolu bağlantı (Ethernet)\n${wifi.on ? "Wi-Fi açık · tıkla: kapat" : "Wi-Fi kapalı · tıkla: aç"}`;
  const btState = !bluetooth
    ? ""
    : `Bluetooth ${bluetooth.disabled ? "donanımdan kapalı" : bluetooth.on ? "açık" : "kapalı"}`;

  return (
    <Tile variant="plain">
      {ethernet ? (
        <Radio
          kind="wifi"
          info={wifi ? { on: true, disabled: false } : WIRED_ONLY}
          name="Ethernet"
          settings="ethernet"
          state={wiredState}
          toggle={wifi && !wifi.disabled ? !wifi.on : null}
          icon={<EthernetIcon />}
        />
      ) : (
        wifi && (
          <Radio
            kind="wifi"
            info={wifi}
            name="Wi-Fi"
            state={wifiState}
            icon={<WifiIcon bars={radios.ssid ? (radios.signal ?? 5) : 0} off={!wifi.on} />}
          />
        )
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
  settings = kind,
  state,
  toggle = !info.on,
  icon,
}: {
  kind: Kind;
  info: RadioInfo;
  name: string;
  /** Sağ tıkla açılan Ayarlar sayfası. */
  settings?: Kind | "ethernet";
  state: string;
  /** Sol yarıya tıklayınca radyonun yeni durumu; `null`: değiştirilecek radyo yok. */
  toggle?: boolean | null;
  icon: React.ReactNode;
}) {
  const radioName = kind === "wifi" ? "Wi-Fi" : "Bluetooth";
  return (
    <SplitPill
      active={info.on}
      disabled={info.disabled}
      title={`${state}\nSağ tık: ${name} ayarları`}
      label={toggle === null ? `${name} ayarları` : `${radioName} ${toggle ? "aç" : "kapat"}`}
      arrowLabel={`${name} panelini aç`}
      icon={icon}
      arrow={<ChevronIcon size={13} />}
      onToggle={() =>
        toggle === null
          ? commands.openSystemSettings(settings).catch(report("open_system_settings"))
          : commands.setRadio(kind, toggle).catch(report("set_radio"))
      }
      onArrow={(e) => togglePopup(`radios/${kind}`, e.currentTarget)}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings(settings).catch(report("open_system_settings"));
      }}
    />
  );
}
