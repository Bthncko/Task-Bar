import { useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { tr } from "date-fns/locale";
import { useConfig } from "../../lib/store";
import { eventsBetween, useIcsSources, type CalEvent } from "./ics";
import styles from "./Popup.module.css";

// Ay görünümü (bölüm 6.4): hafta Pazartesi başlar, bugün vurgulu.
// Saat widget'ına tıklayınca açılır.

const WEEK = { weekStartsOn: 1 as const, locale: tr };
const CELLS = 42; // her ay 6 satır: panel yüksekliği sabit kalsın
const NO_URLS: string[] = [];
const WHEEL_GAP_MS = 250;

/** Abonelik başına renk (ilki vurgu rengi). */
const SOURCE_COLORS = ["var(--accent)", "#ffb86b", "#7ee0a1", "#d79bff", "#ff7a90"];
const colorOf = (source: number) => SOURCE_COLORS[source % SOURCE_COLORS.length];

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** Etkinliğin kapladığı her güne ekle (bitiş hariç; sıfır süreli olan başladığı güne). */
function groupByDay(events: CalEvent[], from: Date, to: Date) {
  const map = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const last = ev.end > ev.start ? ev.end : new Date(ev.start.getTime() + 1);
    let d = startOfDay(ev.start < from ? from : ev.start);
    while (d < last && d < to) {
      const k = dayKey(d);
      map.set(k, [...(map.get(k) ?? []), ev]);
      d = addDays(d, 1);
    }
  }
  return map;
}

function timeLabel(ev: CalEvent, day: Date) {
  if (ev.allDay) return "Tüm gün";
  const startsToday = isSameDay(ev.start, day);
  const endsToday =
    isSameDay(ev.end, day) || ev.end.getTime() === addDays(startOfDay(day), 1).getTime();
  if (startsToday && endsToday) {
    return ev.end > ev.start
      ? `${format(ev.start, "HH:mm")}–${format(ev.end, "HH:mm")}`
      : format(ev.start, "HH:mm");
  }
  if (startsToday) return `${format(ev.start, "HH:mm")}’den`;
  if (endsToday) return `${format(ev.end, "HH:mm")}’e kadar`;
  return "Tüm gün";
}

export function CalendarPopup() {
  const config = useConfig();
  const urls = config?.widgets.calendar?.icsUrls ?? NO_URLS;
  const { sources, loading, failed } = useIcsSources(urls);

  const [today] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(today);

  const gridStart = useMemo(() => startOfWeek(month, WEEK), [month]);
  const gridEnd = useMemo(() => addDays(gridStart, CELLS), [gridStart]);
  const days = useMemo(
    () => Array.from({ length: CELLS }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  );

  // `sources` yalnızca abonelikler yenilenince değişir.
  const byDay = useMemo(
    () => groupByDay(eventsBetween(sources, gridStart, gridEnd), gridStart, gridEnd),
    [sources, gridStart, gridEnd],
  );
  const dayEvents = byDay.get(dayKey(selected)) ?? [];

  const lastWheel = useRef(0);
  const goMonth = (delta: number) => setMonth((m) => addMonths(m, delta));
  const onWheel = (e: React.WheelEvent) => {
    // Dokunmatik yüzey çok sayıda olay yollar: aralıklı tek adım.
    if (e.timeStamp - lastWheel.current < WHEEL_GAP_MS || e.deltaY === 0) return;
    lastWheel.current = e.timeStamp;
    goMonth(e.deltaY > 0 ? 1 : -1);
  };
  const goToday = () => {
    setMonth(startOfMonth(today));
    setSelected(today);
  };
  const pick = (d: Date) => {
    setSelected(d);
    if (!isSameMonth(d, month)) setMonth(startOfMonth(d));
  };

  const selectedLabel = isSameDay(selected, today)
    ? "Bugün"
    : format(selected, "d MMMM EEEE", { locale: tr });

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.weekday}>{format(today, "EEEE", { locale: tr })}</span>
        <span className={styles.today}>{format(today, "d MMMM yyyy", { locale: tr })}</span>
      </header>

      <div className={styles.nav}>
        <span className={styles.month}>{format(month, "LLLL yyyy", { locale: tr })}</span>
        {!isSameMonth(month, today) && (
          <button type="button" className={styles.todayButton} onClick={goToday}>
            Bugün
          </button>
        )}
        <button
          type="button"
          className={styles.arrow}
          aria-label="Önceki ay"
          onClick={() => goMonth(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className={styles.arrow}
          aria-label="Sonraki ay"
          onClick={() => goMonth(1)}
        >
          ›
        </button>
      </div>

      <div
        className={styles.grid}
        // Tekerlekle ay değiştir.
        onWheel={onWheel}
      >
        {days.slice(0, 7).map((d) => (
          <span key={`h${d.getDay()}`} className={styles.weekHead}>
            {format(d, "EEEEEE", { locale: tr })}
          </span>
        ))}
        {days.map((d) => {
          const events = byDay.get(dayKey(d)) ?? [];
          const colors = [...new Set(events.map((e) => e.source))].slice(0, 3);
          return (
            <button
              key={d.getTime()}
              type="button"
              className={styles.cell}
              data-outside={!isSameMonth(d, month) || undefined}
              data-today={isSameDay(d, today) || undefined}
              data-selected={isSameDay(d, selected) || undefined}
              aria-label={format(d, "d MMMM yyyy", { locale: tr })}
              onClick={() => pick(d)}
            >
              <span className={styles.num}>{format(d, "d")}</span>
              <span className={styles.dots}>
                {colors.map((s) => (
                  <span key={s} className={styles.dot} style={{ background: colorOf(s) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <section className={styles.events}>
        <h3 className={styles.eventsHead}>{selectedLabel}</h3>
        {urls.length === 0 ? (
          <p className={styles.note}>
            Takvim bağlı değil. Google Takvim'in “iCal biçiminde gizli adres”ini ayarlara ekleyince
            etkinlikler burada görünür.
          </p>
        ) : dayEvents.length > 0 ? (
          <ul className={styles.list}>
            {dayEvents.map((ev) => (
              <li key={ev.key} className={styles.event}>
                <span className={styles.bar} style={{ background: colorOf(ev.source) }} />
                <span className={styles.time}>{timeLabel(ev, selected)}</span>
                <span className={styles.title} title={ev.location || ev.title}>
                  {ev.title}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>{loading ? "Yükleniyor…" : "Etkinlik yok"}</p>
        )}
        {failed > 0 && (
          <p className={styles.error}>
            {failed === urls.length ? "Takvim yüklenemedi" : `${failed} takvim yüklenemedi`}
          </p>
        )}
      </section>
    </div>
  );
}
