import { useEffect, type CSSProperties } from "react";
import { commands, events, report, type AiLimit } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Meter } from "../ui";
import { PanelHeader } from "../ui/panel";
import {
  ago,
  current,
  days,
  NBSP,
  remaining,
  resetTime,
  share,
  tokens,
  useMinute,
  type Activity,
} from "./format";
import styles from "./Popup.module.css";

/**
 * AI kullanımı paneli (8.9): hesaptaki oturum ve haftalık limit yüzdeleri,
 * sıfırlanma zamanlarıyla; altta bu bilgisayardaki Claude Code etkinliği.
 */
export function AiUsagePopup() {
  const usage = useService(commands.getAiUsage, events.aiUsage);
  const now = useMinute();

  // Açılınca beklemeden yeniden sor (servis normalde iki dakikada bir sorar).
  useEffect(() => {
    commands.aiUsageRefresh().catch(report("ai_usage_refresh"));
  }, []);

  if (!usage)
    return (
      <div className={styles.root}>
        <PanelHeader title="AI kullanımı" />
        <p className={styles.note}>Claude Code oturumu ya da kaydı bulunamadı.</p>
      </div>
    );

  const { limits, limitsError, activity } = usage;

  return (
    <div className={styles.root}>
      <PanelHeader title="AI kullanımı" />

      <div className={styles.windows}>
        <LimitCard
          title="Oturum"
          sub="5 saatlik"
          limit={limits?.session}
          now={now}
          idle="İlk istekle başlar"
        />
        <LimitCard
          title="Haftalık"
          sub="tüm modeller"
          limit={limits?.weekly}
          now={now}
          idle="İlk istekle başlar"
        />
      </div>

      {limits && limits.other.length > 0 && (
        <ul className={styles.others}>
          {limits.other.map((l) => {
            const c = current(l, now);
            return (
              <li key={l.label} className={styles.other} data-high={c?.warning || undefined}>
                <span className={styles.otherName}>{l.label}</span>
                <Meter value={c?.percent ?? 0} className={styles.otherMeter} />
                <span className={styles.otherValue}>%{c?.percent ?? 0}</span>
              </li>
            );
          })}
        </ul>
      )}

      {limitsError && (
        <p className={styles.error} role="status">
          {limits ? `Güncellenemedi: ${limitsError}` : limitsError}
        </p>
      )}

      {activity && (
        <>
          <section className={styles.section} aria-label="Günlük etkinlik">
            <h3 className={styles.title}>
              Bu bilgisayarda · 7 gün
              <span className={styles.titleSub}>
                {activity.requests.toLocaleString("tr-TR")} istek
              </span>
            </h3>
            <DayChart activity={activity} now={now} />
          </section>

          {activity.models.length > 0 && (
            <section className={styles.section} aria-label="Modeller">
              <ul className={styles.models}>
                {activity.models.map((m) => (
                  <li key={m.name} className={styles.model}>
                    <span className={styles.modelName}>{m.name}</span>
                    <Meter value={m.share} className={styles.modelMeter} />
                    <span className={styles.modelValue}>{share(m.share)}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.tokens}>
                {/* Her ölçü ("3,4 M çıktı") kendi içinde bölünmez; satır yalnızca " · " yerinde kırılır. */}
                {[
                  `${tokens(activity.tokens.output)} çıktı`,
                  `${tokens(activity.tokens.input)} girdi`,
                  `${tokens(activity.tokens.cacheRead)} önbellekten`,
                  `${tokens(activity.tokens.cacheWrite)} önbelleğe`,
                ]
                  .map((s) => s.split(" ").join(NBSP))
                  .join(`${NBSP}· `)}
              </p>
            </section>
          )}
        </>
      )}

      <p className={styles.footnote}>
        Yüzdeler Claude hesabından (<code>/usage</code> ile aynı)
        {limits ? `, ${ago(limits.fetchedAt, now)} alındı` : ""}. Grafik ve model payları yalnızca
        bu bilgisayardaki Claude Code kayıtlarından.
      </p>
    </div>
  );
}

function LimitCard({
  title,
  sub,
  limit,
  now,
  idle,
}: {
  title: string;
  sub: string;
  limit: AiLimit | null | undefined;
  now: number;
  idle: string;
}) {
  const c = current(limit, now);
  return (
    <div className={styles.card} data-high={c?.warning || undefined}>
      <span className={styles.cardTitle}>
        {title} <span className={styles.cardTitleSub}>{sub}</span>
      </span>
      <span className={styles.cardValue}>{c ? `%${c.percent}` : "—"}</span>
      <Meter value={c?.percent ?? 0} muted={!c} className={styles.cardMeter} />
      {c?.resetsAt ? (
        <span className={styles.cardDetail}>
          <span className={styles.cardReset}>Sıfırlanma {resetTime(c.resetsAt, now)}</span>
          <span>{remaining(c.resetsAt, now)} kaldı</span>
        </span>
      ) : (
        <span className={styles.cardDetail}>{c ? idle : "Bilinmiyor"}</span>
      )}
    </div>
  );
}

function DayChart({ activity, now }: { activity: Activity; now: number }) {
  const chart = days(activity, now);
  const peak = Math.max(...chart.map((d) => d.weight), 1e-9);
  return (
    <div className={styles.chart}>
      {chart.map((d) => (
        <div
          key={d.label}
          className={styles.day}
          title={`${d.date.toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}: 7 günün %${d.share}`}
        >
          <span className={styles.barTrack}>
            <span
              className={styles.bar}
              data-today={d.label === "Bugün" || undefined}
              style={{ "--h": `${(d.weight / peak) * 100}%` } as CSSProperties}
            />
          </span>
          <span className={styles.dayLabel}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}
