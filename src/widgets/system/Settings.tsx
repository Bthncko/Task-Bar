import { Card, Row, Toggle } from "../../windows/settings/controls";
import { SYSTEM_BUTTONS } from "./buttons";
import type { SystemConfig } from "./index";

/** Ayarlar → Widget'lar: hangi sistem düğmeleri görünsün. */
export function SystemSettings({
  config,
  onChange,
}: {
  config: SystemConfig;
  onChange(c: SystemConfig): void;
}) {
  return (
    <Card>
      {SYSTEM_BUTTONS.map((b) => {
        const on = config.buttons.includes(b.id);
        return (
          <Row key={b.id} label={b.name} hint={b.keys}>
            <Toggle
              checked={on}
              label={b.name}
              onChange={(next) =>
                onChange({
                  buttons: next
                    ? SYSTEM_BUTTONS.map((x) => x.id).filter(
                        (id) => id === b.id || config.buttons.includes(id),
                      )
                    : config.buttons.filter((id) => id !== b.id),
                })
              }
            />
          </Row>
        );
      })}
    </Card>
  );
}
