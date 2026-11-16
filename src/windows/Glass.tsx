import { useState } from "react";
import styles from "./DockWindow.module.css";

/**
 * Çubuğun cam katmanları (7.2), alttan üste: bulanık duvar kâğıdı → koyu
 * örtü → gürültü; hepsi birlikte `--glass-opacity` (ayarlardaki saydamlık)
 * ile arkadaki gerçek masaüstüne karışır. Kenar parlaması bunun dışında, hep tam.
 * Duvar kâğıdı değişince yeni katman eskisinin üstünde belirir (400 ms).
 *
 * `image` yoksa (okunamadı) yalnızca yarı saydam örtü kalır (B bölümü 3. yol).
 */
export function Glass({ image }: { image: string | null }) {
  // Önceki görüntü, yenisi belirene kadar altta kalır.
  const [layers, setLayers] = useState({ current: image, previous: null as string | null });
  if (layers.current !== image) {
    // Görüntü kalktıysa (düz cam, 7.9) eskisi de hemen gider: onu silen
    // animationend yalnızca yeni katmanda tetiklenir.
    setLayers({ current: image, previous: image ? layers.current : null });
  }

  return (
    <div className={styles.glass} aria-hidden>
      <div className={styles.fill}>
        {layers.previous && (
          <div
            className={styles.backdrop}
            style={{ backgroundImage: `url("${layers.previous}")` }}
          />
        )}
        {layers.current && (
          <div
            key={layers.current}
            className={`${styles.backdrop} ${styles.backdropEnter}`}
            style={{ backgroundImage: `url("${layers.current}")` }}
            onAnimationEnd={() => setLayers((l) => ({ ...l, previous: null }))}
          />
        )}
        <div className={styles.tint} />
        <div className={styles.noise} />
      </div>
    </div>
  );
}
