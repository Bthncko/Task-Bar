import { useEffect, useState } from "react";
import { WeatherIcon } from "../icons";
import { cachedForecast, fetchForecast, type Forecast } from "./api";
import { describeWeather } from "./wmo";
import type { WeatherConfig } from "./index";
import styles from "./Popup.module.css";

const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });
const clock = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

/** Yağış olasılığı bu değerin altındaysa gösterme (gürültü). */
const PRECIP_MIN = 20;

const deg = (t: number) => `${Math.round(t)}°`;

function dayLabel(date: string, index: number) {
  if (index === 0) return "Bugün";
  if (index === 1) return "Yarın";
  // "2026-11-18" → yerel gece yarısı (UTC olarak okunmasın).
  return weekday.format(new Date(`${date}T00:00`));
}

export function WeatherPopup({ config }: { config: WeatherConfig }) {
  const { lat, lon, unit, city } = config;
  const [forecast, setForecast] = useState<Forecast | null>(() =>
    cachedForecast({ lat, lon, unit }),
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Panel her açıldığında yeni veri iste; gelene kadar önbellektekini göster.
  useEffect(() => {
    let alive = true;
    fetchForecast({ lat, lon, unit })
      .then((f) => {
        if (!alive) return;
        setForecast(f);
        setFailed(false);
      })
      .catch((e) => {
        console.error("hava durumu tahmini", e);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [lat, lon, unit, attempt]);

  if (!forecast) {
    return (
      <div className={styles.empty}>
        {failed ? (
          <>
            <p>Hava durumu alınamadı. İnternet bağlantını kontrol et.</p>
            <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
              Yeniden dene
            </button>
          </>
        ) : (
          <p>Yükleniyor…</p>
        )}
      </div>
    );
  }

  const { current, hourly, daily } = forecast;
  const now = describeWeather(current.code);
  const today = daily[0];
  const weekMin = Math.min(...daily.map((d) => d.min));
  const weekMax = Math.max(...daily.map((d) => d.max));
  const span = Math.max(weekMax - weekMin, 1);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <WeatherIcon kind={now.kind} night={!current.isDay} size={44} />
        <span className={styles.temp}>{deg(current.temperature)}</span>
        <div className={styles.summary}>
          <span className={styles.city}>{city}</span>
          <span>{now.text}</span>
          <span className={styles.dim}>
            Hissedilen {deg(current.apparent)}
            {today && ` · ${deg(today.max)} / ${deg(today.min)}`}
          </span>
        </div>
      </header>

      <div
        className={styles.hours}
        // Tekerlek yatay kaydırsın.
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {hourly.map((h, i) => {
          const { text, kind } = describeWeather(h.code);
          return (
            <div key={h.time} className={styles.hour} title={text}>
              <span className={styles.dim}>{i === 0 ? "Şimdi" : h.time.slice(11, 13)}</span>
              <WeatherIcon kind={kind} night={!h.isDay} size={20} />
              <span className={styles.hourTemp}>{deg(h.temperature)}</span>
              <span className={styles.precip}>
                {h.precip !== null && h.precip >= PRECIP_MIN ? `%${h.precip}` : ""}
              </span>
            </div>
          );
        })}
      </div>

      <ul className={styles.days}>
        {daily.map((d, i) => {
          const { text, kind } = describeWeather(d.code);
          return (
            <li key={d.date} className={styles.day} title={text}>
              <span className={styles.dayName}>{dayLabel(d.date, i)}</span>
              <WeatherIcon kind={kind} night={false} size={20} />
              <span className={styles.precip}>
                {d.precip !== null && d.precip >= PRECIP_MIN ? `%${d.precip}` : ""}
              </span>
              <span className={`${styles.dim} ${styles.num}`}>{deg(d.min)}</span>
              <span className={styles.range}>
                <span
                  className={styles.rangeFill}
                  style={{
                    left: `${((d.min - weekMin) / span) * 100}%`,
                    width: `${((d.max - d.min) / span) * 100}%`,
                  }}
                />
              </span>
              <span className={styles.num}>{deg(d.max)}</span>
            </li>
          );
        })}
      </ul>

      <footer className={styles.footer}>
        <span>Veri: Open-Meteo.com</span>
        <span>
          {failed ? "Çevrimdışı · " : ""}
          {clock.format(current.fetchedAt)}
        </span>
      </footer>
    </div>
  );
}
