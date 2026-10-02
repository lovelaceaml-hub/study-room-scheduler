// Replaces an element's content only when the markup changed. When it does,
// keyboard focus (and the cursor in a text field) goes back to the control
// with the same data-key, so a background refresh never moves the user.
//
// While someone is composing text (a phone keyboard's word suggestions, or a
// Korean or Chinese input method), replacing the field would break the word
// being typed, so the newest markup waits until the composition ends. Pages
// should still keep typed text out of regions that refresh on their own.

const painted = new WeakMap();
const waiting = new Map();
let composing = null;

addEventListener('compositionstart', event => { composing = event.target; }, true);
addEventListener('compositionend', () => {
  composing = null;
  for (const [element, html] of [...waiting]) {
    waiting.delete(element);
    paint(element, html);
  }
}, true);

export function paint(element, html) {
  if (composing && element.contains(composing)) {
    waiting.set(element, html);
    return;
  }
  waiting.delete(element);
  if (painted.get(element) === html) return;
  const active = element.contains(document.activeElement) ? document.activeElement : null;
  const key = active?.dataset.key;
  const selection = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  element.innerHTML = html;
  painted.set(element, html);
  if (!key) return;
  const next = element.querySelector(`[data-key="${CSS.escape(key)}"]`);
  next?.focus({ preventScroll: true });
  if (next && selection && typeof next.setSelectionRange === 'function') next.setSelectionRange(...selection);
}
