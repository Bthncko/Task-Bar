import { commands, events } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { SparkleIcon } from "../icons";
import { Meter, Tile } from "../ui";
import { current, remaining, resetTime, useMinute } from "./format";
import styles from "./Bar.module.css";

/**
 * AI kullanımı (8.9): Claude hesabındaki oturum (5 saat) ve haftalık limit
 * yüzdeleri. Ne Claude oturumu ne Claude Code kaydı varsa gizli.
 */
export function AiUsageBar() {
  const usage = useService(commands.getAiUsage, events.aiUsage);
  const now = useMinute();
  if (!usage) return null;
  const session = current(usage.limits?.session, now);
  const weekly = current(usage.limits?.weekly, now);

  const line = (name: string, l: typeof session) =>
    l
      ? `${name}: %${l.percent}${l.resetsAt ? ` · sıfırlanma ${resetTime(l.resetsAt, now)} (${remaining(l.resetsAt, now)})` : ""}`
      : `${name}: —`;

  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      className={styles.tile}
      title={[
        line("Oturum (5 saat)", session),
        line("Haftalık", weekly),
        ...(usage.limitsError ? [usage.limitsError] : []),
      ].join("\n")}
      aria-label={`AI kullanımı: oturum ${session ? `yüzde ${session.percent}` : "bilinmiyor"}, hafta ${weekly ? `yüzde ${weekly.percent}` : "bilinmiyor"}`}
      onClick={(e) => togglePopup("aiUsage", e.currentTarget)}
    >
      <SparkleIcon size={16} className={styles.icon} />
      <span className={styles.rows}>
        <Row label="Oturum" limit={session} />
        <Row label="Hafta" limit={weekly} />
      </span>
    </Tile>
  );
}

function Row({ label, limit }: { label: string; limit: ReturnType<typeof current> }) {
  return (
    <span className={styles.row} data-high={limit?.warning || undefined}>
      <span className={styles.label}>{label}</span>
      <Meter value={limit?.percent ?? 0} muted={!limit} className={styles.meter} />
      <span className={styles.value}>{limit ? `%${limit.percent}` : "—"}</span>
    </span>
  );
}
