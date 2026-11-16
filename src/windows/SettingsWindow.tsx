import { useEffect, useState, type FC } from "react";
import type { Config } from "../lib/ipc";
import { startConfigSync, useConfig } from "../lib/store";
import { applyTheme } from "../lib/theme";
import { Appearance } from "./settings/Appearance";
import { Apps } from "./settings/Apps";
import { Calendar } from "./settings/Calendar";
import { General } from "./settings/General";
import { Weather } from "./settings/Weather";
import { Widgets } from "./settings/Widgets";
import styles from "./settings/Settings.module.css";

startConfigSync();

const PAGES: { id: string; label: string; Page: FC<{ config: Config }> }[] = [
  { id: "appearance", label: "Görünüm", Page: Appearance },
  { id: "widgets", label: "Widget'lar", Page: Widgets },
  { id: "apps", label: "Uygulamalar", Page: Apps },
  { id: "weather", label: "Hava durumu", Page: Weather },
  { id: "calendar", label: "Takvim", Page: Calendar },
  { id: "general", label: "Genel", Page: General },
];

/** Ayarlar penceresi (Aşama 6). Her değişiklik `set_config` ile hemen kaydedilir. */
export function SettingsWindow() {
  const config = useConfig();
  const [active, setActive] = useState(PAGES[0].id);

  useEffect(() => {
    if (config) applyTheme(config.theme);
  }, [config?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const { Page } = PAGES.find((p) => p.id === active) ?? PAGES[0];

  return (
    <div className={styles.root}>
      <nav className={styles.nav} aria-label="Ayar bölümleri">
        <h1 className={styles.appTitle}>Akıllı Dock</h1>
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.navItem}
            aria-current={p.id === active ? "page" : undefined}
            onClick={() => setActive(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <main className={styles.main}>{config ? <Page config={config} /> : null}</main>
    </div>
  );
}
