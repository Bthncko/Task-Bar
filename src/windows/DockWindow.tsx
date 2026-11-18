import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { setDockVisible } from "../lib/dockVisible";
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

/**
 * 8.10: imleç dock penceresine (görünür bölgesine) girdi / çıktı → Rust
 * otomatik gizlenmeyi yönetir. Gizliyken bölge kenardaki ince şerittir;
 * imleç ona değince buradan haber gider.
 */
function useReportPointer() {
  useEffect(() => {
    let inside: boolean | null = null;
    const report = (value: boolean) => {
      if (inside === value) return;
      inside = value;
      commands.dockPointer(value).catch((e) => console.error("dock_pointer", e));
    };
    const enter = () => report(true);
    const leave = () => report(false);
    const root = document.documentElement;
    root.addEventListener("mouseenter", enter);
    root.addEventListener("mouseleave", leave);
    // Giriş olayı kaçarsa (bölge imlecin altında değişti) ilk hareket yakalar.
    window.addEventListener("pointermove", enter);
    // Gezgin'den dosya sürüklenirken fare olayı gelmez: gizli dock, dosya kenara
    // gelince de açılsın (uygulamaya / çöp kutusuna bırakılabilsin).
    const unlistenDrag = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") report(true);
      else report(false);
    });
    return () => {
      root.removeEventListener("mouseenter", enter);
      root.removeEventListener("mouseleave", leave);
      window.removeEventListener("pointermove", enter);
      unlistenDrag.then((off) => off());
    };
  }, []);
}

/** Uygulama ikonlarına en az bırakılacak yer (dört küçük ikon, CSS piksel). */
const APPS_MIN = 120;

/**
 * Sıkışık mod: widget'lar çubuğa sığmıyorsa (çok widget ya da büyük boyut
 * ayarı) `html[data-compact]`; geniş karolar ikincil yazılarını gizler (ses
 * aygıtı adı, hava durumu açıklaması, AI etiketleri, dar müzik başlığı).
 *
 * Karar her zaman sıkışık OLMAYAN hâlin ölçüsüyle verilir (öznitelik ölçüm
 * için anlık kaldırılıp geri konur; aynı karede, titreme yok): böylece mod
 * kendi etkisiyle gidip gelmez. Uygulamalar küçülüp kaydığı için onların
 * yerine `APPS_MIN` sayılır.
 */
function useCompact(bar: React.RefObject<HTMLDivElement | null>, layoutKey: string) {
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const html = document.documentElement;
    const measure = () => {
      html.removeAttribute("data-compact");
      const sections = [...el.querySelectorAll<HTMLElement>("[data-section]")];
      const need = sections.reduce((sum, section) => {
        const gap = parseFloat(getComputedStyle(section).columnGap) || 0;
        const widths = [...section.children]
          .map((c) =>
            (c as HTMLElement).dataset.widget === "apps"
              ? APPS_MIN
              : (c as HTMLElement).offsetWidth,
          )
          .filter((w) => w > 0);
        return sum + widths.reduce((s, w) => s + w, 0) + gap * Math.max(widths.length - 1, 0);
      }, 0);
      const cs = getComputedStyle(el);
      const room =
        el.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight) -
        (parseFloat(cs.columnGap) || 0) * (sections.length - 1);
      if (need > room) html.setAttribute("data-compact", "");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const s of el.querySelectorAll("[data-section]")) ro.observe(s);
    return () => ro.disconnect();
  }, [bar, layoutKey]);
}

startConfigSync();

export function DockWindow() {
  useExpandOnHover();
  useReportPointer();
  const config = useConfig();
  const barRef = useRef<HTMLDivElement>(null);
  const layoutKey = config
    ? SECTIONS.map((s) => config.layout[s].map((r) => r.id).join(",")).join("|") +
      `@${config.theme.scale}`
    : "";
  useCompact(barRef, layoutKey);
  const service = useService(commands.getBackdrop, events.backdrop) ?? null;
  // Düz zemin (7.9): duvar kâğıdı şeridi kullanılmaz; çubuk mat ve opak (DockWindow.module.css).
  const flat = config?.theme.glass === "flat";
  const backdrop = flat ? null : service;
  const luma = backdrop?.luma;
  const systemAccent = useService(commands.getSystemAccent, events.accent);

  const [fullscreen, setFullscreen] = useState(false);
  const [autoHidden, setAutoHidden] = useState(false);

  useEffect(() => {
    if (config) applyTheme(config.theme, { luma, systemAccent, zoomDocument: true });
  }, [config?.theme, luma, systemAccent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tam ekrana girerken çubuk aşağı kayar; Rust dock'u ancak sonra arkaya alır.
  useEffect(() => {
    const unlisten = listen<boolean>(events.fullscreen, (e) => setFullscreen(e.payload));
    // Otomatik gizlenme (8.10): aynı kayma; Rust bölgeyi ancak sonra daraltır.
    const unlistenHide = listen<boolean>(events.autohide, (e) => setAutoHidden(e.payload));
    return () => {
      unlisten.then((off) => off());
      unlistenHide.then((off) => off());
    };
  }, []);

  // Çubuk ekranda değilken sürekli güncellenen widget'lar durur (lib/dockVisible).
  useEffect(() => setDockVisible(!fullscreen && !autoHidden), [fullscreen, autoHidden]);

  return (
    <div
      className={styles.root}
      data-edge={DOCK_EDGE}
      data-glass={flat ? "flat" : undefined}
      data-fullscreen={fullscreen || undefined}
      data-autohidden={autoHidden || undefined}
    >
      <div
        ref={barRef}
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
    <div className={`${styles.section} ${styles[section]}`} data-section={section}>
      {items.map(({ id, entering, leaving }) => {
        const widget = registry[id];
        const { Bar } = widget;
        // Widget'ın kendi ayarları config.widgets[id]; yoksa varsayılanı.
        const widgetConfig = widgets[id] ?? widget.defaultConfig;
        return (
          // Anahtar aynı kalır: çıkan widget yeniden takılmaz, son hâli kaybolur.
          <WidgetSlot
            key={id}
            id={id}
            entering={entering}
            leaving={leaving}
            onGone={() => drop(id)}
          >
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
  id,
  entering,
  leaving,
  onGone,
  children,
}: {
  id: string;
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
    // Düzen pikseli (zoom'suz): animasyon CSS genişliği yazıyor (7.9).
    const width = el.offsetWidth;
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
    <div ref={ref} className={styles.widget} data-widget={id} data-leaving={leaving || undefined}>
      {children}
    </div>
  );
}
