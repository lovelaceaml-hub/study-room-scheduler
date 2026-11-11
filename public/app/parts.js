// Markup the member app's sheets share.

import { escapeHtml as esc } from '../shared/format.js';
import { canBook } from './store.js';
import { connectionText } from './text.js';

// A list of [term, value] pairs, such as Day, Time and Where.
export function summaryHtml(items) {
  return `<dl class="summary">${items.map(([term, value]) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
}

// ' disabled' for a button while the schedule is not connected or a change is
// being saved.
export function disabledAttr(state, busy) {
  return canBook(state) && !busy ? '' : ' disabled';
}

// The banner a sheet shows while the schedule is not connected. `waiting` is
// the sentence for a problem that Try again may fix.
export function connectionBanner(state, waiting) {
  if (canBook(state)) return '';
  const problem = connectionText(state.status);
  if (problem?.action === 'reload') {
    return `<div class="sheet-status" role="status"><span>${esc(problem.text)}</span> <button type="button" class="text-button" data-action="reload" data-key="reload">Reload</button></div>`;
  }
  return `<div class="sheet-status" role="status"><span>${esc(waiting)}</span> <button type="button" class="text-button" data-action="retry" data-key="retry">Try again</button></div>`;
}
