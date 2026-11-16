import type { WeatherKind } from "../icons";

// WMO hava kodu → Türkçe metin + ikon. Kodlar open-meteo.com/en/docs tablosundan
// (97 "şiddetli fırtına" dahil; 96/99 yalnızca dolu tahmini yapan modellerde gelir).

const TABLE: Record<number, [string, WeatherKind]> = {
  0: ["Açık", "clear"],
  1: ["Çoğunlukla açık", "partly"],
  2: ["Parçalı bulutlu", "partly"],
  3: ["Kapalı", "cloud"],
  45: ["Sis", "fog"],
  48: ["Kırağılı sis", "fog"],
  51: ["Hafif çisenti", "drizzle"],
  53: ["Çisenti", "drizzle"],
  55: ["Yoğun çisenti", "drizzle"],
  56: ["Hafif donan çisenti", "drizzle"],
  57: ["Yoğun donan çisenti", "drizzle"],
  61: ["Hafif yağmur", "rain"],
  63: ["Yağmur", "rain"],
  65: ["Şiddetli yağmur", "rain"],
  66: ["Hafif donan yağmur", "rain"],
  67: ["Şiddetli donan yağmur", "rain"],
  71: ["Hafif kar", "snow"],
  73: ["Kar", "snow"],
  75: ["Yoğun kar", "snow"],
  77: ["Kar taneleri", "snow"],
  80: ["Hafif sağanak", "rain"],
  81: ["Sağanak", "rain"],
  82: ["Şiddetli sağanak", "rain"],
  85: ["Hafif kar sağanağı", "snow"],
  86: ["Yoğun kar sağanağı", "snow"],
  95: ["Gök gürültülü fırtına", "thunder"],
  96: ["Hafif dolulu fırtına", "thunder"],
  97: ["Şiddetli fırtına", "thunder"],
  99: ["Yoğun dolulu fırtına", "thunder"],
};

export function describeWeather(code: number): { text: string; kind: WeatherKind } {
  const entry = TABLE[code];
  return entry ? { text: entry[0], kind: entry[1] } : { text: "Bilinmiyor", kind: "cloud" };
}
