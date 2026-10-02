// A bottom sheet on phones and a centered panel on larger screens, built on
// <dialog>. Escape (and Android Back) runs `onEscape` (go back a step, or
// close). A tap outside closes it when `closeOnOutside()` allows, but never in
// the first half second, so a double tap on the schedule does not close the
// sheet the first tap opened. On close, focus returns to the control that
// opened it, found again by its data-key if the page was redrawn meanwhile, or
// else to `fallbackFocus`.
//
// While locked (saving), close() does nothing. The browser still closes the
// dialog on a second Escape or Back with no tap in between; the same tidy-up
// then runs from the dialog's close event, exactly once.

import { paint } from '../shared/dom.js';

const OUTSIDE_TAP_DELAY_MS = 500;

export function createSheet(dialog, { onEscape, onClose, fallbackFocus = '#reserve', closeOnOutside = () => true } = {}) {
  let opener = null;
  let openerKey = null;
  let locked = false;
  let finished = true;
  let justOpened = false;
  let openTimer = null;

  // Runs once per opening, whichever way the sheet closed.
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(openTimer);
    justOpened = false;
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('sheet-open');
    const redrawn = openerKey && document.querySelector(`[data-key="${CSS.escape(openerKey)}"]`);
    const target = opener?.isConnected ? opener : redrawn || document.querySelector(fallbackFocus);
    target?.focus({ preventScroll: true });
    opener = null;
    openerKey = null;
    onClose?.();
  }

  const sheet = {
    get isOpen() { return dialog.open; },

    set locked(value) { locked = value; },

    open() {
      if (dialog.open) return;
      const active = document.activeElement;
      // Opened by the page itself (?view=mine on load): focus goes to the fallback.
      opener = active && active !== document.body ? active : null;
      openerKey = opener?.dataset?.key || null;
      dialog.showModal();
      finished = false;
      document.body.classList.add('sheet-open');
      justOpened = true;
      clearTimeout(openTimer);
      openTimer = setTimeout(() => { justOpened = false; }, OUTSIDE_TAP_DELAY_MS);
    },

    close() {
      if (!dialog.open || locked) return;
      dialog.close();
      finish();
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

  // A close the page did not ask for (a second Escape or Back).
  dialog.addEventListener('close', () => {
    if (!dialog.open) finish();
  });
  dialog.addEventListener('cancel', event => {
    // The browser closes the dialog anyway; the close event tidies up.
    if (!event.cancelable) return;
    event.preventDefault();
    if (onEscape) onEscape();
    else sheet.close();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog || justOpened || !closeOnOutside()) return;
    const box = dialog.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (outside) sheet.close();
  });

  return sheet;
}
