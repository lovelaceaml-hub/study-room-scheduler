import { subscribe, submit, retry } from '../shared/live.js';
import { overrideUnitForRange } from '../shared/model.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPES = {
  room: {label:'Study Rooms',single:'Study Room',short:'Room',count:4},
  whiteboard: {label:'Whiteboards',single:'Whiteboard',short:'Board',count:5},
  tv: {label:'TVs',single:'TV',short:'TV',count:3}
};
const PURPOSES = {
  contact: {label:'Contact',hint:''},
  new: {label:'New Member',hint:''},
  other: {label:'Other',hint:''}
};
const SERVICE = {
  6: [[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],
  2: [[1170,1230,'Evening service']]
};
const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10M12 7v10"/></svg>';
const params = new URLSearchParams(location.search);
const initialDayHint = params.get('day');
let resource = TYPES[params.get('resource')] ? params.get('resource') : 'room';
let days = [], bookings = [], dayIndex = 0, firstDates = true;
let connection = {status:'loading',canBook:false,demo:false,error:''};
let draft = {}, step = 'resource', history = [], lastFocus = null;
let saving = false, freshKey = null, toastTimer;
const itemIds = new Map();
const dialog = $('#booking-dialog');
const detailDialog = $('#reservation-dialog');
const detailBody = $('#reservation-detail-body');
let detailReturnFocus = null;

function fmt(min, short = false) {
  const hour = Math.floor(min / 60), minute = min % 60;
  return ((hour + 11) % 12 + 1) + (short && !minute ? '' : ':' + String(minute).padStart(2,'0')) + ' ' + (hour < 12 ? 'AM' : 'PM');
}
const dateText = day => day?.label || '';
const duration = (a,b) => {const n=b-a;return n<60?n+' min':n%60?Math.floor(n/60)+' hr 30 min':n/60+' hr';};
const overlaps = (a,b,c,d) => a < d && b > c;
const services = day => SERVICE[day?.dow] || [];
const ready = () => connection.canBook === true && ['live','demo'].includes(connection.status) && days.length > 0;
const draftDay = () => days.find(day => day.key === draft.day);
const draftReady = () => ready() && Boolean(draftDay());
const announce = text => { $('#announcement').textContent = text; };

function normalizeBooking(row) {
  if (!row || !TYPES[row.type] || !Number.isInteger(row.unit) || row.unit < 1 || row.unit > TYPES[row.type].count || !Number.isFinite(row.start) || !Number.isFinite(row.end) || row.end <= row.start) return null;
  const blocked = row.blocked === true || row.purpose === 'blocked';
  const key = String(row.key || row.id || `${row.day}-${row.type}-${row.unit}-${row.start}-${row.end}`);
  if (!itemIds.has(key)) itemIds.set(key, 'reservation-' + (itemIds.size + 1));
  // The current live projection calls its already-public-safe label `name`.
  const publicName = [row.publicName, row.displayName, row.name].find(value => typeof value === 'string' && visibleText(value))?.trim() || 'Reserved';
  return {key,id:itemIds.get(key),day:row.day,resource:row.type,unit:row.unit,start:row.start,end:row.end,publicName:blocked?'Reserved':publicName,purpose:blocked?'blocked':PURPOSES[row.purpose]?row.purpose:'other',reservedFor:typeof row.reservedFor==='string'?row.reservedFor:'',blocked,override:row.override===true,ownerDetail:row.ownerDetail && typeof row.ownerDetail === 'object' ? row.ownerDetail : row.ownerDetails && typeof row.ownerDetails === 'object' ? row.ownerDetails : row.owner && typeof row.owner === 'object' ? row.owner : null};
}

function free(day, res, unit, start, end) {
  return Boolean(day) && start >= 600 && end <= 1380 && end > start && start % 30 === 0 && end % 30 === 0
    && !services(day).some(s => overlaps(start,end,s[0],s[1]))
    && !bookings.some(b => b.day === day.key && b.resource === res && b.unit === unit && overlaps(start,end,b.start,b.end));
}

function unitsFor(start,end) {
  if (!draftReady() || !TYPES[draft.resource]) return [];
  return Array.from({length:TYPES[draft.resource].count},(_,i)=>i+1)
    .filter(unit => (!draft.presetUnit || unit === draft.presetUnit) && free(draftDay(),draft.resource,unit,start,end));
}

function sharedBookings() {
  return bookings.map(booking => ({...booking,type:booking.resource}));
}

function overrideFor(start,end,exactUnit=null) {
  if (!draftReady() || !['contact','new'].includes(draft.purpose) || services(draftDay()).some(service => overlaps(start,end,service[0],service[1]))) return null;
  return overrideUnitForRange(draft.resource,draft.day,start,end,draft.purpose,sharedBookings(),exactUnit);
}

function rangeOption(start,end) {
  const available=unitsFor(start,end);
  if (available.length) return {unit:available[0],override:false};
  const override=overrideFor(start,end,draft.presetUnit ?? draft.unit);
  return Number.isInteger(override)?{unit:override,override:true}:null;
}

function selectionAvailable() {
  if (unitsFor(draft.start,draft.end).includes(draft.unit)) return true;
  return Boolean(draft.override && overrideFor(draft.start,draft.end,draft.unit) === draft.unit);
}

function statusText() {
  if (connection.status === 'demo') return {title:'Demo schedule',body:'Fictional sample data. Test reservations stay in this page only.'};
  if (connection.status === 'loading') return {title:'Connecting to your spaces.',body:'Checking the current schedule before showing availability.'};
  if (connection.status === 'offline') return {title:'Schedule unavailable.',body:'Reconnect to check availability and reserve. Any schedule below is the last received view.'};
  if (connection.status === 'error') return {title:'Schedule unavailable.',body:connection.error || 'The current schedule could not be loaded. Try again before reserving.'};
  if (!ready()) return {title:'Reservations are not ready yet.',body:connection.error || 'Reconnect to load the available dates and check the schedule.'};
  return {title:'Live schedule',body:'Availability is checked again when you confirm.'};
}

function connectionMarkup() {
  const status = statusText();
  return '<div class="connection-line '+(connection.demo?'demo':'')+'" role="status"><div><strong>'+esc(status.title)+'</strong>'+esc(status.body)+'</div>'+(!ready()?'<button data-recover>Retry</button>':'')+'</div>';
}

function render() {
  const day = days[dayIndex], type = TYPES[resource], isReady = ready();
  document.querySelectorAll('.resource').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.resource===resource)));
  $('#date-value').innerHTML = day ? esc(day.date.toLocaleDateString('en-US',{weekday:'short'}))+' <span>'+esc(day.date.toLocaleDateString('en-US',{month:'short',day:'numeric'}))+'</span>' : 'Loading dates';
  $('#previous-day').disabled = dayIndex === 0 || !day;
  $('#next-day').disabled = !day || dayIndex >= days.length-1;
  $('#previous-day').setAttribute('aria-label',dayIndex>0?'View '+dateText(days[dayIndex-1]):'No earlier eligible date');
  $('#next-day').setAttribute('aria-label',day&&dayIndex<days.length-1?'View '+dateText(days[dayIndex+1]):'No later eligible date');
  $('#schedule-title').textContent = resource === 'room' ? 'Schedule' : type.label;
  document.querySelectorAll('[data-reserve]').forEach(b=>b.disabled=!isReady || saving);
  $('#schedule-note').textContent = connection.demo ? 'Fictional sample data. Test reservations stay in this page only.' : isReady ? 'Reservations are confirmed only after availability is checked.' : 'Booking will resume when the current schedule is connected.';
  const container = $('#schedule');
  container.setAttribute('aria-busy',String(connection.status==='loading'));
  if (!day) {
    container.innerHTML = connectionMarkup()+'<div class="loading-wells" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
    return;
  }
  const heads = '<div class="grid-head"><span class="time-word">Time</span>'+Array.from({length:type.count},(_,i)=>'<div class="unit-head">'+type.short+'<b>'+(i+1)+'</b></div>').join('')+'</div>';
  let rail = '<div class="rail" aria-label="Hourly time boundaries">';
  for (let t=600;t<=1380;t+=60) rail += '<span class="hour" style="top:'+((t-600)/30*48)+'px">'+fmt(t,true)+'</span>';
  rail += '</div>';
  const cols = Array.from({length:type.count},(_,i)=>{
    const unit=i+1;
    let html='<div class="well" aria-label="'+type.single+' '+unit+'">';
    for(let t=600;t<1380;t+=30) {
      if (!free(day,resource,unit,t,t+30)) continue;
      const top=(t-600)/30*48;
      html += isReady ? '<button class="open" data-unit="'+unit+'" data-start="'+t+'" style="top:'+top+'px" aria-label="Reserve '+type.single+' '+unit+' on '+esc(dateText(day))+' starting '+fmt(t)+'" title="'+fmt(t)+'"><span class="plus" aria-hidden="true">+</span>Open</button>' : '<span class="unavailable" style="top:'+top+'px" aria-label="Availability not connected">&#183;</span>';
    }
    bookings.filter(b=>b.day===day.key&&b.resource===resource&&b.unit===unit).forEach(b=>{
      const start=Math.max(600,b.start), end=Math.min(1380,b.end);
      if(end<=start)return;
      const short=end-start<=30, purpose=b.blocked?'':PURPOSES[b.purpose].label, publicName=b.blocked?'Reserved':b.publicName;
      const label=publicName+(purpose?', '+purpose:'')+', '+type.single+' '+unit+', '+fmt(start)+' to '+fmt(end);
      html += '<button id="'+esc(b.id)+'" type="button" class="pebble '+b.purpose+(short?' compact':'')+(b.key===freshKey?' fresh':'')+'" data-booking-key="'+esc(b.key)+'" aria-haspopup="dialog" style="top:'+((start-600)/30*48+3)+'px;height:'+((end-start)/30*48-6)+'px" aria-label="'+esc(label)+'"><span class="name">'+esc(publicName)+'</span>'+(purpose?'<span class="purpose">'+purpose+'</span>':'')+'</button>';
    });
    return html+'</div>';
  }).join('');
  const bands=services(day).map(s=>'<div class="service" style="top:'+((s[0]-600)/30*48)+'px;height:'+((s[1]-s[0])/30*48)+'px"><span class="service-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14a6 6 0 0 1 12 0M4 17h16M12 3v3M4 7l2 2m14-2-2 2"/></svg>'+s[2]+'</span><small>'+fmt(s[0],true)+' to '+fmt(s[1],true)+'</small></div>').join('');
  container.innerHTML = connectionMarkup()+'<div class="grid '+(!isReady?'offline-grid':'')+'" data-resource="'+resource+'" style="--units:'+type.count+'" aria-label="'+type.label+', '+esc(dateText(day))+', 10 AM to 11 PM">'+heads+'<div class="grid-body">'+rail+cols+bands+'</div></div>';
}

function recover() {
  try { Promise.resolve(retry()).catch(error=>showRetryError(error)); }
  catch (error) { showRetryError(error); }
}

function showRetryError(error) {
  connection={...connection,status:'error',canBook:false,error:error?.message || 'The schedule could not reconnect. Please try again.'};
  render();
  syncSheetAvailability();
}

function createDraft(preset) {
  const day=days[dayIndex];
  return {day:day.key,dayLabel:dateText(day),resource:preset?resource:null,presetUnit:preset?Number(preset.unit):null,unit:preset?Number(preset.unit):null,start:preset?Number(preset.start):null,end:null,purpose:null,purposeOther:'',name:localStorage.getItem('srs-name')||'',reservedFor:'',override:false};
}

function openBooking(preset) {
  if (!ready() || saving) return;
  if (preset && !free(days[dayIndex],resource,Number(preset.unit),Number(preset.start),Number(preset.start)+30)) {render();announce('That moment is no longer available. Choose another open moment.');return;}
  lastFocus=document.activeElement;
  draft=createDraft(preset);
  step=preset?'purpose':'resource';
  history=[];
  clearError();
  renderStep();
  dialog.showModal();
  document.body.style.overflow='hidden';
  syncSheetAvailability();
  focusTitle();
}

function focusTitle() {requestAnimationFrame(()=>$('#step-title')?.focus({preventScroll:true}));}
function closeBooking() {if(!saving)dialog.close();}
function clearError() {$('#form-error').hidden=true;$('#form-error').textContent='';}
function showError(message) {$('#form-error').textContent=message;$('#form-error').hidden=false;announce(message);}
function go(next) {history.push(step);step=next;clearError();renderStep();dialog.scrollTop=0;focusTitle();}

function context() {
  return '<span>'+esc(draft.dayLabel)+'</span>'+(draft.resource?'<span>'+TYPES[draft.resource].single+(draft.unit?' '+draft.unit:'')+'</span>':'')+(draft.start!==null?'<span>'+fmt(draft.start)+(draft.end!==null?' to '+fmt(draft.end):'')+'</span>':'');
}

function summary() {
  const overrideNote=draft.override?'<p class="override-note" role="status"><strong>Priority override</strong><span>This range requires taking over a lower-priority reservation.</span></p>':'';
  const reservedLabel=draft.purpose==='contact'?'Contact Name':draft.purpose==='new'?'Member Name':'Purpose';
  return '<div class="booking-summary"><div class="summary-unit">'+TYPES[draft.resource].single+' '+draft.unit+'</div><dl><dt>When</dt><dd>'+esc(draft.dayLabel)+'<br>'+fmt(draft.start)+' to '+fmt(draft.end)+'</dd><dt>Purpose</dt><dd>'+PURPOSES[draft.purpose].label+'</dd><dt>Your name</dt><dd>'+esc(draft.name)+'</dd><dt>'+reservedLabel+'</dt><dd>'+esc(draft.reservedFor)+'</dd></dl>'+overrideNote+'</div>';
}

function renderStep() {
  $('#back').hidden=!history.length||step==='success';
  $('#context').innerHTML=step==='success'?'':context();
  const labels={resource:'Resource',purpose:'Purpose',start:'Start time',end:'End time',reservedFor:'Reserved for',confirm:'Review',success:'Complete'};
  $('#step-label').textContent=labels[step];
  const type=TYPES[draft.resource];
  let html='';
  if(step==='resource') html='<h2 id="step-title" tabindex="-1">What would you like<br>to reserve?</h2><p class="hint" id="step-hint">Select a resource.</p><div class="choices">'+Object.entries(TYPES).map(([key,t])=>'<button class="choice" data-pick-resource="'+key+'"><span class="choice-mark">'+icon+'</span><span><b>'+t.label+'</b><small>'+t.count+' spaces on the schedule</small></span><span class="chev" aria-hidden="true">&#8250;</span></button>').join('')+'</div>';
  if(step==='purpose') html='<h2 id="step-title" tabindex="-1">What is this<br>reservation for?</h2><p class="hint" id="step-hint">Select a purpose.</p><div class="choices">'+Object.entries(PURPOSES).map(([key,p])=>'<button class="choice '+key+'" data-purpose="'+key+'"><span class="choice-mark">'+icon+'</span><span><b>'+p.label+'</b>'+(p.hint?'<small>'+p.hint+'</small>':'')+'</span><span class="chev" aria-hidden="true">&#8250;</span></button>').join('')+'</div>';
  if(step==='start') {
    let times='';
    for(let t=600;t<1380;t+=30){
      const option=rangeOption(t,t+30);
      if(!option)continue;
      const override=option.override;
      times+='<button class="time-choice'+(override?' priority-override':'')+'" data-pick-start="'+t+'"'+(override?' data-priority-override="true" aria-label="Start at '+fmt(t)+', Priority override"':'')+'>'+fmt(t)+(override?'<small class="override-label">Priority override</small>':'')+'</button>';
    }
    html='<h2 id="step-title" tabindex="-1">When shall we begin?</h2><p class="hint" id="step-hint">Only times with an open '+type.single.toLowerCase()+' are shown. Services already have their space.</p><div class="time-choices">'+times+'</div>'+(times?'':draftReady()?'<p class="inline-error">Every space is reserved. Close this sheet and try the other eligible date.</p>':'');
  }
  if(step==='end') {
    let times='';
    for(let t=draft.start+30;t<=1380;t+=30){
      const option=rangeOption(draft.start,t);
      if(!option)continue;
      const override=option.override;
      times+='<button class="time-choice'+(override?' priority-override':'')+'" data-end="'+t+'"'+(override?' data-priority-override="true" aria-label="Finish at '+fmt(t)+', Priority override"':'')+'>'+fmt(t)+'<small>'+duration(draft.start,t)+'</small>'+(override?'<span class="override-label">Priority override</span>':'')+'</button>';
    }
    html='<h2 id="step-title" tabindex="-1">And when will<br>you finish?</h2><p class="hint" id="step-hint">Starting at '+fmt(draft.start)+'. These endings keep '+(draft.presetUnit?type.single+' '+draft.presetUnit:'one space')+' free for your whole reservation.</p><div class="time-choices">'+times+'</div>'+(times?'':draftReady()?'<p class="inline-error">This moment is no longer open. Go back to choose another start.</p>':'');
  }
  if(step==='reservedFor') {
    const label=draft.purpose==='contact'?'Contact Name':draft.purpose==='new'?'Member Name':'Purpose';
    const other=draft.purpose==='other';
    const description=other?'Describe what this reservation is for.':'Enter the '+label.toLowerCase()+' for this reservation.';
    const field=other?'<textarea class="details-field" id="reserved-for" name="reservedFor" maxlength="160" required aria-describedby="reserved-for-note" placeholder="What is the reservation for?">'+esc(draft.reservedFor)+'</textarea>':'<input class="name-field" id="reserved-for" name="reservedFor" type="text" maxlength="60" autocomplete="off" placeholder="'+esc(label)+'" value="'+esc(draft.reservedFor)+'" required aria-describedby="reserved-for-note">';
    html='<h2 id="step-title" tabindex="-1">Who or what is this<br>for?</h2><p class="hint" id="step-hint">'+description+'</p><form id="reserved-for-form"><label class="field-label" for="guest-name">Your name</label><input class="name-field" id="guest-name" name="name" type="text" maxlength="120" autocomplete="name" placeholder="Your full name" value="'+esc(draft.name)+'" required><label class="field-label" for="reserved-for">'+label+'</label>'+field+'<p class="form-note" id="reserved-for-note">Only a public-safe name and purpose appear on the schedule.</p><button class="primary full" type="submit" id="reserved-for-next">Review reservation</button></form>';
  }
  if(step==='confirm') html='<h2 id="step-title" tabindex="-1">Review your<br>reservation.</h2><p class="hint" id="step-hint">Check the details, then confirm your '+(connection.demo?'test ':'')+'reservation.</p>'+summary()+'<p class="form-note">'+(connection.demo?'Demo only. This creates a test reservation in this page. No real booking is made.':'Your reservation is confirmed once the full time is checked and saved.')+'</p><button class="primary full" id="confirm">'+(connection.demo?'Confirm test reservation':'Confirm reservation')+'</button>';
  if(step==='success') html='<div class="success-ring" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div><h2 id="step-title" tabindex="-1">Reservation confirmed.</h2><p class="hint" id="step-hint">'+(draft.savedDemo?'Your test reservation is now on the sample schedule. No real booking was made.':'Your reservation is confirmed and now on the schedule.')+'</p>'+summary()+'<button class="primary full" id="view-booking">See it on the schedule</button><button class="secondary" id="reserve-another">Reserve another space</button>';
  $('#sheet-body').innerHTML=html;
  syncSheetAvailability();
}

function visibleText(value) {return String(value || '').replace(/[\p{Z}\p{C}]/gu,'').length>0;}
function bookingDetailFor(booking) {
  const detail=booking?.ownerDetail && typeof booking.ownerDetail==='object'?booking.ownerDetail:null;
  if(!detail||(detail.authorized!==true&&detail.ownerAuthorized!==true))return null;
  const actions=detail.actions&&typeof detail.actions==='object'?detail.actions:{};
  const allowed=(...names)=>names.some(name=>detail[name]===true||actions[name]===true||actions[name]?.allowed===true);
  const reservedFor=typeof detail.reservedFor==='string'&&visibleText(detail.reservedFor)?detail.reservedFor.trim():'';
  const name=typeof detail.name==='string'&&visibleText(detail.name)?detail.name.trim():typeof detail.displayName==='string'&&visibleText(detail.displayName)?detail.displayName.trim():'';
  return {name,reservedFor,canEndEarly:allowed('canEndEarly','endEarly','end'),canCancel:allowed('canCancel','cancel')};
}
function detailActionsFor(detail) {
  if(!detail||(!detail.canEndEarly&&!detail.canCancel))return '';
  const actions=[];
  if(detail.canEndEarly)actions.push('<a class="detail-action" href="/?classic=1&amp;tab=mine">End early</a>');
  if(detail.canCancel)actions.push('<a class="detail-action danger" href="/?classic=1&amp;tab=mine">Cancel</a>');
  return '<div class="detail-actions"><p>Use My reservations to complete an authorized action.</p><div>'+actions.join('')+'</div></div>';
}
function openReservationDetails(booking, trigger) {
  if(!detailDialog||!booking)return;
  const purpose=booking.blocked?'Reserved':PURPOSES[booking.purpose]?.label||'Other';
  const detail=bookingDetailFor(booking);
  const ownerRow='<div class="detail-row"><span>Reserved</span><b>'+esc(detail?.name||booking.publicName)+'</b></div>'+((detail?.reservedFor||booking.reservedFor)?'<div class="detail-row"><span>Reserved for</span><b>'+esc(detail?.reservedFor||booking.reservedFor)+'</b></div>':'');
  detailBody.innerHTML='<div class="detail-content"><h2 id="reservation-detail-title">'+esc(booking.publicName)+'</h2><p id="reservation-detail-description" class="detail-hint">'+esc(TYPES[booking.resource].single)+' '+booking.unit+' · '+esc(dateText(days.find(day=>day.key===booking.day)))+'</p><div class="detail-summary"><div class="detail-row"><span>Reservation</span><b>'+fmt(booking.start)+' to '+fmt(booking.end)+'</b></div><div class="detail-row"><span>Purpose</span><b>'+esc(purpose)+'</b></div>'+ownerRow+'</div>'+detailActionsFor(detail)+'</div>';
  detailReturnFocus=trigger;
  detailDialog.showModal();
  document.getElementById('reservation-detail-title')?.focus({preventScroll:true});
}
function closeReservationDetails() {if(detailDialog?.open)detailDialog.close();}

function syncSheetAvailability() {
  const canContinue=draftReady(), notice=$('#sheet-connection');
  notice.hidden=canContinue||step==='success';
  if(!notice.hidden) {
    const message=ready()&&!draftDay()?'This date is no longer offered. Close this sheet and choose a current date.':statusText().body;
    notice.innerHTML=esc(message)+(!ready()?'<button type="button" data-recover>Retry connection</button>':'');
  }
  dialog.querySelectorAll('[data-pick-resource],[data-purpose],[data-pick-start],[data-end],#reserved-for-next,#confirm,#reserve-another').forEach(button=>button.disabled=saving||!canContinue);
  if($('#reserved-for-next'))$('#reserved-for-next').disabled=saving||!canContinue||!visibleText(draft.reservedFor);
  $('#back').disabled=saving;
  $('#close').disabled=saving;
  dialog.querySelectorAll('input,textarea').forEach(field=>field.disabled=saving);
  $('#sheet-body').setAttribute('aria-busy',String(saving));
  if($('#confirm'))$('#confirm').textContent=saving?'Saving your reservation...':connection.demo?'Confirm test reservation':'Confirm reservation';
}

async function save() {
  if(saving||!draftReady()) {syncSheetAvailability();return;}
  if(!visibleText(draft.name)||!visibleText(draft.reservedFor)) {showError('Complete your name and the reserved-for field before confirming.');return;}
  if(!selectionAvailable()) {showError('This range is no longer available for that full time. Go back and choose another ending.');return;}
  clearError();
  saving=true;
  syncSheetAvailability();
  render();
  const submittedDemo=connection.demo;
  try {
    const reservedFor=draft.reservedFor.trim();
    const result=await submit({day:draft.day,type:draft.resource,unit:draft.unit,start:draft.start,end:draft.end,name:draft.name.trim(),reservedFor,purpose:draft.purpose,purposeOther:draft.purpose==='other'?reservedFor:''});
    const saved=normalizeBooking(result);
    if(!saved||result.status!=='approved')throw new Error('Confirmation was not received. Check My reservations before trying again.');
    bookings=bookings.filter(b=>b.key!==saved.key);
    bookings.push(saved);
    freshKey=saved.key;
    draft.saved=saved.id;
    draft.savedDemo=submittedDemo;
    draft.resource=saved.resource;
    draft.unit=saved.unit;
    draft.start=saved.start;
    draft.end=saved.end;
    draft.reservedFor=typeof result.reservedFor==='string'?result.reservedFor:reservedFor;
    draft.purpose=saved.purpose;
    draft.override=saved.override;
    resource=saved.resource;
    const savedDay=days.findIndex(day=>day.key===saved.day);
    if(savedDay>=0)dayIndex=savedDay;
    saving=false;
    render();
    go('success');
    announce((submittedDemo?'Test reservation added':'Reservation confirmed')+' for '+saved.publicName+', '+TYPES[resource].single+' '+saved.unit+', '+fmt(saved.start)+' to '+fmt(saved.end)+'.');
  } catch(error) {
    saving=false;
    syncSheetAvailability();
    render();
    showError(error?.message || 'Your reservation could not be saved. Please try again.');
  }
}

document.querySelector('.resource-island').addEventListener('click',event=>{
  const button=event.target.closest('[data-resource]');
  if(!button)return;
  resource=button.dataset.resource;
  render();
  announce(TYPES[resource].label+' schedule shown.');
});
$('#previous-day').addEventListener('click',()=>{if(dayIndex>0){dayIndex--;render();}});
$('#next-day').addEventListener('click',()=>{if(dayIndex<days.length-1){dayIndex++;render();}});
document.querySelectorAll('[data-reserve]').forEach(button=>button.addEventListener('click',()=>openBooking()));
$('#schedule').addEventListener('click',event=>{
  if(event.target.closest('[data-recover]'))return recover();
  const occupied=event.target.closest('[data-booking-key]');
  if(occupied){
    const booking=bookings.find(item=>item.key===occupied.dataset.bookingKey);
    if(booking)openReservationDetails(booking,occupied);
    return;
  }
  const button=event.target.closest('.open');
  if(button)openBooking({unit:button.dataset.unit,start:button.dataset.start});
});
$('#sheet-connection').addEventListener('click',event=>{if(event.target.closest('[data-recover]'))recover();});
$('#close').addEventListener('click',closeBooking);
$('#back').addEventListener('click',()=>{
  if(!history.length||saving)return;
  step=history.pop();
  if(step==='resource'){draft.resource=null;draft.start=null;draft.end=null;draft.unit=null;draft.presetUnit=null;draft.purpose=null;draft.purposeOther='';}
  if(step==='purpose'){draft.purpose=null;draft.end=null;draft.unit=draft.presetUnit;if(!draft.presetUnit)draft.start=null;}
  if(step==='start'){draft.start=null;draft.end=null;draft.unit=null;}
  if(step==='end'){draft.end=null;draft.unit=draft.presetUnit;}
  clearError();
  renderStep();
  dialog.scrollTop=0;
  focusTitle();
});
dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
dialog.addEventListener('close',()=>{
  document.body.style.overflow='';
  if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
  else [...document.querySelectorAll('[data-reserve]')].find(button=>button.getClientRects().length&&!button.disabled)?.focus({preventScroll:true});
});
dialog.addEventListener('click',event=>{
  if(event.target!==dialog||saving)return;
  const rect=dialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeBooking();
});
dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const focusable=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(element=>element.getClientRects().length);
  const first=focusable[0],last=focusable[focusable.length-1];
  if(!first){event.preventDefault();return;}
  if(event.shiftKey&&(document.activeElement===first||document.activeElement.id==='step-title')){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
$('#sheet-body').addEventListener('click',event=>{
  if(saving)return;
  if(event.target.closest('#view-booking')){
    const id=draft.saved,savedDemo=draft.savedDemo;
    closeBooking();
    requestAnimationFrame(()=>{
      document.getElementById(id)?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      $('#toast').textContent=savedDemo?'Your test reservation is on the schedule.':'Your reservation is confirmed.';
      $('#toast').hidden=false;
      clearTimeout(toastTimer);
      toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);
    });
    return;
  }
  if(!draftReady()){syncSheetAvailability();return;}
  let button=event.target.closest('[data-pick-resource]');
  if(button){draft.resource=button.dataset.pickResource;draft.start=null;draft.end=null;draft.unit=null;draft.override=false;return go('purpose');}
  button=event.target.closest('[data-purpose]');
  if(button){draft.purpose=button.dataset.purpose;draft.override=false;draft.purposeOther='';draft.reservedFor='';return go(draft.presetUnit?'end':'start');}
  button=event.target.closest('[data-pick-start]');
  if(button){
    const start=Number(button.dataset.pickStart);
    const option=rangeOption(start,start+30);
    if(!option){showError('That start is no longer available. Choose another moment.');return;}
    draft.start=start;draft.end=null;draft.unit=null;draft.override=false;return go('end');
  }
  button=event.target.closest('[data-end]');
  if(button){
    const end=Number(button.dataset.end),option=rangeOption(draft.start,end);
    if(!option){showError('That ending is no longer available. Choose a shorter time.');return;}
    draft.end=end;draft.unit=option.unit;draft.override=option.override;return go('reservedFor');
  }
  if(event.target.closest('#confirm'))return save();
  if(event.target.closest('#reserve-another')){
    draft=createDraft();history=[];step='resource';clearError();renderStep();dialog.scrollTop=0;focusTitle();
  }
});
$('#sheet-body').addEventListener('input',event=>{
  if(event.target.id==='guest-name')draft.name=event.target.value;
  if(event.target.id==='reserved-for'){
    draft.reservedFor=event.target.value;
    if(draft.purpose==='other')draft.purposeOther=event.target.value;
  }
  syncSheetAvailability();
});
$('#sheet-body').addEventListener('submit',event=>{
  event.preventDefault();
  if(saving||!draftReady()){syncSheetAvailability();return;}
  if(event.target.id!=='reserved-for-form')return;
  draft.name=$('#guest-name').value.trim();
  if(!visibleText(draft.name)||!visibleText(draft.reservedFor))return;
  if(draft.purpose==='other')draft.purposeOther=draft.reservedFor.trim();
  go('confirm');
});
$('#reservation-detail-close')?.addEventListener('click',closeReservationDetails);
detailDialog?.addEventListener('close',()=>{
  if(detailReturnFocus?.isConnected)detailReturnFocus.focus({preventScroll:true});
  else [...document.querySelectorAll('[data-reserve]')].find(button=>button.getClientRects().length&&!button.disabled)?.focus({preventScroll:true});
  detailReturnFocus=null;
});
detailDialog?.addEventListener('click',event=>{
  if(event.target!==detailDialog)return;
  const rect=detailDialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeReservationDetails();
});

render();
subscribe(snapshot=>{
  const previousDay=days[dayIndex]?.key;
  connection={status:snapshot.status,canBook:snapshot.canBook===true,demo:snapshot.demo===true,error:typeof snapshot.error==='string'?snapshot.error:''};
  days=(Array.isArray(snapshot.days)?snapshot.days:[]).filter(day=>/^\d{4}-\d{2}-\d{2}$/.test(day.key)&&[2,6].includes(day.weekday)).map(day=>({key:day.key,label:day.label,date:new Date(day.key+'T12:00:00'),dow:day.weekday}));
  const retainedDay=days.findIndex(day=>day.key===previousDay);
  dayIndex=retainedDay>=0?retainedDay:0;
  if(firstDates&&days.length){
    const wanted=initialDayHint==='tue'?2:initialDayHint==='sat'?6:null;
    const hinted=days.findIndex(day=>day.dow===wanted);
    if(hinted>=0)dayIndex=hinted;
    firstDates=false;
  }
  bookings=(Array.isArray(snapshot.bookings)?snapshot.bookings:[]).map(normalizeBooking).filter(Boolean);
  render();
  if(dialog.open)syncSheetAvailability();
});
