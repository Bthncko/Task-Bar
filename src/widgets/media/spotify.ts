import { useCallback, useEffect, useRef, useState } from "react";
import { commands, type SpotifyPlayer } from "../../lib/ipc";

/** Panel açıkken çalma durumu bu aralıkla tazelenir. */
const PLAYER_REFRESH_MS = 10_000;
/** Şarkı değişince Spotify'ın durumu biraz geç güncellenir. */
export const SETTLE_MS = 400;

/**
 * Spotify çalma durumu (ilerleme, ses, cihaz, beğeni). `trackKey` ya da
 * `playing` değişince yeniden okunur; `refresh(delay)` eylemlerden sonra.
 */
export function useSpotifyPlayer(trackKey: string, playing: boolean) {
  const [player, setPlayer] = useState<SpotifyPlayer>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const delay = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      commands
        .spotifyPlayer()
        .then((p) => {
          if (!alive) return;
          setPlayer(p);
          setError(null);
        })
        .catch((e) => alive && setError(String(e)));
    const first = window.setTimeout(load, delay.current);
    delay.current = SETTLE_MS;
    const timer = window.setInterval(load, PLAYER_REFRESH_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [trackKey, playing, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { player, setPlayer, error, refresh };
}

/** Çalarken ilerlemeyi ölçüm anından tahmin eder (yarım saniyede bir). */
export function useProgress(player: SpotifyPlayer) {
  const [now, setNow] = useState(() => Date.now());
  const playing = !!player?.playing;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [playing]);
  if (!player) return 0;
  const elapsed = player.playing ? Math.max(0, now - player.at) : 0;
  return Math.min(player.progressMs + elapsed, player.durationMs || Infinity);
}

/** 245000 → "4:05". */
export function duration(ms: number) {
  if (!ms && ms !== 0) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Ağ isteğini sürükleme boyunca seyreltir: en çok `gap` ms'de bir, son değer
 * mutlaka gönderilir.
 */
export function useThrottled<T>(send: (v: T) => void, gap = 200) {
  const last = useRef(0);
  const timer = useRef(0);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(
    (v: T) => {
      window.clearTimeout(timer.current);
      const wait = last.current + gap - Date.now();
      if (wait <= 0) {
        last.current = Date.now();
        sendRef.current(v);
      } else {
        timer.current = window.setTimeout(() => {
          last.current = Date.now();
          sendRef.current(v);
        }, wait);
      }
    },
    [gap],
  );
}
