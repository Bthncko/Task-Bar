import { useEffect, useState } from "react";
import type { AiLimit, AiUsage } from "../../lib/ipc";

export type Activity = NonNullable<NonNullable<AiUsage>["activity"]>;

/** Dakikada bir yenilenen "şimdi" (kalan süre ve sıfırlanma için). */
export function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Gösterilecek yüzde: sıfırlanma anı geçtiyse (yeni değer henüz alınmadıysa)
 * pencere yenilenmiştir → 0.
 */
export function current(limit: AiLimit | null | undefined, now: number) {
  if (!limit) return null;
  const reset = limit.resetsAt !== null && limit.resetsAt <= now;
  return {
    percent: reset ? 0 : Math.round(limit.percent),
    resetsAt: reset ? null : limit.resetsAt,
    warning: !reset && limit.warning,
  };
}

/** Sıfırlanma: "22:30" (bugün), "yarın 02:10", "Cmt 05:00", "29 Kas 05:00". */
export function resetTime(at: number, now = Date.now()) {
  const d = new Date(at);
  const hm = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const day = (t: number) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  if (diff <= 0) return hm;
  if (diff === 1) return `yarın ${hm}`;
  if (diff < 7) return `${d.toLocaleDateString("tr-TR", { weekday: "short" })} ${hm}`;
  return `${d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} ${hm}`;
}

/** Kalan süre: "45 dk", "1 sa 56 dk", "4 gün 9 sa". */
export function remaining(at: number, now = Date.now()) {
  const min = Math.max(0, Math.ceil((at - now) / 60_000));
  const h = Math.floor(min / 60);
  if (h >= 24) return `${Math.floor(h / 24)} gün ${h % 24} sa`;
  return h > 0 ? `${h} sa ${min % 60} dk` : `${min} dk`;
}

/** "az önce", "3 dk önce", "2 sa önce". */
export function ago(at: number, now = Date.now()) {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  return `${Math.floor(min / 60)} sa önce`;
}

/** Son 7 günün (bugün dahil) yerel gün ağırlıkları, eskiden yeniye; `share` %. */
export function days(activity: Activity, now = Date.now()) {
  const out: { label: string; date: Date; weight: number; share: number }[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    out.push({
      label: i === 0 ? "Bugün" : date.toLocaleDateString("tr-TR", { weekday: "short" }),
      date,
      weight: 0,
      share: 0,
    });
  }
  for (const [hour, value] of activity.hourly) {
    const d = new Date(hour);
    d.setHours(0, 0, 0, 0);
    const slot = out.find((o) => o.date.getTime() === d.getTime());
    if (slot) slot.weight += value;
  }
  const total = out.reduce((s, d) => s + d.weight, 0);
  for (const d of out) d.share = total > 0 ? Math.round((d.weight / total) * 100) : 0;
  return out;
}

/** 1234567 → "1,2 M". */
export function tokens(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} Mr`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} B`;
  return String(n);
}

/** %62,5 → "%62,5"; tam sayıysa "%62". */
export function share(v: number) {
  return `%${v.toLocaleString("tr-TR", { maximumFractionDigits: v < 10 ? 1 : 0 })}`;
}
