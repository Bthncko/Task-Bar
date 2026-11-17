import { useEffect, useRef, useState } from "react";
import { commands, report } from "../../lib/ipc";

/**
 * Parlaklık (%): açılışta ve `pollMs` aralığıyla okunur (klavyenin parlaklık
 * tuşları da değiştirir; Windows olay vermiyor). `null`: ayarlanamıyor.
 */
export function useBrightness(pollMs: number) {
  const [value, setValue] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      commands
        .getBrightness()
        .then((v) => alive && setValue(v))
        .catch(report("get_brightness"));
    load();
    const id = window.setInterval(load, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pollMs]);
  return [value, setValue] as const;
}

/**
 * Parlaklığı gönderir: bir istek sürerken gelen değerlerden yalnızca sonuncusu,
 * istek bitince gönderilir (WMI çağrısı yavaş olabilir).
 */
export function useBrightnessSender() {
  const busy = useRef(false);
  const pending = useRef<number | null>(null);

  const send = (v: number) => {
    if (busy.current) {
      pending.current = v;
      return;
    }
    busy.current = true;
    commands
      .setBrightness(v)
      .catch(report("set_brightness"))
      .finally(() => {
        busy.current = false;
        const next = pending.current;
        pending.current = null;
        if (next !== null) send(next);
      });
  };
  return send;
}
