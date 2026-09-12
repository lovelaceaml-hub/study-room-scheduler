// LV Rooms — Floor Map prototype
const ROOMS = [
  {id:'Room 1', no:'01', state:'open', meta:'4 seats · window',           note:'Open until 8:30 PM',            walk:'10 steps from the door'},
  {id:'Room 3', no:'03', state:'open', meta:'4 seats · whiteboard wall',  note:'Open for the rest of the evening', walk:'North wing, far end'},
  {id:'Room 6', no:'06', state:'open', meta:'2 seats · booth',            note:'Open until 11:00 PM',           walk:'South wing, far end'},
  {id:'Room 5', no:'05', state:'soon', meta:'8 seats · projector',        note:'Opens at 7:30 PM',              walk:'South wing, centre'},
  {id:'Room 2', no:'02', state:'busy', meta:'6 seats · long table',       note:'In use until 8:00 PM',          walk:'North wing, centre'},
  {id:'Room 4', no:'04', state:'busy', meta:'4 seats · quiet corner',     note:'In use until 9:00 PM',          walk:'South wing, near the door'}
];
const LABEL = {open:'Book now', soon:'Plan ahead', busy:'Join the queue'};

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const isDesktop = () => window.matchMedia('(min-width:900px)').matches;

/* ---- room list mirrors the plan ---- */
const list = $('#roomList');
list.innerHTML = ROOMS.map(r => `
  <button class="cluster-row ${r.state}" data-room="${r.id}">
    <span class="room-no">${r.no}</span>
    <div><b>${r.id}</b><small>${r.note} · ${r.walk}</small></div>
    <em>${LABEL[r.state]}</em>
  </button>`).join('');

/* ---- selection ---- */
const sheet = $('#sheet'), shade = $('#shade');
let selected = null;

function select(roomId){
  const room = ROOMS.find(r => r.id === roomId) || ROOMS[1];
  selected = room.id;

  $$('.room').forEach(g => g.classList.toggle('selected', g.dataset.room === room.id));
  $$('.cluster-row').forEach(b => b.classList.toggle('selected', b.dataset.room === room.id));

  $('#sheetRoom').textContent = room.id;
  $('#sheetMeta').textContent = room.meta;
  $('#sheetNote').textContent =
    room.state === 'open' ? 'Open for the whole range'
    : room.state === 'soon' ? 'Free from 7:30 PM, the range starts then'
    : 'In use now — this books the first free slot';
  $('#sheetRange').textContent = room.state === 'busy' ? '8:00–9:30 PM' : '7:30–9:00 PM';

  sheet.classList.add('open');
  if (!isDesktop()) shade.classList.add('on');
}
function closeSheet(){
  sheet.classList.remove('open');
  shade.classList.remove('on');
}

document.addEventListener('click', e => {
  const hit = e.target.closest('[data-room]');
  if (hit) select(hit.dataset.room);
});
$('#close').addEventListener('click', closeSheet);
shade.addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---- end time + confirm ---- */
$$('#endTimes button').forEach(b => b.addEventListener('click', () => {
  $$('#endTimes button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const start = $('#sheetRange').textContent.split('–')[0];
  $('#sheetRange').textContent = `${start}–${b.textContent} PM`;
}));

const toast = $('#toast');
let toastTimer;
function say(msg){
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 2400);
}
$('#confirm').addEventListener('click', () => {
  say(`${selected || 'Room 3'} reserved · ${$('#sheetRange').textContent}`);
  if (!isDesktop()) closeSheet();
});

/* ---- view switching ---- */
$$('.views button').forEach(b => b.addEventListener('click', () => {
  $$('.views button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${b.dataset.view}`).classList.add('active');
  if (b.dataset.view !== 'map') closeSheet();
  else if (isDesktop()) select(selected || 'Room 3');
  window.scrollTo({top:0, behavior:'smooth'});
}));

/* ---- resource switch (prototype: rooms only) ---- */
$$('#resSwitch button').forEach(b => b.addEventListener('click', () => {
  $$('#resSwitch button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  if (b.dataset.res !== 'rooms') say('Whiteboards and TV use the same plan and the same builder.');
}));

$('#dateBtn').addEventListener('click', () => say('Date picker opens here.'));

/* ---- lobby clock ---- */
setInterval(() => {
  const now = new Date();
  $('#lobbyClock').textContent = now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
}, 1000);

/* ---- desktop opens the rail straight away ---- */
if (isDesktop()) select('Room 3');
