import { commands, report } from "../../lib/ipc";
import styles from "./Bar.module.css";

/** Windows'un kendi Başlat menüsünü açar (Win tuşu simülasyonu, bölüm 5.5). */
export function StartBar() {
  return (
    <button
      type="button"
      className={styles.start}
      title="Başlat"
      aria-label="Başlat"
      data-hit
      onClick={() => commands.openStart().catch(report("open_start"))}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <rect x="1" y="1" width="8.4" height="8.4" rx="1.6" />
        <rect x="10.6" y="1" width="8.4" height="8.4" rx="1.6" />
        <rect x="1" y="10.6" width="8.4" height="8.4" rx="1.6" />
        <rect x="10.6" y="10.6" width="8.4" height="8.4" rx="1.6" />
      </svg>
    </button>
  );
}
