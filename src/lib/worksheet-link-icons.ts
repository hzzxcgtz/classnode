export const WORKSHEET_LINK_ICONS = [
  { value: 'attachment', label: '附件' }, { value: 'document', label: '文档' },
  { value: 'pdf', label: 'PDF' }, { value: 'word', label: 'Word' },
  { value: 'slides', label: 'PPT' }, { value: 'sheet', label: '表格' },
  { value: 'image', label: '图片' }, { value: 'web', label: '网页' },
] as const;
export type WorksheetLinkIcon = typeof WORKSHEET_LINK_ICONS[number]['value'];
export function normalizeWorksheetLinkIcon(value: unknown): WorksheetLinkIcon {
  return WORKSHEET_LINK_ICONS.some(item => item.value === value) ? value as WorksheetLinkIcon : 'attachment';
}
/** Fixed vector assets share a folded-paper shape, soft fill and type-specific accent. */
const PALETTES: Record<WorksheetLinkIcon, { ink: string; soft: string }> = {
  attachment: { ink: '#467bb4', soft: '#edf4ff' }, document: { ink: '#6274c8', soft: '#edf0ff' },
  pdf: { ink: '#db555b', soft: '#fff0f0' }, word: { ink: '#3478ce', soft: '#eaf2ff' },
  slides: { ink: '#d87938', soft: '#fff1e7' }, sheet: { ink: '#32936b', soft: '#e9f7f0' },
  image: { ink: '#a267c7', soft: '#f6edfc' }, web: { ink: '#309da0', soft: '#e9f8f7' },
};
export function worksheetLinkIconImage(value: unknown): string {
  const kind = normalizeWorksheetLinkIcon(value);
  const { ink, soft } = PALETTES[kind];
  const label = {pdf:'PDF',word:'W',slides:'P',sheet:'X'}[kind as 'pdf'|'word'|'slides'|'sheet'];
  let body: string;
  if (kind === 'attachment') {
    body = `<rect width="24" height="24" rx="6" fill="${soft}" stroke="none"/><path transform="translate(2.4 2.4) scale(.8)" d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>`;
  } else if (kind === 'web') {
    body = `<circle cx="12" cy="12" r="9.5" fill="${soft}"/><path d="M2.5 12h19M12 2.5c5 5 5 14 0 19-5-5-5-14 0-19M4.5 6.8c4 2.3 11 2.3 15 0M4.5 17.2c4-2.3 11-2.3 15 0"/>`;
  } else if (kind === 'image') {
    body = `<rect x="2" y="3" width="20" height="18" rx="3" fill="${soft}"/><circle cx="8" cy="8.5" r="2" fill="${ink}" stroke="none"/><path d="m3 17 5-5 4 4 4-5 5 7v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill="${ink}" fill-opacity=".22"/>`;
  } else {
    body = `<path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-10z" fill="${soft}"/><path d="M14 2.5v5a2 2 0 0 0 2 2h5" fill="white"/><path d="M9 12.5h8M9 16h8" opacity=".35"/>`;
    body += label ? `<rect x="1.5" y="11" width="${label.length>1?14:11}" height="10" rx="2.5" fill="${ink}" stroke="none"/><text x="${label.length>1?8.5:7}" y="18.3" text-anchor="middle" stroke="none" fill="white" font-family="Arial,sans-serif" font-weight="700" font-size="${label.length>1?6:8}">${label}</text>` : `<path d="M9 19h5" opacity=".35"/>`;
  }
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
}
