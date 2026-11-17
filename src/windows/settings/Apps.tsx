import { commands, events, type Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { useService } from "../../lib/useService";
import { Card, Row, Section, Segmented, Slider, Toggle } from "./controls";
import { SortableLists } from "./SortableLists";
import styles from "./Settings.module.css";

const PINNED = "pinned";

export function Apps({ config }: { config: Config }) {
  const { pinned, magnify, previews, previewDelayMs } = config.widgets.apps;
  const setApps = (patch: Partial<Config["widgets"]["apps"]>) =>
    updateConfig((c) => ({
      ...c,
      widgets: { ...c.widgets, apps: { ...c.widgets.apps, ...patch } },
    }));
  // İkonlar dock'un uygulama listesinden (sabitlenenler orada her zaman var).
  const apps = useService(commands.getApps, events.apps) ?? [];
  const iconOf = new Map(apps.map((a) => [a.id, a.icon]));

  const setPinned = (ids: string[]) =>
    updateConfig((c) => {
      const byId = new Map(c.widgets.apps.pinned.map((p) => [p.id, p]));
      return {
        ...c,
        widgets: {
          ...c.widgets,
          apps: {
            ...c.widgets.apps,
            pinned: ids.flatMap((id) => byId.get(id) ?? []),
          },
        },
      };
    });

  return (
    <Section title="Uygulamalar">
      <Card>
        <Row label="Büyütme" hint="İmleç üstüne gelince ikonların büyüme oranı.">
          <Slider
            label="Büyütme"
            min={1}
            max={2.5}
            step={0.1}
            value={magnify}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(v) =>
              updateConfig(
                (c) => ({
                  ...c,
                  widgets: { ...c.widgets, apps: { ...c.widgets.apps, magnify: v } },
                }),
                120,
              )
            }
          />
        </Row>
        <Row
          label="Pencere önizlemesi"
          hint="Açık bir uygulamanın ikonunda bekleyince pencerelerinin küçük resimleri."
        >
          <Toggle
            label="Pencere önizlemesi"
            checked={previews ?? true}
            onChange={(on) => setApps({ previews: on })}
          />
        </Row>
        {(previews ?? true) && (
          <Row label="Önizleme gecikmesi" hint="İkonda ne kadar bekleyince açılsın.">
            <Segmented
              label="Önizleme gecikmesi"
              value={String(previewDelayMs ?? 350)}
              options={[
                { value: "200", label: "Kısa" },
                { value: "350", label: "Normal" },
                { value: "600", label: "Uzun" },
              ]}
              onChange={(v) => setApps({ previewDelayMs: Number(v) })}
            />
          </Row>
        )}
      </Card>

      <h3 className={styles.subTitle}>Sabitlenenler</h3>
      {pinned.length === 0 ? (
        <p className={styles.intro}>
          Henüz sabitlenen uygulama yok. Dock'ta bir uygulamaya sağ tıklayıp “Sabitle”yi seç.
        </p>
      ) : (
        <>
          <p className={styles.intro}>Dock'taki sıra. Sürükleyerek değiştir.</p>
          <SortableLists
            lists={[
              {
                key: PINNED,
                title: "",
                items: pinned.map((p) => ({ id: p.id, label: p.name, icon: iconOf.get(p.id) })),
              },
            ]}
            onChange={(next) => setPinned(next[PINNED])}
            renderActions={(it) => (
              <button
                type="button"
                className={styles.itemAction}
                aria-label={`${it.label} sabitlemesini kaldır`}
                title="Sabitlemeyi kaldır"
                onClick={() => setPinned(pinned.map((p) => p.id).filter((id) => id !== it.id))}
              >
                ×
              </button>
            )}
          />
        </>
      )}
    </Section>
  );
}
