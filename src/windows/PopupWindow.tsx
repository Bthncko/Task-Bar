// Aşama 5: takvim / hava durumu panelleri bu pencerede açılacak.
export function PopupWindow({ widgetId }: { widgetId: string }) {
  return <div data-popup={widgetId} />;
}
