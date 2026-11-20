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
import { t } from "../../lib/i18n";

/** Sıra = dock'taki ve ayarlardaki sıra. */
export const SYSTEM_BUTTONS: {
  id: SystemButton;
  name: string;
  keys: string;
  icon: ReactNode;
}[] = [
  {
    id: "tray",
    get name() {
      return t("Gizli simgeler (tepsi)");
    },
    keys: "Win+B",
    icon: <ChevronUpIcon size={17} />,
  },
  {
    id: "notifications",
    get name() {
      return t("Bildirim merkezi");
    },
    keys: "Win+N",
    icon: <BellIcon size={17} />,
  },
  {
    id: "quickSettings",
    get name() {
      return t("Hızlı ayarlar");
    },
    keys: "Win+A",
    icon: <QuickSettingsIcon size={17} />,
  },
  {
    id: "taskView",
    get name() {
      return t("Görev görünümü");
    },
    keys: "Win+Tab",
    icon: <TaskViewIcon size={17} />,
  },
  {
    id: "search",
    get name() {
      return t("Arama");
    },
    keys: "Win+S",
    icon: <SearchIcon size={17} />,
  },
  {
    id: "clipboard",
    get name() {
      return t("Pano geçmişi");
    },
    keys: "Win+V",
    icon: <ClipboardIcon size={17} />,
  },
  {
    id: "snip",
    get name() {
      return t("Ekran alıntısı");
    },
    keys: "Win+Shift+S",
    icon: <SnipIcon size={17} />,
  },
  {
    id: "desktop",
    get name() {
      return t("Masaüstünü göster");
    },
    keys: "Win+D",
    icon: <DesktopIcon size={17} />,
  },
  {
    id: "nightLight",
    get name() {
      return t("Gece ışığı ayarları");
    },
    get keys() {
      return t("ayar sayfası");
    },
    icon: <MoonIcon size={16} />,
  },
];
