import type { FC } from "react";

/** Katalogdaki gruplar (8.1); sıra = ayarlardaki sıra. */
export const CATEGORIES = {
  core: "Temel",
  system: "Sistem",
  media: "Müzik ve medya",
  info: "Bilgi",
  tools: "Araçlar",
} as const;
export type WidgetCategory = keyof typeof CATEGORIES;

export interface WidgetDefinition<C = unknown> {
  id: string; // "media"
  name: string; // "Müzik"
  /** Ayarlar → Widget'lar kataloğundaki grup. */
  category: WidgetCategory;
  /** Katalogda adın altında: ne gösterir, ne işe yarar (tek cümle). */
  description: string;
  /** Katalogdan eklenince gideceği bölüm (yoksa sağ). */
  defaultSection?: DockSection;
  Bar: FC<{ config: C }>;
  Popup?: FC<{ config: C }>;
  popupSize?: { width: number; height: number };
  defaultConfig: C;
  Settings?: FC<{ config: C; onChange(c: C): void }>;
}

export type DockSection = "left" | "center" | "right";
export type DockLayout = Record<DockSection, { id: string }[]>;
