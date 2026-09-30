// Reads a short message to screen readers.
export function announce(message) {
  const announcer = document.getElementById('announcer');
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = message; });
}
