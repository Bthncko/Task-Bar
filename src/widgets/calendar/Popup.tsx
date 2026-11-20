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
import { useConfig } from "../../lib/store";
import { ChevronIcon, ChevronLeftIcon } from "../icons";
import { IconButton } from "../ui";
import { LinkButton, PanelHeader } from "../ui/panel";
import { eventsBetween, useIcsSources, type CalEvent } from "./ics";
import styles from "./Popup.module.css";
import { dateFnsLocale, t } from "../../lib/i18n";

// Takvim paneli (7.6): solda ay ızgarası, sağda seçilen günün etkinlikleri.
// Hafta Pazartesi başlar. Saat widget'ına tıklayınca açılır. ICS salt okunur.

const week = () => ({ weekStartsOn: 1 as const, locale: dateFnsLocale() });
const CELLS = 42; // her ay 6 satır: panel yüksekliği sabit kalsın
const NO_URLS: string[] = [];
const WHEEL_GAP_MS = 250;
const MAX_DOTS = 3;

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

/** Saat sütunu: [başlangıç, bitiş] — gün dışına taşan uç ok ile. */
function timeColumn(ev: CalEvent, day: Date): [string, string | null] {
  if (ev.allDay) return [t("Tüm gün"), null];
  const nextDay = addDays(startOfDay(day), 1);
  const startsToday = isSameDay(ev.start, day);
  const endsToday = ev.end <= nextDay;
  if (!startsToday && !endsToday) return [t("Tüm gün"), null];
  const start = startsToday ? format(ev.start, "HH:mm") : "←";
  if (ev.end <= ev.start) return [start, null];
  const end = endsToday
    ? ev.end.getTime() === nextDay.getTime()
      ? "24:00"
      : format(ev.end, "HH:mm")
    : "→";
  return [start, end];
}

export function CalendarPopup() {
  const config = useConfig();
  const urls = config?.widgets.calendar?.icsUrls ?? NO_URLS;
  const { sources, loading, failed } = useIcsSources(urls);

  const [now] = useState(() => new Date());
  const today = useMemo(() => startOfDay(now), [now]);
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(today);
  /** Son ay değişiminin yönü: ızgara o yönden kayarak gelir. */
  const [dir, setDir] = useState(0);

  const gridStart = useMemo(() => startOfWeek(month, week()), [month]);
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
  const goMonth = (delta: number) => {
    setDir(delta);
    setMonth((m) => addMonths(m, delta));
  };
  const onWheel = (e: React.WheelEvent) => {
    // Dokunmatik yüzey çok sayıda olay yollar: aralıklı tek adım.
    if (e.timeStamp - lastWheel.current < WHEEL_GAP_MS || e.deltaY === 0) return;
    lastWheel.current = e.timeStamp;
    goMonth(e.deltaY > 0 ? 1 : -1);
  };
  const goToday = () => {
    if (!isSameMonth(month, today)) setDir(month < today ? 1 : -1);
    setMonth(startOfMonth(today));
    setSelected(today);
  };
  const pick = (d: Date) => {
    setSelected(d);
    if (!isSameMonth(d, month)) {
      setDir(d < month ? -1 : 1);
      setMonth(startOfMonth(d));
    }
  };

  const isToday = isSameDay(selected, today);
  const selectedLabel = isToday
    ? t("Bugün")
    : format(selected, "d MMMM EEEE", { locale: dateFnsLocale() });

  return (
    <div className={styles.root}>
      <PanelHeader
        title={
          <span className={styles.month}>
            {format(month, "LLLL yyyy", { locale: dateFnsLocale() })}
          </span>
        }
        actions={
          <>
            {(!isSameMonth(month, today) || !isToday) && (
              <LinkButton onClick={goToday}>{t("Bugün")}</LinkButton>
            )}
            <IconButton aria-label={t("Önceki ay")} onClick={() => goMonth(-1)}>
              <ChevronLeftIcon size={16} />
            </IconButton>
            <IconButton aria-label={t("Sonraki ay")} onClick={() => goMonth(1)}>
              <ChevronIcon size={16} />
            </IconButton>
          </>
        }
      />

      <div className={styles.body}>
        <div className={styles.calendar} onWheel={onWheel}>
          <div className={styles.weekHeads}>
            {days.slice(0, 7).map((d) => (
              <span key={`h${d.getDay()}`} className={styles.weekHead}>
                {format(d, "EEEEEE", { locale: dateFnsLocale() })}
              </span>
            ))}
          </div>
          <div className={styles.gridClip}>
            <div key={dayKey(month)} className={styles.grid} data-dir={dir || undefined}>
              {days.map((d) => {
                const events = byDay.get(dayKey(d)) ?? [];
                const colors = [...new Set(events.map((e) => e.source))];
                return (
                  <button
                    key={d.getTime()}
                    type="button"
                    className={styles.cell}
                    data-outside={!isSameMonth(d, month) || undefined}
                    data-today={isSameDay(d, today) || undefined}
                    data-selected={isSameDay(d, selected) || undefined}
                    aria-label={`${format(d, "d MMMM yyyy", { locale: dateFnsLocale() })}${events.length ? t(", {n} etkinlik", { n: events.length }) : ""}`}
                    onClick={() => pick(d)}
                  >
                    <span className={styles.num}>{format(d, "d")}</span>
                    <span className={styles.dots}>
                      {colors.slice(0, MAX_DOTS).map((s) => (
                        <span key={s} className={styles.dot} style={{ background: colorOf(s) }} />
                      ))}
                      {colors.length > MAX_DOTS && (
                        <span className={styles.more}>+{colors.length - MAX_DOTS}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <section className={styles.agenda}>
          <h3 className={styles.agendaHead}>
            <span className={styles.agendaTitle}>{selectedLabel}</span>
            {dayEvents.length > 0 && (
              <span className={styles.count}>
                {dayEvents.length} {t("etkinlik")}
              </span>
            )}
          </h3>
          {urls.length === 0 ? (
            <p className={styles.note}>
              {t(
                "Takvim bağlı değil. Google Takvim'in “iCal biçiminde gizli adres”ini ayarlara ekleyince etkinlikler burada görünür.",
              )}
            </p>
          ) : dayEvents.length > 0 ? (
            <ul className={styles.list}>
              {dayEvents.map((ev) => {
                const [start, end] = timeColumn(ev, selected);
                return (
                  <li
                    key={ev.key}
                    className={styles.event}
                    data-past={(!ev.allDay && ev.end <= now) || undefined}
                    title={ev.location ? `${ev.title}\n${ev.location}` : ev.title}
                  >
                    <span className={styles.time}>
                      <span>{start}</span>
                      {end && <span className={styles.timeEnd}>{end}</span>}
                    </span>
                    <span className={styles.swatch} style={{ background: colorOf(ev.source) }} />
                    <span className={styles.text}>
                      <span className={styles.title}>{ev.title}</span>
                      {ev.location && <span className={styles.location}>{ev.location}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.note}>
              {loading
                ? t("Yükleniyor…")
                : isToday
                  ? t("Bugün etkinlik yok")
                  : t("Bu gün etkinlik yok")}
            </p>
          )}
          {failed > 0 && (
            <p className={styles.error}>
              {failed === urls.length
                ? t("Takvim yüklenemedi")
                : t("{n} takvim yüklenemedi", { n: failed })}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
