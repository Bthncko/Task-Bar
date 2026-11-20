import { commands, events, report } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { TimerIcon } from "../icons";
import { Tile } from "../ui";
import { format, idle, remainingMs, useNow } from "./clock";
import styles from "./Bar.module.css";
import { t } from "../../lib/i18n";

const R = 8;
const C = 2 * Math.PI * R;

/** Zamanlayıcı karosu (8.8): halka + geri sayım; bitince yanıp söner. */
export function TimerBar() {
  const timer = useService(commands.timerGet, events.timer);
  const running = timer?.endsAt != null;
  const now = useNow(running);
  if (!timer) return null;

  const left = remainingMs(timer, now);
  const done = timer.total > 0 ? 1 - left / (timer.total * 1000) : 0;
  const resting = idle(timer);

  return (
    <Tile
      as="button"
      variant={timer.finished ? "solid" : "soft"}
      interactive
      className={styles.tile}
      data-finished={timer.finished || undefined}
      data-paused={(!running && !resting && !timer.finished) || undefined}
      aria-label={timer.finished ? t("Zamanlayıcı bitti: kapat") : t("Zamanlayıcı")}
      title={
        timer.finished
          ? t("Süre doldu · tıkla: kapat")
          : resting
            ? t("Zamanlayıcı")
            : `${running ? t("Kalan") : t("Duraklatıldı")} ${format(left)}`
      }
      onClick={(e) => {
        if (timer.finished) commands.timerControl("reset").catch(report("timer_control"));
        else togglePopup("timer", e.currentTarget);
      }}
    >
      {resting ? (
        <TimerIcon size={18} />
      ) : (
        <>
          <svg className={styles.ring} width={20} height={20} viewBox="0 0 20 20" aria-hidden>
            <circle cx={10} cy={10} r={R} className={styles.track} />
            <circle
              cx={10}
              cy={10}
              r={R}
              className={styles.progress}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - Math.min(Math.max(done, 0), 1))}
            />
          </svg>
          <span className={styles.time}>{timer.finished ? t("Bitti") : format(left)}</span>
        </>
      )}
    </Tile>
  );
}
