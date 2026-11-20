import { useEffect, useRef, useState } from "react";
import { commands, type QueueItem } from "../../lib/ipc";
import { CheckIcon, CloseIcon, PlusIcon, SearchIcon } from "../icons";
import { ListSkeleton, RowAction, TrackRow } from "./rows";
import styles from "./Popup.module.css";
import { trans } from "../../lib/trans";
import { errText, t } from "../../lib/i18n";

/** Yazmayı bitirince ara. */
const DEBOUNCE_MS = 350;
/** "Eklendi" işareti bu kadar kalır. */
const DONE_MS = 1800;

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: QueueItem[] }
  | { kind: "error"; message: string };

/**
 * Spotify'da şarkı ara (en çok 10 sonuç; geliştirme modu sınırı).
 * Satıra tıkla → hemen çal; + → sıraya ekle (çalan listenin önüne).
 */
export function Search({ onQueued }: { onQueued: () => void }) {
  const [query, setQuery] = useState("");
  const [fetched, setResult] = useState<Result>({ kind: "idle" });
  // Boş arama: ipucu (eski sonuç gösterilmez).
  const result: Result = query.trim() ? fetched : { kind: "idle" };
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const t = window.setTimeout(() => {
      setResult({ kind: "loading" });
      commands
        .spotifySearch(q)
        .then((items) => alive && setResult({ kind: "ready", items }))
        .catch((e) => alive && setResult({ kind: "error", message: errText(e) }));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query]);

  const enqueue = (item: QueueItem) => {
    setMessage(null);
    commands
      .spotifyAddToQueue(item.uri)
      .then(() => {
        setAdded((s) => new Set(s).add(item.uri));
        window.setTimeout(
          () =>
            setAdded((s) => {
              const n = new Set(s);
              n.delete(item.uri);
              return n;
            }),
          DONE_MS,
        );
        onQueued();
      })
      .catch((e) => setMessage(errText(e)));
  };

  const play = (item: QueueItem) => {
    setMessage(null);
    commands.spotifyPlayUri(item.uri).catch((e) => setMessage(errText(e)));
  };

  return (
    <>
      <label className={styles.search}>
        <SearchIcon size={16} />
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={t("Şarkı ya da sanatçı ara")}
          aria-label={t("Spotify'da ara")}
          spellCheck={false}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Esc önce aramayı temizlesin, paneli kapatmasın.
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className={styles.searchClear}
            aria-label={t("Temizle")}
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <CloseIcon size={14} />
          </button>
        )}
      </label>
      {message && (
        <div className={styles.error} role="alert">
          <span>{message}</span>
        </div>
      )}
      {result.kind === "idle" && (
        <p className={styles.hint}>
          {trans(
            t("Sonuca tıklayınca hemen çalar; {plus} ile çalan listeyi bozmadan sıraya eklenir."),
            {
              plus: <b>+</b>,
            },
          )}
        </p>
      )}
      {result.kind === "loading" && <ListSkeleton rows={4} />}
      {result.kind === "error" && (
        <div className={styles.error} role="alert">
          <span>{result.message}</span>
        </div>
      )}
      {result.kind === "ready" && result.items.length === 0 && (
        <p className={styles.note}>{t("Sonuç yok.")}</p>
      )}
      {result.kind === "ready" && result.items.length > 0 && (
        <ol className={styles.list}>
          {result.items.map((item) => (
            <li key={item.uri}>
              <TrackRow
                image={item.image}
                title={item.title}
                subtitle={item.artist}
                durationMs={item.durationMs}
                state={added.has(item.uri) ? "done" : undefined}
                playLabel={t("hemen çal")}
                onPlay={() => play(item)}
                actions={
                  <RowAction
                    label={added.has(item.uri) ? t("Sıraya eklendi") : t("Sıraya ekle")}
                    disabled={added.has(item.uri)}
                    onClick={() => enqueue(item)}
                  >
                    {added.has(item.uri) ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
                  </RowAction>
                }
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
