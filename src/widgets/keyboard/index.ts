import type { WidgetDefinition } from "../types";
import { KeyboardBar } from "./Bar";

export const keyboardWidget: WidgetDefinition<Record<string, never>> = {
  id: "keyboard",
  name: "Klavye düzeni",
  category: "system",
  description: "Etkin giriş dili (TR / EN); tıklayınca dil değiştirici (Win+Space).",
  defaultSection: "right",
  Bar: KeyboardBar,
  defaultConfig: {},
};
