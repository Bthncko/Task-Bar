import type { Config } from "../../lib/ipc";
import { updateConfig } from "../../lib/store";
import { registry } from "../../widgets/registry";
import type { DockSection } from "../../widgets/types";
import { Section } from "./controls";
import { SortableLists, type SortList } from "./SortableLists";
import styles from "./Settings.module.css";

const SECTIONS: { key: DockSection; title: string }[] = [
  { key: "left", title: "Sol" },
  { key: "center", title: "Orta" },
  { key: "right", title: "Sağ" },
];
const UNUSED = "unused";

const item = (id: string) => ({ id, label: registry[id].name });

export function Widgets({ config }: { config: Config }) {
  const used = new Set(SECTIONS.flatMap((s) => config.layout[s.key].map((r) => r.id)));

  const lists: SortList[] = [
    ...SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      // Bilinmeyen (kaldırılmış) widget'lar listelenmez; ilk kayıtta temizlenir.
      items: config.layout[s.key].filter((r) => registry[r.id]).map((r) => item(r.id)),
    })),
    {
      key: UNUSED,
      title: "Kullanılmayan",
      items: Object.keys(registry)
        .filter((id) => !used.has(id))
        .map(item),
      empty: "Kapatmak için buraya sürükle",
    },
  ];

  const save = (next: Record<string, string[]>) =>
    updateConfig((c) => ({
      ...c,
      layout: {
        left: next.left.map((id) => ({ id })),
        center: next.center.map((id) => ({ id })),
        right: next.right.map((id) => ({ id })),
      },
    }));

  /** × düğmesi: sürüklemeden kapatma. */
  const remove = (id: string) =>
    save(
      Object.fromEntries(
        lists.map((l) => [l.key, l.items.map((i) => i.id).filter((x) => x !== id)]),
      ),
    );

  return (
    <Section
      title="Widget'lar"
      intro="Sürükleyerek sırala ya da bölümler arasında taşı. Kapatmak için “Kullanılmayan”a sürükle."
    >
      <SortableLists
        lists={lists}
        onChange={save}
        renderActions={(it, listKey) =>
          listKey !== UNUSED && (
            <button
              type="button"
              className={styles.itemAction}
              aria-label={`${it.label} kapat`}
              title="Kapat"
              onClick={() => remove(it.id)}
            >
              ×
            </button>
          )
        }
      />
    </Section>
  );
}
