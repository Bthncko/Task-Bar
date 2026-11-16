import { useState } from "react";

// 7.7: listeye giren / çıkan öğeler. Çıkan öğe, kaybolma animasyonu bitene kadar
// eski yerinde tutulur. (Türetilmiş durum: render sırasında güncellenir.)

export type Presence = { id: string; entering: boolean; leaving: boolean };

export function usePresence(ids: string[]) {
  const key = ids.join("|");
  const [state, setState] = useState<{ key: string | null; items: Presence[] }>({
    key: null,
    items: [],
  });

  if (state.key !== key) {
    // İlk liste animasyonsuz (dock açılışı kendi animasyonuyla gelir).
    const initial = state.key === null;
    const prev = new Map(state.items.filter((e) => !e.leaving).map((e) => [e.id, e]));
    const present = new Set(ids);
    const next: Presence[] = ids.map((id) => ({
      id,
      entering: !initial && (!prev.has(id) || prev.get(id)!.entering),
      leaving: false,
    }));
    state.items.forEach((e, i) => {
      if (!present.has(e.id)) {
        next.splice(Math.min(i, next.length), 0, { ...e, entering: false, leaving: true });
      }
    });
    setState({ key, items: next });
  }

  const drop = (id: string) =>
    setState((s) => ({ ...s, items: s.items.filter((e) => !(e.leaving && e.id === id)) }));
  return [state.items, drop] as const;
}
