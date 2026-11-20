import { useRef, useState, type CSSProperties } from "react";
import { commands, events, report, type AudioDevice } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { CheckIcon, HeadphonesIcon, MicIcon, SpeakerIcon } from "../icons";
import { IconButton } from "../ui";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import styles from "./Popup.module.css";
import { pct, t } from "../../lib/i18n";

/**
 * Ses paneli (8.5): ana ses, çıkış aygıtı seçimi, varsayılan mikrofon.
 * Çıkış değiştirme belgelenmemiş bir API ile; olmazsa Windows ses ayarları açılır.
 */
export function VolumePopup() {
  const audio = useService(commands.getAudio, events.audio);
  const close = usePopupClose();
  const [switching, setSwitching] = useState<string | null>(null);

  const openSettings = (page: "sound" | "sound-mixer") => {
    commands.openSystemSettings(page).catch(report("open_system_settings"));
    close();
  };

  const choose = (device: AudioDevice) => {
    if (device.default || switching) return;
    setSwitching(device.id);
    commands
      .setDefaultOutput(device.id)
      .catch((e) => {
        console.error("set_default_output", e);
        openSettings("sound");
      })
      .finally(() => setSwitching(null));
  };

  return (
    <div className={styles.root}>
      <PanelHeader
        title={t("Ses")}
        actions={
          <LinkButton onClick={() => openSettings("sound-mixer")}>
            {t("Ses karıştırıcısı")}
          </LinkButton>
        }
      />
      {!audio ? (
        <p className={styles.note}>{t("Ses aygıtı bulunamadı.")}</p>
      ) : (
        <>
          <section className={styles.section}>
            <Level
              label={t("Ana ses")}
              value={audio.volume}
              muted={audio.muted}
              icon={
                <SpeakerIcon level={audio.muted ? 0 : audio.volume} muted={audio.muted} size={18} />
              }
              onMute={() => commands.setMute(!audio.muted).catch(report("set_mute"))}
              onChange={(v) => commands.setVolume(v / 100).catch(report("set_volume"))}
            />
          </section>

          <section className={styles.section} aria-label={t("Çıkış aygıtı")}>
            <h3 className={styles.title}>{t("Çıkış")}</h3>
            <ul className={styles.list}>
              {audio.outputs.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={styles.device}
                    data-active={d.default || undefined}
                    data-busy={switching === d.id || undefined}
                    aria-pressed={d.default}
                    onClick={() => choose(d)}
                  >
                    <HeadphonesIcon size={16} />
                    <span className={styles.name}>{d.name}</span>
                    {d.default && <CheckIcon size={16} />}
                  </button>
                </li>
              ))}
            </ul>
            {audio.outputs.length <= 1 && (
              <p className={styles.hint}>
                {t("Kulaklık ya da hoparlör takınca burada seçebilirsin.")}
              </p>
            )}
          </section>

          <section className={styles.section} aria-label={t("Mikrofon")}>
            <h3 className={styles.title}>{t("Giriş")}</h3>
            {audio.mic ? (
              <Level
                label={audio.mic.name}
                value={audio.mic.volume}
                muted={audio.mic.muted}
                icon={<MicIcon muted={audio.mic.muted} size={18} />}
                onMute={() => commands.setMicMute(!audio.mic!.muted).catch(report("set_mic_mute"))}
                onChange={(v) => commands.setMicVolume(v / 100).catch(report("set_mic_volume"))}
              />
            ) : (
              <p className={styles.hint}>{t("Mikrofon yok.")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Sessiz düğmesi + ad + kaydırıcı. Sürüklerken yerel değer gösterilir. */
function Level({
  label,
  value,
  muted,
  icon,
  onMute,
  onChange,
}: {
  label: string;
  value: number;
  muted: boolean;
  icon: React.ReactNode;
  onMute: () => void;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const frame = useRef(0);
  const shown = local ?? value;

  const push = (v: number) => {
    setLocal(v);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onChange(v));
  };

  return (
    <div className={styles.level} data-muted={muted || undefined}>
      <IconButton
        aria-label={t(muted ? t("{label}: sesi aç") : t("{label}: sessize al"), { label })}
        title={muted ? t("Sesi aç") : t("Sessize al")}
        className={styles.mute}
        aria-pressed={muted}
        onClick={onMute}
      >
        {icon}
      </IconButton>
      <div className={styles.levelBody}>
        <div className={styles.levelHead}>
          <span className={styles.name}>{label}</span>
          <span className={styles.percent}>{muted ? t("Sessiz") : pct(shown)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={shown}
          aria-label={label}
          className={styles.slider}
          style={{ "--fill": `${muted ? 0 : shown}%` } as CSSProperties}
          onChange={(e) => push(Number(e.currentTarget.value))}
          onPointerUp={() => setLocal(null)}
          onBlur={() => setLocal(null)}
        />
      </div>
    </div>
  );
}
