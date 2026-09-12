// LV Rooms — Request Desk prototype
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const FIELDS = {
  resource:{label:'WHAT KIND OF SPACE', title:'Space', options:[
    {v:'a study room',  note:'Rooms 1–6'},
    {v:'a whiteboard',  note:'Boards A–C'},
    {v:'the TV room',   note:'One screen, 8 seats'}
  ]},
  people:{label:'HOW MANY PEOPLE', title:'People', options:[
    {v:'1 person',   note:'A booth will do'},
    {v:'2 people',   note:'Most rooms fit'},
    {v:'4 people',   note:'Rooms 1, 3, 4'},
    {v:'8 people',   note:'Room 5 only'}
  ]},
  start:{label:'STARTING WHEN', title:'Start', options:[
    {v:'now',      note:'7:12 PM'},
    {v:'at 7:30',  note:'When Room 5 frees up'},
    {v:'at 8:00',  note:'The busiest hour'},
    {v:'at 9:00',  note:'Quiet, most rooms open'}
  ]},
  length:{label:'FOR HOW LONG', title:'Length', options:[
    {v:'30 minutes', note:'Quick read'},
    {v:'60 minutes', note:'Standard study'},
    {v:'90 minutes', note:'Study with discussion'},
    {v:'the evening',note:'Until 11:00 PM'}
  ]}
};

const state = {resource:'a study room', people:'2 people', start:'now', length:'90 minutes'};

/* ---- matching: small, legible rules so the prototype answers honestly ---- */
const CATALOG = [
  {id:'Room 3', no:'03', seats:4, kind:'a study room',  meta:'4 seats · whiteboard wall', free:'all evening', state:'open'},
  {id:'Room 1', no:'01', seats:4, kind:'a study room',  meta:'4 seats · window',          free:'until 8:30',  state:'open'},
  {id:'Room 6', no:'06', seats:2, kind:'a study room',  meta:'2 seats · booth',           free:'until 11:00', state:'open'},
  {id:'Room 5', no:'05', seats:8, kind:'a study room',  meta:'8 seats · projector',       free:'from 7:30',   state:'soon'},
  {id:'Room 2', no:'02', seats:6, kind:'a study room',  meta:'6 seats · long table',      free:'from 8:00',   state:'busy'},
  {id:'Board A',no:'A',  seats:4, kind:'a whiteboard',  meta:'Wall board · north wing',   free:'all evening', state:'open'},
  {id:'Board B',no:'B',  seats:6, kind:'a whiteboard',  meta:'Rolling board · corridor',  free:'from 8:00',   state:'busy'},
  {id:'TV Room',no:'TV', seats:8, kind:'the TV room',   meta:'Screen · 8 seats',          free:'until 10:00', state:'open'}
];
const seatsOf = p => parseInt(p, 10) || 1;
const startTime = s => s === 'now' ? '7:30' : s.replace('at ', '');
const endTime = (start, len) => {
  if (len === 'the evening') return '11:00';
  const mins = parseInt(len, 10);
  let [h, m] = startTime(start).split(':').map(Number);
  m += mins; h += Math.floor(m / 60); m %= 60;
  if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, '0')}`;
};

function matches(){
  const need = seatsOf(state.people);
  const rank = {open:0, soon:1, busy:2};
  return CATALOG
    .filter(r => r.kind === state.resource && r.seats >= need)
    .sort((a, b) => rank[a.state] - rank[b.state] || a.seats - b.seats);
}

function render(){
  $$('.slot').forEach(s => s.textContent = state[s.dataset.field]);

  const found = matches();
  const best  = found[0];
  const range = `${startTime(state.start)}–${endTime(state.start, state.length)} PM`;

  if (!best){
    $('#badge').textContent = 'Nothing that size';
    $('#badge').className = 'badge warn';
    $('#matchRoom').textContent = 'No match';
    $('#matchLine').textContent = `Nothing fits ${state.people} in ${state.resource} tonight.`;
    $('#matchWhy').textContent = 'Try a smaller group, or open the full evening below to split across two spaces.';
    $('#reserveBtn').textContent = 'Ask a coordinator';
    $('#alts').classList.add('hidden');
    return;
  }

  $('#badge').textContent = best.state === 'open' ? 'Free the whole time'
    : best.state === 'soon' ? 'Frees up at 7:30' : 'First free slot';
  $('#badge').className = best.state === 'open' ? 'badge' : 'badge warn';
  $('#matchRoom').textContent = best.id;
  $('#matchLine').textContent = `${range} · ${best.meta}`;
  $('#matchWhy').textContent = best.state === 'open'
    ? `Free ${best.free}, so you can run long if the study needs it.`
    : `Free ${best.free}. We will hold it the moment the current study ends.`;
  $('#reserveBtn').textContent = `Reserve ${best.id}`;

  const rest = found.slice(1);
  $('#alts').classList.toggle('hidden', rest.length === 0);
  $('#altCount').textContent = `${rest.length} space${rest.length === 1 ? '' : 's'}`;
  $('#altList').innerHTML = rest.map(r => `
    <button class="cluster-row ${r.state}" data-alt="${r.id}">
      <span class="room-no">${r.no}</span>
      <div><b>${r.id}</b><small>${r.meta} · free ${r.free}</small></div>
      <em>${r.state === 'busy' ? 'Queue' : 'Reserve'}</em>
    </button>`).join('');
}

/* ---- picker ---- */
const picker = $('#picker'), shade = $('#shade');
let openField = null;

function openPicker(field){
  openField = field;
  const f = FIELDS[field];
  $('#pickerLabel').textContent = f.label;
  $('#pickerTitle').textContent = f.title;
  $('#options').innerHTML = f.options.map(o => `
    <button data-value="${o.v}" class="${o.v === state[field] ? 'active' : ''}">
      <span style="font-size:15px;font-weight:700;color:inherit">${o.v}</span><span>${o.note}</span>
    </button>`).join('');
  picker.classList.add('open');
  shade.classList.add('on');
}
function closePicker(){
  picker.classList.remove('open');
  shade.classList.remove('on');
  openField = null;
}

document.addEventListener('click', e => {
  const slot = e.target.closest('.slot');
  if (slot) return openPicker(slot.dataset.field);

  const opt = e.target.closest('#options [data-value]');
  if (opt && openField){
    state[openField] = opt.dataset.value;
    const changed = $(`.slot[data-field="${openField}"]`);
    render();
    changed.classList.remove('just-changed');
    void changed.offsetWidth;
    changed.classList.add('just-changed');
    closePicker();
    return;
  }

  const alt = e.target.closest('[data-alt]');
  if (alt) say(`${alt.dataset.alt} reserved · ${startTime(state.start)}–${endTime(state.start, state.length)} PM`);
});
$('#close').addEventListener('click', closePicker);
shade.addEventListener('click', closePicker);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });

/* ---- toast ---- */
const toast = $('#toast');
let toastTimer;
function say(msg){
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 2600);
}
$('#reserveBtn').addEventListener('click', () => {
  const best = matches()[0];
  say(best ? `${best.id} reserved · ${startTime(state.start)}–${endTime(state.start, state.length)} PM`
           : 'Sent to a coordinator — they will find you a space.');
});
$('#otherBtn').addEventListener('click', () => {
  $('#alts').scrollIntoView({behavior:'smooth', block:'start'});
});
$('#dateBtn').addEventListener('click', () => say('Date picker opens here.'));

/* ---- views ---- */
$$('.views button').forEach(b => b.addEventListener('click', () => {
  $$('.views button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${b.dataset.view}`).classList.add('active');
  closePicker();
  window.scrollTo({top:0, behavior:'smooth'});
}));

setInterval(() => {
  $('#lobbyClock').textContent = new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
}, 1000);

render();
