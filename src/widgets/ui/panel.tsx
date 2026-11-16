import type { ReactNode } from "react";
import { CloseIcon } from "../icons";
import { IconButton } from "./index";
import { usePopupClose } from "./popupClose";
import styles from "./panel.module.css";

// Panel ortak parçaları (7.6). Kapatma, popup kabuğunun animasyonlu kapanışıdır.

/** Ortak başlık: başlık solda; eylemler ve kapat sağda. */
export function PanelHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  const close = usePopupClose();
  return (
    <header className={styles.header}>
      <div className={styles.title}>{title}</div>
      <div className={styles.actions}>
        {actions}
        <IconButton aria-label="Kapat" title="Kapat (Esc)" className={styles.close} onClick={close}>
          <CloseIcon size={14} />
        </IconButton>
      </div>
    </header>
  );
}

/** Başlıktaki vurgu renkli metin bağlantısı ("Değiştir", "Bugün"). */
export function LinkButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={styles.link} />;
}
