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
import { t } from "../../lib/i18n";

export function General({ config }: { config: Config }) {
  const [autostart, setAutostart] = useState<AutostartState | null>(null);

  const update = useService(commands.getUpdateInfo, events.update);
  const busy = !!update && ["checking", "downloading", "installing"].includes(update.status.state);

  useEffect(() => {
    commands.getAutostart().then(setAutostart).catch(report("get_autostart"));
  }, []);

  return (
    <Section title={t("Genel")}>
      <Card>
        <Row
          label={t("Dil · Language")}
          hint={t("Dock'un dili. Otomatik: Windows'un görüntüleme dilini kullanır.")}
        >
          <Segmented<Config["language"]>
            label={t("Dil · Language")}
            value={config.language}
            options={[
              { value: "auto", label: "Auto" },
              { value: "tr", label: "Türkçe" },
              { value: "en", label: "English" },
            ]}
            onChange={(language) => updateConfig((c) => ({ ...c, language }))}
          />
        </Row>
        <Row
          label={t("Windows görev çubuğunu gizle")}
          hint={t("Dock, Windows'un çubuğunun yerini alır. Çıkışta çubuk geri gelir.")}
        >
          <Toggle
            label={t("Windows görev çubuğunu gizle")}
            checked={config.hideWindowsTaskbar}
            onChange={(hide) => updateConfig((c) => ({ ...c, hideWindowsTaskbar: hide }))}
          />
        </Row>
        <Row
          label={t("Otomatik gizle")}
          hint={t(
            "Gizliyken pencereler tüm ekranı kullanır; imleci ekranın alt kenarına götürünce dock kayarak gelir. Akıllı: yalnızca bir pencere dock'un alanına girince gizlenir.",
          )}
        >
          <Segmented<AutoHide>
            label={t("Otomatik gizle")}
            value={config.autoHide}
            options={[
              { value: "never", label: t("Kapalı") },
              { value: "smart", label: t("Akıllı") },
              { value: "always", label: t("Her zaman") },
            ]}
            onChange={(autoHide) => updateConfig((c) => ({ ...c, autoHide }))}
          />
        </Row>
        <Row
          label={t("Pencereler dock'a küçülsün")}
          hint={t(
            "Küçültülen pencere dock'taki ikonuna girer, dock'tan açınca ikondan çıkar (macOS tarzı). Açıkken bu pencerelerde Windows'un kendi küçültme/büyütme animasyonları kapanır.",
          )}
        >
          <Toggle
            label={t("Pencereler dock'a küçülsün")}
            checked={config.minimizeToDock}
            onChange={(on) => updateConfig((c) => ({ ...c, minimizeToDock: on }))}
          />
        </Row>
        <Row
          label={t("Bildirimler dock tarzında")}
          hint={t(
            "Uygulama bildirimleri sade kartlarla çıkar (yeri aşağıdan seçilir); Windows'un kutucukları kapanır, bildirimler bildirim merkezinde kalır. Kapatınca (ya da dock kapanınca) Windows'unkiler geri gelir.",
          )}
        >
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              title={t("Örnek bir bildirim kartı gösterir (seçili sesle)")}
              onClick={() => commands.notifyTest().catch(report("notify_test"))}
            >
              {t("Dene")}
            </button>
            <Toggle
              label={t("Bildirimler dock tarzında")}
              checked={config.ownNotifications}
              onChange={(on) => updateConfig((c) => ({ ...c, ownNotifications: on }))}
            />
          </div>
        </Row>
        <Row
          label={t("Açılışta başlat")}
          hint={
            autostart && !autostart.available
              ? t("Yalnızca kurulu sürümde çalışır (geliştirme sürümü kapalı).")
              : t("Windows açılınca dock kendiliğinden başlar.")
          }
        >
          <Toggle
            label={t("Açılışta başlat")}
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

      <h3 className={styles.subTitle}>{t("Güncellemeler")}</h3>
      <Card>
        <Row
          label={t("Otomatik güncelle")}
          hint={t(
            "Yeni sürüm çıkınca arka planda indirilir ve kurulur; dock birkaç saniyeliğine kapanıp yeniden açılır.",
          )}
        >
          <Toggle
            label={t("Otomatik güncelle")}
            checked={config.autoUpdate}
            onChange={(on) => updateConfig((c) => ({ ...c, autoUpdate: on }))}
          />
        </Row>
        <Row
          label={update ? t("Sürüm {v}", { v: update.current }) : t("Sürüm")}
          hint={update ? describe(update.status) : undefined}
        >
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => commands.checkUpdate().catch(report("check_update"))}
          >
            {t("Şimdi denetle")}
          </button>
        </Row>
      </Card>

      <p className={styles.footnote}>
        {t("Bu pencereye dock'un boş bir yerine sağ tıklayarak da ulaşabilirsin.")}
      </p>
    </Section>
  );
}

function describe(status: UpdateStatus) {
  switch (status.state) {
    case "idle":
      return t("Güncellemeler 6 saatte bir denetlenir.");
    case "checking":
      return t("Denetleniyor…");
    case "upToDate":
      return t("En güncel sürümü kullanıyorsun.");
    case "available":
      return t("Yeni sürüm var: {v} (geliştirme sürümünde kurulmaz).", { v: status.version });
    case "downloading":
      return t("{v} indiriliyor… %{p}", { v: status.version, p: status.percent });
    case "installing":
      return t("{v} kuruluyor; dock yeniden açılacak.", { v: status.version });
    case "error":
      return t(status.message);
  }
}
