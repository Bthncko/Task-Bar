import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { TrashIcon } from "../icons";
import { Tile } from "../ui";
import styles from "./Bar.module.css";

function size(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Geri dönüşüm kutusu (8.8): tıkla aç, sağ tıkla boşalt (Windows onay sorar). */
export function RecycleBar() {
  const bin = useService(commands.getRecycle, events.recycle);
  const items = bin?.items ?? 0;
  const label = items === 0 ? "Boş" : `${items} öğe · ${size(bin?.bytes ?? 0)}`;

  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      className={styles.tile}
      aria-label={`Geri dönüşüm kutusu: ${label}`}
      title={`Geri dönüşüm kutusu — ${label}${items > 0 ? "\nSağ tık: boşalt" : ""}`}
      onClick={() => commands.openRecycleBin().catch(report("open_recycle_bin"))}
      onContextMenu={(e) => {
        e.preventDefault();
        if (items > 0) commands.emptyRecycleBin().catch(report("empty_recycle_bin"));
      }}
    >
      <TrashIcon size={18} />
      {items > 0 && <span className={styles.count}>{items > 999 ? "999+" : items}</span>}
    </Tile>
  );
}
