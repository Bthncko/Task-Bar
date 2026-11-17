import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, events, report, type PopupOpen } from "../lib/ipc";
import { startConfigSync, useConfig } from "../lib/store";
import { applyTheme, uiScale } from "../lib/theme";
import { useService } from "../lib/useService";
import { registry } from "../widgets/registry";
import { PopupCloseProvider } from "../widgets/ui/popupClose";
import styles from "./PopupWindow.module.css";

const DEFAULT_SIZE = { width: 320, height: 360 };
/** Kapanış animasyonu (PopupWindow.module.css → exit ile aynı). */
const CLOSE_MS = 120;
/**
 * Bir panelden ötekine geçerken eski panelin ekrandan gitmesi için beklenir:
 * Rust `popup_ready`'de arkadaki ekranı (buzlu cam) okur, eskisi görünmesin.
 */
const SWITCH_SETTLE_MS = 50;

/** Buzlu camın örtüsü: arkası açıksa koyulaşır (yazı okunsun), düzde opak. */
function glassAlpha(theme: { opacity: number; glass: string }, luma: number) {
  if (theme.glass === "flat") return 1;
  const base = 0.42 + 0.4 * Math.min(Math.max(luma, 0), 1);
  // Saydamlık ayarı yükseldikçe opaklığa yaklaşır.
  return Math.min(1, base + Math.max(0, theme.opacity - 0.6));
}

type Backdrop = { image: string; alpha: number };

/**
 * - `pending`: çizildi, Rust henüz göstermedi (görünmez).
 * - `open`: pencere göründü, açılış animasyonu.
 * - `closing`: kapanış animasyonu; bitince `hide_popup`.
 */
type Phase = "pending" | "open" | "closing";

startConfigSync();

/** Hareket ayarı (7.9, `data-motion`): "system" ise Windows'unki. */
const reducedMotion = () => {
  const setting = document.documentElement.dataset.motion;
  if (setting === "reduce") return true;
  if (setting === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

/**
 * Tek popup penceresi (bölüm 3.4, 7.6). Rust hangi widget'ın panelini istediğini
 * `popup://open` ile söyler; panel çizilince `popup_ready` ile boyutu bildiririz,
 * Rust konumlayıp gösterir ve açılış animasyonunun çıkış noktasını döndürür.
 * Kapanırken önce animasyon, sonra `hide_popup` (Rust doğrudan gizlemez).
 */
export function PopupWindow() {
  const config = useConfig();
  const systemAccent = useService(commands.getSystemAccent, events.accent);
  const [open, setOpen] = useState<PopupOpen | null>(null);
  const [phase, setPhase] = useState<Phase>("pending");
  const [originX, setOriginX] = useState<number | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const announced = useRef(0);
  const current = useRef<PopupOpen | null>(null);
  const closingSeq = useRef(0);
  /** Bu açılış başka bir panelin yerine mi (pencere zaten görünür). */
  const switching = useRef(false);

  useEffect(() => {
    current.current = open;
  }, [open]);

  const close = useCallback(() => {
    const cur = current.current;
    if (!cur || closingSeq.current === cur.seq) return;
    closingSeq.current = cur.seq;
    setPhase("closing");
    window.setTimeout(
      () => commands.hidePopup(cur.seq).catch(report("hide_popup")),
      reducedMotion() ? 0 : CLOSE_MS,
    );
  }, []);

  useEffect(() => {
    const unlisten = [
      listen<PopupOpen>(events.popupOpen, (e) => {
        switching.current = current.current !== null;
        current.current = e.payload;
        setOpen(e.payload);
        setPhase("pending");
        setOriginX(null);
        setBackdrop(null);
      }),
      listen<{ seq: number }>(events.popupClose, (e) => {
        if (current.current?.seq === e.payload.seq) close();
      }),
      listen(events.popupClosed, () => {
        current.current = null;
        setOpen(null);
      }),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlisten.forEach((p) => p.then((off) => off()));
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  useEffect(() => {
    if (config) applyTheme(config.theme, { systemAccent });
  }, [config?.theme, systemAccent]); // eslint-disable-line react-hooks/exhaustive-deps

  // "radios/wifi": widget + sayfa (bir widget'ın birden çok paneli).
  const [widgetId, page] = open ? open.widgetId.split("/") : [];
  const widget = widgetId ? registry[widgetId] : undefined;
  const Popup = widget?.Popup;
  const size =
    (typeof widget?.popupSize === "function" ? widget.popupSize(page) : widget?.popupSize) ??
    DEFAULT_SIZE;
  // Boyut ayarı (7.9): panel CSS zoom ile büyür; gölge payı (16 px) büyümez,
  // Rust'taki SHADOW_PAD ile eşit kalsın diye zoom yalnızca panelde.
  const zoom = config ? uiScale(config.theme) : 1;

  // DOM güncellendi → Rust'a "göster" de; her açılışta bir kez. Gösterildiğinde
  // açılış animasyonu başlar (pencere gizliyken kare üretilmeyebilir).
  useLayoutEffect(() => {
    if (!open || !config || !widget?.Popup || announced.current === open.seq) return;
    const seq = open.seq;
    announced.current = seq;
    const theme = config.theme;
    const announce = () =>
      commands
        .popupReady(seq, size.width * zoom, size.height * zoom)
        .then(async (placed) => {
          if (!placed || current.current?.seq !== seq) return;
          if (placed.backdrop && theme.glass !== "flat") {
            // Görüntü çözülmeden açılırsa ilk kareler camsız görünür.
            const img = new Image();
            img.src = placed.backdrop;
            await img.decode().catch(() => {});
            if (current.current?.seq !== seq) return;
            setBackdrop({ image: placed.backdrop, alpha: glassAlpha(theme, placed.luma ?? 0) });
          }
          setOriginX(placed.originX);
          setPhase((p) => (p === "pending" ? "open" : p));
        })
        .catch(report("popup_ready"));
    if (switching.current) window.setTimeout(announce, SWITCH_SETTLE_MS);
    else announce();
  });

  if (!open || !config || !widget || !Popup) return null;
  const widgetConfig = config.widgets[widgetId!] ?? widget.defaultConfig;

  // Panel tıklanan widget'tan doğru büyür (dock altta: panelin alt kenarı).
  // Rust ekran pikseli verir; panelin içi zoom'suz CSS pikseli.
  const origin =
    originX === null ? "50%" : `${Math.min(Math.max(originX / zoom, 0), size.width)}px`;

  return (
    <div
      className={styles.root}
      // Gölge payına tıklamak (panelin dışı) kapatır.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Her açılışta yeni örnek: önceki açılıştan kalan durum (ör. gezilen ay) sıfırlanır. */}
      <div
        key={open.seq}
        className={styles.panel}
        data-phase={phase}
        data-backdrop={backdrop ? "" : undefined}
        style={
          {
            transformOrigin: `${origin} 100%`,
            zoom,
            ...(backdrop && {
              "--panel-image": `url("${backdrop.image}")`,
              "--panel-alpha": backdrop.alpha.toFixed(3),
            }),
          } as CSSProperties
        }
      >
        <PopupCloseProvider value={close}>
          <Popup config={widgetConfig} page={page} />
        </PopupCloseProvider>
      </div>
    </div>
  );
}
