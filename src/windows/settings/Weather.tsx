import { useEffect, useState } from "react";
import type { Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { searchPlaces, type Place } from "../../widgets/weather/api";
import { Card, Row, Section, Segmented } from "./controls";
import styles from "./Settings.module.css";

const SEARCH_DELAY_MS = 350;

type WeatherSettings = Config["widgets"]["weather"];

const setWeather = (patch: Partial<WeatherSettings>) =>
  updateConfig((c) => ({
    ...c,
    widgets: { ...c.widgets, weather: { ...c.widgets.weather, ...patch } },
  }));

export function Weather({ config }: { config: Config }) {
  const weather = config.widgets.weather;
  const [query, setQuery] = useState("");
  // Sonuç hangi arama için geldiyse onunla birlikte: eski arama yeni yazılanın üstüne gelmesin.
  const [result, setResult] = useState<{ q: string; places: Place[] | null } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      searchPlaces(q)
        .then((places) => alive && setResult({ q, places }))
        .catch((e) => {
          console.error("şehir arama", e);
          if (alive) setResult({ q, places: null });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const current = result && result.q === q && q.length >= 2 ? result : null;

  const choose = (p: Place) => {
    setWeather({ lat: p.latitude, lon: p.longitude, city: p.name });
    setQuery("");
  };

  return (
    <Section title="Hava durumu">
      <Card>
        <Row
          label="Şehir"
          hint={`${weather.city} · ${weather.lat.toFixed(2)}, ${weather.lon.toFixed(2)}`}
        />
        <div className={styles.search}>
          <input
            className={styles.input}
            type="search"
            placeholder="Şehir ara…"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {q.length >= 2 && (
            <ul className={styles.results}>
              {!current && <li className={styles.resultNote}>Aranıyor…</li>}
              {current?.places === null && (
                <li className={styles.resultNote}>
                  Arama yapılamadı. İnternet bağlantını kontrol et.
                </li>
              )}
              {current?.places?.length === 0 && <li className={styles.resultNote}>Sonuç yok.</li>}
              {current?.places?.map((p) => (
                <li key={p.id}>
                  <button type="button" className={styles.result} onClick={() => choose(p)}>
                    <span>{p.name}</span>
                    <span className={styles.resultMeta}>
                      {[p.admin1, p.country].filter(Boolean).join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Row label="Birim">
          <Segmented
            label="Sıcaklık birimi"
            value={weather.unit}
            options={[
              { value: "C", label: "°C" },
              { value: "F", label: "°F" },
            ]}
            onChange={(unit) => setWeather({ unit })}
          />
        </Row>
      </Card>
      <p className={styles.footnote}>Veri ve şehir arama: Open-Meteo.com (CC BY 4.0)</p>
    </Section>
  );
}
