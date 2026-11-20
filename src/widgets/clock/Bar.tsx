import { useEffect, useState } from "react";
import { useDockVisible } from "../../lib/dockVisible";
import { commands, report } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { Tile } from "../ui";
import type { ClockConfig } from "./index";
import styles from "./Bar.module.css";
import { dtf, t } from "../../lib/i18n";

const timeFmt = () => dtf({ hour: "2-digit", minute: "2-digit" });
const dateFmt = () =>
  dtf({
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const fullFmt = () => dtf({ dateStyle: "full", timeStyle: "short" });

/** "Sal 20 Eki": Intl sırası yerele göre değişir, parçalardan kurulur. */
function shortDate(d: Date) {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dateFmt()
      .formatToParts(d)
      .find((p) => p.type === type)?.value ?? "";
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
  // Dock görünmezken (tam ekran) saat durur; görününce hemen güncellenir.
  const visible = useDockVisible();

  useEffect(() => {
    if (!visible) return;
    // Görünmezken geçen süre: beklemeden şimdiki saate atla.
    const late = Date.now() - now.getTime() > (seconds ? 1000 : 60_000);
    const id = window.setTimeout(() => setNow(new Date()), late ? 0 : msToNext(now, seconds));
    return () => window.clearTimeout(id);
  }, [now, seconds, visible]);

  const full = fullFmt().format(now);

  return (
    <Tile
      as="button"
      variant="plain"
      interactive
      className={styles.clock}
      title={t("{full}\nSağ tık: bildirim merkezi", { full })}
      aria-label={t("{full} — takvimi aç", { full })}
      onClick={(e) => togglePopup("clock", e.currentTarget)}
      // Windows alışkanlığı (8.2): saate sağ tık bildirimleri açar.
      onContextMenu={(e) => {
        e.preventDefault();
        commands.systemShortcut("notifications").catch(report("system_shortcut"));
      }}
    >
      <span className={styles.top}>
        <span className={styles.time}>{timeFmt().format(now)}</span>
        {seconds && (
          <span className={styles.seconds}>{String(now.getSeconds()).padStart(2, "0")}</span>
        )}
      </span>
      <span className={styles.date}>{shortDate(now)}</span>
    </Tile>
  );
}
