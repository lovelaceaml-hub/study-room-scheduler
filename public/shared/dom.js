// Replaces an element's content only when the markup changed. When it does,
// keyboard focus (and the cursor in a text field) goes back to the control
// with the same data-key, so a background refresh never moves the user.

const painted = new WeakMap();

export function paint(element, html) {
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
