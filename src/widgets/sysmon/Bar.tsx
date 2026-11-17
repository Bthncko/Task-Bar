import { commands, events } from "../../lib/ipc";
import { togglePopup } from "../../lib/popup";
import { useService } from "../../lib/useService";
import { Meter, Tile } from "../ui";
import { HIGH, percent, rate } from "./format";
import type { SysmonConfig } from "./index";
import styles from "./Bar.module.css";

/** Çubuk karosu (8.4): üç görünümden biri; tıklayınca ayrıntılı panel. */
export function SysmonBar({ config }: { config: SysmonConfig }) {
  const sys = useService(commands.getSysmon, events.sysmon);
  if (!sys) return null;
  const ram = percent(sys.ramUsed, sys.ramTotal);
  const view = config.view ?? "compact";

  let body;
  if (view === "bars") {
    body = (
      <span className={styles.bars}>
        <Gauge label="CPU" value={sys.cpu} />
        <Gauge label="RAM" value={ram} />
      </span>
    );
  } else if (view === "net") {
    body = (
      <span className={styles.net}>
        <span>↓ {rate(sys.netDown)}</span>
        <span className={styles.dim}>↑ {rate(sys.netUp)}</span>
      </span>
    );
  } else {
    body = (
      <span className={styles.compact}>
        <span data-high={sys.cpu >= HIGH || undefined}>CPU %{sys.cpu}</span>
        <span className={styles.dot}>·</span>
        <span data-high={ram >= HIGH || undefined}>RAM %{ram}</span>
      </span>
    );
  }

  return (
    <Tile
      as="button"
      variant="soft"
      interactive
      className={styles.tile}
      title={`İşlemci %${sys.cpu} · Bellek %${ram}\nİndirme ${rate(sys.netDown)} · Yükleme ${rate(sys.netUp)}`}
      aria-label={`Sistem: işlemci yüzde ${sys.cpu}, bellek yüzde ${ram}`}
      onClick={(e) => togglePopup("sysmon", e.currentTarget)}
    >
      {body}
    </Tile>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  return (
    <span className={styles.gauge} data-high={value >= HIGH || undefined}>
      <span className={styles.gaugeLabel}>{label}</span>
      <Meter value={value} className={styles.meter} />
    </span>
  );
}
