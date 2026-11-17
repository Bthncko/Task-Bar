import { useEffect, useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Card, Row, Section } from "./controls";
import styles from "./Settings.module.css";

type Status = { kind: "busy" | "ok" | "error"; text: string } | null;

/**
 * Spotify bağlantısı: müzik panelindeki sıradakiler için. Kullanıcı kendi
 * geliştirici uygulamasını açar (geliştirme modu: sahibi Premium olmalı).
 */
export function Music() {
  const spotify = useService(commands.spotifyStatus, events.spotify);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [copied, setCopied] = useState(false);
  const clientId = draft ?? spotify?.clientId ?? "";

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (!spotify) return null;

  const connect = async () => {
    setStatus({
      kind: "busy",
      text: "Tarayıcıda Spotify açıldı; orada “Kabul et”e bas, sonra buraya dön.",
    });
    try {
      const s = await commands.spotifyConnect(clientId.trim());
      setDraft(null);
      setStatus({ kind: "ok", text: `Bağlandı${s.account ? `: ${s.account}` : ""}.` });
    } catch (e) {
      setStatus({ kind: "error", text: String(e) });
    }
  };

  const disconnect = () => {
    setStatus(null);
    commands.spotifyDisconnect().catch(report("spotify_disconnect"));
  };

  return (
    <Section
      title="Müzik"
      intro="Dock'taki müzik karosuna tıklayınca müzik paneli açılır. Spotify bağlıyken panelde sıradakileri düzenleyebilir (sıradaki yap, kaldır), şarkı arayıp sıraya ekleyebilir, çalma listelerini açabilir, Spotify sesini ve çalan cihazı değiştirebilirsin. Karonun üstünde tekerlek Spotify sesini değiştirir."
    >
      <h3 className={styles.subTitle}>Spotify</h3>
      {spotify.connected ? (
        <Card>
          <Row label="Bağlı" hint={spotify.account ?? "Spotify hesabı"}>
            <button type="button" className={styles.button} onClick={disconnect}>
              Bağlantıyı kes
            </button>
          </Row>
          <Row
            label="Yeniden bağlan"
            hint={
              spotify.needsReconnect
                ? "Beğenme ve çalma listeleri yeni izin istiyor; tarayıcıda bir kez onayla."
                : "İzinleri yenilemek gerekirse."
            }
          >
            <button
              type="button"
              className={`${styles.button} ${spotify.needsReconnect ? styles.primary : ""}`}
              disabled={status?.kind === "busy"}
              onClick={connect}
            >
              Yeniden bağlan
            </button>
          </Row>
        </Card>
      ) : (
        <>
          <div className={`${styles.card} ${styles.help}`} style={{ padding: "12px 16px" }}>
            Sıradakiler için Spotify'da kendine ait küçük bir geliştirici uygulaması gerekiyor (bir
            kez, iki dakika). Hesabında Spotify Premium olmalı.
            <ol>
              <li>
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() =>
                    commands
                      .openSystemSettings("spotify-dashboard")
                      .catch(report("open_system_settings"))
                  }
                >
                  developer.spotify.com/dashboard
                </button>{" "}
                adresinde Spotify hesabınla gir ve <b>Create app</b>'e bas.
              </li>
              <li>
                Ad ve açıklamaya istediğini yaz. <b>Redirect URIs</b> alanına şunu ekle:
                <span className={styles.copyRow}>
                  <code className={styles.code}>{spotify.redirectUri}</code>
                  <button
                    type="button"
                    className={styles.inlineLink}
                    onClick={() =>
                      navigator.clipboard
                        .writeText(spotify.redirectUri)
                        .then(() => setCopied(true))
                        .catch(report("clipboard"))
                    }
                  >
                    {copied ? "Kopyalandı" : "Kopyala"}
                  </button>
                </span>
              </li>
              <li>
                “Which API/SDKs” bölümünde <b>Web API</b>'yi işaretle ve kaydet.
              </li>
              <li>
                Uygulama sayfasındaki <b>Client ID</b>'yi kopyalayıp aşağıya yapıştır, <b>Bağlan</b>
                'a bas.
              </li>
            </ol>
          </div>
          <form
            className={styles.addRow}
            onSubmit={(e) => {
              e.preventDefault();
              connect();
            }}
          >
            <input
              className={styles.input}
              placeholder="Client ID"
              value={clientId}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setDraft(e.currentTarget.value)}
            />
            <button
              type="submit"
              className={`${styles.button} ${styles.primary}`}
              disabled={!clientId.trim() || status?.kind === "busy"}
            >
              Bağlan
            </button>
          </form>
        </>
      )}
      {status && (
        <p className={styles.status} data-kind={status.kind}>
          {status.text}
        </p>
      )}
    </Section>
  );
}
