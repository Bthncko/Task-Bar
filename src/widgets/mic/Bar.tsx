import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { MicIcon } from "../icons";
import { Tile } from "../ui";
import styles from "./Bar.module.css";
import { t } from "../../lib/i18n";

/** Mikrofon (8.5): tek düğme; sessizken kırmızı. Sağ tık: ses ayarları. */
export function MicBar() {
  const audio = useService(commands.getAudio, events.audio);
  const mic = audio?.mic;
  if (!mic) return null;
  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      className={styles.mic}
      data-muted={mic.muted || undefined}
      aria-pressed={mic.muted}
      aria-label={mic.muted ? t("Mikrofonu aç") : t("Mikrofonu kapat")}
      title={t("{name} — {state}\nSağ tık: ses ayarları", {
        name: mic.name,
        state: mic.muted ? t("kapalı") : t("açık, %{v}", { v: mic.volume }),
      })}
      onClick={() => commands.setMicMute(!mic.muted).catch(report("set_mic_mute"))}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings("sound").catch(report("open_system_settings"));
      }}
    >
      <MicIcon muted={mic.muted} size={18} />
    </Tile>
  );
}
