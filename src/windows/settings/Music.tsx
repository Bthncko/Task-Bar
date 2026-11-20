import { useEffect, useState } from "react";
import { commands, events, report } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Card, Row, Section } from "./controls";
import styles from "./Settings.module.css";
import { trans } from "../../lib/trans";
import { errText, t } from "../../lib/i18n";

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
      text: t("Tarayıcıda Spotify açıldı; orada “Kabul et”e bas, sonra buraya dön."),
    });
    try {
      const s = await commands.spotifyConnect(clientId.trim());
      setDraft(null);
      setStatus({
        kind: "ok",
        text: s.account ? t("Bağlandı: {account}.", { account: s.account }) : t("Bağlandı."),
      });
    } catch (e) {
      setStatus({ kind: "error", text: errText(e) });
    }
  };

  const disconnect = () => {
    setStatus(null);
    commands.spotifyDisconnect().catch(report("spotify_disconnect"));
  };

  return (
    <Section
      title={t("Müzik")}
      intro={t(
        "Dock'taki müzik karosuna tıklayınca müzik paneli açılır. Spotify bağlıyken panelde sıradakileri düzenleyebilir (sıradaki yap, kaldır), şarkı arayıp sıraya ekleyebilir, çalma listelerini açabilir, Spotify sesini ve çalan cihazı değiştirebilirsin. Karonun üstünde tekerlek Spotify sesini değiştirir.",
      )}
    >
      <h3 className={styles.subTitle}>{t("Spotify")}</h3>
      {spotify.connected ? (
        <Card>
          <Row label={t("Bağlı")} hint={spotify.account ?? t("Spotify hesabı")}>
            <button type="button" className={styles.button} onClick={disconnect}>
              {t("Bağlantıyı kes")}
            </button>
          </Row>
          <Row
            label={t("Yeniden bağlan")}
            hint={
              spotify.needsReconnect
                ? t("Beğenme ve çalma listeleri yeni izin istiyor; tarayıcıda bir kez onayla.")
                : t("İzinleri yenilemek gerekirse.")
            }
          >
            <button
              type="button"
              className={`${styles.button} ${spotify.needsReconnect ? styles.primary : ""}`}
              disabled={status?.kind === "busy"}
              onClick={connect}
            >
              {t("Yeniden bağlan")}
            </button>
          </Row>
        </Card>
      ) : (
        <>
          <div className={`${styles.card} ${styles.help}`} style={{ padding: "12px 16px" }}>
            {t(
              "Sıradakiler için Spotify'da kendine ait küçük bir geliştirici uygulaması gerekiyor (bir kez, iki dakika). Hesabında Spotify Premium olmalı.",
            )}
            <ol>
              <li>
                {trans(t("{link} adresinde Spotify hesabınla gir ve {create} düğmesine bas."), {
                  link: (
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
                    </button>
                  ),
                  create: <b>Create app</b>,
                })}
              </li>
              <li>
                {trans(t("Ad ve açıklamaya istediğini yaz. {field} alanına şunu ekle:"), {
                  field: <b>Redirect URIs</b>,
                })}
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
                    {copied ? t("Kopyalandı") : t("Kopyala")}
                  </button>
                </span>
              </li>
              <li>
                {trans(t("“Which API/SDKs” bölümünde {api} seçeneğini işaretle ve kaydet."), {
                  api: <b>Web API</b>,
                })}
              </li>
              <li>
                {trans(
                  t(
                    "Uygulama sayfasındaki {id} değerini kopyalayıp aşağıya yapıştır, {connect} düğmesine bas.",
                  ),
                  { id: <b>Client ID</b>, connect: <b>{t("Bağlan")}</b> },
                )}
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
              {t("Bağlan")}
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
