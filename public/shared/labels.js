// Words the member app and the Admin page both show.

const STATUS_LABELS = {
  approved: 'Confirmed',
  cancelled: 'Cancelled',
  overridden: 'Replaced',
  pending: 'Pending',
  declined: 'Declined'
};

// A reservation's status in words. A confirmed one that is over is 'Finished'.
export function statusLabel(status, ended = false) {
  if (status === 'approved' && ended) return 'Finished';
  return STATUS_LABELS[status] || '';
}
