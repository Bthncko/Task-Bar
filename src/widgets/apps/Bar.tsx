import { memo, useEffect, useRef, useState } from "react";
import { createMagnifier, type Magnifier } from "../../lib/magnify";
import { commands, events, report, type AppItem } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Divider } from "../ui";
import type { AppsConfig } from "./index";
import styles from "./Bar.module.css";

const ICON = 40; // tokens.css → --icon-size
const GAP = 6; // tokens.css → --icon-gap
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

export function AppsBar({ config }: { config: AppsConfig }) {
  const apps = useService(commands.getApps, events.apps) ?? NO_APPS;
  const [entries, drop] = useEntries(apps);
  const [launching, startLaunch] = useLaunching();
  const groupRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const magnifier = useRef<Magnifier | null>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const m = createMagnifier(group, {
      base: ICON,
      gap: GAP,
      max: config.magnify,
      range: ICON * 3,
      smoothingMs: 45,
    });
    magnifier.current = m;
    return () => {
      m.destroy();
      magnifier.current = null;
    };
  }, [config.magnify]);

  // Liste değişince büyütücüye yeni ikon kutularını ver (kaybolanlar hariç).
  const key = entries.map((e) => `${e.app.id}${e.leaving ? "-" : ""}`).join("|");
  useEffect(() => {
    const slots = entries
      .filter((e) => !e.leaving)
      .map((e) => slotRefs.current.get(e.app.id))
      .filter((s): s is HTMLDivElement => !!s);
    magnifier.current?.setSlots(slots);
  }, [key, config.magnify]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pencere küçültme animasyonunun hedefi: ikonların büyütülmemiş konumları.
  // Kutuların o anki (büyümüş olabilecek) yerleri değil, dinlenme düzeni hesaplanır.
  const ids = entries.filter((e) => !e.leaving).map((e) => e.app.id);
  const idsKey = ids.join("|");
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const send = () => {
      const r = group.getBoundingClientRect();
      commands
        .setAppIconRects(
          idsKey
            .split("|")
            .filter(Boolean)
            .map((id, i) => ({ id, x: r.left + i * (ICON + GAP), y: r.top, size: ICON })),
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
  }, [idsKey]);

  // Sabitlenenler ile yalnızca açık olanlar arasında ayraç: ilk sabitlenmemiş ikon.
  const firstUnpinned = entries.findIndex((e) => !e.app.pinned && !e.leaving);
  const hasPinned = entries.some((e) => e.app.pinned && !e.leaving);

  return (
    <div
      ref={groupRef}
      className={styles.group}
      data-hit
      onPointerMove={(e) => magnifier.current?.move(e.clientX)}
      onPointerLeave={() => magnifier.current?.leave()}
    >
      {entries.map((entry, i) => {
        const { app } = entry;
        return (
          <div
            key={entry.leaving ? `${app.id}#leaving` : app.id}
            className={styles.slot}
            data-entering={entry.entering || undefined}
            data-leaving={entry.leaving || undefined}
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
  launching,
  onLaunch,
}: {
  app: AppItem;
  launching: boolean;
  onLaunch: (id: string) => void;
}) {
  const open = app.windows.length > 0;

  return (
    <>
      <div className={styles.pop}>
        <div className={styles.lift} data-launching={launching || undefined}>
          <button
            type="button"
            className={styles.icon}
            aria-label={app.name}
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

function initial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase("tr-TR") || "?";
}
