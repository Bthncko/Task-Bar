import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, events, report, type Notice, type NotifyBackdrop } from "../../lib/ipc";
import { useReducedMotion } from "../../lib/motion";
import { startConfigSync, useConfig } from "../../lib/store";
import { applyTheme, glassAlpha, uiScale } from "../../lib/theme";
import { useService } from "../../lib/useService";
import { BellIcon, CloseIcon } from "../../widgets/icons";
import styles from "./NotifyWindow.module.css";

startConfigSync();

/** Kart genişliği (CSS piksel, zoom'suz). */
const WIDTH = 360;
/** Aynı anda en fazla bu kadar kart; fazlası en eskiden kapanır. */
const MAX_CARDS = 3;
/** Kart bu kadar sonra kendiliğinden kapanır (üstündeyken durur). */
const LIFETIME_MS = 6000;
/** Kapanış animasyonu (CSS `exit` ile aynı). */
const EXIT_MS = 220;
/** Kart kalkınca alttakilerin yukarı kayması. */
const SHIFT_MS = 260;

type Card = Notice & { leaving: boolean; left: number };

/**
 * Bildirim kartları (sağ üst), macOS bildirimleri ve dock'un camıyla aynı dil.
 * Rust yeni bildirimi `notify://show` ile gönderir (pencere gizliyse önce
 * arkadaki ekranın bulanık görüntüsünü, `notify://backdrop`); yığın boyu
 * değişince `notify_layout` ile pencere boyutlanır / gizlenir.
 */
export function NotifyWindow() {
  const config = useConfig();
  const systemAccent = useService(commands.getSystemAccent, events.accent);
  const [cards, setCards] = useState<Card[]>([]);
  const [hover, setHover] = useState(false);
  const [backdrop, setBackdrop] = useState<NotifyBackdrop | null>(null);
  const stack = useRef<HTMLDivElement>(null);
  const zoom = config ? uiScale(config.theme) : 1;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (config) applyTheme(config.theme, { systemAccent });
  }, [config?.theme, systemAccent]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = (id: number) => {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, leaving: true } : c)));
    window.setTimeout(() => setCards((cs) => cs.filter((c) => c.id !== id)), EXIT_MS);
  };

  useEffect(() => {
    const unlisten = [
      listen<NotifyBackdrop>(events.notifyBackdrop, (e) => setBackdrop(e.payload)),
      listen<Notice>(events.notifyShow, (e) => {
        setCards((cs) => {
          const next = [
            { ...e.payload, leaving: false, left: LIFETIME_MS },
            ...cs.filter((c) => c.id !== e.payload.id),
          ];
          // Fazlası: en eskiler kapanır.
          next.slice(MAX_CARDS).forEach((c) => window.setTimeout(() => dismiss(c.id)));
          return next;
        });
      }),
      listen<number>(events.notifyGone, (e) => dismiss(e.payload)),
    ];
    return () => unlisten.forEach((p) => p.then((off) => off()));
  }, []);

  const latest = useRef(cards);
  useEffect(() => {
    latest.current = cards;
  }, [cards]);

  // Süre sayacı: üstündeyken durur.
  const ticking = !hover && cards.some((c) => !c.leaving);
  useEffect(() => {
    if (!ticking) return;
    const step = 250;
    const timer = window.setInterval(() => {
      latest.current.filter((c) => !c.leaving && c.left - step <= 0).forEach((c) => dismiss(c.id));
      setCards((cs) => cs.map((c) => (c.leaving ? c : { ...c, left: c.left - step })));
    }, step);
    return () => window.clearInterval(timer);
  }, [ticking]);

  // Yığın boyu → pencere boyu (0: gizle).
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const send = () => {
      // offsetHeight: kendi (zoom'suz) CSS pikseli.
      const h = cards.length === 0 ? 0 : el.offsetHeight * zoom;
      commands.notifyLayout(WIDTH * zoom, h).catch(report("notify_layout"));
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cards.length, zoom]);

  // Kart eklenip kalkınca diğerleri yeni yerine kayar (FLIP); her kartın camı
  // da yığındaki yerine göre kaydırılır (görüntü yığının köşesine yaslı).
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const next = new Map<string, number>();
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const id = child.dataset.id!;
      const top = child.offsetTop;
      next.set(id, top);
      child.style.setProperty("--glass-y", `${-top}px`);
      const before = tops.current.get(id);
      if (before !== undefined && before !== top && !reduced) {
        child.animate([{ translate: `0 ${before - top}px` }, { translate: "0 0" }], {
          duration: SHIFT_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
    }
    tops.current = next;
  }, [cards, reduced]);

  // Yığın kapanınca eski cam atılır (sonraki bildirimde Rust yenisini gönderir).
  const empty = cards.length === 0;
  useEffect(() => {
    if (empty) setBackdrop(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [empty]);

  const glass =
    backdrop && config && config.theme.glass !== "flat"
      ? ({
          "--notify-image": `url("${backdrop.image}")`,
          "--glass-w": `${backdrop.width}px`,
          "--glass-h": `${backdrop.height}px`,
          "--glass-x": `${WIDTH - backdrop.width}px`,
          "--panel-alpha": glassAlpha(config.theme, backdrop.luma).toFixed(3),
        } as CSSProperties)
      : undefined;

  return (
    <div className={styles.root}>
      <div style={{ zoom, ...glass } as CSSProperties}>
        <div
          ref={stack}
          className={styles.stack}
          style={{ width: WIDTH }}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
        >
          {cards.map((c) => {
            const title = c.title || c.app || "Bildirim";
            const body = c.title ? c.body : c.body || "";
            return (
              <article
                key={c.id}
                data-id={c.id}
                className={styles.card}
                data-leaving={c.leaving || undefined}
                data-glass={glass ? "" : undefined}
                role="button"
                tabIndex={0}
                aria-label={`${c.app}: ${title}${body ? `. ${body}` : ""}`}
                onClick={() => {
                  commands.notifyActivate(c.id).catch(report("notify_activate"));
                  dismiss(c.id);
                }}
              >
                <button
                  type="button"
                  className={styles.close}
                  aria-label="Kapat"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(c.id);
                  }}
                >
                  <CloseIcon size={10} />
                </button>
                {c.icon ? (
                  <img className={styles.icon} src={c.icon} alt="" draggable={false} />
                ) : (
                  <span className={styles.icon} data-fallback>
                    <BellIcon size={18} />
                  </span>
                )}
                <div className={styles.content}>
                  <div className={styles.row}>
                    <span className={styles.title}>{title}</span>
                    <span className={styles.time}>şimdi</span>
                  </div>
                  {c.title && c.app && c.app !== title && <div className={styles.app}>{c.app}</div>}
                  {body && <div className={styles.body}>{body}</div>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
