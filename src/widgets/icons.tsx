import type { ReactNode } from "react";

// Dock genelinde kullanılan çizgi ikonlar: hepsi 24×24 ızgarada, çizgi 1.6 (7.3), currentColor.
// Eksik ikon gerekirse tek set: Lucide (ISC). Şimdilik hepsi elle çizildi.

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// --- müzik ---------------------------------------------------------------------

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const NextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6.5v11l8-5.5z" fill="currentColor" stroke="none" />
    <path d="M17 6.5v11" strokeWidth={2.2} />
  </Svg>
);
export const PrevIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6.5v11l-8-5.5z" fill="currentColor" stroke="none" />
    <path d="M7 6.5v11" strokeWidth={2.2} />
  </Svg>
);

// --- ses -------------------------------------------------------------------------

export function SpeakerIcon({ level, muted, ...p }: IconProps & { level: number; muted: boolean }) {
  return (
    <Svg {...p}>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          {level > 0 && <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />}
          {level > 50 && <path d="M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />}
        </>
      )}
    </Svg>
  );
}

// --- pil -------------------------------------------------------------------------

export function BatteryIcon({ percent, ...p }: IconProps & { percent: number }) {
  const width = Math.max(1, Math.round((Math.min(percent, 100) / 100) * 13));
  return (
    <Svg {...p} size={p.size ?? 20}>
      <rect x="2.5" y="7" width="17" height="10" rx="2.5" />
      <path d="M21.5 10.5v3" strokeWidth={2.2} />
      <rect x="4.5" y="9" width={width} height="6" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z" fill="currentColor" stroke="none" />
  </Svg>
);

// --- genel -----------------------------------------------------------------------

export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 6.5l5.5 5.5-5.5 5.5" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6.5L9 12l5.5 5.5" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

/** Enerji tasarrufu. */
export const LeafIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M5 19c0-8 5-13 15-14-.5 9.5-6 14.5-13 14.5M5 19c2.5-4 5.5-6.5 9-8"
      fill="currentColor"
      fillOpacity={0.9}
    />
  </Svg>
);

// --- radyolar ------------------------------------------------------------------

export function WifiIcon({ bars, off, ...p }: IconProps & { bars: number; off: boolean }) {
  // 0–5 çubuk → 3 yay. Görünmeyen yaylar soluk.
  const arcs = off ? 0 : Math.ceil((Math.min(bars, 5) / 5) * 3);
  const dim = (i: number) => ({ opacity: arcs >= i ? 1 : 0.28 });
  return (
    <Svg {...p}>
      <path d="M2.5 9a14 14 0 0 1 19 0" style={dim(3)} />
      <path d="M5.8 12.4a9.3 9.3 0 0 1 12.4 0" style={dim(2)} />
      <path d="M9 15.7a4.6 4.6 0 0 1 6 0" style={dim(1)} />
      <circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none" />
      {off && <path d="M4 4l16 16" />}
    </Svg>
  );
}

export function BluetoothIcon({ off, ...p }: IconProps & { off: boolean }) {
  return (
    <Svg {...p}>
      <path d="M7 7.5l10 9-5 4.5v-18l5 4.5-10 9" />
      {off && <path d="M4 4l16 16" />}
    </Svg>
  );
}

// --- hava durumu ---------------------------------------------------------------

export type WeatherKind =
  "clear" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "thunder";

const Sun = () => (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </>
);
const Moon = () => <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />;
const CloudPath = ({ y = 0 }: { y?: number }) => (
  <path
    d="M7 18.5h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.8 11 3.8 3.8 0 0 0 7 18.5z"
    transform={`translate(0 ${y})`}
  />
);

export function WeatherIcon({
  kind,
  night,
  ...p
}: IconProps & { kind: WeatherKind; night: boolean }) {
  switch (kind) {
    case "clear":
      return <Svg {...p}>{night ? <Moon /> : <Sun />}</Svg>;
    case "partly":
      return (
        <Svg {...p}>
          <g transform="translate(-3 -4) scale(0.75)">{night ? <Moon /> : <Sun />}</g>
          <CloudPath y={1} />
        </Svg>
      );
    case "cloud":
      return (
        <Svg {...p}>
          <CloudPath y={-1} />
        </Svg>
      );
    case "fog":
      return (
        <Svg {...p}>
          <path d="M4 9h16M3 13h18M5 17h14" />
        </Svg>
      );
    case "drizzle":
      return (
        <Svg {...p}>
          <CloudPath y={-4} />
          <path d="M9 18v1M13 18v1M17 18v1" />
        </Svg>
      );
    case "rain":
      return (
        <Svg {...p}>
          <CloudPath y={-4} />
          <path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3" />
        </Svg>
      );
    case "snow":
      return (
        <Svg {...p}>
          <CloudPath y={-4} />
          <path d="M8 18.5h.01M12 20h.01M16 18.5h.01" strokeWidth={2.6} />
        </Svg>
      );
    case "thunder":
      return (
        <Svg {...p}>
          <CloudPath y={-4} />
          <path d="M12.5 15l-2 3.5h3l-2 3.5" />
        </Svg>
      );
  }
}
