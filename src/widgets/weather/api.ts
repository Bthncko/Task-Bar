import { t } from "../../lib/i18n";
// Open-Meteo (bölüm 6.3). Ticari olmayan kullanımda anahtarsız; sınır günde
// 10.000 istek (open-meteo.com/en/pricing). Yanıtta CORS başlığı var (denendi),
// bu yüzden istek doğrudan frontend'den.

export type WeatherParams = { lat: number; lon: number; unit: "C" | "F" };

export type CurrentWeather = {
  temperature: number;
  code: number;
  isDay: boolean;
  /** Verinin alındığı an (ms). */
  fetchedAt: number;
};

const CACHE_PREFIX = "weather:";

function cacheKey(p: WeatherParams) {
  return `${CACHE_PREFIX}${p.lat.toFixed(2)},${p.lon.toFixed(2)},${p.unit}`;
}

export async function fetchCurrent(p: WeatherParams): Promise<CurrentWeather> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(p.lat));
  url.searchParams.set("longitude", String(p.lon));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("timezone", "auto");
  if (p.unit === "F") url.searchParams.set("temperature_unit", "fahrenheit");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const c = json?.current;
  if (typeof c?.temperature_2m !== "number" || typeof c?.weather_code !== "number") {
    throw new Error(t("beklenmeyen yanıt"));
  }
  const weather: CurrentWeather = {
    temperature: c.temperature_2m,
    code: c.weather_code,
    isDay: c.is_day !== 0,
    fetchedAt: Date.now(),
  };
  writeCache(cacheKey(p), weather);
  return weather;
}

/** Son başarılı yanıt (çevrimdışıyken gösterilir). */
export function cachedCurrent(p: WeatherParams): CurrentWeather | null {
  return readCache<CurrentWeather>(cacheKey(p));
}

// --- panel: saatlik + 7 günlük (parametre adları canlı yanıtla denendi) -------------

export type HourPoint = {
  /** Yerel saat, "2026-11-16T21:00" */
  time: string;
  temperature: number;
  code: number;
  isDay: boolean;
  precip: number | null;
};

export type DayPoint = {
  /** Yerel tarih, "2026-11-16" */
  date: string;
  code: number;
  max: number;
  min: number;
  precip: number | null;
};

export type Forecast = {
  current: CurrentWeather & { apparent: number };
  hourly: HourPoint[];
  daily: DayPoint[];
};

const HOURS = 24;

const forecastKey = (p: WeatherParams) => `${cacheKey(p)}:forecast`;

export async function fetchForecast(p: WeatherParams): Promise<Forecast> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(p.lat));
  url.searchParams.set("longitude", String(p.lon));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,is_day");
  url.searchParams.set("hourly", "temperature_2m,weather_code,is_day,precipitation_probability");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
  );
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("timezone", "auto");
  if (p.unit === "F") url.searchParams.set("temperature_unit", "fahrenheit");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  const { current: c, hourly: h, daily: d } = json ?? {};
  if (typeof c?.temperature_2m !== "number" || !Array.isArray(h?.time) || !Array.isArray(d?.time)) {
    throw new Error(t("beklenmeyen yanıt"));
  }

  // Saatlik dizi günün başından başlar; şimdiki saatten itibaren 24 saat.
  const nowHour = `${String(c.time).slice(0, 13)}:00`;
  const first = Math.max(
    0,
    (h.time as string[]).findIndex((t) => t >= nowHour),
  );
  const hourly: HourPoint[] = (h.time as string[]).slice(first, first + HOURS).map((time, k) => {
    const i = first + k;
    return {
      time,
      temperature: h.temperature_2m[i],
      code: h.weather_code[i],
      isDay: h.is_day[i] !== 0,
      precip: h.precipitation_probability?.[i] ?? null,
    };
  });

  const daily: DayPoint[] = (d.time as string[]).map((date, i) => ({
    date,
    code: d.weather_code[i],
    max: d.temperature_2m_max[i],
    min: d.temperature_2m_min[i],
    precip: d.precipitation_probability_max?.[i] ?? null,
  }));

  const forecast: Forecast = {
    current: {
      temperature: c.temperature_2m,
      apparent: c.apparent_temperature,
      code: c.weather_code,
      isDay: c.is_day !== 0,
      fetchedAt: Date.now(),
    },
    hourly,
    daily,
  };
  writeCache(forecastKey(p), forecast);
  // Bar da aynı veriyle güncel kalsın.
  writeCache(cacheKey(p), forecast.current);
  return forecast;
}

export function cachedForecast(p: WeatherParams): Forecast | null {
  return readCache<Forecast>(forecastKey(p));
}

// --- şehir arama (ayarlar) — sonuç yoksa yanıtta `results` alanı hiç yok (denendi) ---

export type Place = {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
};

export async function searchPlaces(query: string): Promise<Place[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "tr");
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.results) ? (json.results as Place[]) : [];
}

// --- önbellek (yalnızca kolaylık; erişilemezse sessizce geç) -------------------

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // yazılamazsa sorun değil
  }
}
