import { useState } from "react";
import { commands, events, report, type TrayIcon } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import styles from "./TrayPopup.module.css";

/**
 * Tepsi (gizli simgeler): uygulamaların bildirim alanı simgeleri dock tarzında.
 * Simgeler Rust'taki kendi `Shell_TrayWnd` penceremizden gelir (`win/tray_host`).
 * Sol tık / çift tık / sağ tık uygulamaya Windows'un tepsisi gibi iletilir.
 */
export function TrayPopup() {
  const tray = useService(commands.getTray, events.tray);
  const close = usePopupClose();
  const [hover, setHover] = useState<TrayIcon | null>(null);

  const windowsTray = () => {
    close();
    commands.systemShortcut("tray").catch(report("system_shortcut"));
  };

  const icons = tray?.icons ?? [];
  // Simge kaybolduysa (uygulama kapandı) alt satırdaki ad da gitsin.
  const hovered = hover && icons.some((i) => i.id === hover.id) ? hover : null;

  return (
    <div className={styles.root}>
      <PanelHeader title="Tepsi" />
      {tray && !tray.active ? (
        <p className={styles.note}>Simgeler şu an Windows'un tepsisinde.</p>
      ) : tray && icons.length === 0 ? (
        <p className={styles.note}>Tepside simge yok.</p>
      ) : (
        <ul className={styles.grid} onPointerLeave={() => setHover(null)}>
          {icons.map((icon) => (
            <li key={icon.id}>
              <button
                type="button"
                className={styles.icon}
                aria-label={icon.tip || "Tepsi simgesi"}
                onPointerEnter={() => setHover(icon)}
                onFocus={() => setHover(icon)}
                onClick={() => commands.trayClick(icon.id, "left").catch(report("tray_click"))}
                onDoubleClick={() =>
                  commands.trayClick(icon.id, "double").catch(report("tray_click"))
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  commands.trayClick(icon.id, "right").catch(report("tray_click"));
                }}
              >
                {icon.icon ? (
                  <img src={icon.icon} alt="" draggable={false} />
                ) : (
                  <span className={styles.blank} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className={styles.footer}>
        <span className={styles.tip}>
          {hovered ? hovered.tip.split("\n")[0] || "Adsız simge" : `${icons.length} simge`}
        </span>
        <LinkButton onClick={windowsTray}>Windows tepsisi</LinkButton>
      </footer>
    </div>
  );
}
