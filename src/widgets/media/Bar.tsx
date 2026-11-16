import { useEffect, useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../icons";
import { averageColor } from "./averageColor";
import shared from "../shared.module.css";
import styles from "./Bar.module.css";

export function MediaBar() {
  const media = useService(commands.getMedia, events.media);
  // Hangi kapak için hesaplandığıyla birlikte tut: kapak değişince eski ton kullanılmaz.
  const [computed, setComputed] = useState<{ art: string; tint: string | null } | null>(null);
  const artwork = media?.artwork ?? null;
  const tint = computed && computed.art === artwork ? computed.tint : null;

  useEffect(() => {
    if (!artwork) return;
    let alive = true;
    averageColor(artwork).then((c) => {
      if (alive) {
        setComputed({ art: artwork, tint: c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.32)` : null });
      }
    });
    return () => {
      alive = false;
    };
  }, [artwork]);

  // Oturum yoksa widget gizlenir.
  if (!media) return null;

  const label = media.artist ? `${media.title} — ${media.artist}` : media.title;

  return (
    <div className={styles.card} style={tint ? { background: tint } : undefined} title={label}>
      {media.artwork ? (
        <img className={styles.art} src={media.artwork} alt="" draggable={false} />
      ) : (
        <div className={styles.art} />
      )}
      <div className={styles.text}>
        <span className={styles.title}>{media.title}</span>
        {media.artist && <span className={styles.artist}>{media.artist}</span>}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={shared.iconButton}
          title="Önceki"
          aria-label="Önceki"
          disabled={!media.canPrev}
          onClick={() => commands.mediaPrev().catch(report("media_prev"))}
        >
          <PrevIcon size={14} />
        </button>
        <button
          type="button"
          className={shared.iconButton}
          title={media.playing ? "Duraklat" : "Oynat"}
          aria-label={media.playing ? "Duraklat" : "Oynat"}
          onClick={() => commands.mediaToggle().catch(report("media_toggle"))}
        >
          {media.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
        <button
          type="button"
          className={shared.iconButton}
          title="Sonraki"
          aria-label="Sonraki"
          disabled={!media.canNext}
          onClick={() => commands.mediaNext().catch(report("media_next"))}
        >
          <NextIcon size={14} />
        </button>
      </div>
    </div>
  );
}
