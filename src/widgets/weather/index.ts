import type { WidgetDefinition } from "../types";
import { WeatherBar } from "./Bar";
import { WeatherPopup } from "./Popup";

export interface WeatherConfig {
  lat: number;
  lon: number;
  city: string;
  unit: "C" | "F";
}

export const weatherWidget: WidgetDefinition<WeatherConfig> = {
  id: "weather",
  name: "Hava durumu",
  Bar: WeatherBar,
  Popup: WeatherPopup,
  popupSize: { width: 340, height: 500 },
  defaultConfig: { lat: 41.01, lon: 28.98, city: "İstanbul", unit: "C" },
};
