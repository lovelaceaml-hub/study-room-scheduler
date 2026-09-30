// A bottom sheet on phones and a centered panel on larger screens, built on
// <dialog>. It returns focus to whatever opened it and closes on a tap
// outside. Escape runs `onEscape` (go back a step, or close).

// `fallbackFocus` is a selector to focus on close when the control that
// opened the sheet is gone (for example a reservation that was cancelled).
export function createSheet(dialog, { onEscape, onClose, fallbackFocus = '#reserve' } = {}) {
  let opener = null;
  let locked = false;
  let painted = '';

  const sheet = {
    get isOpen() { return dialog.open; },

    // While locked (saving), the sheet cannot be closed.
    set locked(value) { locked = value; },

    open() {
      if (dialog.open) return;
      opener = document.activeElement;
      dialog.showModal();
      document.body.classList.add('sheet-open');
    },

    close() {
      if (!dialog.open || locked) return;
      dialog.close();
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('sheet-open');
      const target = opener?.isConnected ? opener : document.querySelector(fallbackFocus);
      target?.focus({ preventScroll: true });
      opener = null;
      onClose?.();
    },

    // Replaces the content when it changed. `focus` is a selector to focus
    // afterwards; otherwise focus stays on the same control (by data-key), or
    // moves to the heading if that control is gone.
    render(html, { focus = null, scrollTop = false } = {}) {
      if (html === painted && !focus) return;
      painted = html;
      const hadFocus = dialog.contains(document.activeElement);
      const focusKey = document.activeElement?.dataset?.key;
      dialog.innerHTML = html;
      if (scrollTop) dialog.scrollTop = 0;
      const target = (focus && dialog.querySelector(focus))
        || (hadFocus && focusKey && dialog.querySelector(`[data-key="${CSS.escape(focusKey)}"]`))
        || (hadFocus || focus ? dialog.querySelector('h2') : null);
      target?.focus({ preventScroll: true });
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
