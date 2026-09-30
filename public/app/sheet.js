// A bottom sheet on phones and a centered panel on larger screens, built on
// <dialog>. It closes on a tap outside, and Escape runs `onEscape` (go back a
// step, or close). On close, focus returns to the control that opened it,
// found again by its data-key if the page was redrawn meanwhile, or else to
// `fallbackFocus`.

import { paint } from '../shared/dom.js';

export function createSheet(dialog, { onEscape, onClose, fallbackFocus = '#reserve' } = {}) {
  let opener = null;
  let openerKey = null;
  let locked = false;

  const sheet = {
    get isOpen() { return dialog.open; },

    // While locked (saving), the sheet cannot be closed.
    set locked(value) { locked = value; },

    open() {
      if (dialog.open) return;
      opener = document.activeElement;
      openerKey = opener?.dataset?.key || null;
      dialog.showModal();
      document.body.classList.add('sheet-open');
    },

    close() {
      if (!dialog.open || locked) return;
      dialog.close();
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('sheet-open');
      const redrawn = openerKey && document.querySelector(`[data-key="${CSS.escape(openerKey)}"]`);
      const target = opener?.isConnected ? opener : redrawn || document.querySelector(fallbackFocus);
      target?.focus({ preventScroll: true });
      opener = null;
      openerKey = null;
      onClose?.();
    },

    // Replaces the content when it changed. Focus stays on the same control
    // (by data-key), or moves to `focus`, or to the heading if the focused
    // control is gone.
    render(html, { focus = null } = {}) {
      const hadFocus = dialog.contains(document.activeElement);
      paint(dialog, html);
      if (focus) {
        dialog.scrollTop = 0;
        dialog.querySelector(focus)?.focus({ preventScroll: true });
      } else if (hadFocus && !dialog.contains(document.activeElement)) {
        dialog.querySelector('h2')?.focus({ preventScroll: true });
      }
    }
  };

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    if (onEscape) onEscape();
    else sheet.close();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) sheet.close();
  });

  return sheet;
}
