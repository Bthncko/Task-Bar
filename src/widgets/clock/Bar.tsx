import { useEffect, useState } from "react";
import { togglePopup } from "../../lib/popup";
import { Tile } from "../ui";
import styles from "./Bar.module.css";

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  weekday: "short",
});

// Bir sonraki dakika başına kalan süre: her saniye render etmeyiz (bölüm 6.1).
function msToNextMinute(now: Date) {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20;
}

export function ClockBar() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setTimeout(() => setNow(new Date()), msToNextMinute(now));
    return () => window.clearTimeout(id);
  }, [now]);

  return (
    <Tile
      as="button"
      variant="plain"
      className={styles.clock}
      title={now.toLocaleString("tr-TR")}
      aria-label={`${now.toLocaleString("tr-TR")} — takvimi aç`}
      onClick={(e) => togglePopup("clock", e.currentTarget)}
    >
      <span className={styles.time}>{timeFmt.format(now)}</span>
      <span className={styles.date}>{dateFmt.format(now)}</span>
    </Tile>
  );
}
