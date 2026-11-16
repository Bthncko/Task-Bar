import type { WidgetDefinition } from "../types";
import { WeatherBar } from "./Bar";

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
  defaultConfig: { lat: 41.01, lon: 28.98, city: "İstanbul", unit: "C" },
};
