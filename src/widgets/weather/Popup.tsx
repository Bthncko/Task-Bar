import { useEffect, useState } from "react";
import { commands, report } from "../../lib/ipc";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import { cachedForecast, fetchForecast, type Forecast } from "./api";
import { WeatherArt } from "./Art";
import { describeWeather } from "./wmo";
import type { WeatherConfig } from "./index";
import styles from "./Popup.module.css";
import { dtf, pct, t } from "../../lib/i18n";

const weekday = () => dtf({ weekday: "short" });
const clock = () => dtf({ hour: "2-digit", minute: "2-digit" });

/** Yağış olasılığı bu değerin altındaysa gösterme (gürültü). */
const PRECIP_MIN = 20;

const deg = (t: number) => `${Math.round(t)}°`;

function dayLabel(date: string, index: number) {
  if (index === 0) return t("Bugün");
  if (index === 1) return t("Yarın");
  // "2026-11-18" → yerel gece yarısı (UTC olarak okunmasın).
  return weekday().format(new Date(`${date}T00:00`));
}

export function WeatherPopup({ config }: { config: WeatherConfig }) {
  const { lat, lon, unit, city } = config;
  const close = usePopupClose();
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

  const header = (
    <PanelHeader
      title={city}
      actions={
        <LinkButton
          onClick={() => {
            commands.openSettings("weather").catch(report("open_settings"));
            close();
          }}
        >
          {t("Değiştir")}
        </LinkButton>
      }
    />
  );

  if (!forecast) {
    return (
      <div className={styles.root}>
        {header}
        <div className={styles.empty}>
          {failed ? (
            <>
              <p>{t("Hava durumu alınamadı. İnternet bağlantını kontrol et.")}</p>
              <button
                type="button"
                className={styles.retry}
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("Yeniden dene")}
              </button>
            </>
          ) : (
            <p>{t("Yükleniyor…")}</p>
          )}
        </div>
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
      {header}

      <section className={styles.now}>
        <div className={styles.nowRow}>
          <WeatherArt kind={now.kind} night={!current.isDay} size={56} />
          <span className={styles.temp}>{deg(current.temperature)}</span>
          <span className={styles.feels}>
            {t("Hissedilen")} {deg(current.apparent)}
          </span>
        </div>
        <p className={styles.nowText}>
          {now.text}
          {today && (
            <span className={styles.dim}>
              {" "}
              · {t("Y")} {deg(today.max)} {t("D")} {deg(today.min)}
            </span>
          )}
        </p>
      </section>

      <div
        className={styles.hours}
        // Tekerlek yatay kaydırsın.
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {hourly.map((h, i) => {
          const { text, kind } = describeWeather(h.code);
          const precip = h.precip !== null && h.precip >= PRECIP_MIN ? pct(h.precip) : "";
          return (
            <div key={h.time} className={styles.hour} title={text} data-now={i === 0 || undefined}>
              <span className={styles.hourLabel}>
                {i === 0 ? t("Şimdi") : h.time.slice(11, 13)}
              </span>
              <WeatherArt kind={kind} night={!h.isDay} size={24} />
              <span className={styles.hourTemp}>{deg(h.temperature)}</span>
              <span className={styles.precip}>{precip}</span>
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
              <WeatherArt kind={kind} night={false} size={22} />
              <span className={styles.precip}>
                {d.precip !== null && d.precip >= PRECIP_MIN ? pct(d.precip) : ""}
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
              <span className={`${styles.num} ${styles.high}`}>{deg(d.max)}</span>
            </li>
          );
        })}
      </ul>

      <footer className={styles.footer}>
        <span>{t("Veri: Open-Meteo.com")}</span>
        <span>
          {failed ? t("Çevrimdışı · ") : ""}
          {clock().format(current.fetchedAt)}
        </span>
      </footer>
    </div>
  );
}
