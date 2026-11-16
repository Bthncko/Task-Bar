import type { FC } from "react";

export interface WidgetDefinition<C = unknown> {
  id: string; // "media"
  name: string; // "Müzik"
  Bar: FC<{ config: C }>;
  Popup?: FC<{ config: C }>;
  popupSize?: { width: number; height: number };
  defaultConfig: C;
  Settings?: FC<{ config: C; onChange(c: C): void }>;
}

export type DockSection = "left" | "center" | "right";
export type DockLayout = Record<DockSection, { id: string }[]>;
