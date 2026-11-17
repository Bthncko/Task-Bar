import { commands, events, report } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { TimerIcon } from "../icons";
import { Tile } from "../ui";
import { format, idle, remainingMs, useNow } from "./clock";
import styles from "./Bar.module.css";

const R = 8;
const C = 2 * Math.PI * R;

/** Zamanlayıcı karosu (8.8): halka + geri sayım; bitince yanıp söner. */
export function TimerBar() {
  const t = useService(commands.timerGet, events.timer);
  const running = t?.endsAt != null;
  const now = useNow(running);
  if (!t) return null;

  const left = remainingMs(t, now);
  const done = t.total > 0 ? 1 - left / (t.total * 1000) : 0;
  const resting = idle(t);

  return (
    <Tile
      as="button"
      variant={t.finished ? "solid" : "soft"}
      interactive
      className={styles.tile}
      data-finished={t.finished || undefined}
      data-paused={(!running && !resting && !t.finished) || undefined}
      aria-label={t.finished ? "Zamanlayıcı bitti: kapat" : "Zamanlayıcı"}
      title={
        t.finished
          ? "Süre doldu · tıkla: kapat"
          : resting
            ? "Zamanlayıcı"
            : `${running ? "Kalan" : "Duraklatıldı"} ${format(left)}`
      }
      onClick={(e) => {
        if (t.finished) commands.timerControl("reset").catch(report("timer_control"));
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
          <span className={styles.time}>{t.finished ? "Bitti" : format(left)}</span>
        </>
      )}
    </Tile>
  );
}
