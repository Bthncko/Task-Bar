import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Servis deseni (bölüm 2): açılışta `get` ile ilk durumu al, sonra olayla güncelle.
 * Olay, ilk yanıttan önce gelirse olaydaki (daha yeni) değer korunur.
 */
export function useService<T>(get: () => Promise<T>, event: string): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    let gotEvent = false;
    const unlisten = listen<T>(event, (e) => {
      gotEvent = true;
      if (alive) setValue(e.payload);
    });
    get()
      .then((v) => {
        if (alive && !gotEvent) setValue(v);
      })
      .catch((e) => console.error(event, e));
    return () => {
      alive = false;
      unlisten.then((off) => off());
    };
    // get ve event sabit kabul edilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}
