'use strict';

// How a member's name appears on shared screens: a title initial, the first
// name, and a last-name initial only when two people share a first name on
// the same date. "Brother John Smith" becomes "B John"; with a
// "Sister John Lee" also booked that day, they become "B John S" and
// "S John L". Names are typed in English.

const TITLES = {
  brother: 'B', bro: 'B', sister: 'S', sis: 'S', elder: 'E', missionary: 'M', deacon: 'D', deaconess: 'D', pastor: 'P'
};

function key(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function parseName(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  let title = '';
  let titleWord = '';
  if (words.length) {
    const first = words[0].replace(/[.,]+$/g, '');
    title = TITLES[first.toLocaleLowerCase('en-US')] || (/^[BSEMDP]$/i.test(first) ? first.toUpperCase() : '');
    if (title) titleWord = words.shift().replace(/,+$/, '');
  }
  const given = words.shift() || '';
  const surname = words.join(' ');
  const bareSurname = surname.replace(/[.,]+/g, '');
  const surnameKey = words.length === 1 && /^\p{L}$/u.test(bareSurname)
    ? `initial:${key(bareSurname)}`
    : `name:${key(surname)}`;
  const initial = [...surname.replace(/^[^\p{L}\p{N}]+/u, '')][0] || '';
  return { title, titleWord, given, givenKey: key(given), surnameKey, initial: initial.toLocaleUpperCase('en-US') };
}

// `others` are the full names of everyone else shown on the same date. A name
// that is only a title ("Brother") shows that word as typed, not "Reserved",
// which means an Admin hold. Only a blank name (never saved since names became
// required) shows "Reserved".
function publicName(value, others = []) {
  const name = parseName(value);
  if (!name.given) return name.titleWord || 'Reserved';
  const shared = others.some(other => {
    const parsed = parseName(other);
    return parsed.givenKey === name.givenKey && parsed.surnameKey !== name.surnameKey;
  });
  return [name.title, name.given, shared ? name.initial : ''].filter(Boolean).join(' ');
}

module.exports = { publicName };
