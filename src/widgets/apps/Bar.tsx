import { memo, useEffect, useRef } from "react";
import { createMagnifier, type Magnifier } from "../../lib/magnify";
import { commands, events, report, type AppItem } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import type { AppsConfig } from "./index";
import styles from "./Bar.module.css";

const ICON = 40; // tokens.css → --icon-size
const GAP = 6; // tokens.css → --icon-gap

export function AppsBar({ config }: { config: AppsConfig }) {
  const apps = useService(commands.getApps, events.apps) ?? [];
  const groupRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
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

  // Liste değişince büyütücüye yeni ikon kutularını ver.
  const key = apps.map((a) => a.id).join("|");
  useEffect(() => {
    slotRefs.current.length = apps.length;
    magnifier.current?.setSlots(slotRefs.current.filter((s): s is HTMLDivElement => !!s));
  }, [key, apps.length, config.magnify]);

  return (
    <div
      ref={groupRef}
      className={styles.group}
      data-hit
      onPointerMove={(e) => magnifier.current?.move(e.clientX)}
      onPointerLeave={() => magnifier.current?.leave()}
    >
      {apps.map((app, i) => (
        <div
          key={app.id}
          className={styles.slot}
          ref={(el) => {
            slotRefs.current[i] = el;
          }}
        >
          <AppIcon app={app} />
        </div>
      ))}
    </div>
  );
}

const AppIcon = memo(function AppIcon({ app }: { app: AppItem }) {
  const open = app.windows.length > 0;
  const tooltip = open
    ? [app.name, ...app.windows.map((w) => `• ${w.title}`)].join("\n")
    : app.name;

  return (
    <>
      <button
        type="button"
        className={styles.icon}
        title={tooltip}
        aria-label={app.name}
        onClick={() => commands.activateApp(app.id).catch(report("activate_app"))}
        onAuxClick={(e) => {
          if (e.button === 1) commands.launchApp(app.id).catch(report("launch_app"));
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
      {open && (
        <span className={styles.dots} data-focused={app.focused}>
          <span className={styles.dot} />
          {app.windows.length > 1 && <span className={styles.dot} />}
        </span>
      )}
    </>
  );
});

function initial(name: string) {
  return name.trim().charAt(0).toLocaleUpperCase("tr-TR") || "?";
}
