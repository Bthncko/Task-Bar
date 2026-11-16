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
    throw new Error("beklenmeyen yanıt");
  }
  const weather: CurrentWeather = {
    temperature: c.temperature_2m,
    code: c.weather_code,
    isDay: c.is_day !== 0,
    fetchedAt: Date.now(),
  };
  try {
    localStorage.setItem(cacheKey(p), JSON.stringify(weather));
  } catch {
    // Önbellek yalnızca kolaylık; yazılamazsa sorun değil.
  }
  return weather;
}

/** Son başarılı yanıt (çevrimdışıyken gösterilir). */
export function cachedCurrent(p: WeatherParams): CurrentWeather | null {
  try {
    const raw = localStorage.getItem(cacheKey(p));
    return raw ? (JSON.parse(raw) as CurrentWeather) : null;
  } catch {
    return null;
  }
}
