import { useState, type CSSProperties } from "react";
import {
  commands,
  events,
  report,
  type MediaState,
  type RepeatMode,
  type SpotifyPlayer,
} from "../../lib/ipc";
import { useService } from "../../lib/useService";
import {
  MusicIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  ShuffleIcon,
} from "../icons";
import { IconButton } from "../ui";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import { LikeButton, ProgressBar, VolumeRow } from "./Playback";
import { Playlists } from "./Playlists";
import { Queue } from "./Queue";
import { Cover } from "./rows";
import { Search } from "./Search";
import { useSpotifyPlayer } from "./spotify";
import { useCoverTint } from "./useCoverTint";
import styles from "./Popup.module.css";

const isSpotify = (app: string) => /spotify/i.test(app);

/** Tekrar düğmesi Spotify'daki sırayla döner: kapalı → liste → tek şarkı. */
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "list", list: "track", track: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Tekrarla: kapalı",
  list: "Tekrarla: liste",
  track: "Tekrarla: bu şarkı",
};

type Tab = "queue" | "search" | "playlists";
const TABS: { id: Tab; label: string }[] = [
  { id: "queue", label: "Sıradakiler" },
  { id: "search", label: "Ara" },
  { id: "playlists", label: "Listelerim" },
];

/**
 * Müzik paneli: şu an çalan; Spotify bağlıysa ilerleme, ses, cihaz, beğen ve
 * sekmeler (sıradakiler düzenlenebilir, arama, çalma listeleri).
 * Spotify Web API: `services/spotify.rs`.
 */
export function MediaPopup() {
  const media = useService(commands.getMedia, events.media) ?? null;
  const spotify = useService(commands.spotifyStatus, events.spotify);
  const close = usePopupClose();
  const fromSpotify = !!media && isSpotify(media.sourceApp);
  const linked = fromSpotify && !!spotify?.connected;

  const openSettings = () => {
    commands.openSettings("music").catch(report("open_settings"));
    close();
  };

  let body;
  if (!media) body = null;
  else if (!fromSpotify)
    body = <p className={styles.note}>Sıra ve ses ayarı yalnızca Spotify çalarken görünür.</p>;
  else if (!spotify) body = null;
  else if (!spotify.connected)
    body = (
      <div className={styles.connect}>
        <p>
          Spotify hesabını bağlarsan burada sıradaki şarkıları düzenleyebilir, şarkı arayıp sıraya
          ekleyebilir, Spotify sesini ve çalan cihazı değiştirebilirsin.
        </p>
        <button type="button" className={styles.primary} onClick={openSettings}>
          Spotify'ı bağla
        </button>
      </div>
    );
  else body = <Tabs trackKey={`${media.title}\u0000${media.artist}`} />;

  return (
    <div className={styles.root}>
      <PanelHeader
        title="Müzik"
        actions={linked ? <LinkButton onClick={openSettings}>Spotify</LinkButton> : undefined}
      />
      {media ? (
        linked ? (
          <SpotifyNow media={media} />
        ) : (
          <NowPlaying media={media} />
        )
      ) : (
        <div className={styles.empty}>
          <MusicIcon size={28} />
          <p>Şu an bir şey çalmıyor.</p>
        </div>
      )}
      {linked && spotify?.needsReconnect && (
        <div className={styles.reconnect}>
          <span>Beğenme ve çalma listeleri için Spotify'ı bir kez yeniden bağla.</span>
          <LinkButton onClick={openSettings}>Yeniden bağla</LinkButton>
        </div>
      )}
      {body}
    </div>
  );
}

/** Spotify bağlıyken: kapak kartı + ilerleme, altında ses ve cihaz. */
function SpotifyNow({ media }: { media: NonNullable<MediaState> }) {
  const trackKey = `${media.title}\u0000${media.artist}`;
  const { player, setPlayer, error, refresh } = useSpotifyPlayer(trackKey, media.playing);
  const [actionError, setActionError] = useState<string | null>(null);
  const onError = (e: unknown) => {
    setActionError(String(e));
    refresh();
  };
  // Şarkı değişince eski hata gitsin.
  const [lastKey, setLastKey] = useState(trackKey);
  if (lastKey !== trackKey) {
    setLastKey(trackKey);
    setActionError(null);
  }
  const current: SpotifyPlayer = player;
  const message = actionError ?? error;

  return (
    <>
      <NowPlaying
        media={media}
        extra={current && <ProgressBar player={current} setPlayer={setPlayer} onError={onError} />}
        like={current && <LikeButton player={current} setPlayer={setPlayer} onError={onError} />}
      />
      {current && (
        <VolumeRow player={current} setPlayer={setPlayer} refresh={refresh} onError={onError} />
      )}
      {message && (
        <div className={styles.error} role="alert">
          <span>{message}</span>
          <LinkButton
            onClick={() => {
              setActionError(null);
              refresh();
            }}
          >
            Tamam
          </LinkButton>
        </div>
      )}
    </>
  );
}

function NowPlaying({
  media,
  extra,
  like,
}: {
  media: NonNullable<MediaState>;
  extra?: React.ReactNode;
  like?: React.ReactNode;
}) {
  const tint = useCoverTint(media.artwork);
  return (
    <div className={styles.now} style={{ "--tile-color": tint } as CSSProperties}>
      <div className={styles.nowTop}>
        <Cover src={media.artwork} className={styles.nowCover} size={26} />
        <div className={styles.nowBody}>
          <div className={styles.nowHead}>
            <div className={styles.nowText}>
              <b className={styles.nowTitle} title={media.title}>
                {media.title}
              </b>
              {media.artist && <span className={styles.nowArtist}>{media.artist}</span>}
            </div>
            {like}
          </div>
          <div className={styles.controls}>
            {media.shuffle !== null && (
              <IconButton
                className={`${styles.control} ${styles.toggle}`}
                aria-label="Karıştır"
                aria-pressed={media.shuffle}
                title={media.shuffle ? "Karıştır: açık" : "Karıştır: kapalı"}
                onClick={() =>
                  commands.mediaSetShuffle(!media.shuffle).catch(report("media_set_shuffle"))
                }
              >
                <ShuffleIcon size={15} />
              </IconButton>
            )}
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
            {media.repeat !== null && (
              <IconButton
                className={`${styles.control} ${styles.toggle}`}
                aria-label={REPEAT_LABEL[media.repeat]}
                aria-pressed={media.repeat !== "off"}
                title={REPEAT_LABEL[media.repeat]}
                onClick={() =>
                  commands
                    .mediaSetRepeat(NEXT_REPEAT[media.repeat!])
                    .catch(report("media_set_repeat"))
                }
              >
                <RepeatIcon size={15} one={media.repeat === "track"} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
      {extra}
    </div>
  );
}

/** Sıradakiler / Ara / Listelerim. */
function Tabs({ trackKey }: { trackKey: string }) {
  const [tab, setTab] = useState<Tab>("queue");
  /** Aramadan sıraya eklenince sıradakiler yeniden okunur. */
  const [queueVersion, setQueueVersion] = useState(0);
  return (
    <section className={styles.queue}>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.tabBody} role="tabpanel">
        {tab === "queue" && <Queue trackKey={trackKey} version={queueVersion} />}
        {tab === "search" && <Search onQueued={() => setQueueVersion((n) => n + 1)} />}
        {tab === "playlists" && <Playlists />}
      </div>
    </section>
  );
}
