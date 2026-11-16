import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, events, type Config } from "../lib/ipc";
import { useReducedMotion } from "../lib/motion";
import { usePresence } from "../lib/presence";
import { useService } from "../lib/useService";
import { Glass } from "./Glass";
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
  const backdrop = useService(commands.getBackdrop, events.backdrop) ?? null;
  const luma = backdrop?.luma;

  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (config) applyTheme(config.theme, luma);
  }, [config?.theme, luma]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tam ekrana girerken çubuk aşağı kayar; Rust dock'u ancak sonra arkaya alır.
  useEffect(() => {
    const unlisten = listen<boolean>(events.fullscreen, (e) => setFullscreen(e.payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  return (
    <div className={styles.root} data-edge={DOCK_EDGE} data-fullscreen={fullscreen || undefined}>
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
        <Glass image={backdrop?.image ?? null} />
        {config &&
          SECTIONS.map((section) => (
            <Section
              key={section}
              section={section}
              ids={config.layout[section].map((r) => r.id).filter((id) => registry[id])}
              widgets={config.widgets}
            />
          ))}
      </div>
    </div>
  );
}

function Section({
  section,
  ids,
  widgets,
}: {
  section: DockSection;
  ids: string[];
  widgets: Config["widgets"];
}) {
  const [items, drop] = usePresence(ids);
  return (
    <div className={`${styles.section} ${styles[section]}`}>
      {items.map(({ id, entering, leaving }) => {
        const widget = registry[id];
        const { Bar } = widget;
        // Widget'ın kendi ayarları config.widgets[id]; yoksa varsayılanı.
        const widgetConfig = widgets[id] ?? widget.defaultConfig;
        return (
          // Anahtar aynı kalır: çıkan widget yeniden takılmaz, son hâli kaybolur.
          <WidgetSlot key={id} entering={entering} leaving={leaving} onGone={() => drop(id)}>
            <Bar config={widgetConfig} />
          </WidgetSlot>
        );
      })}
    </div>
  );
}

/** Widget eklenince / çıkarılınca (ayarlardan): genişlik + opaklık, 250 ms (7.7). */
const SLOT_MS = 250;

function WidgetSlot({
  entering,
  leaving,
  onGone,
  children,
}: {
  entering: boolean;
  leaving: boolean;
  onGone: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (!entering && !leaving)) return;
    const width = el.getBoundingClientRect().width;
    // Boş widget (ör. müzik çalmıyor) ya da animasyonlar kapalı: hemen.
    if (width === 0 || reduced) {
      if (leaving) gone.current();
      return;
    }
    // Bölüm aralığı da kapansın: komşusu olan taraftaki boşluk eriyerek.
    const gap = parseFloat(getComputedStyle(el.parentElement!).columnGap) || 0;
    const side = el.nextElementSibling ? "marginRight" : "marginLeft";
    const shown = { width: `${width}px`, opacity: 1, [side]: "0px" };
    const hidden = { width: "0px", opacity: 0, [side]: `${-gap}px` };
    el.style.overflow = "hidden";
    const anim = el.animate(entering ? [hidden, shown] : [shown, hidden], {
      duration: SLOT_MS,
      easing: entering ? "ease-out" : "ease-in",
      fill: leaving ? "forwards" : "none",
    });
    anim.onfinish = () => {
      el.style.overflow = "";
      if (leaving) gone.current();
    };
    return () => {
      anim.onfinish = null;
      anim.cancel();
      el.style.overflow = "";
    };
  }, [entering, leaving, reduced]);

  return (
    <div ref={ref} className={styles.widget} data-leaving={leaving || undefined}>
      {children}
    </div>
  );
}
