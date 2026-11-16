import { useEffect, useState } from "react";
import { commands, report, type AutostartState, type Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { Card, Row, Section, Toggle } from "./controls";
import styles from "./Settings.module.css";

export function General({ config }: { config: Config }) {
  const [autostart, setAutostart] = useState<AutostartState | null>(null);

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
      <p className={styles.footnote}>
        Bu pencereye dock'un boş bir yerine sağ tıklayarak da ulaşabilirsin.
      </p>
    </Section>
  );
}
