import { useEffect, useState } from "react";
import { commands, report } from "../../lib/ipc";
import { CheckIcon, PlayIcon } from "../../widgets/icons";
import { Card } from "./controls";
import styles from "./NotificationSound.module.css";
import settings from "./Settings.module.css";

/** Sesler `src-tauri/sounds/generate.py` ile sentezlendi (sıfırdan, örnek yok). */
const SOUNDS = [
  { id: "damla", name: "Damla", hint: "İki küçük kabarcık" },
  { id: "esinti", name: "Esinti", hint: "Yükselen iki yumuşak nota" },
  { id: "cakil", name: "Çakıl", hint: "Tek, kısa dokunuş" },
  { id: "kristal", name: "Kristal", hint: "Tek cam tınısı" },
  { id: "can", name: "Çan", hint: "İki notalı çan" },
  { id: "windows", name: "Windows", hint: "Windows'un kendi sesleri" },
];

/**
 * Ayarlar → Genel: bildirim sesi. Seçmek sesi bir kez çalar ve Windows'un
 * bildirim olaylarına yazar (uygulama bildirimleri + dock'un kendi bildirimleri).
 * Seçili ses kayıt defterinden okunur (Windows'tan değiştirilirse de doğru görünür).
 */
export function NotificationSound() {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    commands.getNotificationSound().then(setCurrent).catch(report("get_notification_sound"));
  }, []);

  const choose = (id: string) => {
    commands.previewNotificationSound(id).catch(report("preview_notification_sound"));
    if (id === current) return;
    setCurrent(id);
    commands.setNotificationSound(id).catch((e) => {
      report("set_notification_sound")(e);
      commands.getNotificationSound().then(setCurrent).catch(report("get_notification_sound"));
    });
  };

  return (
    <>
      <h3 className={settings.subTitle}>Bildirim sesi</h3>
      <Card>
        <div className={styles.grid} role="radiogroup" aria-label="Bildirim sesi">
          {SOUNDS.map((s) => {
            const on = s.id === current;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={styles.option}
                onClick={() => choose(s.id)}
              >
                <span className={styles.icon} aria-hidden>
                  {on ? <CheckIcon size={14} /> : <PlayIcon size={12} />}
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{s.name}</span>
                  <span className={styles.hint}>{s.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className={styles.note}>
          {current === "custom"
            ? "Şu an Windows'tan seçilmiş başka bir ses var; buradan birini seçince o değişir. "
            : ""}
          Seçince bir kez çalar. Mesaj, posta ve takvim bildirimleri de bu sesi kullanır; kendi
          sesini kendisi çalan uygulamalar (Discord gibi) değişmez.
        </p>
      </Card>
    </>
  );
}
