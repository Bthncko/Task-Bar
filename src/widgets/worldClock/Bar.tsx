import { useEffect, useState } from "react";
import { Tile } from "../ui";
import type { WorldClockConfig } from "./index";
import styles from "./Bar.module.css";
import { dtf, t } from "../../lib/i18n";

/** Saat dilimi biçimleyicisi (dtf önbelleklidir ve dile göre yenilenir). */
function formatter(tz: string) {
  try {
    return dtf({ hour: "2-digit", minute: "2-digit", timeZone: tz });
  } catch {
    // Geçersiz dilim (elle düzenlenmiş ayar): yerel saat.
    return dtf({ hour: "2-digit", minute: "2-digit" });
  }
}

/** Dilimin yerel saate göre farkı: "+3 sa", "−8 sa", "aynı". */
function offset(tz: string, now: Date) {
  try {
    const there = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const here = new Date(now.toLocaleString("en-US"));
    const h = Math.round(((there.getTime() - here.getTime()) / 3600_000) * 2) / 2;
    if (h === 0) return t("aynı saat");
    return t("{n} sa", { n: `${h > 0 ? "+" : "−"}${Math.abs(h)}` });
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
