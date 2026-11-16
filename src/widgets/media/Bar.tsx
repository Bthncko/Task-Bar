import { useEffect, useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../icons";
import { averageColor } from "./averageColor";
import { IconButton, Tile } from "../ui";
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
        // Kapak rengi koyu camla karışır ki beyaz yazı her kapakta okunsun.
        // (7.5'te doygunluk ve parlaklık sınırlaması ayrıntılanacak.)
        setComputed({
          art: artwork,
          tint: c
            ? `color-mix(in srgb, rgb(${c[0]} ${c[1]} ${c[2]}) 45%, rgb(var(--glass-tint)))`
            : null,
        });
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
    <Tile
      variant={tint ? "tinted" : "soft"}
      color={tint ?? undefined}
      className={styles.card}
      title={label}
    >
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
        <IconButton
          title="Önceki"
          aria-label="Önceki"
          disabled={!media.canPrev}
          onClick={() => commands.mediaPrev().catch(report("media_prev"))}
        >
          <PrevIcon size={14} />
        </IconButton>
        <IconButton
          title={media.playing ? "Duraklat" : "Oynat"}
          aria-label={media.playing ? "Duraklat" : "Oynat"}
          onClick={() => commands.mediaToggle().catch(report("media_toggle"))}
        >
          {media.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </IconButton>
        <IconButton
          title="Sonraki"
          aria-label="Sonraki"
          disabled={!media.canNext}
          onClick={() => commands.mediaNext().catch(report("media_next"))}
        >
          <NextIcon size={14} />
        </IconButton>
      </div>
    </Tile>
  );
}
