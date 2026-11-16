import { useEffect, useRef } from "react";
import { commands } from "../lib/ipc";
import { registry } from "../widgets/registry";
import type { DockLayout, DockSection } from "../widgets/types";
import styles from "./DockWindow.module.css";

// src-tauri/src/win/placement.rs → EDGE ile aynı tutulmalı.
const DOCK_EDGE: "top" | "bottom" = "top";

// Aşama 4'te config.json'dan gelecek.
const LAYOUT: DockLayout = {
  left: [{ id: "start" }, { id: "apps" }],
  center: [{ id: "clock" }],
  right: [],
};

const SECTIONS: DockSection[] = ["left", "center", "right"];
const COLLAPSE_DELAY_MS = 150;

/**
 * 3.2 Plan A: pencere normalde yalnızca bar yüksekliğinde. İmleç dock'a girince
 * Rust'tan pencereyi büyütme payı kadar uzatmasını isteriz; imleç bardan ve
 * büyümüş ikonlardan çıkınca kısa bir gecikmeyle geri küçültürüz.
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

export function DockWindow() {
  useExpandOnHover();

  return (
    <div className={styles.root} data-edge={DOCK_EDGE}>
      <div className={styles.bar} data-hit>
        {SECTIONS.map((section) => (
          <div key={section} className={`${styles.section} ${styles[section]}`}>
            {LAYOUT[section].map(({ id }) => {
              const widget = registry[id];
              if (!widget) return null;
              const { Bar } = widget;
              return <Bar key={id} config={widget.defaultConfig} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
