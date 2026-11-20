import type { SysmonView } from "../../lib/ipc";
import { Card, Row, Segmented } from "../../windows/settings/controls";
import type { SysmonConfig } from "./index";
import { t } from "../../lib/i18n";

/** Ayarlar → Widget'lar: çubukta ne görünsün. */
export function SysmonSettings({
  config,
  onChange,
}: {
  config: SysmonConfig;
  onChange(c: SysmonConfig): void;
}) {
  return (
    <Card>
      <Row label={t("Çubukta")} hint={t("Tıklayınca ayrıntılı panel açılır.")}>
        <Segmented<SysmonView>
          label={t("Çubuk görünümü")}
          value={config.view ?? "compact"}
          options={[
            { value: "compact", label: t("Yüzde") },
            { value: "bars", label: t("Çubuk") },
            { value: "net", label: t("Ağ") },
          ]}
          onChange={(view) => onChange({ ...config, view })}
        />
      </Row>
    </Card>
  );
}
