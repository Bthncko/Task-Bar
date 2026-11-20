import { Fragment, type ReactNode } from "react";
import { t } from "./i18n";

/**
 * İçinde kalın / kod gibi öğeler olan metinler için: `{ad}` yer tutucuları React
 * öğeleriyle doldurulur, cümle sırası dile göre değişebilir.
 *   trans("Sonuca tıklayınca çalar; {key} ile sıraya eklenir.", { key: <b>Alt</b> })
 */
export function trans(tr: string, parts: Record<string, ReactNode>): ReactNode {
  const text = t(tr);
  return text
    .split(/\{(\w+)\}/)
    .map((piece, i) =>
      i % 2 === 0 ? (
        <Fragment key={i}>{piece}</Fragment>
      ) : (
        <Fragment key={i}>{piece in parts ? parts[piece] : `{${piece}}`}</Fragment>
      ),
    );
}
