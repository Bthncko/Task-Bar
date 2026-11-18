import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { commands, report, type AppItem } from "../../lib/ipc";
import type { Magnifier } from "../../lib/magnify";

/** Dosyayla açık bir uygulamanın ikonunda bu kadar bekleyince penceresi öne gelir. */
const HOVER_MS = 500;

const isApp = (path: string) => /\.(exe|lnk)$/i.test(path);

/**
 * Gezgin'den dock'a dosya sürükleme (8.7). Tauri'nin sürükle-bırak olayları
 * (konum: webview'e göre fiziksel piksel) işaretçi olayı üretmediği için
 * büyütme, vurgu ve bölge genişletme buradan sürülür.
 *
 * - İkonda bekleme → açık penceresi öne gelir (dosya pencereye bırakılabilir).
 * - İkona bırakma → dosyalar o uygulamayla açılır.
 * - Boş alana `.exe` / `.lnk` bırakma → sabitlenir.
 *
 * Döner: üzerinde dosya duran uygulamanın kimliği (vurgu için).
 */
export function useFileDrop(
  group: React.RefObject<HTMLDivElement | null>,
  magnifier: React.RefObject<Magnifier | null>,
  apps: AppItem[],
) {
  const [target, setTarget] = useState<string | null>(null);
  const latest = useRef(apps);
  useEffect(() => {
    latest.current = apps;
  }, [apps]);

  useEffect(() => {
    let over: string | null = null;
    let timer = 0;

    const appAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest("[data-app-id]") as HTMLElement | null)?.dataset
        .appId ?? null;

    // Fiziksel piksel → istemci (CSS) pikseli; işaretçi olaylarının clientX'i ile aynı birim.
    const client = (p: { x: number; y: number }) => ({
      x: p.x / window.devicePixelRatio,
      y: p.y / window.devicePixelRatio,
    });

    const hover = (id: string | null) => {
      if (id === over) return;
      over = id;
      setTarget(id);
      window.clearTimeout(timer);
      const app = latest.current.find((a) => a.id === id);
      if (app && app.windows.length > 0) {
        const hwnd = app.windows[0].hwnd;
        timer = window.setTimeout(
          () => commands.activateWindow(hwnd).catch(report("activate_window")),
          HOVER_MS,
        );
      }
    };

    const track = (x: number, y: number) => {
      const r = group.current?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right) magnifier.current?.move(x);
      else magnifier.current?.leave();
      hover(appAt(x, y));
    };

    const end = () => {
      window.clearTimeout(timer);
      over = null;
      setTarget(null);
      magnifier.current?.leave();
      commands.setDockExpanded(false).catch(report("set_dock_expanded"));
    };

    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      switch (payload.type) {
        case "enter": {
          // Büyümüş ikonlar bar şeridinin dışına taşar: bölge açık kalsın.
          commands.setDockExpanded(true).catch(report("set_dock_expanded"));
          const { x, y } = client(payload.position);
          track(x, y);
          break;
        }
        case "over": {
          const { x, y } = client(payload.position);
          track(x, y);
          break;
        }
        case "drop": {
          const { x, y } = client(payload.position);
          const id = appAt(x, y);
          // Kendi bırakma hedefi olan widget (ör. çöp kutusu) dosyayı kendisi işler.
          const claimed = document.elementFromPoint(x, y)?.closest("[data-file-drop]");
          if (id) {
            commands.openFilesWithApp(id, payload.paths).catch(report("open_files_with_app"));
          } else if (!claimed) {
            for (const path of payload.paths.filter(isApp)) {
              commands.pinPath(path).catch(report("pin_path"));
            }
          }
          end();
          break;
        }
        case "leave":
          end();
          break;
      }
    });
    return () => {
      window.clearTimeout(timer);
      unlisten.then((off) => off());
    };
  }, [group, magnifier]);

  return target;
}
