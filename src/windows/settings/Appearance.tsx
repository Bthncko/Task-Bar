import type { Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { Card, Row, Section, Slider } from "./controls";
import styles from "./Settings.module.css";

type Theme = Config["theme"];

// src-tauri/src/config.rs → Theme::default ve tokens.css ile aynı.
const DEFAULT_THEME: Theme = { accent: "#3b9eff", opacity: 0.55, radius: 16 };

const SWATCHES = [
  "#3b9eff",
  "#6aa8ff",
  "#8b7cff",
  "#ff7ab6",
  "#ff8f5a",
  "#f5c451",
  "#5fd38d",
  "#4fd1c5",
  "#e6e6e6",
];

/** Kaydırıcılar diske her harekette yazmasın; dock yine de akıcı güncellenir. */
const DRAG_DELAY_MS = 120;

const setTheme = (patch: Partial<Theme>, delay = 0) =>
  updateConfig((c) => ({ ...c, theme: { ...c.theme, ...patch } }), delay);

export function Appearance({ config }: { config: Config }) {
  const { theme } = config;
  const accent = theme.accent.toLowerCase();

  return (
    <Section title="Görünüm" intro="Değişiklikler dock'ta hemen görünür.">
      <Card>
        <Row label="Vurgu rengi" hint="Takvimde bugün, seçili öğeler, kaydırıcılar.">
          <div className={styles.swatches}>
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ background: color }}
                aria-label={color}
                aria-pressed={accent === color}
                onClick={() => setTheme({ accent: color })}
              />
            ))}
            <label className={styles.customColor} title="Başka bir renk">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/.test(accent) ? accent : "#6aa8ff"}
                onChange={(e) => setTheme({ accent: e.currentTarget.value }, DRAG_DELAY_MS)}
              />
            </label>
          </div>
        </Row>
        <Row label="Saydamlık" hint="Çubuğun arka planı.">
          <Slider
            label="Saydamlık"
            min={20}
            max={100}
            value={Math.round(theme.opacity * 100)}
            format={(v) => `%${v}`}
            onChange={(v) => setTheme({ opacity: v / 100 }, DRAG_DELAY_MS)}
          />
        </Row>
        <Row label="Köşe yuvarlaklığı">
          <Slider
            label="Köşe yuvarlaklığı"
            min={0}
            max={24}
            value={theme.radius}
            format={(v) => `${v} px`}
            onChange={(v) => setTheme({ radius: v }, DRAG_DELAY_MS)}
          />
        </Row>
      </Card>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => setTheme(DEFAULT_THEME)}>
          Varsayılana dön
        </button>
      </div>
    </Section>
  );
}
