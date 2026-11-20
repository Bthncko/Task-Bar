import type { FC } from "react";
import { t } from "../lib/i18n";

/** Katalogdaki gruplar (8.1); sıra = ayarlardaki sıra. */
export const CATEGORIES = {
  get core() {
    return t("Temel");
  },
  get system() {
    return t("Sistem");
  },
  get media() {
    return t("Müzik ve medya");
  },
  get info() {
    return t("Bilgi");
  },
  get tools() {
    return t("Araçlar");
  },
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
  /** `page`: aynı widget'ın farklı paneli ("radios/wifi" → "wifi"). */
  Popup?: FC<{ config: C; page?: string }>;
  popupSize?:
    { width: number; height: number } | ((page?: string) => { width: number; height: number });
  defaultConfig: C;
  Settings?: FC<{ config: C; onChange(c: C): void }>;
}

export type DockSection = "left" | "center" | "right";
export type DockLayout = Record<DockSection, { id: string }[]>;
