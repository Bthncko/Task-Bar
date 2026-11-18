import { useEffect, useRef, useState, type CSSProperties } from "react";
import { commands, events, report, type PowerState } from "../../lib/ipc";
import { useDockVisible } from "../../lib/dockVisible";
import { useReducedMotion } from "../../lib/motion";
import { togglePopup } from "../../lib/popup";
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

/**
 * Dalga zamanlayıcıyla kare kare kaydırılır (8.0). CSS `steps()` animasyonu
 * görüntüyü saniyede 8 kez değiştirse de tarayıcı onu her karede (60/sn)
 * işliyordu: boşta tek çekirdeğin ~%12'si. Zamanlayıcıyla yalnızca adım
 * anlarında çizilir: ~%2. Hız: şarjda hızlı, prizde orta, pilde yavaş.
 */
function useWave(power: PowerState | undefined) {
  const ref = useRef<SVGSVGElement>(null);
  const reduced = useReducedMotion();
  // Dock görünmezken (tam ekran) dalga durur; dönünce kaldığı yerden sürer.
  const visible = useDockVisible();
  const step = useRef(0);
  // [tur süresi ms, adım sayısı]: saniyede 15, 8, 8 adım.
  const [period, steps] = power?.charging ? [1600, 24] : power?.plugged ? [3000, 24] : [5000, 40];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.style.transform = "";
      return;
    }
    if (!visible) return;
    let i = step.current % steps;
    const id = window.setInterval(() => {
      i = (i + 1) % steps;
      step.current = i;
      // İki kat genişlikteki dalga yarısı kadar kayınca başa döner.
      el.style.transform = `translateX(${(-50 * i) / steps}%)`;
    }, period / steps);
    return () => window.clearInterval(id);
  }, [reduced, visible, period, steps, !power]); // eslint-disable-line react-hooks/exhaustive-deps

  return ref;
}

export function BatteryBar() {
  const power = useService(commands.getPower, events.power);
  const pulse = usePlugPulse(power?.plugged);
  const wave = useWave(power);
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
      onClick={(e) => togglePopup("battery", e.currentTarget)}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings("battery").catch(report("open_system_settings"));
      }}
    >
      <span className={styles.liquid} aria-hidden>
        <svg ref={wave} className={styles.wave} viewBox="0 0 40 6" preserveAspectRatio="none">
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
