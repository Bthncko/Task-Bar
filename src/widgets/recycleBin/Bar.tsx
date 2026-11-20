import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Tile } from "../ui";
import styles from "./Bar.module.css";
import { t } from "../../lib/i18n";

function size(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Yutma animasyonu (Bar.module.css `gulp`) süresi. */
const GULP_MS = 420;

/**
 * Gezgin'den sürüklenen dosya karonun üstünde mi; bırakılınca kutuya gönder.
 * Tauri'nin sürükleme olayları fiziksel piksel verir (useFileDrop ile aynı).
 * Uygulamalar widget'ı `data-file-drop` taşıyan karoya bırakılanı sabitlemez.
 */
function useRecycleDrop(tile: React.RefObject<HTMLElement | null>) {
  const [over, setOver] = useState(false);
  // Bırakınca bir kez "yutar": kapak kapanırken kutu hafifçe esner.
  const [swallowing, setSwallowing] = useState(false);

  useEffect(() => {
    let timer = 0;
    const inside = (p: { x: number; y: number }) => {
      const el = document.elementFromPoint(
        p.x / window.devicePixelRatio,
        p.y / window.devicePixelRatio,
      );
      return !!el && !!tile.current?.contains(el);
    };
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      switch (payload.type) {
        case "enter":
        case "over":
          setOver(inside(payload.position));
          break;
        case "drop":
          setOver(false);
          if (inside(payload.position) && payload.paths.length > 0) {
            setSwallowing(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setSwallowing(false), GULP_MS);
            commands.recycleFiles(payload.paths).catch(report("recycle_files"));
          }
          break;
        case "leave":
          setOver(false);
          break;
      }
    });
    return () => {
      window.clearTimeout(timer);
      unlisten.then((off) => off());
    };
  }, [tile]);

  return { over, swallowing };
}

/**
 * Geri dönüşüm kutusu (8.8): tıkla aç, sağ tıkla boşalt (Windows onay sorar).
 * Dosya sürükleyip üstüne getirince kapak açılır, bırakınca kutuya gider.
 */
export function RecycleBar() {
  const bin = useService(commands.getRecycle, events.recycle);
  const items = bin?.items ?? 0;
  const label =
    items === 0 ? t("Boş") : t("{items} öğe · {size}", { items, size: size(bin?.bytes ?? 0) });
  const tile = useRef<HTMLElement>(null);
  const { over, swallowing } = useRecycleDrop(tile);

  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      ref={tile}
      data-file-drop="recycle"
      data-over={over || undefined}
      className={styles.tile}
      aria-label={t("Geri dönüşüm kutusu: {label}", { label })}
      title={t("Geri dönüşüm kutusu — {label}\nDosya sürükle: çöpe at{empty}", {
        label,
        empty: items > 0 ? t("\nSağ tık: boşalt") : "",
      })}
      onClick={() => commands.openRecycleBin().catch(report("open_recycle_bin"))}
      onContextMenu={(e) => {
        e.preventDefault();
        if (items > 0) commands.emptyRecycleBin().catch(report("empty_recycle_bin"));
      }}
    >
      <BinIcon open={over} swallowing={swallowing} />
      {items > 0 && <span className={styles.count}>{items > 999 ? "999+" : items}</span>}
    </Tile>
  );
}

/** Kapağı ayrı çizilmiş kutu: kapak menteşesinden (sağ uç) açılır. */
function BinIcon({ open, swallowing }: { open: boolean; swallowing: boolean }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.bin}
      data-open={open || undefined}
      data-swallow={swallowing || undefined}
      aria-hidden="true"
    >
      <g className={styles.lid}>
        <path d="M4 6.5h16M9.5 6.5V4.5h5v2" />
      </g>
      <g className={styles.body}>
        <path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13" />
        <path d="M10 10.5v6.5M14 10.5v6.5" />
      </g>
    </svg>
  );
}
