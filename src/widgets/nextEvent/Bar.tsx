import { useEffect, useMemo, useState } from "react";
import { togglePopup } from "../../lib/popup";
import { useConfig } from "../../lib/store";
import { eventsBetween, useIcsSources } from "../calendar/ics";
import { CalendarIcon } from "../icons";
import { Tile } from "../ui";
import styles from "./Bar.module.css";

const NO_URLS: string[] = [];
/** Bu kadar kala karo vurgu rengine döner. */
const SOON_MIN = 10;
/** Kalan süre yazısı dakikada bir değişir. */
const TICK_MS = 30_000;
const LOOKAHEAD_DAYS = 7;

const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function inMinutes(min: number) {
  if (min < 60) return `${Math.max(1, min)} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

/** "12 dk sonra", "14:30", "yarın 09:00", "Cum 10:00". */
function when(start: Date, now: Date) {
  const min = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (min < 60) return `${inMinutes(min)} sonra`;
  if (sameDay(start, now)) return timeFmt.format(start);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(start, tomorrow)) return `yarın ${timeFmt.format(start)}`;
  return `${dayFmt.format(start)} ${timeFmt.format(start)}`;
}

/** Sıradaki etkinlik (8.8): saat widget'ının takvim abonelikleri (ICS) okunur. */
export function NextEventBar() {
  const config = useConfig();
  const urls = config?.widgets.calendar?.icsUrls ?? NO_URLS;
  const { sources } = useIcsSources(urls);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Dakikada bir yeniden hesapla (tekrarlı etkinlikleri açmak pahalı olabilir).
  const minute = Math.floor(now.getTime() / 60_000);
  const next = useMemo(() => {
    const at = new Date(minute * 60_000);
    const from = new Date(at.getTime() - 24 * 3600_000);
    const to = new Date(at.getTime() + LOOKAHEAD_DAYS * 24 * 3600_000);
    return eventsBetween(sources, from, to).find((e) => !e.allDay && e.end > at) ?? null;
  }, [sources, minute]);

  if (!next) return null;
  const ongoing = next.start <= now;
  const toStart = Math.round((next.start.getTime() - now.getTime()) / 60_000);
  const soon = !ongoing && toStart <= SOON_MIN;
  const status = ongoing
    ? `${inMinutes(Math.round((next.end.getTime() - now.getTime()) / 60_000))} kaldı`
    : when(next.start, now);

  return (
    <Tile
      as="button"
      variant={soon ? "solid" : "soft"}
      interactive
      className={styles.tile}
      data-ongoing={ongoing || undefined}
      data-soon={soon || undefined}
      title={`${next.title}\n${timeFmt.format(next.start)}–${timeFmt.format(next.end)}${
        next.location ? ` · ${next.location}` : ""
      }`}
      aria-label={`Sıradaki etkinlik: ${next.title}, ${status}`}
      onClick={(e) => togglePopup("clock", e.currentTarget)}
    >
      <CalendarIcon size={16} />
      <span className={styles.title}>{next.title || "Etkinlik"}</span>
      <span className={styles.status}>{status}</span>
    </Tile>
  );
}
