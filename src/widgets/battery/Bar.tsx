import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { BatteryIcon, BoltIcon } from "../icons";
import shared from "../shared.module.css";
import styles from "./Bar.module.css";

export function BatteryBar() {
  const power = useService(commands.getPower, events.power);
  // Pil yoksa (masaüstü PC) widget gizlenir.
  if (!power) return null;

  const low = power.percent <= 15 && !power.plugged;
  const state = power.charging ? "şarj oluyor" : power.plugged ? "prizde" : "pilde";

  return (
    <button
      type="button"
      className={`${shared.iconButton} ${low ? styles.low : ""}`}
      title={`Pil %${power.percent} — ${state} (sağ tık: ayarlar)`}
      aria-label={`Pil yüzde ${power.percent}, ${state}`}
      onClick={() => commands.openQuickSettings("battery").catch(report("open_quick_settings"))}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings("battery").catch(report("open_system_settings"));
      }}
    >
      <span className={styles.icon}>
        <BatteryIcon percent={power.percent} />
        {power.charging && <BoltIcon size={11} className={styles.bolt} />}
      </span>
      <span className={shared.value}>{power.percent}</span>
    </button>
  );
}
