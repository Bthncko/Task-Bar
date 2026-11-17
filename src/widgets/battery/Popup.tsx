import { useEffect, useRef, useState, type CSSProperties } from "react";
import { commands, events, report, type BatterySettings, type PowerMode } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Toggle } from "../../windows/settings/controls";
import { BoltIcon, LeafIcon, MonitorIcon, MoonIcon, SunIcon } from "../icons";
import { Meter } from "../ui";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import styles from "./Popup.module.css";

const MODES: { value: PowerMode; label: string; hint: string }[] = [
  { value: "efficiency", label: "Verimlilik", hint: "En uzun pil ömrü" },
  { value: "balanced", label: "Dengeli", hint: "Varsayılan" },
  { value: "performance", label: "Performans", hint: "En hızlı, en çok tüketim" },
];

/** Pildeyken ekranı kapat / uyku seçenekleri (sn; 0 = hiçbir zaman). */
const TIMEOUTS = [60, 120, 180, 300, 600, 900, 1800, 3600, 0];

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? (m > 0 ? `${h} sa ${m} dk` : `${h} sa`) : `${m} dk`;
}

const timeoutLabel = (s: number) => (s === 0 ? "Hiçbir zaman" : duration(s));

/** Pil paneli: yüzde, enerji tasarrufu, güç modu, parlaklık, yenileme hızı, süreler. */
export function BatteryPopup() {
  const power = useService(commands.getPower, events.power);
  const close = usePopupClose();
  const [settings, setSettings] = useState<BatterySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    commands.getBatterySettings().then(setSettings).catch(report("get_battery_settings"));

  useEffect(() => {
    commands.getBatterySettings().then(setSettings).catch(report("get_battery_settings"));
  }, []);

  const run = (p: Promise<void>) => {
    setError(null);
    p.catch((e) => setError(String(e))).finally(reload);
  };

  const openSettings = (page: "battery" | "power") => {
    commands.openSystemSettings(page).catch(report("open_system_settings"));
    close();
  };

  if (!power) {
    return (
      <div className={styles.root}>
        <PanelHeader title="Pil" />
        <p className={styles.note}>Bu bilgisayarda pil yok.</p>
      </div>
    );
  }

  const status = power.charging
    ? "Şarj oluyor"
    : power.plugged
      ? "Prizde, dolu"
      : power.secondsLeft
        ? `Pilde · yaklaşık ${duration(power.secondsLeft)} kaldı`
        : "Pilde";
  const low = !power.plugged && power.percent <= 20;

  return (
    <div className={styles.root}>
      <PanelHeader
        title="Pil"
        actions={<LinkButton onClick={() => openSettings("power")}>Güç ayarları</LinkButton>}
      />

      <section className={styles.summary}>
        <div className={styles.head}>
          <span className={styles.big} data-low={low || undefined}>
            %{power.percent}
          </span>
          {power.charging && (
            <span className={styles.bolt}>
              <BoltIcon size={18} />
            </span>
          )}
          <span className={styles.status}>{status}</span>
        </div>
        <Meter value={power.percent} className={low ? styles.lowMeter : styles.meter} />
      </section>

      {/* Enerji tasarrufu: satırın tamamı tek tıkla açıp kapatır (pildeyken). */}
      <div
        className={styles.saver}
        data-on={power.saver || undefined}
        data-disabled={power.plugged || undefined}
      >
        <span className={styles.saverIcon}>
          <LeafIcon size={16} />
        </span>
        <button
          type="button"
          className={styles.saverText}
          disabled={power.plugged}
          onClick={() => run(commands.setEnergySaver(!power.saver))}
        >
          <span>Enerji tasarrufu</span>
          <span className={styles.status}>
            {power.plugged
              ? "Pildeyken açılabilir"
              : power.saver
                ? "Açık · prize takınca kapanır"
                : settings?.saverThreshold
                  ? `Kapalı · %${settings.saverThreshold}'de kendiliğinden açılır`
                  : "Kapalı"}
          </span>
        </button>
        <Toggle
          label="Enerji tasarrufu"
          checked={power.saver}
          disabled={power.plugged}
          onChange={(on) => run(commands.setEnergySaver(on))}
        />
      </div>

      {power.mode && (
        <section className={styles.section} aria-label="Güç modu">
          <h3 className={styles.title}>Güç modu</h3>
          <div className={styles.modes} role="radiogroup" aria-label="Güç modu">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={power.mode === m.value}
                className={styles.mode}
                title={m.hint}
                onClick={() => commands.setPowerMode(m.value).catch(report("set_power_mode"))}
              >
                {m.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {settings?.brightness != null && (
        <Brightness
          value={settings.brightness}
          onChange={(v) => commands.setBrightness(v).catch((e) => setError(String(e)))}
        />
      )}

      {settings?.refresh && settings.refresh.options.length > 1 && (
        <section className={styles.section} aria-label="Ekran yenileme hızı">
          <h3 className={styles.title}>
            <MonitorIcon size={14} /> Ekran yenileme hızı
          </h3>
          <div
            className={styles.modes}
            style={{ gridTemplateColumns: `repeat(${settings.refresh.options.length}, 1fr)` }}
            role="radiogroup"
            aria-label="Ekran yenileme hızı"
          >
            {settings.refresh.options.map((hz) => (
              <button
                key={hz}
                type="button"
                role="radio"
                aria-checked={settings.refresh?.current === hz}
                className={styles.mode}
                title={hz <= 60 ? "Daha az pil tüketir" : "Daha akıcı"}
                onClick={() => run(commands.setRefreshRate(hz))}
              >
                {hz} Hz
              </button>
            ))}
          </div>
        </section>
      )}

      {(settings?.screenOff != null || settings?.sleep != null) && (
        <section className={styles.section} aria-label="Pildeyken">
          <h3 className={styles.title}>
            <MoonIcon size={14} /> Pildeyken
          </h3>
          {settings.screenOff != null && (
            <TimeoutRow
              label="Ekranı kapat"
              value={settings.screenOff}
              onChange={(s) => run(commands.setPowerTimeout("screen", s))}
            />
          )}
          {settings.sleep != null && (
            <TimeoutRow
              label="Uyku"
              value={settings.sleep}
              onChange={(s) => run(commands.setPowerTimeout("sleep", s))}
            />
          )}
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <footer className={styles.footer}>
        <LinkButton onClick={() => openSettings("battery")}>
          Pil ve enerji tasarrufu ayarları
        </LinkButton>
      </footer>
    </div>
  );
}

/**
 * Parlaklık kaydırıcısı: sürüklerken yerel değer. Bir istek sürerken gelen
 * değerlerden yalnızca sonuncusu, istek bitince gönderilir (WMI çağrısı yavaş).
 */
export function Brightness({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => Promise<void>;
}) {
  const [local, setLocal] = useState<number | null>(null);
  // Dışarıdan yeni değer (ör. klavye tuşları, yeniden okuma) gelince yerel değer bırakılır.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setLocal(null);
  }
  const busy = useRef(false);
  const pending = useRef<number | null>(null);
  const shown = local ?? value;

  const send = (v: number) => {
    busy.current = true;
    onChange(v).finally(() => {
      busy.current = false;
      const next = pending.current;
      pending.current = null;
      if (next !== null) send(next);
    });
  };

  const push = (v: number) => {
    setLocal(v);
    if (busy.current) pending.current = v;
    else send(v);
  };

  return (
    <section className={styles.section} aria-label="Parlaklık">
      <h3 className={styles.title}>
        <SunIcon size={14} /> Parlaklık <span className={styles.value}>%{shown}</span>
      </h3>
      <input
        type="range"
        min={0}
        max={100}
        value={shown}
        aria-label="Parlaklık"
        className={styles.slider}
        style={{ "--fill": `${shown}%` } as CSSProperties}
        onChange={(e) => push(Number(e.currentTarget.value))}
      />
    </section>
  );
}

function TimeoutRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (seconds: number) => void;
}) {
  const options = TIMEOUTS.includes(value) ? TIMEOUTS : [...TIMEOUTS, value].sort(byTimeout);
  return (
    <label className={styles.timeout}>
      <span>{label}</span>
      <select
        value={value}
        className={styles.select}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {timeoutLabel(s)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Hiçbir zaman" (0) en sonda. */
function byTimeout(a: number, b: number) {
  return (a || Infinity) - (b || Infinity);
}
