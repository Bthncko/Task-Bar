import type { ReactNode } from "react";
import { MusicIcon, PlayIcon } from "../icons";
import { duration } from "./spotify";
import styles from "./Popup.module.css";

export function Cover({
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

/**
 * Liste satırı: tıklayınca çal; sağda süre, üstüne gelince eylem düğmeleri.
 * (Düğme içinde düğme olmasın diye satır bir kapsayıcı, çal düğmesi içinde.)
 */
export function TrackRow({
  image,
  title,
  subtitle,
  durationMs,
  state,
  playLabel = "çal",
  onPlay,
  actions,
}: {
  image: string | null;
  title: string;
  subtitle: string;
  durationMs?: number;
  state?: "skipped" | "next" | "done";
  playLabel?: string;
  onPlay: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.row} data-state={state}>
      <button
        type="button"
        className={styles.rowMain}
        title={`${title} — ${playLabel}`}
        onClick={onPlay}
      >
        <span className={styles.rowCover}>
          <Cover src={image} size={16} />
          <span className={styles.rowPlay} aria-hidden>
            <PlayIcon size={16} />
          </span>
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>{title}</span>
          <span className={styles.rowArtist}>{subtitle}</span>
        </span>
        {durationMs !== undefined && (
          <span className={styles.rowTime}>{durationMs ? duration(durationMs) : ""}</span>
        )}
      </button>
      {actions && (
        <span className={styles.rowActions} data-no-drag>
          {actions}
        </span>
      )}
    </div>
  );
}

/** Satırdaki küçük eylem düğmesi. */
export function RowAction({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.rowAction}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ol className={styles.list} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={styles.skeleton} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </ol>
  );
}
