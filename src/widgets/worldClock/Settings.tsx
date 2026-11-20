import { useState } from "react";
import type { WorldCity } from "../../lib/ipc";
import { Card, Row } from "../../windows/settings/controls";
import settings from "../../windows/settings/Settings.module.css";
import type { WorldClockConfig } from "./index";
import styles from "./Settings.module.css";
import { t } from "../../lib/i18n";

/** Seçilebilir şehirler (IANA saat dilimleri). */
const CITIES: WorldCity[] = [
  {
    get label() {
      return t("İstanbul");
    },
    tz: "Europe/Istanbul",
  },
  {
    get label() {
      return t("Londra");
    },
    tz: "Europe/London",
  },
  { label: "Paris", tz: "Europe/Paris" },
  { label: "Berlin", tz: "Europe/Berlin" },
  { label: "Amsterdam", tz: "Europe/Amsterdam" },
  {
    get label() {
      return t("Moskova");
    },
    tz: "Europe/Moscow",
  },
  { label: "Dubai", tz: "Asia/Dubai" },
  {
    get label() {
      return t("Bakü");
    },
    tz: "Asia/Baku",
  },
  { label: "Delhi", tz: "Asia/Kolkata" },
  {
    get label() {
      return t("Singapur");
    },
    tz: "Asia/Singapore",
  },
  {
    get label() {
      return t("Şangay");
    },
    tz: "Asia/Shanghai",
  },
  {
    get label() {
      return t("Seul");
    },
    tz: "Asia/Seoul",
  },
  { label: "Tokyo", tz: "Asia/Tokyo" },
  {
    get label() {
      return t("Sidney");
    },
    tz: "Australia/Sydney",
  },
  { label: "Auckland", tz: "Pacific/Auckland" },
  { label: "New York", tz: "America/New_York" },
  { label: "Toronto", tz: "America/Toronto" },
  { label: "Chicago", tz: "America/Chicago" },
  { label: "Denver", tz: "America/Denver" },
  { label: "Los Angeles", tz: "America/Los_Angeles" },
  {
    get label() {
      return t("Meksiko");
    },
    tz: "America/Mexico_City",
  },
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
      <Row label={t("Şehirler")} hint={t("Çubukta soldan sağa bu sırayla görünür.")}>
        <div className={styles.list}>
          {cities.map((c) => (
            <span key={c.tz} className={styles.chip}>
              {c.label}
              <button
                type="button"
                aria-label={t("{label} kaldır", { label: c.label })}
                onClick={() => onChange({ cities: cities.filter((x) => x.tz !== c.tz) })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Row>
      <Row label={t("Şehir ekle")}>
        <div className={styles.add}>
          <select
            className={settings.input}
            value={pick}
            aria-label={t("Eklenecek şehir")}
            onChange={(e) => setPick(e.currentTarget.value)}
          >
            <option value="">{t("Seç…")}</option>
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
            {t("Ekle")}
          </button>
        </div>
      </Row>
    </Card>
  );
}
