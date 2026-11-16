import { useEffect, useRef, useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { SpeakerIcon } from "../icons";
import shared from "../shared.module.css";
import styles from "./Bar.module.css";

const WHEEL_STEP = 2;

export function VolumeBar() {
  const audio = useService(commands.getAudio, events.audio);
  // Sürüklerken yerel değer; Rust'tan gelen eski değerler kaydırıcıyı geri itmesin.
  const [local, setLocal] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const releaseTimer = useRef<number | undefined>(undefined);

  // Kaydırıcı hareketlerini kare başına tek isteğe indir.
  const push = (percent: number) => {
    setLocal(percent);
    pending.current = percent;
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current !== null) {
          commands.setVolume(pending.current / 100).catch(report("set_volume"));
          pending.current = null;
        }
      });
    }
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => setLocal(null), 700);
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(releaseTimer.current);
    },
    [],
  );

  if (audio === undefined) return null;
  if (audio === null) {
    return (
      <div className={shared.item} title="Ses aygıtı yok">
        <span className={shared.dim}>
          <SpeakerIcon level={0} muted />
        </span>
      </div>
    );
  }

  const value = local ?? audio.volume;
  const shown = audio.muted ? 0 : value;

  return (
    <div
      className={shared.item}
      title={`${audio.device} — %${audio.volume}${audio.muted ? " (sessiz)" : ""}`}
      onWheel={(e) =>
        push(Math.min(100, Math.max(0, value + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP))))
      }
    >
      <button
        type="button"
        className={shared.iconButton}
        aria-label={audio.muted ? "Sesi aç" : "Sesi kapat"}
        onClick={() => commands.setMute(!audio.muted).catch(report("set_mute"))}
        onContextMenu={(e) => {
          e.preventDefault();
          commands.openSystemSettings("sound").catch(report("open_system_settings"));
        }}
      >
        <SpeakerIcon level={shown} muted={audio.muted || value === 0} />
      </button>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        aria-label="Ses düzeyi"
        style={{ "--fill": `${shown}%` } as React.CSSProperties}
        onChange={(e) => push(Number(e.currentTarget.value))}
      />
      <span className={`${shared.value} ${styles.percent}`}>{shown}</span>
    </div>
  );
}
