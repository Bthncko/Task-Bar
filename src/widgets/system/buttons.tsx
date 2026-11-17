import type { ReactNode } from "react";
import type { SystemButton } from "../../lib/ipc";
import {
  BellIcon,
  ChevronUpIcon,
  ClipboardIcon,
  DesktopIcon,
  MoonIcon,
  QuickSettingsIcon,
  SearchIcon,
  SnipIcon,
  TaskViewIcon,
} from "../icons";

/** Sıra = dock'taki ve ayarlardaki sıra. */
export const SYSTEM_BUTTONS: {
  id: SystemButton;
  name: string;
  keys: string;
  icon: ReactNode;
}[] = [
  { id: "tray", name: "Gizli simgeler (tepsi)", keys: "Win+B", icon: <ChevronUpIcon size={17} /> },
  { id: "notifications", name: "Bildirim merkezi", keys: "Win+N", icon: <BellIcon size={17} /> },
  {
    id: "quickSettings",
    name: "Hızlı ayarlar",
    keys: "Win+A",
    icon: <QuickSettingsIcon size={17} />,
  },
  { id: "taskView", name: "Görev görünümü", keys: "Win+Tab", icon: <TaskViewIcon size={17} /> },
  { id: "search", name: "Arama", keys: "Win+S", icon: <SearchIcon size={17} /> },
  { id: "clipboard", name: "Pano geçmişi", keys: "Win+V", icon: <ClipboardIcon size={17} /> },
  { id: "snip", name: "Ekran alıntısı", keys: "Win+Shift+S", icon: <SnipIcon size={17} /> },
  { id: "desktop", name: "Masaüstünü göster", keys: "Win+D", icon: <DesktopIcon size={17} /> },
  {
    id: "nightLight",
    name: "Gece ışığı ayarları",
    keys: "ayar sayfası",
    icon: <MoonIcon size={16} />,
  },
];
