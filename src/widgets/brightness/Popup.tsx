import { commands, report } from "../../lib/ipc";
import { Brightness } from "../battery/Popup";
import { useBrightness } from "./use";
import styles from "./Popup.module.css";

/** Parlaklık paneli: pil panelindeki kaydırıcının aynısı. */
export function BrightnessPopup() {
  // Panel açıkken tuşlarla yapılan değişiklik de görünsün.
  const [value] = useBrightness(3000);
  return (
    <div className={styles.root}>
      {value == null ? (
        <p className={styles.note}>
          {value === null ? "Bu ekranın parlaklığı ayarlanamıyor." : "Okunuyor…"}
        </p>
      ) : (
        <Brightness
          value={value}
          onChange={(v) => commands.setBrightness(v).catch(report("set_brightness"))}
        />
      )}
    </div>
  );
}
