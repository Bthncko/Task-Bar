import { commands, events, type Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { FALLBACK_ACCENT } from "../../lib/theme";
import { useService } from "../../lib/useService";
import { Card, Row, Section, Segmented, Slider } from "./controls";
import styles from "./Settings.module.css";
import { pct, t } from "../../lib/i18n";

type Theme = Config["theme"];

// src-tauri/src/config.rs → Theme::default ve tokens.css ile aynı.
const DEFAULT_THEME: Theme = {
  accent: "#3b9eff",
  opacity: 0.85,
  radius: 16,
  glass: "wallpaper",
  scale: 1,
  font: "inter",
  reduceMotion: "system",
};

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
/** Boyut ekranda ayrılan şeridi değiştirir (büyütülmüş pencereler yeniden boyutlanır):
 *  sürükleme durunca uygula. */
const SCALE_DELAY_MS = 500;

const setTheme = (patch: Partial<Theme>, delay = 0) =>
  updateConfig((c) => ({ ...c, theme: { ...c.theme, ...patch } }), delay);

export function Appearance({ config }: { config: Config }) {
  const { theme } = config;
  const accent = theme.accent.toLowerCase();
  const systemAccent = useService(commands.getSystemAccent, events.accent) ?? null;

  return (
    <Section title={t("Görünüm")} intro={t("Değişiklikler dock'ta hemen görünür.")}>
      <Card>
        <Row
          label={t("Vurgu rengi")}
          hint={t(
            "İlk daire Windows'un vurgu rengi (Ayarlar → Kişiselleştirme → Renkler); orada değişince dock da değişir.",
          )}
        >
          <div className={styles.swatches}>
            <button
              type="button"
              className={`${styles.swatch} ${styles.swatchAuto}`}
              style={{ background: systemAccent ?? FALLBACK_ACCENT }}
              aria-label={t("Windows vurgu rengi")}
              title={t("Windows vurgu rengi")}
              aria-pressed={accent === "auto"}
              onClick={() => setTheme({ accent: "auto" })}
            />
            <span className={styles.swatchDivider} aria-hidden />
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
            <label className={styles.customColor} title={t("Başka bir renk")}>
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/.test(accent) ? accent : "#6aa8ff"}
                onChange={(e) => setTheme({ accent: e.currentTarget.value }, DRAG_DELAY_MS)}
              />
            </label>
          </div>
        </Row>
        <Row
          label={t("Zemin")}
          hint={t(
            "Cam: arkadaki duvar kâğıdı bulanık görünür (hareketli duvar kâğıdında çubuk yarı saydam olur). Düz: mat, opak koyu zemin.",
          )}
        >
          <Segmented
            label={t("Zemin")}
            value={theme.glass}
            options={[
              { value: "wallpaper", label: t("Cam") },
              { value: "flat", label: t("Düz") },
            ]}
            onChange={(glass) => setTheme({ glass })}
          />
        </Row>
        <Row
          label={t("Saydamlık")}
          hint={
            theme.glass === "flat"
              ? t("Düz zeminde kullanılmaz.")
              : t(
                  "Arttıkça çubuğun arkası daha çok görünür. Açık renkli duvar kâğıdında yüksek değer yazıları zorlaştırabilir.",
                )
          }
        >
          {/* config'te opaklık saklanır (1 = tam cam); burada tersi gösterilir. */}
          <Slider
            label={t("Saydamlık")}
            min={0}
            max={90}
            value={Math.round((1 - theme.opacity) * 100)}
            format={(v) => pct(v)}
            disabled={theme.glass === "flat"}
            onChange={(v) => setTheme({ opacity: 1 - v / 100 }, DRAG_DELAY_MS)}
          />
        </Row>
        <Row label={t("Köşe yuvarlaklığı")}>
          <Slider
            label={t("Köşe yuvarlaklığı")}
            min={0}
            max={24}
            value={theme.radius}
            format={(v) => `${v} px`}
            onChange={(v) => setTheme({ radius: v }, DRAG_DELAY_MS)}
          />
        </Row>
      </Card>

      <Card>
        <Row
          label={t("Boyut")}
          hint={t("Dock ve panellerin tüm ölçüleri. Ekranda ayrılan yer de büyür ya da küçülür.")}
        >
          <Slider
            label={t("Boyut")}
            min={85}
            max={125}
            step={5}
            value={Math.round(theme.scale * 100)}
            format={(v) => pct(v)}
            onChange={(v) => setTheme({ scale: v / 100 }, SCALE_DELAY_MS)}
          />
        </Row>
        <Row label={t("Yazı tipi")}>
          <Segmented
            label={t("Yazı tipi")}
            value={theme.font}
            options={[
              { value: "inter", label: "Inter" },
              { value: "system", label: t("Sistem (Segoe UI)") },
            ]}
            onChange={(font) => setTheme({ font })}
          />
        </Row>
        <Row
          label={t("Hareket")}
          hint={t(
            "Sistem: Windows'taki “Animasyon efektleri” ayarına uyar. Azalt: animasyonlar ve ikon büyütme kapalı.",
          )}
        >
          <Segmented
            label={t("Hareket")}
            value={theme.reduceMotion}
            options={[
              { value: "system", label: t("Sistem") },
              { value: "reduce", label: t("Azalt") },
              { value: "full", label: t("Tam") },
            ]}
            onChange={(reduceMotion) => setTheme({ reduceMotion })}
          />
        </Row>
      </Card>

      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => setTheme(DEFAULT_THEME)}>
          {t("Varsayılana dön")}
        </button>
      </div>
    </Section>
  );
}
