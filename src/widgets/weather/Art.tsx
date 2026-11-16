import { useId } from "react";
import type { WeatherKind } from "../icons";

// Renkli hava ikonları (7.5): dolgulu, 32×32 ızgara. Elle çizildi, harici set yok.

const SUN = "#ffc93c";
const SUN_EDGE = "#ff9f1c";
const MOON = "#e9edf7";
const DROP = "#7cc8ff";
const BOLT = "#ffd84a";

export function WeatherArt({
  kind,
  night,
  size = 32,
  className,
}: {
  kind: WeatherKind;
  night: boolean;
  size?: number;
  className?: string;
}) {
  // url(#…) başvuruları için yalnızca güvenli karakterler.
  const id = `w${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const sunGrad = `${id}-sun`;
  const cloudGrad = `${id}-cloud`;
  const darkCloud = kind === "rain" || kind === "thunder" || kind === "drizzle";

  const sun = (cx: number, cy: number, r: number) =>
    night ? (
      <g>
        <mask id={`${id}-moon-${cx}`}>
          <rect width="32" height="32" fill="#fff" />
          <circle cx={cx + r * 0.6} cy={cy - r * 0.45} r={r * 0.82} fill="#000" />
        </mask>
        <circle cx={cx} cy={cy} r={r} fill={MOON} mask={`url(#${id}-moon-${cx})`} />
      </g>
    ) : (
      <g>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          const [c, s] = [Math.cos(a), Math.sin(a)];
          return (
            <line
              key={i}
              x1={cx + c * (r + 2)}
              y1={cy + s * (r + 2)}
              x2={cx + c * (r + 4.5)}
              y2={cy + s * (r + 4.5)}
              stroke={SUN}
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx={cx} cy={cy} r={r} fill={`url(#${sunGrad})`} />
      </g>
    );

  const cloud = (dy: number) => (
    <path
      transform={`translate(0 ${dy})`}
      d="M9.5 26h14a5.5 5.5 0 0 0 .6-10.97A7.5 7.5 0 0 0 9.6 16.6 4.7 4.7 0 0 0 9.5 26z"
      fill={`url(#${cloudGrad})`}
    />
  );

  let body;
  switch (kind) {
    case "clear":
      body = sun(16, 16, 7);
      break;
    case "partly":
      body = (
        <>
          {sun(12, 12, 5.5)}
          {cloud(2)}
        </>
      );
      break;
    case "cloud":
      body = cloud(0);
      break;
    case "fog":
      body = (
        <>
          {cloud(-4)}
          <path d="M6 25h20M9 29h14" stroke="#cfd6e3" strokeWidth={2} strokeLinecap="round" />
        </>
      );
      break;
    case "drizzle":
    case "rain":
      body = (
        <>
          {cloud(-5)}
          {(kind === "rain" ? [11, 16, 21] : [12, 20]).map((x) => (
            <path
              key={x}
              d={`M${x} 24.5l-1.6 4`}
              stroke={DROP}
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </>
      );
      break;
    case "snow":
      body = (
        <>
          {cloud(-5)}
          {[
            [11, 25],
            [16, 28],
            [21, 25],
          ].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r={1.6} fill="#fff" />
          ))}
        </>
      );
      break;
    case "thunder":
      body = (
        <>
          {cloud(-5)}
          <path d="M17 21l-4 6h3.5l-2 5 5.5-7h-3.5l2-4z" fill={BOLT} />
        </>
      );
      break;
  }

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={sunGrad} cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffe27a" />
          <stop offset="0.6" stopColor={SUN} />
          <stop offset="1" stopColor={SUN_EDGE} />
        </radialGradient>
        <linearGradient id={cloudGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={darkCloud ? "#e3e8f1" : "#ffffff"} />
          <stop offset="1" stopColor={darkCloud ? "#a9b4c6" : "#d9e0ec"} />
        </linearGradient>
      </defs>
      {body}
    </svg>
  );
}
