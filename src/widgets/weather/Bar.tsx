import { useEffect, useState } from "react";
import { togglePopup } from "../../lib/popup";
import { hexToRgb, readableTint, rgbCss } from "../../lib/color";
import type { WeatherKind } from "../icons";
import { cachedCurrent, fetchCurrent, type CurrentWeather } from "./api";
import { WeatherArt } from "./Art";
import { describeWeather } from "./wmo";
import type { WeatherConfig } from "./index";
import { Tile } from "../ui";
import styles from "./Bar.module.css";

const REFRESH_MS = 20 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;

/** Karo rengi: [gündüz, gece] (PLAN-ASAMA-7 7.5). */
const COLORS: Record<WeatherKind, [string, string]> = {
  clear: ["#3b9eff", "#27408b"],
  partly: ["#3b9eff", "#27408b"],
  cloud: ["#6f7f95", "#3a4354"],
  fog: ["#6f7f95", "#3a4354"],
  drizzle: ["#4a6fa5", "#2c3e63"],
  rain: ["#4a6fa5", "#2c3e63"],
  snow: ["#8fb4d9", "#4a5f7d"],
  thunder: ["#4b4a7a", "#2b2a4a"],
};

/** Plandaki renkler, beyaz yazı 4.5:1 okunacak kadar koyulaştırılmış hâliyle. */
const tileColor = (kind: WeatherKind, day: boolean) =>
  rgbCss(readableTint(hexToRgb(COLORS[kind][day ? 0 : 1])));

export function WeatherBar({ config }: { config: WeatherConfig }) {
  const { lat, lon, unit, city } = config;
  const [weather, setWeather] = useState<CurrentWeather | null>(() =>
    cachedCurrent({ lat, lon, unit }),
  );
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const params = { lat, lon, unit };

    const load = async () => {
      try {
        const w = await fetchCurrent(params);
        if (!alive) return;
        setWeather(w);
        setStale(false);
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (e) {
        console.error("hava durumu", e);
        if (!alive) return;
        // Çevrimdışı: eski veriyi göstermeye devam et, kısa süre sonra yeniden dene.
        setStale(true);
        timer = window.setTimeout(load, RETRY_MS);
      }
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [lat, lon, unit]);

  if (!weather) return null;

  const { text, kind } = describeWeather(weather.code);
  const degrees = Math.round(weather.temperature);
  const time = new Date(weather.fetchedAt).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const title = [
    `${city}: ${text}, ${degrees}°${unit}`,
    stale ? `Son güncelleme ${time} (çevrimdışı)` : `Güncellendi ${time}`,
    "Veri: Open-Meteo.com (CC BY 4.0)",
  ].join("\n");

  return (
    <Tile
      as="button"
      variant="tinted"
      color={tileColor(kind, weather.isDay)}
      className={styles.tile}
      title={title}
      aria-label={`Hava durumu: ${title}`}
      data-stale={stale || undefined}
      onClick={(e) => togglePopup("weather", e.currentTarget)}
    >
      <span className={styles.text}>
        <span className={styles.state}>{text}</span>
        <span className={styles.city}>{city}</span>
      </span>
      <span className={styles.degrees}>{degrees}°</span>
      <WeatherArt kind={kind} night={!weather.isDay} size={34} className={styles.art} />
    </Tile>
  );
}
