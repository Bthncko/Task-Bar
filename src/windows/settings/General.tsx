import { useEffect, useState } from "react";
import {
  commands,
  events,
  report,
  type AutostartState,
  type AutoHide,
  type Config,
  type UpdateStatus,
} from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { useService } from "../../lib/useService";
import { Card, Row, Section, Segmented, Toggle } from "./controls";
import { NotificationSound } from "./NotificationSound";
import { NotifyPlacement } from "./NotifyPlacement";
import styles from "./Settings.module.css";

export function General({ config }: { config: Config }) {
  const [autostart, setAutostart] = useState<AutostartState | null>(null);

  const update = useService(commands.getUpdateInfo, events.update);
  const busy = !!update && ["checking", "downloading", "installing"].includes(update.status.state);

  useEffect(() => {
    commands.getAutostart().then(setAutostart).catch(report("get_autostart"));
  }, []);

  return (
    <Section title="Genel">
      <Card>
        <Row
          label="Windows görev çubuğunu gizle"
          hint="Dock, Windows'un çubuğunun yerini alır. Çıkışta çubuk geri gelir."
        >
          <Toggle
            label="Windows görev çubuğunu gizle"
            checked={config.hideWindowsTaskbar}
            onChange={(hide) => updateConfig((c) => ({ ...c, hideWindowsTaskbar: hide }))}
          />
        </Row>
        <Row
          label="Otomatik gizle"
          hint="Gizliyken pencereler tüm ekranı kullanır; imleci ekranın alt kenarına götürünce dock kayarak gelir. Akıllı: yalnızca bir pencere dock'un alanına girince gizlenir."
        >
          <Segmented<AutoHide>
            label="Otomatik gizle"
            value={config.autoHide}
            options={[
              { value: "never", label: "Kapalı" },
              { value: "smart", label: "Akıllı" },
              { value: "always", label: "Her zaman" },
            ]}
            onChange={(autoHide) => updateConfig((c) => ({ ...c, autoHide }))}
          />
        </Row>
        <Row
          label="Pencereler dock'a küçülsün"
          hint="Küçültülen pencere dock'taki ikonuna girer, dock'tan açınca ikondan çıkar (macOS tarzı). Açıkken bu pencerelerde Windows'un kendi küçültme/büyütme animasyonları kapanır."
        >
          <Toggle
            label="Pencereler dock'a küçülsün"
            checked={config.minimizeToDock}
            onChange={(on) => updateConfig((c) => ({ ...c, minimizeToDock: on }))}
          />
        </Row>
        <Row
          label="Bildirimler dock tarzında"
          hint="Uygulama bildirimleri sade kartlarla çıkar (yeri aşağıdan seçilir); Windows'un kutucukları kapanır, bildirimler bildirim merkezinde kalır. Kapatınca (ya da dock kapanınca) Windows'unkiler geri gelir."
        >
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              title="Örnek bir bildirim kartı gösterir (seçili sesle)"
              onClick={() => commands.notifyTest().catch(report("notify_test"))}
            >
              Dene
            </button>
            <Toggle
              label="Bildirimler dock tarzında"
              checked={config.ownNotifications}
              onChange={(on) => updateConfig((c) => ({ ...c, ownNotifications: on }))}
            />
          </div>
        </Row>
        <Row
          label="Açılışta başlat"
          hint={
            autostart && !autostart.available
              ? "Yalnızca kurulu sürümde çalışır (geliştirme sürümü kapalı)."
              : "Windows açılınca dock kendiliğinden başlar."
          }
        >
          <Toggle
            label="Açılışta başlat"
            checked={autostart?.enabled ?? false}
            disabled={!autostart?.available}
            onChange={(enabled) =>
              commands.setAutostart(enabled).then(setAutostart).catch(report("set_autostart"))
            }
          />
        </Row>
      </Card>

      <NotifyPlacement config={config} />

      <NotificationSound />

      <h3 className={styles.subTitle}>Güncellemeler</h3>
      <Card>
        <Row
          label="Otomatik güncelle"
          hint="Yeni sürüm çıkınca arka planda indirilir ve kurulur; dock birkaç saniyeliğine kapanıp yeniden açılır."
        >
          <Toggle
            label="Otomatik güncelle"
            checked={config.autoUpdate}
            onChange={(on) => updateConfig((c) => ({ ...c, autoUpdate: on }))}
          />
        </Row>
        <Row
          label={update ? `Sürüm ${update.current}` : "Sürüm"}
          hint={update ? describe(update.status) : undefined}
        >
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => commands.checkUpdate().catch(report("check_update"))}
          >
            Şimdi denetle
          </button>
        </Row>
      </Card>

      <p className={styles.footnote}>
        Bu pencereye dock'un boş bir yerine sağ tıklayarak da ulaşabilirsin.
      </p>
    </Section>
  );
}

function describe(status: UpdateStatus) {
  switch (status.state) {
    case "idle":
      return "Güncellemeler 6 saatte bir denetlenir.";
    case "checking":
      return "Denetleniyor…";
    case "upToDate":
      return "En güncel sürümü kullanıyorsun.";
    case "available":
      return `Yeni sürüm var: ${status.version} (geliştirme sürümünde kurulmaz).`;
    case "downloading":
      return `${status.version} indiriliyor… %${status.percent}`;
    case "installing":
      return `${status.version} kuruluyor; dock yeniden açılacak.`;
    case "error":
      return status.message;
  }
}
