import { useEffect, useState } from "react";
import { commands, report } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { Tile } from "../ui";
import type { ClockConfig } from "./index";
import styles from "./Bar.module.css";

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("tr-TR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const fullFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full", timeStyle: "short" });

/** "Sal 20 Eki": Intl sırası yerele göre değişir, parçalardan kurulur. */
function shortDate(d: Date) {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateFmt.formatToParts(d).find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}`;
}

/** Bir sonraki dakika (ya da saniye) başına kalan süre: gereğinden sık çizilmez. */
function msToNext(now: Date, seconds: boolean) {
  const ms = now.getMilliseconds();
  return (seconds ? 1000 - ms : 60_000 - (now.getSeconds() * 1000 + ms)) + 20;
}

export function ClockBar({ config }: { config: ClockConfig }) {
  const seconds = config.showSeconds;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setTimeout(() => setNow(new Date()), msToNext(now, seconds));
    return () => window.clearTimeout(id);
  }, [now, seconds]);

  const full = fullFmt.format(now);

  return (
    <Tile
      as="button"
      variant="plain"
      interactive
      className={styles.clock}
      title={`${full}\nSağ tık: bildirim merkezi`}
      aria-label={`${full} — takvimi aç`}
      onClick={(e) => togglePopup("clock", e.currentTarget)}
      // Windows alışkanlığı (8.2): saate sağ tık bildirimleri açar.
      onContextMenu={(e) => {
        e.preventDefault();
        commands.systemShortcut("notifications").catch(report("system_shortcut"));
      }}
    >
      <span className={styles.top}>
        <span className={styles.time}>{timeFmt.format(now)}</span>
        {seconds && (
          <span className={styles.seconds}>{String(now.getSeconds()).padStart(2, "0")}</span>
        )}
      </span>
      <span className={styles.date}>{shortDate(now)}</span>
    </Tile>
  );
}
