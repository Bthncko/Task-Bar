import {
  createElement,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./ui.module.css";

// Karo sistemi (PLAN-ASAMA-7 7.3): dock widget'larının ortak parçaları.

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

export type TileVariant = "plain" | "soft" | "tinted" | "solid" | "dark";

type TileProps = (HTMLAttributes<HTMLElement> & ButtonHTMLAttributes<HTMLButtonElement>) & {
  /** `button`: tıklanabilir karo (klavye ile de). */
  as?: "div" | "button";
  variant?: TileVariant;
  /** Hover zemini + basınca hafif küçülme. */
  interactive?: boolean;
  /** `tinted` için degrade rengi (`--tile-color`). */
  color?: string;
};

/**
 * Karo: `plain` (zeminsiz), `soft` (`--tile`), `tinted` (`--tile-color`
 * degradesi), `solid` (vurgu). Yükseklik, köşe ve hover tüm widget'larda aynı.
 */
export function Tile({
  as = "div",
  variant = "soft",
  interactive = as === "button",
  color,
  className,
  style,
  ...rest
}: TileProps) {
  return createElement(as, {
    ...rest,
    ...(as === "button" ? { type: rest.type ?? "button" } : {}),
    className: cx(styles.tile, styles[variant], interactive && styles.interactive, className),
    style: color ? ({ ...style, "--tile-color": color } as CSSProperties) : style,
  });
}

/** 28 px yuvarlak düğme (karoların içindeki küçük eylemler). */
export function IconButton({
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return <button type="button" {...rest} className={cx(styles.iconButton, className)} />;
}

/** Hap düğme; `active` iken vurgu çerçevesi + `--accent-soft` zemin. */
export function Pill({
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      data-active={active || undefined}
      className={cx(styles.pill, className)}
    />
  );
}

/** Kalın dolgu çubuğu (0–100). */
export function Meter({
  value,
  muted,
  className,
  style,
}: {
  value: number;
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div className={cx(styles.meter, className)} style={style} data-muted={muted || undefined}>
      <div className={styles.meterFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Gruplar arası dikey ince çizgi. */
export function Divider({ className }: { className?: string }) {
  return <span className={cx(styles.divider, className)} aria-hidden />;
}

/** Eş genişlikli rakamlarla değer (yüzde, derece...). */
export function Value({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <span className={cx(styles.value, dim && styles.dim)}>{children}</span>;
}

/** İkincil (soluk) içerik. */
export function Dim({ children }: { children: ReactNode }) {
  return <span className={styles.dim}>{children}</span>;
}
