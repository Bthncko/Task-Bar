import { useEffect, useState } from "react";
import { togglePopup } from "../../lib/popup";
import { WeatherIcon } from "../icons";
import { cachedCurrent, fetchCurrent, type CurrentWeather } from "./api";
import { describeWeather } from "./wmo";
import type { WeatherConfig } from "./index";
import { Tile, Value } from "../ui";

const REFRESH_MS = 20 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;

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
  const time = new Date(weather.fetchedAt).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const title = [
    `${city}: ${text}, ${Math.round(weather.temperature)}°${unit}`,
    stale ? `Son güncelleme ${time} (çevrimdışı)` : `Güncellendi ${time}`,
    "Veri: Open-Meteo.com (CC BY 4.0)",
  ].join("\n");

  return (
    <Tile
      as="button"
      variant="plain"
      title={title}
      aria-label={`Hava durumu: ${title}`}
      data-stale={stale || undefined}
      onClick={(e) => togglePopup("weather", e.currentTarget)}
    >
      <WeatherIcon kind={kind} night={!weather.isDay} size={20} />
      <Value dim={stale}>{Math.round(weather.temperature)}°</Value>
    </Tile>
  );
}
