import { useEffect, useState } from "react";
import type { TimerState } from "../../lib/ipc";

/** Kalan süreyi gösterirken saniyede birkaç kez yenile (yalnızca çalışırken). */
const TICK_MS = 250;

/** Çalışırken düzenli yenilenen "şimdi" (ms). */
export function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);
  return now;
}

/** Kalan süre (ms); bitiş anı ile şimdi arasından, kurulan süreyi aşmadan. */
export function remainingMs(t: TimerState, now: number) {
  if (t.endsAt === null) return t.remainingMs;
  return Math.min(Math.max(0, t.endsAt - now), t.total * 1000);
}

/** 1500000 → "25:00"; bir saatten uzunsa "1:05:00". */
export function format(ms: number) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Boşta: hiç kurulmadı ya da sıfırlandı (çalışmıyor, bitmedi, hiç ilerlemedi). */
export function idle(t: TimerState) {
  return t.total === 0 || (t.endsAt === null && !t.finished && t.remainingMs >= t.total * 1000);
}
