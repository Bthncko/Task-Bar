import { useState, type CSSProperties } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { BoltIcon, LeafIcon } from "../icons";
import { Tile } from "../ui";
import styles from "./Bar.module.css";

/** Sıvının üst kenarı: iki tam dalga; genişliğin yarısı kadar kayınca başa döner. */
const WAVE = "M0 3 Q5 0 10 3 T20 3 T30 3 T40 3 V6 H0 Z";

/** Prize her takılışta artan sayaç: parıltı animasyonunu yeniden başlatır. */
function usePlugPulse(plugged: boolean | undefined) {
  const [state, setState] = useState({ plugged, pulse: 0 });
  if (plugged !== state.plugged) {
    // İlk ölçümde (undefined → değer) parıltı yok; yalnızca gerçek takma anı.
    const pulse = state.plugged === false && plugged ? state.pulse + 1 : state.pulse;
    setState({ plugged, pulse });
  }
  return state.pulse;
}

export function BatteryBar() {
  const power = useService(commands.getPower, events.power);
  const pulse = usePlugPulse(power?.plugged);
  // Pil yoksa (masaüstü PC) widget gizlenir.
  if (!power) return null;

  const pct = Math.min(Math.max(power.percent, 0), 100);
  // Öncelik: prizde (yeşil) > kritik ≤%10 (kırmızı) > tasarruf (sarı) > <%30 (turuncu).
  const level = power.plugged
    ? "plugged"
    : pct <= 10
      ? "danger"
      : power.saver
        ? "saver"
        : pct < 30
          ? "low"
          : "ok";
  const state = [
    power.charging
      ? "şarj oluyor"
      : power.plugged
        ? pct >= 100
          ? "prizde, dolu"
          : "prizde"
        : "pilde",
    power.saver && "enerji tasarrufu açık",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Tile
      as="button"
      variant="soft"
      className={styles.battery}
      data-level={level}
      data-charging={power.charging || undefined}
      style={{ "--level": `${pct}%` } as CSSProperties}
      title={`Pil %${power.percent} — ${state}\nSağ tık: pil ayarları`}
      aria-label={`Pil yüzde ${power.percent}, ${state}`}
      onClick={() => commands.openQuickSettings("battery").catch(report("open_quick_settings"))}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings("battery").catch(report("open_system_settings"));
      }}
    >
      <span className={styles.liquid} aria-hidden>
        <svg className={styles.wave} viewBox="0 0 40 6" preserveAspectRatio="none">
          <path d={WAVE} />
        </svg>
      </span>
      {pulse > 0 && <span key={pulse} className={styles.shine} aria-hidden />}
      {/* Sayı iki kat: sıvının üstünde açık, içinde koyu (kırpılarak). */}
      <span className={styles.number} aria-hidden>
        {pct}
      </span>
      <span className={`${styles.number} ${styles.inLiquid}`} aria-hidden>
        {pct}
      </span>
      {power.plugged ? (
        <BoltIcon key={pulse} size={10} className={styles.badge} />
      ) : (
        power.saver && <LeafIcon size={10} className={styles.badge} />
      )}
    </Tile>
  );
}
