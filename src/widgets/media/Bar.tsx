import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { commands, events, report, type MediaState } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { togglePopup } from "../../lib/popup";
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from "../icons";
import { useCoverTint } from "./useCoverTint";
import { IconButton, Tile } from "../ui";
import styles from "./Bar.module.css";

/** Kayan yazı hızı (px/sn). */
const MARQUEE_SPEED = 30;

type Shown = NonNullable<MediaState>;

/**
 * Oturum kapanınca karo hemen kaybolmaz: son durum çıkış animasyonu bitene
 * kadar gösterilir. (Türetilmiş durum: render sırasında güncellenir.)
 */
function useLingering(media: MediaState | undefined) {
  const [state, setState] = useState<{ last: Shown | null; leaving: boolean }>({
    last: null,
    leaving: false,
  });
  if (media && media !== state.last) setState({ last: media, leaving: false });
  if (!media && state.last && !state.leaving) setState({ last: state.last, leaving: true });
  const done = () => setState({ last: null, leaving: false });
  return [state.last, state.leaving, done] as const;
}

/** Şarkı değişince eski etiket solarken yenisi belirir. */
function useCrossfade(label: string) {
  const [state, setState] = useState<{ cur: string; prev: string | null }>({
    cur: label,
    prev: null,
  });
  if (label !== state.cur) setState({ cur: label, prev: state.cur });
  const clear = () => setState((s) => ({ ...s, prev: null }));
  return [state.cur, state.prev, clear] as const;
}

export function MediaBar() {
  const live = useService(commands.getMedia, events.media);
  const [media, leaving, gone] = useLingering(live);
  const tint = useCoverTint(media?.artwork ?? null);

  if (!media) return null;

  return (
    <Tile
      variant="tinted"
      color={tint}
      className={styles.card}
      data-leaving={leaving || undefined}
      // Kontrollerin dışına tıklama: müzik paneli (sıradakiler).
      onClick={(e) => {
        if (!(e.target as Element).closest("button")) togglePopup("media", e.currentTarget);
      }}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) gone();
      }}
    >
      <Title title={media.title} artist={media.artist} />
      <div className={styles.controls}>
        <IconButton
          className={styles.control}
          title="Önceki"
          aria-label="Önceki"
          disabled={!media.canPrev}
          onClick={() => commands.mediaPrev().catch(report("media_prev"))}
        >
          <PrevIcon size={14} />
        </IconButton>
        <IconButton
          className={styles.control}
          title={media.playing ? "Duraklat" : "Oynat"}
          aria-label={media.playing ? "Duraklat" : "Oynat"}
          onClick={() => commands.mediaToggle().catch(report("media_toggle"))}
        >
          {/* Durum değişince simge çapraz geçişle değişir (7.7). */}
          <span key={media.playing ? "pause" : "play"} className={styles.swap}>
            {media.playing ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
          </span>
        </IconButton>
        <IconButton
          className={styles.control}
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

/** Şarkı ile sanatçıyı tek anahtarda tutar (başlıkta geçemeyecek ayırıcıyla). */
const SEP = "\u0000";

function Title({ title, artist }: { title: string; artist: string }) {
  const full = artist ? `${title} · ${artist}` : title;
  const [cur, prev, clearPrev] = useCrossfade(`${title}${SEP}${artist}`);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  // Sığmayan başlık: kenarlar soluklaşır, hover'da yavaşça kayar.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(text.scrollWidth - box.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [cur]);

  const style = {
    "--marquee": `${-overflow}px`,
    "--marquee-time": `${Math.max(2, overflow / MARQUEE_SPEED)}s`,
  } as CSSProperties;

  return (
    <div
      ref={boxRef}
      className={styles.titleBox}
      data-overflow={overflow > 0 || undefined}
      title={full}
      style={style}
    >
      {prev !== null && (
        <span key={`prev:${prev}`} className={styles.label} data-out onAnimationEnd={clearPrev}>
          <Label text={prev} />
        </span>
      )}
      <span key={cur} ref={textRef} className={styles.label} data-in={prev !== null || undefined}>
        <Label text={cur} />
      </span>
    </div>
  );
}

/** "Şarkı · Sanatçı": şarkı kalın, sanatçı soluk. */
function Label({ text }: { text: string }) {
  const [title, artist] = text.split(SEP);
  return (
    <>
      <b>{title}</b>
      {artist && <span className={styles.artist}> · {artist}</span>}
    </>
  );
}
