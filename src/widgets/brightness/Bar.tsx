import { togglePopup } from "../../lib/popup";
import { SunIcon } from "../icons";
import { Tile } from "../ui";
import { useBrightness, useBrightnessSender } from "./use";
import styles from "./Bar.module.css";
import { pct, t } from "../../lib/i18n";

/** Klavye tuşlarıyla değişen parlaklık bu aralıkla yeniden okunur. */
const POLL_MS = 5000;
const STEP = 5;

/** Parlaklık (8.8): yüzde; tekerlekle ±5, tıklayınca kaydırıcı. */
export function BrightnessBar() {
  const [value, setValue] = useBrightness(POLL_MS);
  const send = useBrightnessSender();
  if (value == null) return null;

  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      className={styles.tile}
      aria-label={t("Parlaklık yüzde {v}", { v: value })}
      title={t("Parlaklık %{v}\nTekerlek: ayarla · Tıkla: kaydırıcı", { v: value })}
      onClick={(e) => togglePopup("brightness", e.currentTarget)}
      onWheel={(e) => {
        const next = Math.min(100, Math.max(0, value + (e.deltaY < 0 ? STEP : -STEP)));
        if (next === value) return;
        setValue(next);
        send(next);
      }}
    >
      <SunIcon size={17} />
      <span className={styles.value}>{pct(value)}</span>
    </Tile>
  );
}
