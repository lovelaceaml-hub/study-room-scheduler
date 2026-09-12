// LV Rooms — Departure Board prototype
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const HOURS = ['7:00','7:30','8:00','8:30','9:00','9:30','10:00','10:30','11:00'];
const SETS = {
  rooms: [
    {id:'ROOM 1', meta:'4 SEATS · WINDOW',     busy:[2,3]},
    {id:'ROOM 2', meta:'6 SEATS · LONG TABLE', busy:[0,1]},
    {id:'ROOM 3', meta:'4 SEATS · BOARD WALL', busy:[], mine:[]},
    {id:'ROOM 4', meta:'4 SEATS · QUIET',      busy:[0,1,2,3]},
    {id:'ROOM 5', meta:'8 SEATS · PROJECTOR',  busy:[0]},
    {id:'ROOM 6', meta:'2 SEATS · BOOTH',      busy:[5]}
  ],
  boards: [
    {id:'BOARD A', meta:'WALL · NORTH',    busy:[]},
    {id:'BOARD B', meta:'ROLLING · HALL',  busy:[2,3,4]},
    {id:'BOARD C', meta:'WALL · SOUTH',    busy:[0,1]}
  ],
  tv: [
    {id:'TV ROOM', meta:'SCREEN · 8 SEATS', busy:[6,7,8]}
  ]
};

let resource = 'rooms';
let sel = null;            // {row, from, to}
const grid = $('#grid');

function render(){
  const rows = SETS[resource];
  const head = `<div class="cell hd corner">${resource.toUpperCase()}</div>` +
    HOURS.map(h => `<div class="cell hd">${h}</div>`).join('');

  const body = rows.map((r, ri) => {
    const cells = HOURS.map((h, ci) => {
      const held = r.busy.includes(ci);
      const inSel = sel && sel.row === ri && ci >= sel.from && ci <= sel.to;
      const cls = inSel ? 'sel' : held ? 'held' : 'free';
      const text = inSel ? (ci === sel.from ? 'START' : ci === sel.to ? 'END' : '·')
                 : held ? 'HELD' : 'FREE';
      return `<div class="cell"><button class="slot ${cls}" data-row="${ri}" data-col="${ci}" ${held ? 'disabled' : ''}>${text}</button></div>`;
    }).join('');
    return `<div class="cell rowhead"><b>${r.id}</b><small>${r.meta}</small></div>${cells}`;
  }).join('');

  grid.innerHTML = head + body;
  updateSummary();
}

function updateSummary(){
  const line = $('#selLine'), note = $('#selNote'), btn = $('#confirm');
  if (!sel){
    line.textContent = 'Nothing selected';
    note.textContent = 'Pick a free block on the board.';
    btn.disabled = true;
    return;
  }
  const row = SETS[resource][sel.row];
  const start = HOURS[sel.from];
  const end = sel.to + 1 < HOURS.length ? HOURS[sel.to + 1] : '11:30';
  const mins = (sel.to - sel.from + 1) * 30;
  line.textContent = `${row.id} · ${start}–${end} PM`;
  note.textContent = `${mins} MINUTES · ${row.meta} · TAP A LATER BLOCK TO EXTEND`;
  btn.disabled = false;
}

/* click / tap selection: first tap sets the start, a later free tap extends */
grid.addEventListener('click', e => {
  const s = e.target.closest('.slot');
  if (!s || s.disabled) return;
  const row = +s.dataset.row, col = +s.dataset.col;

  if (!sel || sel.row !== row || col < sel.from){
    sel = {row, from:col, to:col};
  } else if (col === sel.from && sel.to === sel.from){
    sel = null;                                    // tap the start again to clear
  } else {
    const blocked = SETS[resource][row].busy.some(b => b > sel.from && b <= col);
    if (blocked){ say('THAT RANGE CROSSES A HELD BLOCK'); return; }
    sel.to = col;
  }
  render();
});

/* keyboard: arrows move, space selects, enter reserves */
let cursor = {row:0, col:0};
document.addEventListener('keydown', e => {
  if ($('#palette').classList.contains('open')) return;
  if (!$('#view-board').classList.contains('active')) return;
  const rows = SETS[resource];
  const move = {ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1]}[e.key];
  if (move){
    e.preventDefault();
    cursor.row = Math.max(0, Math.min(rows.length - 1, cursor.row + move[0]));
    cursor.col = Math.max(0, Math.min(HOURS.length - 1, cursor.col + move[1]));
    const cell = grid.querySelector(`.slot[data-row="${cursor.row}"][data-col="${cursor.col}"]`);
    if (cell) cell.focus();
  }
  if (e.key === ' '){
    e.preventDefault();
    const cell = grid.querySelector(`.slot[data-row="${cursor.row}"][data-col="${cursor.col}"]`);
    if (cell && !cell.disabled) cell.click();
  }
  if (e.key === 'Enter' && sel) $('#confirm').click();
});

/* toast */
const toast = $('#toast');
let toastTimer;
function say(msg){
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 2400);
}
$('#confirm').addEventListener('click', () => {
  if (!sel) return;
  say(`RESERVED · ${$('#selLine').textContent.toUpperCase()}`);
  const row = SETS[resource][sel.row];
  for (let i = sel.from; i <= sel.to; i++) row.busy.push(i);
  sel = null;
  render();
});

/* resource switch */
$$('#resSwitch button').forEach(b => b.addEventListener('click', () => {
  $$('#resSwitch button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  resource = b.dataset.res;
  sel = null;
  cursor = {row:0, col:0};
  render();
}));

/* views */
$$('.views button').forEach(b => b.addEventListener('click', () => {
  $$('.views button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${b.dataset.view}`).classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
}));

/* command palette */
const palette = $('#palette'), shade = $('#shade'), cmdInput = $('#cmdInput'), cmdList = $('#cmdList');
const COMMANDS = [
  {label:'Reserve the next free room', hint:'ROOM 3 · 7:30', run:() => { resource='rooms'; sel={row:2, from:1, to:3}; render(); say('ROOM 3 SELECTED · 7:30–9:00'); }},
  {label:'Show whiteboards',  hint:'BOARDS',  run:() => { $('[data-res="boards"]').click(); }},
  {label:'Show the TV room',  hint:'TV',      run:() => { $('[data-res="tv"]').click(); }},
  {label:'My reservations',   hint:'MINE',    run:() => { $('[data-view="mine"]').click(); }},
  {label:'Coordinator view',  hint:'ADMIN',   run:() => { $('[data-view="admin"]').click(); }},
  {label:'Lobby display',     hint:'LOBBY',   run:() => { $('[data-view="lobby"]').click(); }},
  {label:'Clear the selection', hint:'ESC',   run:() => { sel = null; render(); }}
];
let cmdIndex = 0;

function renderCmds(){
  const q = cmdInput.value.trim().toLowerCase();
  const hits = COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
  cmdIndex = Math.min(cmdIndex, Math.max(0, hits.length - 1));
  cmdList.innerHTML = hits.map((c, i) =>
    `<button class="cmd ${i === cmdIndex ? 'on' : ''}" data-i="${COMMANDS.indexOf(c)}">${c.label}<span>${c.hint}</span></button>`).join('')
    || '<button class="cmd">No match<span></span></button>';
}
function openPalette(){
  palette.classList.add('open'); shade.classList.add('on');
  cmdInput.value = ''; cmdIndex = 0; renderCmds(); cmdInput.focus();
}
function closePalette(){ palette.classList.remove('open'); shade.classList.remove('on'); }

$('#cmdBtn').addEventListener('click', openPalette);
shade.addEventListener('click', closePalette);
cmdInput.addEventListener('input', () => { cmdIndex = 0; renderCmds(); });
cmdList.addEventListener('click', e => {
  const b = e.target.closest('.cmd[data-i]');
  if (!b) return;
  closePalette();
  COMMANDS[+b.dataset.i].run();
});
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); openPalette(); return; }
  if (!palette.classList.contains('open')) return;
  if (e.key === 'Escape') closePalette();
  if (e.key === 'ArrowDown'){ e.preventDefault(); cmdIndex++; renderCmds(); }
  if (e.key === 'ArrowUp'){ e.preventDefault(); cmdIndex = Math.max(0, cmdIndex - 1); renderCmds(); }
  if (e.key === 'Enter'){
    const b = cmdList.querySelector('.cmd.on[data-i]');
    if (b){ closePalette(); COMMANDS[+b.dataset.i].run(); }
  }
});

/* lobby board */
$('#flap').innerHTML = [
  ['01','OPEN','UNTIL 8:30','open'],
  ['02','IN USE','FREE 8:00','busy'],
  ['03','OPEN','ALL EVENING','open'],
  ['04','IN USE','FREE 9:00','busy'],
  ['05','OPENS 7:30','STUDY ENDING','soon'],
  ['06','OPEN','UNTIL 11:00','open']
].map(([no, state, note, cls]) =>
  `<div class="flap-row ${cls}"><b>${no}</b><span>${note}</span><em>${state}</em></div>`).join('');

/* clocks */
setInterval(() => {
  const t = new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  $('#clock').textContent = t;
  $('#lobbyClock').textContent = t;
}, 1000);

render();
