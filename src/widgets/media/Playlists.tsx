import { useEffect, useState } from "react";
import { commands, type SpotifyPlaylist } from "../../lib/ipc";
import { LinkButton } from "../ui/panel";
import { ListSkeleton, TrackRow } from "./rows";
import styles from "./Popup.module.css";

type State =
  | { kind: "loading" }
  | { kind: "ready"; items: SpotifyPlaylist[] }
  | { kind: "error"; message: string };

/** Kullanıcının çalma listeleri; tıklayınca baştan çalar. */
export function Playlists() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [started, setStarted] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    commands
      .spotifyPlaylists()
      .then((items) => alive && setState({ kind: "ready", items }))
      .catch((e) => alive && setState({ kind: "error", message: String(e) }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const play = (p: SpotifyPlaylist) => {
    setMessage(null);
    setStarted(p.uri);
    commands.spotifyPlayContext(p.uri).catch((e) => {
      setStarted(null);
      setMessage(String(e));
    });
  };

  if (state.kind === "loading") return <ListSkeleton />;
  if (state.kind === "error")
    return (
      <div className={styles.error} role="alert">
        <span>{state.message}</span>
        <LinkButton
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          Yeniden dene
        </LinkButton>
      </div>
    );
  if (state.items.length === 0) return <p className={styles.note}>Çalma listen yok.</p>;

  return (
    <>
      {message && (
        <div className={styles.error} role="alert">
          <span>{message}</span>
        </div>
      )}
      <ol className={styles.list}>
        {state.items.map((p) => (
          <li key={p.uri}>
            <TrackRow
              image={p.image}
              title={p.name}
              subtitle={[p.owner, p.total !== null ? `${p.total} şarkı` : null]
                .filter(Boolean)
                .join(" · ")}
              state={started === p.uri ? "next" : undefined}
              playLabel="baştan çal"
              onPlay={() => play(p)}
            />
          </li>
        ))}
      </ol>
    </>
  );
}
