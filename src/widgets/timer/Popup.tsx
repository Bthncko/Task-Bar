import { useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { PanelHeader } from "../ui/panel";
import { format, idle, remainingMs, useNow } from "./clock";
import styles from "./Popup.module.css";

/** Hazır süreler (dakika). */
const PRESETS = [5, 15, 25, 50];

const control = (action: "start" | "pause" | "resume" | "reset", seconds?: number) =>
  commands.timerControl(action, seconds).catch(report("timer_control"));

/** Zamanlayıcı paneli: hazır süreler / özel süre, başlat, duraklat, sıfırla. */
export function TimerPopup() {
  const t = useService(commands.timerGet, events.timer);
  const running = t?.endsAt != null;
  const now = useNow(running);
  const [custom, setCustom] = useState("");
  if (!t) return null;

  const resting = idle(t);
  const left = remainingMs(t, now);
  const minutes = Number(custom);
  const customValid = Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60;

  return (
    <div className={styles.root}>
      <PanelHeader title="Zamanlayıcı" />

      <div className={styles.display} data-paused={(!running && !resting) || undefined}>
        {t.finished ? "Süre doldu" : format(resting ? t.total * 1000 || 25 * 60_000 : left)}
      </div>

      <div className={styles.presets} role="group" aria-label="Hazır süreler">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={styles.preset}
            aria-pressed={t.total === m * 60 && !resting}
            onClick={() => control("start", m * 60)}
          >
            {m} dk
          </button>
        ))}
      </div>

      <form
        className={styles.custom}
        onSubmit={(e) => {
          e.preventDefault();
          if (customValid) control("start", Math.round(minutes * 60));
        }}
      >
        <input
          type="number"
          min={1}
          max={1440}
          inputMode="numeric"
          placeholder="Özel süre (dk)"
          aria-label="Özel süre, dakika"
          value={custom}
          onChange={(e) => setCustom(e.currentTarget.value)}
        />
        <button type="submit" className={styles.secondary} disabled={!customValid}>
          Başlat
        </button>
      </form>

      <div className={styles.actions}>
        {running ? (
          <button type="button" className={styles.primary} onClick={() => control("pause")}>
            Duraklat
          </button>
        ) : !resting && !t.finished ? (
          <button type="button" className={styles.primary} onClick={() => control("resume")}>
            Devam et
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={() => control("start", t.total || 25 * 60)}
          >
            {t.total ? "Yeniden başlat" : "25 dk başlat"}
          </button>
        )}
        <button
          type="button"
          className={styles.secondary}
          disabled={resting}
          onClick={() => control("reset")}
        >
          Sıfırla
        </button>
      </div>
    </div>
  );
}
