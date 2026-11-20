import { useEffect } from "react";
import { commands, events, report, type SysState } from "../../lib/ipc";
import { useService } from "../../lib/useService";
import { Meter } from "../ui";
import { LinkButton, PanelHeader } from "../ui/panel";
import { usePopupClose } from "../ui/popupClose";
import { bytes, HIGH, percent, rate } from "./format";
import styles from "./Popup.module.css";
import { nf, pct, t } from "../../lib/i18n";

/** Grafikteki örnek sayısı (sysmon.rs → HISTORY). */
const SAMPLES = 60;

/** Sistem izleyici paneli (8.4). Açıkken servis her saniye örnekler. */
export function SysmonPopup() {
  const sys = useService(commands.getSysmon, events.sysmon);
  const close = usePopupClose();

  useEffect(() => {
    commands.sysmonDetail(true).catch(report("sysmon_detail"));
    return () => {
      commands.sysmonDetail(false).catch(report("sysmon_detail"));
    };
  }, []);

  const openTaskManager = () => {
    commands.openTaskManager().catch(report("open_task_manager"));
    close();
  };

  return (
    <div className={styles.root}>
      <PanelHeader
        title={t("Sistem")}
        actions={<LinkButton onClick={openTaskManager}>{t("Görev Yöneticisi")}</LinkButton>}
      />
      {sys ? <Body sys={sys} /> : <p className={styles.note}>{t("Okunuyor…")}</p>}
    </div>
  );
}

function Body({ sys }: { sys: NonNullable<SysState> }) {
  const ram = percent(sys.ramUsed, sys.ramTotal);
  return (
    <>
      <section className={styles.cpu}>
        <div className={styles.cpuHead}>
          <span className={styles.label}>{t("İşlemci")}</span>
          <span className={styles.big} data-high={sys.cpu >= HIGH || undefined}>
            {pct(sys.cpu)}
          </span>
        </div>
        <Graph values={sys.history} />
      </section>

      <section className={styles.row}>
        <div className={styles.rowHead}>
          <span className={styles.label}>{t("Bellek")}</span>
          <span className={styles.value}>
            {bytes(sys.ramUsed)} / {bytes(sys.ramTotal)}
            <span className={styles.dim}> · {pct(ram)}</span>
          </span>
        </div>
        <Meter value={ram} className={ram >= HIGH ? styles.warnMeter : undefined} />
      </section>

      <section className={styles.netRow}>
        <span className={styles.label}>{t("Ağ")}</span>
        <span className={styles.value}>↓ {rate(sys.netDown)}</span>
        <span className={styles.value}>↑ {rate(sys.netUp)}</span>
      </section>

      {sys.disks.length > 0 && (
        <section className={styles.group}>
          {sys.disks.map((d) => {
            const p = percent(d.used, d.total);
            return (
              <div key={d.root} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.label}>
                    {t("Disk")} {d.root}
                  </span>
                  <span className={styles.value}>
                    {bytes(d.total - d.used)} {t("boş")}
                    <span className={styles.dim}> / {bytes(d.total)}</span>
                  </span>
                </div>
                <Meter value={p} className={p >= HIGH ? styles.warnMeter : undefined} />
              </div>
            );
          })}
        </section>
      )}

      <section className={styles.procs} aria-label={t("En çok işlemci kullananlar")}>
        <div className={styles.procHead}>
          <span>{t("Süreç")}</span>
          <span>{t("İşlemci")}</span>
          <span>{t("Bellek")}</span>
        </div>
        {sys.processes.length === 0 ? (
          <p className={styles.note}>{t("Ölçülüyor…")}</p>
        ) : (
          sys.processes.map((p) => (
            <div key={p.name} className={styles.proc}>
              <span className={styles.procName} title={p.name}>
                {p.name}
              </span>
              <span>{pct(nf({ maximumFractionDigits: 1 }).format(p.cpu))}</span>
              <span className={styles.dim}>{bytes(p.memory)}</span>
            </div>
          ))
        )}
      </section>
    </>
  );
}

/** Son örneklerin çizgi grafiği; sağda en yeni. Kütüphane yok (SVG). */
function Graph({ values }: { values: number[] }) {
  const w = 300;
  const h = 64;
  const step = w / (SAMPLES - 1);
  const start = SAMPLES - values.length;
  const y = (v: number) => (h - (v / 100) * (h - 2) - 1).toFixed(1);
  const line = values.map((v, i) => `${((start + i) * step).toFixed(1)},${y(v)}`).join(" ");
  const area = values.length > 1 ? `${(start * step).toFixed(1)},${h} ${line} ${w},${h}` : "";
  return (
    <svg className={styles.graph} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} className={styles.gridLine} />
      {area && <polygon points={area} className={styles.area} />}
      {values.length > 1 && <polyline points={line} className={styles.line} />}
    </svg>
  );
}
