import { useEffect, useRef, useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { SpeakerIcon } from "../icons";
import { Dim, Meter, Tile } from "../ui";
import styles from "./Bar.module.css";

const WHEEL_STEP = 2;
const KEY_STEP = 5;

const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

export function VolumeBar() {
  const audio = useService(commands.getAudio, events.audio);
  // Sürüklerken yerel değer; Rust'tan gelen eski değerler çubuğu geri itmesin.
  const [local, setLocal] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const frame = useRef(0);
  const releaseTimer = useRef<number | undefined>(undefined);
  const dragging = useRef(false);

  // Hareketleri kare başına tek isteğe indir.
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
    releaseTimer.current = window.setTimeout(() => {
      if (!dragging.current) setLocal(null);
    }, 700);
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
      <Tile variant="soft" className={styles.tile} title="Ses aygıtı yok">
        <div className={styles.top}>
          <Dim>
            <SpeakerIcon level={0} muted size={16} />
          </Dim>
          <span className={styles.device}>
            <Dim>Ses aygıtı yok</Dim>
          </span>
        </div>
        <Meter value={0} muted className={styles.meter} />
      </Tile>
    );
  }

  const value = local ?? audio.volume;
  const shown = audio.muted ? 0 : value;
  const silent = audio.muted || value === 0;

  const fromPointer = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * 100);
  };

  return (
    <Tile
      variant="soft"
      className={styles.tile}
      data-muted={audio.muted || undefined}
      data-volume-tile
      title={`${audio.device} — %${audio.volume}${audio.muted ? " (sessiz)" : ""}\nAygıt adına tıkla: çıkış ve mikrofon · Sağ tık: ses ayarları`}
      onWheel={(e) => push(clamp(value + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP)))}
      onContextMenu={(e) => {
        e.preventDefault();
        commands.openSystemSettings("sound").catch(report("open_system_settings"));
      }}
    >
      <div className={styles.top}>
        <button
          type="button"
          className={styles.mute}
          aria-label={audio.muted ? "Sesi aç" : "Sesi kapat"}
          onClick={() => commands.setMute(!audio.muted).catch(report("set_mute"))}
        >
          <SpeakerIcon level={shown} muted={silent} size={16} />
        </button>
        {/* Aygıt adı: çıkış / mikrofon paneli (8.5). */}
        <button
          type="button"
          className={styles.device}
          title="Çıkış aygıtı ve mikrofon"
          onClick={(e) => togglePopup("volume", e.currentTarget.closest("[data-volume-tile]")!)}
        >
          {audio.device}
        </button>
        <span className={styles.percent}>{shown}</span>
      </div>
      <div
        className={styles.track}
        role="slider"
        tabIndex={0}
        aria-label="Ses düzeyi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          push(fromPointer(e.currentTarget, e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragging.current) push(fromPointer(e.currentTarget, e.clientX));
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onLostPointerCapture={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowRight" || e.key === "ArrowUp"
              ? KEY_STEP
              : e.key === "ArrowLeft" || e.key === "ArrowDown"
                ? -KEY_STEP
                : 0;
          if (!step) return;
          e.preventDefault();
          push(clamp(value + step));
        }}
      >
        <Meter value={shown} muted={audio.muted} className={styles.meter} />
      </div>
    </Tile>
  );
}
