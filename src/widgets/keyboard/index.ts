import type { WidgetDefinition } from "../types";
import { KeyboardBar } from "./Bar";
import { t } from "../../lib/i18n";

export const keyboardWidget: WidgetDefinition<Record<string, never>> = {
  id: "keyboard",
  get name() {
    return t("Klavye düzeni");
  },
  category: "system",
  get description() {
    return t("Etkin giriş dili (TR / EN); tıklayınca dil değiştirici (Win+Space).");
  },
  defaultSection: "right",
  Bar: KeyboardBar,
  defaultConfig: {},
};
