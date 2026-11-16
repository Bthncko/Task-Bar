import { useState } from "react";
import { commands, type Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { parse } from "../../widgets/calendar/ics";
import { Card, Row, Section, Toggle } from "./controls";
import styles from "./Settings.module.css";

/** Google'ın herkese açık Türkiye tatilleri takvimi (gizli değil). */
const TR_HOLIDAYS =
  "https://calendar.google.com/calendar/ical/tr.turkish%23holiday%40group.v.calendar.google.com/public/basic.ics";

/** Adresler gizli: ekranda yalnızca sunucu ve dosya adı görünür. */
function mask(url: string) {
  if (url === TR_HOLIDAYS) return "Türkiye tatilleri (Google)";
  try {
    const u = new URL(url.replace(/^webcal:/i, "https:"));
    const file = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return `${u.host} / … / ${file}`;
  } catch {
    return "Geçersiz adres";
  }
}

type Status = { kind: "busy" | "ok" | "error"; text: string } | null;

const setUrls = (change: (urls: string[]) => string[]) =>
  updateConfig((c) => ({
    ...c,
    widgets: {
      ...c.widgets,
      calendar: { ...c.widgets.calendar, icsUrls: change(c.widgets.calendar.icsUrls) },
    },
  }));

export function Calendar({ config }: { config: Config }) {
  const urls = config.widgets.calendar.icsUrls;
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>(null);

  /** Eklemeden önce gerçekten indirip okuyabildiğimizi denetle. */
  const add = async (raw: string) => {
    const url = raw.trim();
    if (!/^(https?|webcal):\/\//i.test(url)) {
      setStatus({ kind: "error", text: "Adres https:// ya da webcal:// ile başlamalı." });
      return;
    }
    if (urls.includes(url)) {
      setStatus({ kind: "error", text: "Bu takvim zaten ekli." });
      return;
    }
    setStatus({ kind: "busy", text: "Takvim indiriliyor…" });
    try {
      const { events } = parse(await commands.fetchIcs(url));
      setUrls((list) => [...list, url]);
      setDraft("");
      setStatus({ kind: "ok", text: `Eklendi: ${events.length} etkinlik bulundu.` });
    } catch (e) {
      console.error("takvim denenemedi:", String(e));
      setStatus({
        kind: "error",
        text: "Takvim indirilemedi ya da okunamadı. Adresi kontrol et.",
      });
    }
  };

  return (
    <Section
      title="Saat ve takvim"
      intro="Saate tıklayınca açılan takvimde bu aboneliklerin etkinlikleri görünür. Salt okunur; 15 dakikada bir yenilenir."
    >
      <Card>
        <Row label="Saniyeleri göster" hint="Saatin yanında soluk, küçük saniye.">
          <Toggle
            label="Saniyeleri göster"
            checked={config.widgets.clock?.showSeconds ?? false}
            onChange={(on) =>
              updateConfig((c) => ({
                ...c,
                widgets: { ...c.widgets, clock: { ...c.widgets.clock, showSeconds: on } },
              }))
            }
          />
        </Row>
      </Card>

      <h3 className={styles.subTitle}>Takvim abonelikleri</h3>
      <Card>
        {urls.length === 0 ? (
          <p className={styles.cardNote}>Henüz takvim eklenmedi.</p>
        ) : (
          <ul className={styles.urlList}>
            {urls.map((u) => (
              <li key={u} className={styles.urlItem}>
                <span className={styles.urlText}>{mask(u)}</span>
                <button
                  type="button"
                  className={styles.itemAction}
                  aria-label="Takvimi kaldır"
                  title="Kaldır"
                  onClick={() => setUrls((list) => list.filter((x) => x !== u))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <input
          className={styles.input}
          type="password"
          placeholder="ICS adresini yapıştır"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setDraft(e.currentTarget.value)}
        />
        <button
          type="submit"
          className={`${styles.button} ${styles.primary}`}
          disabled={!draft.trim() || status?.kind === "busy"}
        >
          Ekle
        </button>
      </form>
      {status && (
        <p className={styles.status} data-kind={status.kind}>
          {status.text}
        </p>
      )}
      {!urls.includes(TR_HOLIDAYS) && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={status?.kind === "busy"}
            onClick={() => add(TR_HOLIDAYS)}
          >
            Türkiye tatillerini ekle
          </button>
        </div>
      )}

      <div className={styles.help}>
        <h3 className={styles.subTitle}>Google Takvim adresi nereden alınır?</h3>
        <ol>
          <li>Tarayıcıda Google Takvim → sağ üstte ⚙ → Ayarlar.</li>
          <li>Soldan takviminin adını seç.</li>
          <li>“iCal biçiminde gizli adres”i kopyalayıp buraya yapıştır.</li>
        </ol>
        <p>
          Bu adresi bilen herkes takvimini görebilir. Adres yalnızca bu bilgisayardaki ayar
          dosyasında saklanır, ekranda kısaltılmış görünür.
        </p>
      </div>
    </Section>
  );
}
