import { useEffect, useMemo, useState } from "react";
import ICAL from "ical.js";
import { commands } from "../../lib/ipc";
import { t } from "../../lib/i18n";

// ICS aboneliği (bölüm 6.4). İndirme Rust'ta (Google'ın yanıtında CORS yok),
// ayrıştırma burada `ical.js` ile.
//
// Doğrulananlar (ical.js 2.2.1 kaynağı ve tipleri):
// - Tekrar: `RecurExpansion` RRULE + RDATE + EXDATE'i birlikte açıyor.
// - Tek tekrarı değiştiren RECURRENCE-ID istisnaları `getOccurrenceDetails` ile geliyor.
// - Dikkat: istisnaları kendiliğinden bağlarken UID'ye bakmıyor (strictExceptions
//   kapalı); bu yüzden UID'ye göre kendimiz gruplayıp veriyoruz.
// - Saat dilimleri hazır kayıtlı gelmiyor; dosyadaki VTIMEZONE'ları kaydediyoruz.
//
// Adresler gizlidir: günlüğe yazılmaz.

type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalTime = InstanceType<typeof ICAL.Time>;

export type CalEvent = {
  key: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  /** Hangi abonelikten (renk için). */
  source: number;
};

type Source = { events: IcalEvent[] };

const REFRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
/** Çok eski, sonsuz tekrarlı etkinliklerde döngüyü sınırla. */
const MAX_OCCURRENCES = 20_000;

type Entry = { at: number; source: Source | null; error: boolean };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();

export function parse(text: string): Source {
  const jcal = ICAL.parse(text);
  // Tek takvim → bileşen; birden çok → bileşen dizisi.
  const list: unknown[] = Array.isArray(jcal[0]) ? jcal : [jcal];
  const roots = list.map(
    (j) => new ICAL.Component(j as ConstructorParameters<typeof ICAL.Component>[0]),
  );

  const masters: IcalComponent[] = [];
  const exceptions = new Map<string, IcalComponent[]>();
  for (const root of roots) {
    for (const tz of root.getAllSubcomponents("vtimezone")) {
      const tzid = tz.getFirstPropertyValue("tzid");
      if (typeof tzid === "string" && !ICAL.TimezoneService.has(tzid)) {
        ICAL.TimezoneService.register(tz);
      }
    }
    for (const v of root.getAllSubcomponents("vevent")) {
      if (v.hasProperty("recurrence-id")) {
        const uid = String(v.getFirstPropertyValue("uid"));
        exceptions.set(uid, [...(exceptions.get(uid) ?? []), v]);
      } else {
        masters.push(v);
      }
    }
  }

  return {
    events: masters.map(
      (v) =>
        new ICAL.Event(v, {
          strictExceptions: true,
          exceptions: exceptions.get(String(v.getFirstPropertyValue("uid"))) ?? [],
        }),
    ),
  };
}

function load(url: string): Promise<void> {
  const running = inflight.get(url);
  if (running) return running;
  const job = commands
    .fetchIcs(url)
    .then((text) => {
      cache.set(url, { at: Date.now(), source: parse(text), error: false });
    })
    .catch((e) => {
      console.error(t("takvim yüklenemedi:"), String(e));
      // Eski veriyi koru; kısa süre sonra yeniden dene.
      cache.set(url, {
        at: Date.now() - REFRESH_MS + RETRY_MS,
        source: cache.get(url)?.source ?? null,
        error: true,
      });
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, job);
  return job;
}

/** Abonelikleri getirir; panel her açıldığında eskiyse (15 dk) yeniler. */
export function useIcsSources(urls: string[]) {
  const key = urls.join("\n");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    const stale = list.filter((u) => {
      const e = cache.get(u);
      return !e || Date.now() - e.at > REFRESH_MS;
    });
    if (stale.length === 0) return;
    let alive = true;
    Promise.all(stale.map(load)).then(() => {
      if (alive) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return useMemo(() => {
    const entries = (key ? key.split("\n") : []).map((u) => cache.get(u));
    return {
      sources: entries.map((e) => e?.source ?? null),
      loading: entries.some((e) => !e),
      failed: entries.filter((e) => e?.error).length,
    };
    // `version` yenileme sonrası yeni nesne üretmek için.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

/** [from, to) aralığına düşen tüm etkinlikler (tekrarlar açılmış), başlangıca göre sıralı. */
export function eventsBetween(sources: (Source | null)[], from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  sources.forEach((src, i) => {
    for (const ev of src?.events ?? []) expand(ev, from, to, i, out);
  });
  return out.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay),
  );
}

function expand(ev: IcalEvent, from: Date, to: Date, source: number, out: CalEvent[]) {
  try {
    if (!ev.isRecurring()) {
      add(ev, ev.startDate, ev.endDate, from, to, source, out);
      return;
    }
    const it = ev.iterator();
    for (let n = 0; n < MAX_OCCURRENCES; n++) {
      const next = it.next();
      if (!next || next.toJSDate() >= to) break;
      const d = ev.getOccurrenceDetails(next);
      add(d.item, d.startDate, d.endDate, from, to, source, out);
    }
  } catch (e) {
    // Bozuk tek etkinlik tüm takvimi düşürmesin.
    console.warn(t("etkinlik atlandı"), e);
  }
}

function add(
  item: IcalEvent,
  startTime: IcalTime,
  endTime: IcalTime | null,
  from: Date,
  to: Date,
  source: number,
  out: CalEvent[],
) {
  if (item.component.getFirstPropertyValue("status") === "CANCELLED") return;
  const start = startTime.toJSDate();
  const end = endTime ? endTime.toJSDate() : start;
  if (start >= to || (end <= from && start < from)) return;
  out.push({
    key: `${source}:${item.uid}:${start.getTime()}`,
    title: item.summary || t("(Başlıksız)"),
    start,
    end,
    allDay: startTime.isDate,
    location: item.location || "",
    source,
  });
}
