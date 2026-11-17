import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, events, report, type Notice } from "../../lib/ipc";
import { startConfigSync, useConfig } from "../../lib/store";
import { applyTheme, uiScale } from "../../lib/theme";
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
/** Kapanış animasyonu (CSS → exit ile aynı). */
const EXIT_MS = 160;

type Card = Notice & { leaving: boolean; left: number };

/**
 * Bildirim kartları (sağ üst). Rust yeni bildirimi `notify://show` ile gönderir;
 * yığın boyu değişince `notify_layout` ile pencere boyutlanır / gizlenir.
 */
export function NotifyWindow() {
  const config = useConfig();
  const systemAccent = useService(commands.getSystemAccent, events.accent);
  const [cards, setCards] = useState<Card[]>([]);
  const [hover, setHover] = useState(false);
  const stack = useRef<HTMLDivElement>(null);
  const zoom = config ? uiScale(config.theme) : 1;

  useEffect(() => {
    if (config) applyTheme(config.theme, { systemAccent });
  }, [config?.theme, systemAccent]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = (id: number) => {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, leaving: true } : c)));
    window.setTimeout(() => setCards((cs) => cs.filter((c) => c.id !== id)), EXIT_MS);
  };

  useEffect(() => {
    const unlisten = [
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

  return (
    <div className={styles.root}>
      <div style={{ zoom } as CSSProperties}>
        <div
          ref={stack}
          className={styles.stack}
          style={{ width: WIDTH }}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
        >
          {cards.map((c) => (
            <article
              key={c.id}
              className={styles.card}
              data-leaving={c.leaving || undefined}
              role="button"
              tabIndex={0}
              onClick={() => {
                commands.notifyActivate(c.id).catch(report("notify_activate"));
                dismiss(c.id);
              }}
            >
              <header className={styles.head}>
                {c.icon ? (
                  <img className={styles.icon} src={c.icon} alt="" draggable={false} />
                ) : (
                  <span className={styles.icon}>
                    <BellIcon size={14} />
                  </span>
                )}
                <span className={styles.app}>{c.app || "Bildirim"}</span>
                <span className={styles.time}>şimdi</span>
                <button
                  type="button"
                  className={styles.close}
                  aria-label="Kapat"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(c.id);
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </header>
              {c.title && <div className={styles.title}>{c.title}</div>}
              {c.body && <div className={styles.body}>{c.body}</div>}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
