// Inline SVG icons. They inherit the text color.

const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = {
  room: svg('<path d="M5 21V4l12-2v19M3 21h18M13 11v2"/>'),
  whiteboard: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 8h10M7 12h6"/>'),
  tv: svg('<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 22h8m-4-4v4"/>'),
  back: svg('<path d="m14 6-6 6 6 6"/>'),
  close: svg('<path d="m6 6 12 12M6 18 18 6"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>')
};
