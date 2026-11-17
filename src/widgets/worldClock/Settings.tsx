import { useState } from "react";
import type { WorldCity } from "../../lib/ipc";
import { Card, Row } from "../../windows/settings/controls";
import settings from "../../windows/settings/Settings.module.css";
import type { WorldClockConfig } from "./index";
import styles from "./Settings.module.css";

/** Seçilebilir şehirler (IANA saat dilimleri). */
const CITIES: WorldCity[] = [
  { label: "İstanbul", tz: "Europe/Istanbul" },
  { label: "Londra", tz: "Europe/London" },
  { label: "Paris", tz: "Europe/Paris" },
  { label: "Berlin", tz: "Europe/Berlin" },
  { label: "Amsterdam", tz: "Europe/Amsterdam" },
  { label: "Moskova", tz: "Europe/Moscow" },
  { label: "Dubai", tz: "Asia/Dubai" },
  { label: "Bakü", tz: "Asia/Baku" },
  { label: "Delhi", tz: "Asia/Kolkata" },
  { label: "Singapur", tz: "Asia/Singapore" },
  { label: "Şangay", tz: "Asia/Shanghai" },
  { label: "Seul", tz: "Asia/Seoul" },
  { label: "Tokyo", tz: "Asia/Tokyo" },
  { label: "Sidney", tz: "Australia/Sydney" },
  { label: "Auckland", tz: "Pacific/Auckland" },
  { label: "New York", tz: "America/New_York" },
  { label: "Toronto", tz: "America/Toronto" },
  { label: "Chicago", tz: "America/Chicago" },
  { label: "Denver", tz: "America/Denver" },
  { label: "Los Angeles", tz: "America/Los_Angeles" },
  { label: "Meksiko", tz: "America/Mexico_City" },
  { label: "São Paulo", tz: "America/Sao_Paulo" },
  { label: "UTC", tz: "UTC" },
];

/** Ayarlar → Widget'lar: şehir ekle / çıkar. */
export function WorldClockSettings({
  config,
  onChange,
}: {
  config: WorldClockConfig;
  onChange(c: WorldClockConfig): void;
}) {
  const cities = config.cities ?? [];
  const available = CITIES.filter((c) => !cities.some((x) => x.tz === c.tz));
  const [pick, setPick] = useState("");

  return (
    <Card>
      <Row label="Şehirler" hint="Çubukta soldan sağa bu sırayla görünür.">
        <div className={styles.list}>
          {cities.map((c) => (
            <span key={c.tz} className={styles.chip}>
              {c.label}
              <button
                type="button"
                aria-label={`${c.label} kaldır`}
                onClick={() => onChange({ cities: cities.filter((x) => x.tz !== c.tz) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Row>
      <Row label="Şehir ekle">
        <div className={styles.add}>
          <select
            className={settings.input}
            value={pick}
            aria-label="Eklenecek şehir"
            onChange={(e) => setPick(e.currentTarget.value)}
          >
            <option value="">Seç…</option>
            {available.map((c) => (
              <option key={c.tz} value={c.tz}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={settings.button}
            disabled={!pick || cities.length >= 4}
            onClick={() => {
              const city = CITIES.find((c) => c.tz === pick);
              if (city) onChange({ cities: [...cities, city] });
              setPick("");
            }}
          >
            Ekle
          </button>
        </div>
      </Row>
    </Card>
  );
}
