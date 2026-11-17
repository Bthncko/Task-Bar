import type { SysmonView } from "../../lib/ipc";
import { Card, Row, Segmented } from "../../windows/settings/controls";
import type { SysmonConfig } from "./index";

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
      <Row label="Çubukta" hint="Tıklayınca ayrıntılı panel açılır.">
        <Segmented<SysmonView>
          label="Çubuk görünümü"
          value={config.view ?? "compact"}
          options={[
            { value: "compact", label: "Yüzde" },
            { value: "bars", label: "Çubuk" },
            { value: "net", label: "Ağ" },
          ]}
          onChange={(view) => onChange({ ...config, view })}
        />
      </Row>
    </Card>
  );
}
