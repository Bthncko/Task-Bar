import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Tile } from "../ui";
import styles from "./Bar.module.css";
import { t } from "../../lib/i18n";

/** Klavye düzeni (8.8): ön plandaki pencerenin giriş dili. */
export function KeyboardBar() {
  const kb = useService(commands.getKeyboard, events.keyboard);
  if (!kb) return null;
  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      className={styles.tile}
      aria-label={t("Giriş dili: {name}. Değiştir", { name: kb.name })}
      title={t("{name}\nTıkla: dil değiştir (Win+Space)", { name: kb.name })}
      onClick={() => commands.systemShortcut("inputSwitch").catch(report("system_shortcut"))}
    >
      {kb.short}
    </Tile>
  );
}
