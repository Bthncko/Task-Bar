import { createContext, useContext } from "react";

// Panelin animasyonlu kapanışı (7.6): popup kabuğu sağlar, paneller kullanır.

const PopupClose = createContext<() => void>(() => {});

export const PopupCloseProvider = PopupClose.Provider;

/** Paneli kapanış animasyonuyla kapatır (paneldeki eylemlerden sonra da kullanılır). */
export const usePopupClose = () => useContext(PopupClose);
