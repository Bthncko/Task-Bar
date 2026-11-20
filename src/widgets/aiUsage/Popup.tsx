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

import { trans } from "../../lib/trans";
import { dtf, nf, pct, t } from "../../lib/i18n";
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
        <PanelHeader title={t("AI kullanımı")} />
        <p className={styles.note}>{t("Claude Code oturumu ya da kaydı bulunamadı.")}</p>
      </div>
    );

  const { limits, limitsError, activity } = usage;

  return (
    <div className={styles.root}>
      <PanelHeader title={t("AI kullanımı")} />

      <div className={styles.windows}>
        <LimitCard
          title={t("Oturum")}
          sub={t("5 saatlik")}
          limit={limits?.session}
          now={now}
          idle={t("İlk istekle başlar")}
        />
        <LimitCard
          title={t("Haftalık")}
          sub={t("tüm modeller")}
          limit={limits?.weekly}
          now={now}
          idle={t("İlk istekle başlar")}
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
                <span className={styles.otherValue}>{pct(c?.percent ?? 0)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {limitsError && (
        <p className={styles.error} role="status">
          {limits ? t("Güncellenemedi: {error}", { error: t(limitsError) }) : t(limitsError)}
        </p>
      )}

      {activity && (
        <>
          <section className={styles.section} aria-label={t("Günlük etkinlik")}>
            <h3 className={styles.title}>
              {t("Bu bilgisayarda · 7 gün")}
              <span className={styles.titleSub}>
                {nf().format(activity.requests)} {t("istek")}
              </span>
            </h3>
            <DayChart activity={activity} now={now} />
          </section>

          {activity.models.length > 0 && (
            <section className={styles.section} aria-label={t("Modeller")}>
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
                  t("{n} çıktı", { n: tokens(activity.tokens.output) }),
                  t("{n} girdi", { n: tokens(activity.tokens.input) }),
                  t("{n} önbellekten", { n: tokens(activity.tokens.cacheRead) }),
                  t("{n} önbelleğe", { n: tokens(activity.tokens.cacheWrite) }),
                ]
                  .map((s) => s.split(" ").join(NBSP))
                  .join(`${NBSP}· `)}
              </p>
            </section>
          )}
        </>
      )}

      <p className={styles.footnote}>
        {trans(
          t(
            "Yüzdeler Claude hesabından ({cmd} ile aynı){fetched}. Grafik ve model payları yalnızca bu bilgisayardaki Claude Code kayıtlarından.",
          ),
          {
            cmd: <code>/usage</code>,
            fetched: limits ? t(", {ago} alındı", { ago: ago(limits.fetchedAt, now) }) : "",
          },
        )}
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
      <span className={styles.cardValue}>{c ? pct(c.percent) : "—"}</span>
      <Meter value={c?.percent ?? 0} muted={!c} className={styles.cardMeter} />
      {c?.resetsAt ? (
        <span className={styles.cardDetail}>
          <span className={styles.cardReset}>
            {t("Sıfırlanma")} {resetTime(c.resetsAt, now)}
          </span>
          <span>
            {remaining(c.resetsAt, now)} {t("kaldı")}
          </span>
        </span>
      ) : (
        <span className={styles.cardDetail}>{c ? idle : t("Bilinmiyor")}</span>
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
          title={t("{date}: 7 günün %{share}", {
            date: dtf({ day: "numeric", month: "long" }).format(d.date),
            share: d.share,
          })}
        >
          <span className={styles.barTrack}>
            <span
              className={styles.bar}
              data-today={d.label === t("Bugün") || undefined}
              style={{ "--h": `${(d.weight / peak) * 100}%` } as CSSProperties}
            />
          </span>
          <span className={styles.dayLabel}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}
