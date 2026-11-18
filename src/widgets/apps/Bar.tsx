import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { createMagnifier, type Magnifier } from "../../lib/magnify";
import { useReducedMotion } from "../../lib/motion";
import { commands, events, report, type AppItem } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Divider } from "../ui";
import type { AppsConfig } from "./index";
import styles from "./Bar.module.css";
import { useFileDrop } from "./useFileDrop";
import { useReorder } from "./useReorder";

const ICON = 40; // tokens.css → --icon-size
const GAP = 6; // tokens.css → --icon-gap
/** Çok uygulama açıkken ikonlar en çok bu boya kadar küçülür (7.8). */
const MIN_ICON = 24;
/** Başlatma zıplaması en çok bu kadar sürer (pencere gelmese de). */
const LAUNCH_MS = 3000;
const NO_APPS: AppItem[] = [];

type Entry = {
  app: AppItem;
  /** Sonradan geldi: belirme animasyonu (açılıştaki ilk liste hariç). */
  entering: boolean;
  /** Listeden çıktı: kaybolma animasyonu bitince silinir. */
  leaving: boolean;
};

/**
 * Rust listesini, kaybolan uygulamaları animasyon bitene kadar eski yerinde
 * tutan görüntü listesine çevirir. (Türetilmiş durum: render sırasında güncellenir.)
 */
function useEntries(apps: AppItem[]) {
  const [state, setState] = useState<{ source: AppItem[] | null; entries: Entry[] }>({
    source: null,
    entries: [],
  });

  if (state.source !== apps) {
    const initial = state.entries.length === 0;
    const prev = new Map(state.entries.filter((e) => !e.leaving).map((e) => [e.app.id, e]));
    const ids = new Set(apps.map((a) => a.id));
    const next: Entry[] = apps.map((app) => {
      const before = prev.get(app.id);
      return { app, entering: !initial && (!before || before.entering), leaving: false };
    });
    state.entries.forEach((e, i) => {
      if (!ids.has(e.app.id)) next.splice(Math.min(i, next.length), 0, { ...e, leaving: true });
    });
    setState({ source: apps, entries: next });
  }

  const drop = (id: string) =>
    setState((s) => ({
      ...s,
      entries: s.entries.filter((e) => !(e.leaving && e.app.id === id)),
    }));
  return [state.entries, drop] as const;
}

/** Tıklanan kapalı uygulamalar: penceresi görünene kadar (en çok 3 sn) zıplar. */
function useLaunching() {
  const [launching, setLaunching] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => window.clearTimeout(t));
  }, []);

  const start = (id: string) => {
    setLaunching((s) => new Set(s).add(id));
    window.clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        setLaunching((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, LAUNCH_MS),
    );
  };
  return [launching, start] as const;
}

/**
 * Bölümde kalan yere sığacak ikon boyu (7.8): bölümün genişliğinden diğer
 * widget'lar çıkarılır, ikonlar sığmazsa `MIN_ICON`'a kadar küçülür. O da
 * yetmezse `room` (kalan genişlik) ile grup kaydırılabilir yapılır.
 */
function useIconSize(group: React.RefObject<HTMLDivElement | null>, count: number) {
  const [fit, setFit] = useState({ size: ICON, room: Infinity });
  useEffect(() => {
    const widget = group.current?.parentElement; // DockWindow → .widget
    const section = widget?.parentElement;
    if (!widget || !section) return;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(section).columnGap) || 0;
      const others = [...section.children]
        .filter((c) => c !== widget)
        // Düzen pikseli (zoom'suz): clientWidth ile aynı birimde (7.9).
        .map((c) => (c as HTMLElement).offsetWidth)
        .filter((w) => w > 0)
        .reduce((sum, w) => sum + w + gap, 0);
      const room = section.clientWidth - others;
      const size = Math.floor((room + GAP) / Math.max(count, 1) - GAP);
      setFit({ size: Math.max(MIN_ICON, Math.min(ICON, size)), room });
    };
    // Gözlemci ilk ölçümü de kendisi yapar; bölüm ve komşu widget'lar değişince yeniler.
    const ro = new ResizeObserver(measure);
    ro.observe(section);
    for (const c of section.children) if (c !== widget) ro.observe(c);
    return () => ro.disconnect();
  }, [group, count]);
  return fit;
}

const noPreview = () => Promise.resolve(null);

export function AppsBar({ config }: { config: AppsConfig }) {
  const apps = useService(commands.getApps, events.apps) ?? NO_APPS;
  // Önizlemesi açık uygulama (8.3): o sırada isim balonları gizli.
  const previewing = useService<string | null>(noPreview, events.previewState) ?? null;
  const [entries, drop] = useEntries(apps);
  const [launching, startLaunch] = useLaunching();
  const groupRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const magnifier = useRef<Magnifier | null>(null);
  // Sıralamadan sonra Rust yeni listeyi gönderene dek gösterilen sıra (8.7).
  const [optimistic, setOptimistic] = useState<{ source: AppItem[]; order: string[] } | null>(null);
  const order = optimistic?.source === apps ? optimistic.order : null;
  const shown = order ? sortPinned(entries, order) : entries;
  const pinnedIds = shown.filter((e) => e.app.pinned && !e.leaving).map((e) => e.app.id);
  const count = entries.filter((e) => !e.leaving).length;
  const { size: icon, room } = useIconSize(groupRef, count);
  // En küçük boyda da sığmıyor: grup kayar (büyüyen ikonlar kırpılacağı için büyütme kapalı).
  const scrolling = count * (icon + GAP) - GAP > room;
  // Animasyon efektleri kapalıysa büyütme de kapalı (7.7).
  const magnify = useReducedMotion() || scrolling ? 1 : config.magnify;
  const dropTarget = useFileDrop(groupRef, magnifier, apps);
  const reorder = useReorder({
    pinned: pinnedIds,
    step: icon + GAP,
    group: groupRef,
    magnifier,
    onReorder: (next) => setOptimistic({ source: apps, order: next }),
  });

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const m = createMagnifier(group, {
      base: icon,
      gap: GAP,
      max: magnify,
      range: icon * 3,
      smoothingMs: 45,
    });
    magnifier.current = m;
    return () => {
      m.destroy();
      magnifier.current = null;
    };
  }, [magnify, icon]);

  // Liste değişince büyütücüye yeni ikon kutularını ver (kaybolanlar hariç).
  const key = shown.map((e) => `${e.app.id}${e.leaving ? "-" : ""}`).join("|");
  useEffect(() => {
    const slots = shown
      .filter((e) => !e.leaving)
      .map((e) => slotRefs.current.get(e.app.id))
      .filter((s): s is HTMLDivElement => !!s);
    magnifier.current?.setSlots(slots);
  }, [key, magnify, icon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pencere küçültme animasyonunun hedefi: ikonların büyütülmemiş konumları.
  // Kutuların o anki (büyümüş olabilecek) yerleri değil, dinlenme düzeni hesaplanır.
  const ids = shown.filter((e) => !e.leaving).map((e) => e.app.id);
  const idsKey = ids.join("|");
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const send = () => {
      // Dikdörtgen ekran (zoom'lu) pikseli; ikon ölçüleri CSS pikseli → çarp (7.9).
      const r = group.getBoundingClientRect();
      const z = group.currentCSSZoom || 1;
      commands
        .setAppIconRects(
          idsKey
            .split("|")
            .filter(Boolean)
            .map((id, i) => ({
              id,
              x: r.left + i * (icon + GAP) * z,
              y: r.top,
              size: icon * z,
            })),
        )
        .catch(report("set_app_icon_rects"));
    };
    send();
    // Soldaki widget'lar değişirse grup kayar: imleç gruba her girdiğinde tazele.
    window.addEventListener("resize", send);
    group.addEventListener("pointerenter", send);
    return () => {
      window.removeEventListener("resize", send);
      group.removeEventListener("pointerenter", send);
    };
  }, [idsKey, icon]);

  // Sabitlenenler ile yalnızca açık olanlar arasında ayraç: ilk sabitlenmemiş ikon.
  const firstUnpinned = shown.findIndex((e) => !e.app.pinned && !e.leaving);
  const hasPinned = pinnedIds.length > 0;

  return (
    <div
      ref={groupRef}
      className={styles.group}
      // Küçülmüş ikonlar çubukta dikeyde ortalı kalsın.
      style={
        icon === ICON
          ? undefined
          : ({
              "--icon-size": `${icon}px`,
              // Kayarken üst pay (3 px, Bar.module.css) da telafi edilir.
              marginTop: (ICON - icon) / 2 - (scrolling ? 3 : 0),
              // Yer hiç kalmasa da en az bir ikon görünür (eksi değer geçersiz sayılıp
              // grup komşu widget'ların altına taşıyordu).
              maxWidth: scrolling ? Math.max(room, icon) : undefined,
            } as CSSProperties)
      }
      data-scrolling={scrolling || undefined}
      data-previewing={previewing ? true : undefined}
      onWheel={(e) => {
        if (scrolling) e.currentTarget.scrollLeft += e.deltaY;
      }}
      data-hit
      data-reordering={reorder.drag ? true : undefined}
      onPointerMove={(e) => {
        if (!reorder.drag) magnifier.current?.move(e.clientX);
      }}
      onPointerLeave={() => magnifier.current?.leave()}
    >
      {shown.map((entry, i) => {
        const { app } = entry;
        const dragged = reorder.drag?.id === app.id;
        const pinnedIndex = app.pinned && !entry.leaving ? pinnedIds.indexOf(app.id) : -1;
        return (
          <div
            key={entry.leaving ? `${app.id}#leaving` : app.id}
            className={styles.slot}
            data-app-id={entry.leaving ? undefined : app.id}
            data-entering={entry.entering || undefined}
            data-leaving={entry.leaving || undefined}
            data-drop-target={dropTarget === app.id || undefined}
            data-dragged={dragged || undefined}
            data-unpinning={(dragged && reorder.unpinning) || undefined}
            // Dock açılışında ikonlar 20 ms arayla belirir (Bar.module.css → intro).
            style={
              {
                "--i": i,
                transform: pinnedIndex >= 0 ? reorder.transform(app.id, pinnedIndex) : undefined,
              } as CSSProperties
            }
            onPointerDown={pinnedIndex >= 0 ? (e) => reorder.start(e, app.id) : undefined}
            onClickCapture={(e) => {
              if (reorder.suppressClick.current) e.stopPropagation();
            }}
            ref={(el) => {
              if (entry.leaving) return;
              if (el) slotRefs.current.set(app.id, el);
              else slotRefs.current.delete(app.id);
            }}
            onAnimationEnd={(e) => {
              if (entry.leaving && e.target === e.currentTarget) drop(app.id);
            }}
          >
            {hasPinned && i === firstUnpinned && <Divider className={styles.divider} />}
            <AppIcon
              app={app}
              previews={config.previews ?? true}
              launching={launching.has(app.id) && app.windows.length === 0}
              onLaunch={startLaunch}
            />
          </div>
        );
      })}
    </div>
  );
}

const AppIcon = memo(function AppIcon({
  app,
  previews,
  launching,
  onLaunch,
}: {
  app: AppItem;
  previews: boolean;
  launching: boolean;
  onLaunch: (id: string) => void;
}) {
  const open = app.windows.length > 0;
  const hidePreview = () => commands.hidePreview().catch(report("hide_preview"));

  return (
    <>
      <div className={styles.pop}>
        <div className={styles.lift} data-launching={launching || undefined}>
          <button
            type="button"
            className={styles.icon}
            aria-label={app.name}
            // Pencere önizlemesi (8.3): yalnızca açık penceresi olanlarda; kapalı
            // uygulamaya geçiş açık önizlemeyi kapatır (isim balonu görünür).
            onPointerEnter={(e) => {
              if (open && previews && e.buttons === 0) {
                const r = e.currentTarget.getBoundingClientRect();
                commands
                  .previewEnter(app.id, { x: r.left, width: r.width })
                  .catch(report("preview_enter"));
              } else {
                commands.previewLeave().catch(report("preview_leave"));
              }
            }}
            onPointerLeave={() => commands.previewLeave().catch(report("preview_leave"))}
            onPointerDown={hidePreview}
            onClick={() => {
              if (!open) onLaunch(app.id);
              commands.activateApp(app.id).catch(report("activate_app"));
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              onLaunch(app.id);
              commands.launchApp(app.id).catch(report("launch_app"));
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault(); // orta tıkta otomatik kaydırmayı engelle
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              commands.showAppMenu(app.id).catch(report("show_app_menu"));
            }}
          >
            {app.icon ? (
              <img className={styles.image} src={app.icon} alt="" draggable={false} />
            ) : (
              <span className={styles.fallback}>{initial(app.name)}</span>
            )}
          </button>
        </div>
      </div>
      {open && <span className={styles.indicator} data-focused={app.focused || undefined} />}
      {/* İsim balonu: yerel `title` yerine; pencere listesi sağ tık menüsünde. */}
      <span className={styles.tooltip} aria-hidden>
        {app.name}
      </span>
    </>
  );
});

/** Sabit ikonları verilen sıraya dizer; diğerleri yerinde kalır. */
function sortPinned(entries: Entry[], order: string[]) {
  const rank = (e: Entry) => {
    const i = e.app.pinned ? order.indexOf(e.app.id) : -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

function initial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase("tr-TR") || "?";
}
