import { commands, report } from "../../lib/ipc";
import { IconButton, Tile } from "../ui";
import { SYSTEM_BUTTONS } from "./buttons";
import type { SystemConfig } from "./index";

/** Windows'un kendi panellerini açan düğmeler (8.2); kısayol gönderir. */
export function SystemBar({ config }: { config: SystemConfig }) {
  const shown = SYSTEM_BUTTONS.filter((b) => config.buttons.includes(b.id));
  if (shown.length === 0) return null;
  return (
    <Tile variant="plain">
      {shown.map((b) => (
        <IconButton
          key={b.id}
          aria-label={b.name}
          title={`${b.name} (${b.keys})`}
          onClick={(e) => {
            if (b.id === "tray") {
              const r = e.currentTarget.getBoundingClientRect();
              commands.openTray({ x: r.left, width: r.width }).catch(report("open_tray"));
            } else {
              commands.systemShortcut(b.id).catch(report("system_shortcut"));
            }
          }}
        >
          {b.icon}
        </IconButton>
      ))}
    </Tile>
  );
}
