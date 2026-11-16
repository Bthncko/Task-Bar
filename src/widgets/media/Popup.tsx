import { useEffect, useState, type CSSProperties } from "react";
import {
  commands,
  events,
  report,
  type MediaState,
  type QueueItem,
  type SpotifyQueue,
} from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { MusicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../icons";
import { IconButton } from "../ui";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import { useCoverTint } from "./useCoverTint";
import styles from "./Popup.module.css";

/** Panel açıkken sıra bu aralıkla tazelenir (Spotify'da elle eklenenler için). */
const REFRESH_MS = 15_000;
/** Şarkı değişince Spotify'ın sırası biraz geç güncellenir. */
const SETTLE_MS = 400;

const isSpotify = (app: string) => /spotify/i.test(app);

/**
 * Müzik paneli: şu an çalan + (Spotify'da) sıradakiler; listeden birine
 * tıklayınca o şarkıya geçilir (Spotify Web API, `services/spotify.rs`).
 */
export function MediaPopup() {
  const media = useService(commands.getMedia, events.media) ?? null;
  const spotify = useService(commands.spotifyStatus, events.spotify);
  const close = usePopupClose();
  const fromSpotify = !!media && isSpotify(media.sourceApp);

  const openSettings = () => {
    commands.openSettings("music").catch(report("open_settings"));
    close();
  };

  let queue;
  if (!media) queue = null;
  else if (!fromSpotify)
    queue = <p className={styles.note}>Sıra yalnızca Spotify çalarken görünür.</p>;
  else if (!spotify) queue = null;
  else if (!spotify.connected)
    queue = (
      <div className={styles.connect}>
        <p>
          Spotify hesabını bağlarsan sıradaki şarkılar burada görünür; birine tıklayıp ona
          geçebilirsin.
        </p>
        <button type="button" className={styles.primary} onClick={openSettings}>
          Spotify'ı bağla
        </button>
      </div>
    );
  else queue = <Queue trackKey={`${media.title}\u0000${media.artist}`} />;

  return (
    <div className={styles.root}>
      <PanelHeader
        title="Müzik"
        actions={
          fromSpotify && spotify?.connected ? (
            <LinkButton onClick={openSettings}>Spotify</LinkButton>
          ) : undefined
        }
      />
      {media ? (
        <NowPlaying media={media} />
      ) : (
        <div className={styles.empty}>
          <MusicIcon size={28} />
          <p>Şu an bir şey çalmıyor.</p>
        </div>
      )}
      {queue && (
        <section className={styles.queue} aria-label="Sıradakiler">
          <h3 className={styles.sectionTitle}>Sıradakiler</h3>
          {queue}
        </section>
      )}
    </div>
  );
}

function NowPlaying({ media }: { media: NonNullable<MediaState> }) {
  const tint = useCoverTint(media.artwork);
  return (
    <div className={styles.now} style={{ "--tile-color": tint } as CSSProperties}>
      <Cover src={media.artwork} className={styles.nowCover} size={26} />
      <div className={styles.nowBody}>
        <div className={styles.nowText}>
          <b className={styles.nowTitle} title={media.title}>
            {media.title}
          </b>
          {media.artist && <span className={styles.nowArtist}>{media.artist}</span>}
        </div>
        <div className={styles.controls}>
          <IconButton
            className={styles.control}
            aria-label="Önceki"
            title="Önceki"
            disabled={!media.canPrev}
            onClick={() => commands.mediaPrev().catch(report("media_prev"))}
          >
            <PrevIcon size={16} />
          </IconButton>
          <IconButton
            className={`${styles.control} ${styles.play}`}
            aria-label={media.playing ? "Duraklat" : "Oynat"}
            title={media.playing ? "Duraklat" : "Oynat"}
            onClick={() => commands.mediaToggle().catch(report("media_toggle"))}
          >
            {media.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
          </IconButton>
          <IconButton
            className={styles.control}
            aria-label="Sonraki"
            title="Sonraki"
            disabled={!media.canNext}
            onClick={() => commands.mediaNext().catch(report("media_next"))}
          >
            <NextIcon size={16} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

type QueueState =
  | { kind: "loading" }
  | { kind: "ready"; queue: SpotifyQueue }
  | { kind: "error"; message: string; queue: SpotifyQueue | null };

/** Spotify sırası: açılışta, şarkı değişince ve panel açıkken düzenli olarak. */
function Queue({ trackKey }: { trackKey: string }) {
  const [state, setState] = useState<QueueState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** Geçilen satır (gelene kadar üstündekiler soluk). */
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      commands
        .spotifyQueue()
        .then((queue) => {
          if (!alive) return;
          setState({ kind: "ready", queue });
          setPending(null);
        })
        .catch(
          (e) =>
            alive &&
            setState((s) => ({
              kind: "error",
              message: String(e),
              queue: s.kind === "loading" ? null : s.queue,
            })),
        );
    const first = window.setTimeout(load, attempt === 0 ? 0 : SETTLE_MS);
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [trackKey, attempt]);

  // Şarkı değişti (geçiş tamamlandı): bekleyen satır yok.
  const [lastKey, setLastKey] = useState(trackKey);
  if (lastKey !== trackKey) {
    setLastKey(trackKey);
    setPending(null);
  }

  const skipTo = (index: number) => {
    if (pending !== null) return;
    setPending(index);
    commands
      .spotifySkip(index + 1)
      .catch((e) => {
        setPending(null);
        setState((s) => ({
          kind: "error",
          message: String(e),
          queue: s.kind === "loading" ? null : s.queue,
        }));
      })
      .finally(() => setAttempt((n) => n + 1));
  };

  if (state.kind === "loading") return <QueueSkeleton />;

  const queue = state.queue;
  return (
    <>
      {state.kind === "error" && (
        <div className={styles.error} role="alert">
          <span>{state.message}</span>
          <LinkButton onClick={() => setAttempt((n) => n + 1)}>Yeniden dene</LinkButton>
        </div>
      )}
      {queue && queue.items.length === 0 && <p className={styles.note}>Sırada şarkı yok.</p>}
      {queue && queue.items.length > 0 && (
        <ol className={styles.list}>
          {queue.items.map((item, i) => (
            <li key={`${i}:${item.uri}`}>
              <QueueRow
                item={item}
                state={
                  pending === null
                    ? undefined
                    : i < pending
                      ? "skipped"
                      : i === pending
                        ? "next"
                        : undefined
                }
                onPlay={() => skipTo(i)}
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function QueueRow({
  item,
  state,
  onPlay,
}: {
  item: QueueItem;
  state?: "skipped" | "next";
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.row}
      data-state={state}
      title={`${item.title} — çal`}
      onClick={onPlay}
    >
      <span className={styles.rowCover}>
        <Cover src={item.image} size={16} />
        <span className={styles.rowPlay} aria-hidden>
          <PlayIcon size={16} />
        </span>
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowArtist}>{item.artist}</span>
      </span>
      <span className={styles.rowTime}>{duration(item.durationMs)}</span>
    </button>
  );
}

function QueueSkeleton() {
  return (
    <ol className={styles.list} aria-busy="true">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className={styles.skeleton} style={{ "--i": i } as CSSProperties} />
      ))}
    </ol>
  );
}

function Cover({
  src,
  size,
  className = styles.cover,
}: {
  src: string | null;
  size: number;
  className?: string;
}) {
  return src ? (
    <img className={className} src={src} alt="" draggable={false} />
  ) : (
    <span className={`${className} ${styles.coverEmpty}`}>
      <MusicIcon size={size} />
    </span>
  );
}

function duration(ms: number) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
