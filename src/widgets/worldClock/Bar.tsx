import { useEffect, useState } from "react";
import { Tile } from "../ui";
import type { WorldClockConfig } from "./index";
import styles from "./Bar.module.css";

/** Saat dilimi biçimleyicileri (oluşturmak pahalı): dilim başına bir kez. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    } catch {
      // Geçersiz dilim (elle düzenlenmiş ayar): yerel saat.
      f = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
    }
    formatters.set(tz, f);
  }
  return f;
}

/** Dilimin yerel saate göre farkı: "+3 sa", "−8 sa", "aynı". */
function offset(tz: string, now: Date) {
  try {
    const there = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const here = new Date(now.toLocaleString("en-US"));
    const h = Math.round(((there.getTime() - here.getTime()) / 3600_000) * 2) / 2;
    if (h === 0) return "aynı saat";
    return `${h > 0 ? "+" : "−"}${Math.abs(h)} sa`;
  } catch {
    return "";
  }
}

/** Dünya saati (8.8): yalnızca sayfada, `Intl` saat dilimleriyle. */
export function WorldClockBar({ config }: { config: WorldClockConfig }) {
  const cities = config.cities ?? [];
  const [now, setNow] = useState(() => new Date());

  // Dakika başında yenile.
  useEffect(() => {
    const wait = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20;
    const id = window.setTimeout(() => setNow(new Date()), wait);
    return () => window.clearTimeout(id);
  }, [now]);

  if (cities.length === 0) return null;
  return (
    <Tile
      variant="soft"
      className={styles.tile}
      title={cities
        .map((c) => `${c.label}: ${formatter(c.tz).format(now)} (${offset(c.tz, now)})`)
        .join("\n")}
    >
      {cities.map((c) => (
        <span key={`${c.label}-${c.tz}`} className={styles.city}>
          <span className={styles.label}>{c.label}</span>
          <span className={styles.time}>{formatter(c.tz).format(now)}</span>
        </span>
      ))}
    </Tile>
  );
}
