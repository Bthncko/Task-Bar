import { useEffect, useRef, useState, type CSSProperties } from "react";
import { commands, type QueueItem, type SpotifyQueue } from "../../lib/ipc";
import { CloseIcon, PlayNextIcon } from "../icons";
import { LinkButton } from "../ui/panel";
import { ListSkeleton, RowAction, TrackRow } from "./rows";
import { SETTLE_MS } from "./spotify";
import { useQueueDrag } from "./useQueueDrag";
import styles from "./Popup.module.css";

/** Panel açıkken sıra bu aralıkla tazelenir (Spotify'da elle eklenenler için). */
const REFRESH_MS = 15_000;

type QueueState =
  | { kind: "loading" }
  | { kind: "ready"; queue: SpotifyQueue }
  | { kind: "error"; message: string; queue: SpotifyQueue | null };

/**
 * Spotify sırası: açılışta, şarkı değişince ve panel açıkken düzenli olarak.
 * Satıra tıkla → o şarkıya geç; basılı tutup sürükle → sırayı değiştir;
 * üstüne gelince "sıradaki yap" ve "kaldır".
 * `version` dışarıdan artınca (ör. aramadan sıraya eklendi) yeniden okunur.
 */
export function Queue({ trackKey, version }: { trackKey: string; version: number }) {
  const [state, setState] = useState<QueueState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** Çalınmak üzere seçilen satır (gelene kadar üstündekiler soluk). */
  const [pending, setPending] = useState<number | null>(null);
  /** Kaldırılması sürerken bu satırlar soluk. */
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  /** Yeni sıra Spotify'a uygulanıyor (birkaç saniye sürebilir). */
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      // Uygulanırken ara hâl (kopyalar eklendi, asıllar henüz gizlenmedi) görünmesin.
      if (applyingRef.current) return;
      commands
        .spotifyQueue()
        .then((queue) => {
          if (!alive || applyingRef.current) return;
          setState({ kind: "ready", queue });
          setPending(null);
          setBusy(new Set());
        })
        .catch(
          (e) =>
            alive &&
            setState((s) => ({
              kind: "error",
              message: String(e),
              queue: s.kind === "loading" ? null : s.queue,
            })),
        );
    };
    const first = window.setTimeout(load, attempt === 0 && version === 0 ? 0 : SETTLE_MS);
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [trackKey, attempt, version]);

  // Şarkı değişti (geçiş tamamlandı): bekleyen satır yok.
  const [lastKey, setLastKey] = useState(trackKey);
  if (lastKey !== trackKey) {
    setLastKey(trackKey);
    setPending(null);
  }

  const queue = state.kind === "loading" ? null : state.queue;
  const items = queue?.items ?? [];

  const fail = (e: unknown) =>
    setState((s) => ({
      kind: "error",
      message: String(e),
      queue: s.kind === "loading" ? null : s.queue,
    }));

  const setItems = (next: QueueItem[], hiddenDelta = 0) =>
    setState((s) =>
      s.kind === "loading" || !s.queue
        ? s
        : { ...s, queue: { ...s.queue, items: next, hidden: s.queue.hidden + hiddenDelta } },
    );

  /** Görünen sırada `from` → `to`; baştan ikisinin büyüğüne kadar Spotify'a uygulanır. */
  const move = (from: number, to: number) => {
    if (applyingRef.current || from === to) return;
    const order = [...items];
    order.splice(to, 0, ...order.splice(from, 1));
    setItems(order);
    applyingRef.current = true;
    setApplying(true);
    commands
      .spotifyQueueReorder(order.slice(0, Math.max(from, to) + 1))
      .catch(fail)
      .finally(() => {
        applyingRef.current = false;
        setApplying(false);
        setAttempt((n) => n + 1);
      });
  };

  const drag = useQueueDrag({
    count: items.length,
    list,
    disabled: applying || pending !== null,
    onDrop: move,
  });

  const play = (item: QueueItem) => {
    if (pending !== null || applying || drag.suppressClick.current) return;
    setPending(item.position);
    commands
      .spotifyPlayItem(item.position, item.uri)
      .catch((e) => {
        setPending(null);
        fail(e);
      })
      .finally(() => setAttempt((n) => n + 1));
  };

  const remove = (item: QueueItem) => {
    const key = rowKey(item);
    setBusy((b) => new Set(b).add(key));
    // Kaldırılan satır hemen kaybolsun (sunucu da gizleyecek).
    setItems(
      items.filter((i) => rowKey(i) !== key),
      1,
    );
    commands
      .spotifyQueueRemove(item)
      .catch(fail)
      .finally(() => setAttempt((n) => n + 1));
  };

  const restore = () => {
    commands
      .spotifyQueueReset()
      .catch(fail)
      .finally(() => setAttempt((n) => n + 1));
  };

  if (state.kind === "loading") return <ListSkeleton />;

  return (
    <>
      {state.kind === "error" && (
        <div className={styles.error} role="alert">
          <span>{state.message}</span>
          <LinkButton onClick={() => setAttempt((n) => n + 1)}>Yeniden dene</LinkButton>
        </div>
      )}
      {queue && items.length === 0 && <p className={styles.note}>Sırada şarkı yok.</p>}
      {items.length > 0 && (
        <ol
          ref={list}
          className={styles.list}
          data-dragging={drag.drag ? "" : undefined}
          aria-busy={applying || undefined}
        >
          {items.map((item, i) => {
            const key = rowKey(item);
            return (
              <li
                key={key}
                className={styles.dragItem}
                data-dragged={drag.drag?.from === i || undefined}
                style={{ transform: drag.transform(i) } as CSSProperties}
                onPointerDown={(e) => drag.start(e, i)}
              >
                <TrackRow
                  image={item.image}
                  title={item.title}
                  subtitle={item.artist}
                  durationMs={item.durationMs}
                  state={
                    busy.has(key)
                      ? "skipped"
                      : pending === null
                        ? undefined
                        : item.position < pending
                          ? "skipped"
                          : item.position === pending
                            ? "next"
                            : undefined
                  }
                  onPlay={() => play(item)}
                  actions={
                    applying ? undefined : (
                      <>
                        {i > 0 && (
                          <RowAction label="Sıradaki yap" onClick={() => move(i, 0)}>
                            <PlayNextIcon size={16} />
                          </RowAction>
                        )}
                        <RowAction label="Sıradan kaldır" onClick={() => remove(item)}>
                          <CloseIcon size={15} />
                        </RowAction>
                      </>
                    )
                  }
                />
              </li>
            );
          })}
        </ol>
      )}
      {applying ? (
        <div className={styles.footnote} role="status">
          <span className={styles.applying}>Yeni sıra Spotify'a uygulanıyor…</span>
        </div>
      ) : (
        queue &&
        queue.hidden > 0 && (
          <div className={styles.footnote}>
            <span title="Spotify sıradan çıkarmaya izin vermiyor: kaldırılan şarkı çalmaya başlarsa hemen geçilir.">
              {queue.hidden} şarkı sıradan kaldırıldı
            </span>
            <LinkButton onClick={restore}>Geri getir</LinkButton>
          </div>
        )
      )}
    </>
  );
}

const rowKey = (i: QueueItem) => `${i.uri}#${i.occurrence}`;
