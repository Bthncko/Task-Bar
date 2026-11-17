import { useEffect, useRef, useState, type CSSProperties } from "react";
import { commands, type SpotifyDevice, type SpotifyPlayer } from "../../lib/ipc";
import {
  CheckIcon,
  ChevronIcon,
  DesktopIcon,
  HeartIcon,
  PhoneIcon,
  SpeakerBoxIcon,
  SpeakerIcon,
} from "../icons";
import { IconButton } from "../ui";
import { duration, useProgress, useThrottled } from "./spotify";
import styles from "./Popup.module.css";

type Player = NonNullable<SpotifyPlayer>;
type SetPlayer = (f: (p: SpotifyPlayer) => SpotifyPlayer) => void;

/** İlerleme çubuğu: sürükleyip bırakınca o noktaya atlar. */
export function ProgressBar({
  player,
  setPlayer,
  onError,
}: {
  player: Player;
  setPlayer: SetPlayer;
  onError: (e: unknown) => void;
}) {
  const live = useProgress(player);
  const [drag, setDrag] = useState<number | null>(null);
  const total = player.durationMs;
  const shown = drag ?? live;
  if (!total) return null;

  const commit = () => {
    if (drag === null) return;
    const to = drag;
    setDrag(null);
    // Yeni konumu hemen göster; Spotify'ın onayı gelene kadar oradan say.
    setPlayer((p) => (p ? { ...p, progressMs: to, at: Date.now() } : p));
    commands.spotifySeek(Math.round(to)).catch(onError);
  };

  return (
    <div className={styles.progress}>
      <span className={styles.time}>{duration(shown)}</span>
      <input
        type="range"
        min={0}
        max={total}
        step={1000}
        value={shown}
        aria-label="Şarkıda konum"
        className={styles.seek}
        style={{ "--fill": `${(shown / total) * 100}%` } as CSSProperties}
        onChange={(e) => setDrag(Number(e.currentTarget.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => setDrag(null)}
      />
      <span className={styles.time}>{duration(total)}</span>
    </div>
  );
}

/** Beğenilenlere ekle / çıkar (izin yoksa görünmez). */
export function LikeButton({
  player,
  setPlayer,
  onError,
}: {
  player: Player;
  setPlayer: SetPlayer;
  onError: (e: unknown) => void;
}) {
  if (player.liked === null || !player.uri) return null;
  const liked = player.liked;
  const uri = player.uri;
  const toggle = () => {
    setPlayer((p) => (p ? { ...p, liked: !liked } : p));
    commands.spotifySetLiked(uri, !liked).catch((e) => {
      setPlayer((p) => (p ? { ...p, liked } : p));
      onError(e);
    });
  };
  return (
    <IconButton
      className={styles.like}
      data-on={liked || undefined}
      aria-label={liked ? "Beğenilenlerden çıkar" : "Beğenilenlere ekle"}
      aria-pressed={liked}
      title={liked ? "Beğenilenlerden çıkar" : "Beğenilenlere ekle"}
      onClick={toggle}
    >
      <HeartIcon size={18} filled={liked} />
    </IconButton>
  );
}

/** Spotify sesi + çalan cihaz (tıklayınca diğer cihazlar). */
export function VolumeRow({
  player,
  setPlayer,
  refresh,
  onError,
}: {
  player: Player;
  setPlayer: SetPlayer;
  refresh: () => void;
  onError: (e: unknown) => void;
}) {
  const device = player.device;
  const [local, setLocal] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const send = useThrottled((v: number) => {
    commands.spotifySetVolume(v).catch(onError);
  }, 250);

  const volume = device?.volume ?? null;
  const canVolume = !!device?.supportsVolume && volume !== null;
  const shown = local ?? volume ?? 0;
  const muted = canVolume && shown === 0;

  const setKnown = (v: number) =>
    setPlayer((p) => (p && p.device ? { ...p, device: { ...p.device, volume: v } } : p));

  const toggleMute = () => {
    commands.spotifyToggleMute(shown).then(setKnown).catch(onError);
  };

  return (
    <div className={styles.volumeBlock}>
      <div className={styles.volume} data-muted={muted || undefined}>
        <IconButton
          className={styles.mute}
          aria-label={muted ? "Spotify sesini aç" : "Spotify sesini kapat"}
          title={canVolume ? (muted ? "Sesi aç" : "Sessize al") : "Bu cihazın sesi ayarlanamıyor"}
          disabled={!canVolume}
          aria-pressed={muted}
          onClick={toggleMute}
        >
          <SpeakerIcon level={shown} muted={muted} size={18} />
        </IconButton>
        <input
          type="range"
          min={0}
          max={100}
          value={shown}
          disabled={!canVolume}
          aria-label="Spotify sesi"
          className={styles.slider}
          style={{ "--fill": `${shown}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            setLocal(v);
            send(v);
          }}
          onPointerUp={() => {
            if (local !== null) setKnown(local);
            setLocal(null);
          }}
          onBlur={() => setLocal(null)}
        />
        <span className={styles.percent}>{canVolume ? `%${shown}` : "—"}</span>
        {device && (
          <button
            type="button"
            className={styles.deviceChip}
            aria-expanded={open}
            title={`Çalan cihaz: ${device.name}`}
            onClick={() => setOpen((o) => !o)}
          >
            <DeviceIcon kind={device.kind} size={15} />
            <span>{device.name}</span>
            <ChevronIcon size={13} className={styles.chevron} />
          </button>
        )}
      </div>
      {open && (
        <Devices
          onPicked={() => {
            setOpen(false);
            refresh();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function Devices({ onPicked, onError }: { onPicked: () => void; onError: (e: unknown) => void }) {
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const errorRef = useRef(onError);
  useEffect(() => {
    errorRef.current = onError;
  });
  useEffect(() => {
    let alive = true;
    commands
      .spotifyDevices()
      .then((d) => alive && setDevices(d))
      .catch((e) => {
        if (!alive) return;
        setDevices([]);
        errorRef.current(e);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pick = (d: SpotifyDevice) => {
    if (d.active) return onPicked();
    setBusy(d.id);
    commands
      .spotifyTransfer(d.id)
      .then(onPicked)
      .catch(onError)
      .finally(() => setBusy(null));
  };

  if (devices === null) return <p className={styles.hint}>Cihazlar aranıyor…</p>;
  if (devices.length === 0)
    return <p className={styles.hint}>Açık başka bir Spotify cihazı yok.</p>;
  return (
    <ul className={styles.devices}>
      {devices.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            className={styles.device}
            data-active={d.active || undefined}
            data-busy={busy === d.id || undefined}
            aria-pressed={d.active}
            onClick={() => pick(d)}
          >
            <DeviceIcon kind={d.kind} size={16} />
            <span>{d.name}</span>
            {d.active && <CheckIcon size={16} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DeviceIcon({ kind, size }: { kind: string; size: number }) {
  const k = kind.toLowerCase();
  if (k === "smartphone" || k === "tablet") return <PhoneIcon size={size} />;
  if (k === "computer") return <DesktopIcon size={size} />;
  return <SpeakerBoxIcon size={size} />;
}
