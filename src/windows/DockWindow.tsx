import { useEffect, useRef } from "react";
import { commands } from "../lib/ipc";
import { startConfigSync, useConfig } from "../lib/store";
import { applyTheme } from "../lib/theme";
import { registry } from "../widgets/registry";
import type { DockSection } from "../widgets/types";
import styles from "./DockWindow.module.css";

// src-tauri/src/win/placement.rs → EDGE ile aynı tutulmalı.
// (Config'teki `position` Aşama 6'da Rust'a bağlanınca buradan okunacak.)
const DOCK_EDGE: "top" | "bottom" = "bottom";

const SECTIONS: DockSection[] = ["left", "center", "right"];
const COLLAPSE_DELAY_MS = 150;

/**
 * 3.2: pencere hep bar + pay yüksekliğinde, ama normalde yalnızca bar şeridi
 * görünür ve tıklanır (Rust'ta pencere bölgesi). İmleç dock'a girince bölgeyi
 * açtırırız; imleç bardan ve büyümüş ikonlardan çıkınca kısa gecikmeyle daraltırız.
 */
function useExpandOnHover() {
  const expanded = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const set = (value: boolean) => {
      if (expanded.current === value) return;
      expanded.current = value;
      commands.setDockExpanded(value).catch((e) => console.error("set_dock_expanded", e));
    };
    const cancel = () => window.clearTimeout(timer.current);
    const scheduleCollapse = () => {
      cancel();
      timer.current = window.setTimeout(() => set(false), COLLAPSE_DELAY_MS);
    };

    const onMove = (e: PointerEvent) => {
      const hit = (e.target as Element | null)?.closest("[data-hit]");
      if (hit) {
        cancel();
        set(true);
      } else if (expanded.current) {
        scheduleCollapse();
      }
    };

    const root = document.documentElement;
    window.addEventListener("pointermove", onMove);
    root.addEventListener("mouseleave", scheduleCollapse);
    return () => {
      cancel();
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("mouseleave", scheduleCollapse);
    };
  }, []);
}

startConfigSync();

export function DockWindow() {
  useExpandOnHover();
  const config = useConfig();

  useEffect(() => {
    if (config) applyTheme(config.theme);
  }, [config?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.root} data-edge={DOCK_EDGE}>
      <div
        className={styles.bar}
        data-hit
        // Widget'ların kendi sağ tık menüleri varsa onlar önce davranır.
        onContextMenu={(e) => {
          if (e.defaultPrevented) return;
          e.preventDefault();
          commands.showDockMenu().catch((err) => console.error("show_dock_menu", err));
        }}
      >
        {config &&
          SECTIONS.map((section) => (
            <div key={section} className={`${styles.section} ${styles[section]}`}>
              {config.layout[section].map(({ id }) => {
                const widget = registry[id];
                if (!widget) return null;
                const { Bar } = widget;
                // Widget'ın kendi ayarları config.widgets[id]; yoksa varsayılanı.
                const widgetConfig = config.widgets[id] ?? widget.defaultConfig;
                return <Bar key={id} config={widgetConfig} />;
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
