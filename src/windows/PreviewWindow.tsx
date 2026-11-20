import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  commands,
  events,
  report,
  type AppItem,
  type PreviewOpen,
  type SourceSize,
} from "../lib/ipc";
import { startConfigSync, useConfig } from "../lib/store";
import { applyTheme, uiScale } from "../lib/theme";
import { useService } from "../lib/useService";
import { CloseIcon } from "../widgets/icons";
import styles from "./PreviewWindow.module.css";
import { t } from "../lib/i18n";

startConfigSync();

/** Küçük resim alanı: yükseklik sabit, genişlik pencerenin oranına göre. */
const THUMB_H = 120;
const MIN_THUMB_H = 80;
const MAX_W = 220;
const MIN_W = 96;
/** Kart iç payı + kartlar arası boşluk + panel iç payı (CSS ile aynı). */
const CARD_PAD = 8;
const CARD_GAP = 4;
const PANEL_PAD = 6;
const HEAD_H = 28;
/** Gölge payı (preview.rs → SHADOW_PAD) ve ekran kenarı payı. */
const SHADOW = 16;
const MARGIN = 8;
/** Kapatılan pencere bu süre içinde kaybolmazsa (ör. "Kaydedilsin mi?") kart geri gelir. */
const CLOSE_TIMEOUT = 2000;

const NO_APPS: AppItem[] = [];

type Card = {
  hwnd: number;
  title: string;
  /** Kart (küçük resim alanı) genişliği. */
  width: number;
  /** Alanın içine oranı korunarak sığdırılmış küçük resim; yoksa ikon gösterilir. */
  shot: { width: number; height: number } | null;
};

/** Kartları diz: sığmazsa küçük resimler `MIN_THUMB_H`'ye kadar küçülür, sonra liste kayar. */
function arrange(windows: AppItem["windows"], sizes: Map<number, SourceSize>, maxWidth: number) {
  const build = (h: number): Card[] =>
    windows.map((w) => {
      const s = sizes.get(w.hwnd);
      if (!s || s.width <= 0 || s.height <= 0) {
        return { hwnd: w.hwnd, title: w.title, width: Math.round(h * 1.6), shot: null };
      }
      const ratio = s.width / s.height;
      const width = Math.round(
        Math.min(MAX_W * (h / THUMB_H), Math.max(MIN_W * (h / THUMB_H), h * ratio)),
      );
      const k = Math.min(width / s.width, h / s.height);
      return {
        hwnd: w.hwnd,
        title: w.title,
        width,
        shot: { width: Math.round(s.width * k), height: Math.round(s.height * k) },
      };
    });
  const total = (cards: Card[]) =>
    cards.reduce((sum, c) => sum + c.width + 2 * CARD_PAD, 0) +
    CARD_GAP * Math.max(cards.length - 1, 0) +
    2 * PANEL_PAD;

  let h = THUMB_H;
  let cards = build(h);
  if (total(cards) > maxWidth) {
    h = Math.max(MIN_THUMB_H, Math.floor(THUMB_H * (maxWidth / total(cards))));
    cards = build(h);
  }
  const width = Math.min(total(cards), maxWidth);
  // Kartın üst payı yok: başlık satırı kendi yüksekliğinde.
  const height = HEAD_H + h + CARD_PAD + 2 * PANEL_PAD;
  return { cards, thumbHeight: h, width, height, scrolls: total(cards) > maxWidth };
}

/**
 * Pencere önizlemesi (8.3). Kartlar burada, küçük resimleri DWM çizer
 * (`win/preview.rs`): her kartın resim alanının yerini Rust'a bildiririz.
 */
export function PreviewWindow() {
  const config = useConfig();
  const systemAccent = useService(commands.getSystemAccent, events.accent);
  const apps = useService(commands.getApps, events.apps) ?? NO_APPS;
  const [open, setOpen] = useState<PreviewOpen | null>(null);
  const [sizes, setSizes] = useState<{ key: string; map: Map<number, SourceSize> } | null>(null);
  const [closing, setClosing] = useState<ReadonlySet<number>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = [
      listen<PreviewOpen>(events.previewOpen, (e) => {
        setOpen(e.payload);
        setClosing(new Set());
      }),
      listen(events.previewClosed, () => {
        setOpen(null);
        setSizes(null);
      }),
    ];
    return () => unlisten.forEach((p) => p.then((off) => off()));
  }, []);

  useEffect(() => {
    if (config) applyTheme(config.theme, { systemAccent });
  }, [config?.theme, systemAccent]); // eslint-disable-line react-hooks/exhaustive-deps

  const app = open ? apps.find((a) => a.id === open.appId) : undefined;
  const windows = app?.windows ?? [];
  const sizeKey = open ? `${open.seq}:${windows.map((w) => w.hwnd).join(",")}` : "";

  // Pencereler kapandı (ya da uygulama listeden çıktı): önizleme de kapansın.
  const empty = !!open && apps !== NO_APPS && windows.length === 0;
  useEffect(() => {
    if (empty) commands.hidePreview().catch(report("hide_preview"));
  }, [empty]);

  // Pencere listesi değişince küçük resimler kaydedilir, boyutları gelir.
  useEffect(() => {
    if (!open || windows.length === 0) return;
    let alive = true;
    commands
      .previewSizes(
        open.seq,
        windows.map((w) => w.hwnd),
      )
      .then((list) => {
        if (alive && list.length > 0)
          setSizes({ key: sizeKey, map: new Map(list.map((s) => [s.hwnd, s])) });
      })
      .catch(report("preview_sizes"));
    return () => {
      alive = false;
    };
  }, [sizeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kapatılan pencere gitmediyse kartı geri getir.
  useEffect(() => {
    if (closing.size === 0) return;
    const t = window.setTimeout(() => setClosing(new Set()), CLOSE_TIMEOUT);
    return () => window.clearTimeout(t);
  }, [closing]);

  const zoom = config ? uiScale(config.theme) : 1;
  const ready = !!open && !!sizes && sizes.key === sizeKey && windows.length > 0;
  const maxWidth = (window.screen.availWidth - 2 * (MARGIN + SHADOW)) / zoom;
  const layout = ready ? arrange(windows, sizes.map, maxWidth) : null;

  // Çizildi: küçük resimlerin yerini bildir, Rust pencereyi konumlayıp gösterir.
  const place = () => {
    const panel = panelRef.current;
    const list = listRef.current;
    if (!open || !panel || !list) return;
    const p = panel.getBoundingClientRect();
    const c = list.getBoundingClientRect();
    const thumbs = [...list.querySelectorAll<HTMLElement>("[data-shot]")]
      .filter((el) => !closing.has(Number(el.dataset.shot)))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          hwnd: Number(el.dataset.shot),
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        };
      });
    commands
      .previewLayout(open.seq, p.width, p.height, thumbs, {
        x: c.left,
        y: c.top,
        width: c.width,
        height: c.height,
      })
      .catch(report("preview_layout"));
  };
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });

  const layoutKey = layout
    ? `${open?.seq}|${layout.width}|${layout.cards.map((c) => `${c.hwnd}:${c.width}`).join(",")}|${[...closing].join(",")}|${zoom}`
    : "";
  useLayoutEffect(() => {
    if (layoutKey) placeRef.current();
  }, [layoutKey]);

  if (!open || !layout || !app) return null;

  const closeWindow = (hwnd: number) => {
    setClosing((s) => new Set(s).add(hwnd));
    commands.closeWindow(hwnd).catch(report("close_window"));
  };

  return (
    <div className={styles.root}>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width: layout.width, height: layout.height, zoom } as CSSProperties}
        onPointerEnter={() => commands.previewHover(true).catch(report("preview_hover"))}
        onPointerLeave={() => commands.previewHover(false).catch(report("preview_hover"))}
      >
        <div
          ref={listRef}
          className={styles.list}
          data-scrolls={layout.scrolls || undefined}
          onScroll={() => placeRef.current()}
          onWheel={(e) => {
            if (layout.scrolls) e.currentTarget.scrollLeft += e.deltaY;
          }}
        >
          {layout.cards.map((card) => (
            <div
              key={card.hwnd}
              role="button"
              tabIndex={-1}
              className={styles.card}
              data-closing={closing.has(card.hwnd) || undefined}
              title={card.title}
              onClick={() => commands.activateWindow(card.hwnd).catch(report("activate_window"))}
              onAuxClick={(e) => {
                if (e.button === 1) closeWindow(card.hwnd);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
            >
              <div className={styles.head}>
                {app.icon && (
                  <img className={styles.icon} src={app.icon} alt="" draggable={false} />
                )}
                <span className={styles.title}>{card.title || app.name}</span>
                <button
                  type="button"
                  className={styles.close}
                  aria-label={t("Pencereyi kapat")}
                  title={t("Kapat")}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWindow(card.hwnd);
                  }}
                >
                  <CloseIcon size={14} />
                </button>
              </div>
              <div
                className={styles.area}
                style={{ width: card.width, height: layout.thumbHeight }}
              >
                {card.shot ? (
                  // Boş alan: DWM küçük resmi tam buraya çizer.
                  <div
                    data-shot={card.hwnd}
                    style={{ width: card.shot.width, height: card.shot.height }}
                  />
                ) : (
                  // Küçük resim yok (ör. boyutu alınamadı): büyük uygulama ikonu.
                  app.icon && (
                    <img className={styles.fallback} src={app.icon} alt="" draggable={false} />
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
