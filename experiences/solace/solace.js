import * as live from '../shared/live.js';
import { overrideUnitForRange, minutes as toMinutes, groupMyReservations, reservationResource, reservationStatusLabel, reservationPurposeLabel, endEarlyOptions, endEarlyNowOption, endedEarly, priorityNoticeText } from '../shared/model.js';

const { subscribe, submit, retry } = live;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icon = (type) => `<svg viewBox="0 0 24 24" aria-hidden="true">${{room:'<path d="M5 21V4l12-2v19M3 21h18M13 11v2"/>',whiteboard:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 8h10M7 12h6"/>',tv:'<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 22h8m-4-4v4"/>'}[type]}</svg>`;
const types = {room:{label:'Study Rooms',one:'Room',count:4,description:''},whiteboard:{label:'Whiteboards',one:'Whiteboard',count:5,description:''},tv:{label:'TVs',one:'TV',count:3,description:''}};
const purposes = {contact:{label:'Contact',description:''},new:{label:'New Member',description:''},other:{label:'Other',description:''}};
const reservedForLabels = {contact:'Contact Name',new:'Member Name',other:'Purpose'};
const serviceRules = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
const fmt = (minutes) => {const hour=Math.floor(minutes/60);return `${hour%12||12}:${String(minutes%60).padStart(2,'0')} ${hour<12?'AM':'PM'}`;};
const hourLabel = (minutes) => fmt(minutes).replace(':00','');
const range = (start,end) => `${fmt(start)} to ${fmt(end)}`;
const duration = (minutes) => `${Math.floor(minutes/60)?`${Math.floor(minutes/60)} hr`:''}${minutes%60?`${minutes>=60?' ':''}30 min`:''}`;
const visibleText = (value) => String(value).replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF]/g,'').length>0;

let connection={status:'loading',canBook:false,demo:false,error:''};
let dates=[],bookings=[],selectedDate=null,selectedType='room';
let draft={},step='resource',history=[],lastOpener=null,saved=null,pending=false,detailBooking=null,detailReturnFocus=null,actionPending=false,detailConfirm='';
let myReservations=[],mineStep={view:'list'},mineBusy=false,mineError='',mineOpener=null,mineFocus='',mineDrawn='';
const dialog=$('#booking-dialog');
const mineDialog=$('#mine-dialog');
const dateLabel = (key) => dates.find(day=>day.key===key)?.label || key || 'Choose a day';
const eligible = (key) => dates.some(day=>day.key===key);
const ready = () => ['live','demo'].includes(connection.status)&&connection.canBook&&eligible(selectedDate);
const draftReady = () => ready()&&eligible(draft.date);
const dayServices = (date) => serviceRules[dates.find(day=>day.key===date)?.weekday] || [];
const serviceAt = (date,time) => dayServices(date).find(([start,end])=>time>=start&&time<end);
const occupant = (date,type,unit,time) => bookings.find(b=>b.date===date&&b.type===type&&b.unit===unit&&time>=b.start&&time<b.end);
const free = (date,type,unit,time) => ready()&&eligible(date)&&time>=600&&time<1380&&!serviceAt(date,time)&&!occupant(date,type,unit,time);
const freeUntil = (date,type,unit,start) => {let end=start;while(free(date,type,unit,end))end+=30;return end;};
const allUnits = (type) => Array.from({length:types[type].count},(_,i)=>i+1);
const validUnits = (date,type,start,end) => start>=600&&end<=1380&&end>start&&start%30===0&&end%30===0?allUnits(type).filter(unit=>freeUntil(date,type,unit,start)>=end):[];
const rangeAllowed = (date,start,end) => start>=600&&end<=1380&&end>start&&start%30===0&&end%30===0&&!dayServices(date).some(([serviceStart,serviceEnd])=>start<serviceEnd&&end>serviceStart);
const rangeChoice = (date,type,start,end,purpose,exactUnit=null) => {
  const freeUnits=validUnits(date,type,start,end).filter(unit=>exactUnit===null||unit===exactUnit);
  if(freeUnits.length){
    const unit=exactUnit===null?freeUnits[0]:freeUnits.includes(exactUnit)?exactUnit:null;
    return unit===null?null:{unit,override:false};
  }
  if(!rangeAllowed(date,start,end))return null;
  const unit=overrideUnitForRange(type,date,start,end,purpose,bookings,exactUnit);
  return Number.isInteger(unit)?{unit,override:true}:null;
};
const reserveStartChoices = (date,type,purpose) => {
  const choices=[];
  for(let start=600;start<1380;start+=30){
    if(serviceAt(date,start))continue;
    let normal=false,override=false,overrideUnit=null;
    for(let end=start+30;end<=1380;end+=30){
      const choice=rangeChoice(date,type,start,end,purpose);
      if(!choice)continue;
      if(choice.override){override=true;overrideUnit??=choice.unit;}else normal=true;
    }
    if(normal||override)choices.push({time:start,override:!normal&&override,unit:!normal&&override?overrideUnit:null});
  }
  return choices;
};
const reserveEndChoices = (date,type,start,purpose) => {
  const choices=[];
  for(let end=start+30;end<=1380;end+=30){
    const choice=rangeChoice(date,type,start,end,purpose,draft.unit);
    if(choice)choices.push({time:end,override:choice.override});
  }
  return choices;
};
const normalizeBooking = (booking) => {
  const purpose=booking.purpose==='new-member'?'new':booking.purpose;
  const blocked=!!booking.blocked||purpose==='blocked'||!purposes[purpose];
  const projectedName=publicProjection(booking);
  return {key:String(booking.key??''),bookingId:booking.bookingId||booking.id||booking.key,day:booking.day??booking.date,date:booking.day??booking.date,type:booking.type,unit:Number(booking.unit),start:Number(booking.start),end:Number(booking.end),name:blocked?'Reserved':projectedName,publicName:blocked?'':projectedName,purpose:blocked?'blocked':purpose,reservedFor:typeof booking.reservedFor==='string'?booking.reservedFor:'',blocked,ownerDetail:authorizedOwnerDetail(booking)};
};
const publicProjection = (booking) => {const projected=booking?.publicName??booking?.displayName??booking?.name;const text=String(projected??'').trim();return text||'Reserved';};
const authorizedOwnerDetail = (booking) => {const detail=booking?.ownerDetail??booking?.ownerDetails??booking?.detail;if(!detail||typeof detail!=='object'||Array.isArray(detail))return null;return detail.authorized===true||detail.ownerAuthorized===true||detail.authorizedForMember===true?detail:null;};
/* The shared state names these permissions canCancel and canEndEarly; older
   shapes are still accepted. */
const detailAllows = (detail,action) => {
  if(!detail||typeof detail!=='object')return false;
  const owned=action==='cancel'?detail.canCancel:detail.canEndEarly;
  return owned===true||detail[action]===true||detail.permissions?.[action]===true||detail.actions?.[action]===true;
};
const reservedForValue = (detail,booking) => {if(!detail)return '';const value=booking?.purpose==='other'?detail.purposeOther??detail.purpose_other??detail.reservedFor??detail.reserved_for:detail.reservedFor??detail.reserved_for??detail.name;return String(value??'').trim();};

function renderNavigation(){
  $('#dates').innerHTML=dates.map(day=>{const comma=day.label.indexOf(',');const long=comma<0?day.label:day.label.slice(0,comma);const month=comma<0?'':day.label.slice(comma+1).trim();return `<button type="button" class="date-button" data-date="${esc(day.key)}" aria-pressed="${selectedDate===day.key}" aria-label="${esc(day.label)}"><b>${esc(long)}</b><i class="day-dot" aria-hidden="true"></i><span>${esc(month)}</span></button>`;}).join('');
  $('#resources').innerHTML=Object.entries(types).map(([key,type])=>`<button type="button" class="resource-button" data-type="${key}" aria-pressed="${selectedType===key}">${icon(key)}<span>${type.label}</span></button>`).join('');
  const count=types[selectedType].count;
  $('.schedule-surface').style.setProperty('--units',count);
  $('.schedule-surface').classList.toggle('dense',count===5);
  $('#unit-headings').innerHTML=`<span>Time</span>${allUnits(selectedType).map(unit=>`<span>${selectedType==='whiteboard'?'Board':types[selectedType].one} <b>${unit}</b>${selectedType==='whiteboard'?`<small>${unit<=3?'Large':'Vertical'}</small>`:''}</span>`).join('')}`;
  $('#day-caption').textContent=dateLabel(selectedDate);
  $('#availability-caption').innerHTML=ready()?'<i class="open-dot"></i> Tap an open space':'Availability awaits connection';
  $('#reserve').disabled=!ready()||pending;
  $('#connection-label').textContent=connection.demo?'Demo':({loading:'Connecting',live:'Live schedule',offline:'Offline',error:'Reconnect',demo:'Demo'}[connection.status]||'Connecting');
  $('#schedule-note').innerHTML=connection.demo?'Fictional names and sample bookings.<br>Your practice reservations stay in this browser tab.':'Names are abbreviated on the shared schedule.<br>Manage your bookings in My reservations.';
}

function connectionMessage(){
  if(connection.status==='loading')return '<div class="loading-spinner" aria-hidden="true"></div><h3>Preparing schedule.</h3><p>Connecting to your schedule.</p><button type="button" class="text-button" data-recover>Retry connection</button>';
  if(connection.status==='offline')return '<h3>Schedule unavailable.</h3><p>You are offline. Availability will return when the connection is restored.</p><button type="button" class="text-button" data-recover>Retry connection</button>';
  if(connection.status==='error')return `<h3>Schedule unavailable.</h3><p>${esc(connection.error||'The schedule could not connect. Please try again.')}</p><button type="button" class="text-button" data-recover>Retry connection</button>`;
  if(!ready())return '<h3>Your schedule is getting ready.</h3><p>Reservations will open when the current schedule is available.</p><button type="button" class="text-button" data-recover>Retry connection</button>';
  if(connection.demo)return 'Demo mode. Try a reservation with fictional details.';
  return '';
}

function renderSchedule(){
  renderNavigation();
  $('#state-message').innerHTML=connectionMessage();
  $('#state-message').classList.toggle('connection-live',ready());
  $('#schedule').setAttribute('aria-busy',String(connection.status==='loading'));
  $('#schedule').classList.toggle('pending-grid',!eligible(selectedDate));
  if(!eligible(selectedDate)){
    $('#schedule').innerHTML=connection.status==='loading'?Array.from({length:types[selectedType].count*6},(_,i)=>`<span class="skeleton-cell" aria-hidden="true" style="grid-column:${i%types[selectedType].count+2};grid-row:${Math.floor(i/types[selectedType].count)+1}"></span>`).join(''):'';
    updateDialogAvailability();return;
  }
  let html='<div class="time-track" aria-hidden="true"></div>';
  for(let time=600;time<=1380;time+=60)html+=`<span class="hour-label ${time===1380?'last':''}" style="grid-row:${time===1380?26:(time-600)/30+1}">${hourLabel(time)}</span>`;
  for(const unit of allUnits(selectedType)){
    for(let time=600;time<1380;){
      if(serviceAt(selectedDate,time)){time+=30;continue;}
      const booking=occupant(selectedDate,selectedType,unit,time);
      const row=(time-600)/30+1;
      if(booking){
        let end=time+30;
        while(end<1380&&!serviceAt(selectedDate,end)&&occupant(selectedDate,selectedType,unit,end)===booking)end+=30;
        const span=(end-time)/30;
        const description=booking.blocked?`Reserved, ${types[selectedType].one} ${unit}, ${range(time,end)}`:`${booking.name}, ${purposes[booking.purpose].label}, ${types[selectedType].one} ${unit}, ${range(time,end)}`;
        html+=`<button type="button" class="booking ${booking.purpose} ${span===1?'short':''} ${saved&&booking.key===saved.key?'recent-saved':''}" data-booking="${esc(booking.key)}" style="grid-column:${unit+1};grid-row:${row}/span ${span}" aria-label="${esc(description)}"><span class="booking-name">${esc(booking.blocked?'Reserved':booking.name)}</span>${booking.blocked?'':`<span class="booking-purpose">${purposes[booking.purpose].label}</span>`}</button>`;
        time=end;
      }else{
        html+=ready()?`<button type="button" class="open-slot" data-unit="${unit}" data-start="${time}" style="grid-column:${unit+1};grid-row:${row}" aria-label="Reserve ${types[selectedType].one} ${unit}, ${esc(dateLabel(selectedDate))}, starting ${fmt(time)}"><span>Open</span></button>`:`<span class="unavailable-slot" style="grid-column:${unit+1};grid-row:${row}" aria-label="Availability unavailable">·</span>`;
        time+=30;
      }
    }
  }
  for(const [start,end,label] of dayServices(selectedDate))html+=`<div class="service-band" style="grid-row:${(start-600)/30+1}/span ${(end-start)/30}" aria-label="${label}, ${range(start,end)}, unavailable"><span aria-hidden="true">✧</span><span>${label}</span></div>`;
  $('#schedule').innerHTML=html;
  updateDialogAvailability();
}

function detailActionMarkup(action,label){return detailAllows(detailBooking?.ownerDetail,action)?`<button type="button" class="primary detail-action" data-detail-action="${action}">${label}</button>`:'';}
function detailActionsHtml(){
  if(detailConfirm==='cancel')return `<p class="mine-confirm-copy">Cancel this reservation? The time opens for everyone right away.</p><div class="detail-actions"><button type="button" class="primary detail-action" data-detail-action="cancel-confirm">Yes, cancel reservation</button><button type="button" class="text-button" data-detail-action="cancel-keep">Keep it</button></div>`;
  const actions=`${detailActionMarkup('endEarly','End early')}${detailActionMarkup('cancel','Cancel')}`;
  return actions?`<div class="detail-actions">${actions}</div>`:'';
}
function renderDetail(booking,open=false){
  if(!booking)return;
  detailBooking=booking;
  const detail=booking.ownerDetail,purpose=booking.blocked?'':purposes[booking.purpose]?.label||'Other';
  const privateValue=reservedForValue(detail,booking)||booking.reservedFor||'',privateLabel=reservedForLabels[booking.purpose]||'Reserved for';
  const actionMarkup=detailActionsHtml();
  const date=dateLabel(booking.date);
  const ownerName=detail?.name||detail?.displayName||booking.publicName||'';
  const rows=`<div class="detail-row"><span>Day</span><b>${esc(date)}</b></div><div class="detail-row"><span>Reservation</span><b>${range(booking.start,booking.end)}</b></div><div class="detail-row"><span>Public name</span><b>${esc(booking.blocked?'Reserved':booking.publicName||booking.name)}</b></div>${purpose?`<div class="detail-row"><span>Purpose</span><b>${esc(purpose)}</b></div>`:''}${ownerName?`<div class="detail-row detail-private"><span>Reserved</span><b>${esc(ownerName)}</b></div>`:''}`;
  $('#detail-body').innerHTML=`<p class="flow-context">${esc(types[booking.type]?.one||'Reservation')} ${booking.unit}</p><h2 id="detail-title" tabindex="-1">Reservation details</h2><div class="detail-card">${rows}${privateValue?`<div class="detail-row detail-private"><span>${esc(privateLabel)}</span><b>${esc(privateValue)}</b></div>`:''}</div>${actionMarkup}<p id="detail-status" class="validation" role="alert"></p>`;
  if(open&&!$('#detail-dialog').open){detailReturnFocus=document.activeElement;$('#detail-dialog').showModal();}
  requestAnimationFrame(()=>$('#detail-title')?.focus({preventScroll:true}));
}
function closeDetail(){if(!$('#detail-dialog').open||actionPending)return;$('#detail-dialog').close();detailConfirm='';if(detailReturnFocus?.isConnected)detailReturnFocus.focus({preventScroll:true});detailReturnFocus=null;detailBooking=null;}
async function runDetailAction(action){
  if(actionPending||!detailBooking)return;
  const detail=detailBooking.ownerDetail,bookingId=detail?.bookingId??detail?.id??'';
  if(action==='cancel-keep'){detailConfirm='';renderDetail(detailBooking);return;}
  if(action==='endEarly'){
    // Ending early needs a new ending, so it continues in My reservations.
    if(!detailAllows(detail,'endEarly')||!bookingId)return;
    closeDetail();openMine({view:'end-early',bookingId});return;
  }
  if(action==='cancel'){if(!detailAllows(detail,'cancel')||!bookingId)return;detailConfirm='cancel';renderDetail(detailBooking);return;}
  if(action!=='cancel-confirm'||!detailAllows(detail,'cancel')||!bookingId)return;
  const status=$('#detail-status');
  actionPending=true;if(status)status.textContent='Cancelling reservation...';$('#detail-body').querySelectorAll('button').forEach(button=>button.disabled=true);
  try{
    await live.cancelOwnedBooking(bookingId);
    actionPending=false;detailConfirm='';closeDetail();
    $('#announcement').textContent='Reservation cancelled. The time is open for everyone.';
  }catch(error){
    actionPending=false;if(status)status.textContent=error?.message||'That action could not be completed. Please try again.';$('#detail-body').querySelectorAll('button').forEach(button=>button.disabled=false);
  }
}

/* ================= My reservations, inside Solace ================= */

const mineTime = (value) => {const total=toMinutes(value);return Number.isFinite(total)?fmt(total):String(value??'');};
const mineRange = (booking) => `${mineTime(booking.start)} to ${mineTime(booking.end)}`;
const mineDateLabel = (key) => {
  const known=dates.find(day=>day.key===key);
  if(known)return known.label;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key||''))
    ?new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'})
    :String(key??'');
};
const mineResourceLabel = (booking) => {const resource=reservationResource(booking);if(!resource)return 'Reservation';return resource.unit?`${types[resource.type]?.one||resource.label} ${resource.unit}`:resource.label;};
const mineById = (id) => myReservations.find(booking=>booking.id===id)||null;
const mineReady = () => ['live','demo'].includes(connection.status)&&connection.canBook;
const mineDisabled = () => mineReady()?'':' disabled';

function mineSummaryHtml(booking){
  const label=reservedForLabels[booking.purpose]||'Reserved for',purpose=reservationPurposeLabel(booking),detail=String(booking.reservedFor||'').trim();
  return `<div class="summary"><h3>${esc(mineResourceLabel(booking))}</h3><dl><div><dt>Day</dt><dd>${esc(mineDateLabel(booking.date))}</dd></div><div><dt>Time</dt><dd>${esc(mineRange(booking))}</dd></div>${purpose?`<div><dt>Purpose</dt><dd>${esc(purpose)}</dd></div>`:''}${detail?`<div><dt>${esc(label)}</dt><dd>${esc(detail)}</dd></div>`:''}</dl></div>`;
}
function mineCardHtml(booking){
  const label=reservedForLabels[booking.purpose]||'Reserved for',detail=String(booking.reservedFor||'').trim();
  const status=reservationStatusLabel(booking),purpose=reservationPurposeLabel(booking),notice=priorityNoticeText(booking);
  const canEndEarly=booking.canEndEarly===true&&endEarlyOptions(booking).length>0;
  const actions=[
    booking.status==='overridden'?`<button type="button" class="mine-action" data-mine-rebook="${esc(booking.id)}">Reserve another time</button>`:'',
    canEndEarly?`<button type="button" class="mine-action" data-mine-end-early="${esc(booking.id)}"${mineDisabled()}>End early</button>`:'',
    booking.canCancel===true?`<button type="button" class="mine-action mine-stop" data-mine-cancel="${esc(booking.id)}"${mineDisabled()}>${booking.status==='approved'?'Cancel reservation':'Cancel request'}</button>`:''
  ].filter(Boolean).join('');
  return `<li class="mine-card">`+
    `<div class="mine-card-head"><b>${esc(mineDateLabel(booking.date))}</b>${status?`<span class="mine-badge mine-${esc(booking.status)}">${esc(status)}</span>`:''}</div>`+
    `<p class="mine-when">${esc(mineRange(booking))}</p>`+
    `<p class="mine-meta"><span>${esc(mineResourceLabel(booking))}</span>${purpose?`<span>${esc(purpose)}</span>`:''}${detail?`<span>${esc(label)}: ${esc(detail)}</span>`:''}</p>`+
    (endedEarly(booking)?`<p class="mine-note">Ended early · originally booked until ${esc(mineTime(booking.endedEarlyFrom))}</p>`:'')+
    (notice?`<p class="mine-note mine-priority" role="note"><strong>Priority update</strong> ${esc(notice)}</p>`:'')+
    (actions?`<div class="mine-actions">${actions}</div>`:'')+
    `</li>`;
}
function mineListHtml(){
  const {upcoming,past}=groupMyReservations(myReservations);
  if(!upcoming.length&&!past.length){
    if(connection.status==='loading')return '<div class="loading-spinner" aria-hidden="true"></div><h2 id="mine-title" tabindex="-1">Finding your reservations.</h2><p class="hint">Connecting to the shared schedule.</p>';
    if(connection.status==='error')return `<h2 id="mine-title" tabindex="-1">Reservations unavailable.</h2><p class="hint">${esc(connection.error||'The schedule could not connect. Please try again.')}</p><button type="button" class="text-button" data-recover>Retry connection</button>`;
    return `<h2 id="mine-title" tabindex="-1">No reservations yet.</h2><p class="hint">Anything you reserve on this device appears here, with Cancel and End early.</p><button type="button" class="primary" id="mine-reserve"${ready()?'':' disabled'}>Reserve a space</button>`;
  }
  return `<h2 id="mine-title" tabindex="-1">My reservations.</h2><p class="hint">Everything reserved from this device, with its latest status.</p>`+
    (upcoming.length?`<h3 class="mine-heading">Upcoming</h3><ul class="mine-list" aria-label="Upcoming reservations">${upcoming.map(mineCardHtml).join('')}</ul>`:'')+
    (past.length?`<h3 class="mine-heading">Past reservations</h3><ul class="mine-list" aria-label="Past reservations">${past.map(mineCardHtml).join('')}</ul>`:'');
}
function mineCancelHtml(booking){
  const approved=booking.status==='approved';
  return `<h2 id="mine-title" tabindex="-1">${approved?'Cancel this reservation?':'Cancel this request?'}</h2>`+
    `<p class="hint">${approved?'The time opens for everyone right away. This cannot be undone.':'The request is withdrawn right away. This cannot be undone.'}</p>`+
    mineSummaryHtml(booking)+
    `<button type="button" class="primary mine-stop" id="mine-cancel-confirm"${mineDisabled()} aria-busy="${mineBusy}">${mineBusy?'Cancelling...':approved?'Yes, cancel reservation':'Yes, cancel request'}</button>`+
    `<button type="button" class="text-button" id="mine-step-back">Keep it</button>`;
}
function mineEndEarlyHtml(booking){
  const options=endEarlyOptions(booking),current=endEarlyNowOption(booking);
  if(!options.length)return `<h2 id="mine-title" tabindex="-1">This one cannot be shortened.</h2><p class="hint">It is a single 30 minute block, so finishing early means cancelling it.</p><button type="button" class="text-button" id="mine-step-back">Back to your reservations</button>`;
  return `<h2 id="mine-title" tabindex="-1">When did you finish?</h2><p class="hint">Choose when you actually finished. The time after that opens for everyone right away.</p>`+
    `<div class="time-choices" role="group" aria-label="Choose a new ending">${options.map(option=>`<button type="button" class="time-choice${option===current?' mine-now':''}" data-mine-end="${esc(option)}"${mineDisabled()} aria-label="${esc(`End at ${mineTime(option)}${option===current?', now':''}, frees ${mineTime(option)} to ${mineTime(booking.end)}`)}">${esc(mineTime(option))}${option===current?'<small class="mine-now-label">now</small>':''}<small>Frees ${esc(mineTime(option))}</small></button>`).join('')}</div>`+
    `<button type="button" class="text-button" id="mine-step-back">Keep my time</button>`;
}
function mineEndConfirmHtml(booking,end){
  return `<h2 id="mine-title" tabindex="-1">End at ${esc(mineTime(end))}?</h2>`+
    `<p class="hint">${esc(mineTime(booking.start))} to ${esc(mineTime(end))} stays yours. ${esc(mineTime(end))} to ${esc(mineTime(booking.end))} opens for everyone.</p>`+
    mineSummaryHtml(booking)+
    `<button type="button" class="primary" id="mine-end-confirm"${mineDisabled()} aria-busy="${mineBusy}">${mineBusy?'Ending early...':'End early'}</button>`+
    `<button type="button" class="text-button" id="mine-step-back">Back</button>`;
}
function mineConnectionHtml(){
  if(connection.status==='offline')return 'You are offline. Your reservations return when the connection does.<button type="button" class="text-button" data-recover>Retry connection</button>';
  if(connection.status==='error'&&myReservations.length)return `${esc(connection.error||'The shared schedule could not connect.')}<button type="button" class="text-button" data-recover>Retry connection</button>`;
  if(!mineReady()&&connection.status!=='loading')return 'The shared schedule is reconnecting. Cancel and End early return when it is live.<button type="button" class="text-button" data-recover>Retry connection</button>';
  return '';
}
/* A background refresh arrives every few seconds. Redrawing the sheet then
   would interrupt whoever is part-way through a confirmation, so the sheet is
   only redrawn when something it shows has actually changed. */
function mineSignature(){
  return JSON.stringify([connection.status,connection.canBook,connection.error,mineStep,mineBusy,mineError,
    dates.map(day=>`${day.key}|${day.label}`),
    myReservations.map(booking=>[booking.id,booking.status,booking.date,booking.start,booking.end,booking.purpose,booking.reservedFor,booking.canCancel,booking.canEndEarly,booking.endedEarlyFrom,booking.priorityNotice?.kind??'',booking.assignments])]);
}
function renderMine(moveFocus=false){
  if(!mineDialog.open)return;
  if(mineStep.view!=='list'&&!mineById(mineStep.bookingId))mineStep={view:'list'};
  const signature=mineSignature();
  if(!moveFocus&&!mineFocus&&signature===mineDrawn)return;
  mineDrawn=signature;
  const booking=mineById(mineStep.bookingId),view=mineStep.view;
  $('#mine-back').style.visibility=view==='list'?'hidden':'visible';
  $('#mine-counter').textContent=view==='list'?'Your reservations':view==='cancel'?'Cancel · confirm':view==='end-early'?'End early · choose':'End early · confirm';
  $('#mine-connection').innerHTML=mineConnectionHtml();
  const body=view==='cancel'?mineCancelHtml(booking):view==='end-early'?mineEndEarlyHtml(booking):view==='end-confirm'?mineEndConfirmHtml(booking,mineStep.end):mineListHtml();
  // A background refresh replaces this markup, so keep focus inside the sheet.
  const heldFocus=$('#mine-body').contains(document.activeElement);
  $('#mine-body').innerHTML=`<section class="step">${mineError?`<p class="inline-error" role="alert">${esc(mineError)}</p>`:''}${body}</section>`;
  mineDialog.scrollTop=0;
  const target=mineFocus?$('#mine-body').querySelector(mineFocus):null;
  mineFocus='';
  if(moveFocus||target||heldFocus)requestAnimationFrame(()=>(target?.isConnected?target:$('#mine-title'))?.focus({preventScroll:true}));
}
function mineUrl(open){
  const params=new URLSearchParams(location.search);
  if(open)params.set('view','mine');else params.delete('view');
  const query=params.toString();
  return location.pathname+(query?`?${query}`:'')+location.hash;
}
function openMine(nextStep={view:'list'},push=true){
  if(!mineDialog.open){mineOpener=document.activeElement;if(dialog.open&&!pending)closeBooking();}
  mineStep=nextStep;mineError='';
  if(!mineDialog.open){mineDialog.showModal();document.body.style.overflow='hidden';}
  if(push&&new URLSearchParams(location.search).get('view')!=='mine')window.history.pushState({view:'mine'},'',mineUrl(true));
  renderMine(true);
}
function closeMine(push=true){
  if(mineBusy||!mineDialog.open)return;
  mineDialog.close();document.body.style.overflow='';mineStep={view:'list'};mineError='';
  if(push&&new URLSearchParams(location.search).get('view')==='mine')window.history.pushState({},'',mineUrl(false));
  if(mineOpener?.isConnected)mineOpener.focus({preventScroll:true});else $('#mine-link')?.focus({preventScroll:true});
  mineOpener=null;
}
function mineBack(){
  if(mineBusy)return;
  mineError='';
  if(mineStep.view==='end-confirm'){mineStep={view:'end-early',bookingId:mineStep.bookingId};renderMine(true);return;}
  mineFocus=mineStep.view==='cancel'?`[data-mine-cancel="${mineStep.bookingId}"]`:mineStep.view==='end-early'?`[data-mine-end-early="${mineStep.bookingId}"]`:'';
  mineStep={view:'list'};renderMine(true);
}
async function runMineCancel(){
  const booking=mineById(mineStep.bookingId);
  if(!booking||mineBusy)return;
  mineBusy=true;mineError='';renderMine();
  try{
    await live.cancelOwnedBooking(booking.id);
    mineBusy=false;mineStep={view:'list'};
    $('#announcement').textContent=booking.status==='approved'?'Reservation cancelled. The time is open for everyone.':'Request cancelled.';
    renderMine(true);
  }catch(error){
    mineBusy=false;mineError=error?.message||'That reservation could not be cancelled. Please try again.';renderMine(true);
  }
}
async function runMineEndEarly(){
  const booking=mineById(mineStep.bookingId),end=mineStep.end;
  if(!booking||!end||mineBusy)return;
  mineBusy=true;mineError='';renderMine();
  try{
    await live.endOwnedBookingEarly(booking.id,end);
    mineBusy=false;mineStep={view:'list'};
    $('#announcement').textContent=`Ended at ${mineTime(end)}. The rest of your time is open for others.`;
    renderMine(true);
  }catch(error){
    mineBusy=false;mineError=error?.message||'That reservation could not end early. Please try again.';renderMine(true);
  }
}

function title(text,hint){return `<h2 id="step-title" tabindex="-1">${text}</h2><p class="hint">${hint}</p>`;}
function summary(){const label=reservedForLabels[draft.purpose]||'Reserved for';return `<div class="summary"><h3>${types[draft.type].one} ${draft.unit}</h3><dl><div><dt>Day</dt><dd>${esc(dateLabel(draft.date))}</dd></div><div><dt>Time</dt><dd>${range(draft.start,draft.end)}</dd></div><div><dt>Purpose</dt><dd>${purposes[draft.purpose].label}</dd></div><div><dt>Name</dt><dd>${esc(draft.name||'')}</dd></div><div><dt>${label}</dt><dd>${esc(draft.reservedFor||'')}</dd></div></dl>${draft.override?'<p class="override-note" role="note"><strong>Priority override</strong>This time is held by a lower-priority reservation.</p>':''}</div>`;}

function updateDialogAvailability(){
  const status=$('#dialog-status');
  if(!draft.date){status.innerHTML='';return;}
  if(pending)status.textContent='Saving your reservation. Please keep this window open.';
  else if(step==='done')status.innerHTML='';
  else if(!draftReady())status.innerHTML=`${eligible(draft.date)?'Your details are kept here. Reconnect to finish your reservation.':'This reservation date is no longer available. Close this sheet to choose another day.'}<button type="button" class="text-button" data-recover>Retry connection</button>`;
  else status.innerHTML='';
  const confirm=$('#confirm-reservation');
  if(confirm){confirm.disabled=pending||!draftReady();confirm.setAttribute('aria-busy',String(pending));confirm.textContent=pending?'Saving your reservation...':'Confirm reservation';}
  $('#back').disabled=pending;
  $('#close').disabled=pending;
  for(const button of $('#step-body').querySelectorAll('.choice,.time-choice,#name-form button,#other-form button'))button.disabled=pending||!draftReady();
  const another=$('#another-reservation');if(another)another.disabled=!ready()||pending;
  $('#reserve').disabled=!ready()||pending;
}

function renderStep(){
  $('#back').style.visibility=history.length&&step!=='done'?'visible':'hidden';
  const steps=draft.direct?['purpose','end','reservedFor','confirm']:['resource','purpose','start','end','reservedFor','confirm'];
  $('#step-count').textContent=step==='done'?'Reservation confirmed':`Your reservation · ${Math.max(1,steps.indexOf(step)+1)} of ${steps.length}`;
  const crumbs=[dateLabel(draft.date)];
  if(draft.type)crumbs.push(`${types[draft.type].one}${draft.unit?` ${draft.unit}`:''}`);
  if(draft.start!=null)crumbs.push(fmt(draft.start));
  $('#selection-context').innerHTML=step==='done'?'':crumbs.map(value=>`<span>${esc(value)}</span>`).join('');
  let html='';
  if(step==='resource')html=title('What would you like to reserve?','Select a resource.')+`<div class="choices">${Object.entries(types).map(([key,type])=>`<button class="choice" type="button" data-choose-type="${key}"><span class="choice-icon">${icon(key)}</span><span class="choice-copy"><b>${type.label}</b>${type.description?`<small>${type.description}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`;
  if(step==='purpose')html=title('What is this reservation for?',draft.direct?`Your ${types[draft.type].one.toLowerCase()} and ${fmt(draft.start)} start are selected.`:'Select a purpose.')+`<div class="choices">${Object.entries(purposes).map(([key,purpose])=>`<button type="button" class="choice" data-purpose="${key}"><span class="purpose-dot ${key}" aria-hidden="true"></span><span class="choice-copy"><b>${purpose.label}</b>${purpose.description?`<small>${purpose.description}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`;
  if(step==='reservedFor'){const label=reservedForLabels[draft.purpose]||'Reserved for';const heading=draft.purpose==='other'?'What is this for?':'Who is this for?';const hint=draft.purpose==='other'?'Add a short purpose for this reservation.':'Add the person this reservation is for.';html=title(heading,hint)+`<form id="name-form"><label class="field-label" for="guest-name">Your name</label><input class="name-field" id="guest-name" name="name" maxlength="120" autocomplete="name" value="${esc(draft.name||'')}" required><label class="field-label" for="reserved-for">${label}</label><input class="name-field" id="reserved-for" name="reservedFor" maxlength="120" autocomplete="off" value="${esc(draft.reservedFor||'')}" required><p class="field-note">Only the shared public name and purpose appear on the schedule.</p><p class="inline-error" id="name-error" role="alert"></p><button class="primary" type="submit">Continue</button></form>`;}
  if(step==='start'){
    const starts=reserveStartChoices(draft.date,draft.type,draft.purpose);
    html=title('When would you like to start?','Choose a beginning. Only available times appear below.')+(starts.length?`<div class="time-choices">${starts.map(({time,override})=>`<button type="button" class="time-choice${override?' override':''}" data-start-choice="${time}"${override?` aria-label="${esc(`${fmt(time)}, Priority override`)}"`:''}>${fmt(time)}${override?'<small class="override-indicator">Priority override</small>':''}</button>`).join('')}</div>`:`<p class="hint">${draftReady()?'Every space is reserved. Close this sheet to choose the other day.':'Available times will appear when the connection returns.'}</p>`);
  }
  if(step==='end'){
    const ends=reserveEndChoices(draft.date,draft.type,draft.start,draft.purpose);
    html=title('When would you like to end?',`Starting at ${fmt(draft.start)}. Each ending fits around reservations and service.`)+(ends.length?`<div class="time-choices">${ends.map(({time,override})=>`<button type="button" class="time-choice${override?' override':''}" data-end-choice="${time}"${override?` aria-label="${esc(`${fmt(time)}, Priority override`)}"`:''}>${fmt(time)}<small>${duration(time-draft.start)}</small>${override?'<small class="override-indicator">Priority override</small>':''}</button>`).join('')}</div>`:`<p class="inline-error">${draftReady()?'This opening has changed. Go back and choose another start.':'Available endings will appear when the connection returns.'}</p>`);
  }
  if(step==='confirm')html=title('Confirm your reservation.','Review the details before confirming.')+summary()+`<p class="summary-note">${connection.demo?'This practice reservation saves only in this browser tab.':'Your reservation is confirmed after the space is secured.'}</p><p class="inline-error" id="save-error" role="alert"></p><button type="button" class="primary" id="confirm-reservation">Confirm reservation</button>`;
  if(step==='done')html='<div class="done-symbol" aria-hidden="true">✓</div>'+title(connection.demo?'Practice reservation saved.':'Reservation confirmed.','Your reservation is confirmed.')+summary()+`<p class="summary-note">${connection.demo?'Demo confirmation. Saved only in this browser tab.':'Find and manage this booking in My reservations.'}</p><button type="button" class="primary" id="see-reservation">See it on the schedule</button><button type="button" class="text-button" id="another-reservation">Reserve another space</button>`;
  $('#step-body').innerHTML=`<section class="step ${step==='done'?'done':''}">${html}</section>`;
  updateDialogAvailability();
  dialog.scrollTop=0;
  requestAnimationFrame(()=>$('#step-title')?.focus({preventScroll:true}));
}

function go(next){history.push(step);step=next;renderStep();}
function blankDraft(preset){return {date:selectedDate,name:localStorage.getItem('srs-name')||'',reservedFor:'',purposeOther:'',type:preset?selectedType:null,unit:preset?.unit||null,start:preset?.start??null,end:null,purpose:null,override:false,direct:!!preset};}
function openBooking(preset){
  if(!ready()||pending)return;
  if(preset&&!free(selectedDate,selectedType,preset.unit,preset.start))return;
  lastOpener=document.activeElement;draft=blankDraft(preset);step=preset?'purpose':'resource';history=[];renderStep();
  if(!dialog.open)dialog.showModal();
  document.body.style.overflow='hidden';
}
function closeBooking(){if(pending)return;dialog.close();document.body.style.overflow='';if(lastOpener?.isConnected)lastOpener.focus({preventScroll:true});else $('#reserve').focus({preventScroll:true});}
async function recover(){
  if(pending)return;
  connection={...connection,status:'loading',canBook:false,error:''};renderSchedule();
  try{await retry();}catch(error){connection={...connection,status:'error',canBook:false,error:error?.message||'The schedule could not connect. Please try again.'};renderSchedule();}
}

$('#dates').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(!button||pending)return;selectedDate=button.dataset.date;renderSchedule();[...$('#dates').querySelectorAll('button')].find(item=>item.dataset.date===selectedDate)?.focus({preventScroll:true});$('#announcement').textContent=`Showing ${dateLabel(selectedDate)}.`;});
$('#resources').addEventListener('click',event=>{const button=event.target.closest('[data-type]');if(!button||pending)return;selectedType=button.dataset.type;renderSchedule();$(`#resources [data-type="${selectedType}"]`).focus({preventScroll:true});$('#announcement').textContent=`Showing ${types[selectedType].count} ${types[selectedType].label.toLowerCase()}.`;});
$('#schedule').addEventListener('click',event=>{const bookingButton=event.target.closest('[data-booking]');if(bookingButton){const booking=bookings.find(item=>item.key===bookingButton.dataset.booking);if(booking)renderDetail(booking,true);return;}const button=event.target.closest('.open-slot');if(button)openBooking({unit:Number(button.dataset.unit),start:Number(button.dataset.start)});});
$('#state-message').addEventListener('click',event=>{if(event.target.closest('[data-recover]'))recover();});
$('#reserve').addEventListener('click',()=>openBooking());
$('#close').addEventListener('click',closeBooking);
dialog.addEventListener('cancel',event=>{event.preventDefault();closeBooking();});
$('#back').addEventListener('click',()=>{if(!history.length||pending)return;step=history.pop();if(step==='start'&&!draft.direct){draft.start=null;draft.unit=null;draft.override=false;}if(step==='end'){draft.end=null;if(!draft.direct){draft.unit=null;draft.override=false;}}renderStep();});
dialog.addEventListener('click',event=>{if(event.target.closest('[data-recover]')){recover();return;}if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeBooking();}});
dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>getComputedStyle(el).visibility!=='hidden'&&el.getClientRects().length);
  if(!items.length){event.preventDefault();return;}
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('#step-title'))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
$('#detail-close').addEventListener('click',closeDetail);
$('#detail-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('#detail-dialog').addEventListener('click',event=>{if(event.target!==$('#detail-dialog'))return;const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDetail();});
$('#detail-body').addEventListener('click',event=>{const action=event.target.closest('[data-detail-action]')?.dataset.detailAction;if(action)runDetailAction(action);});
$('#mine-link').addEventListener('click',event=>{event.preventDefault();openMine();});
$('#mine-close').addEventListener('click',()=>closeMine());
$('#mine-back').addEventListener('click',mineBack);
mineDialog.addEventListener('cancel',event=>{event.preventDefault();if(mineStep.view==='list')closeMine();else mineBack();});
mineDialog.addEventListener('click',event=>{
  if(event.target!==mineDialog)return;
  const rect=mineDialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeMine();
});
$('#mine-body').addEventListener('click',event=>{
  if(event.target.closest('[data-recover]')){recover();return;}
  if(event.target.closest('#mine-step-back')){mineBack();return;}
  if(event.target.closest('#mine-reserve')||event.target.closest('[data-mine-rebook]')){closeMine();openBooking();return;}
  if(mineBusy)return;
  const cancel=event.target.closest('[data-mine-cancel]');
  if(cancel){mineStep={view:'cancel',bookingId:cancel.dataset.mineCancel};mineError='';renderMine(true);return;}
  const endEarly=event.target.closest('[data-mine-end-early]');
  if(endEarly){mineStep={view:'end-early',bookingId:endEarly.dataset.mineEndEarly};mineError='';renderMine(true);return;}
  const choice=event.target.closest('[data-mine-end]');
  if(choice){mineStep={view:'end-confirm',bookingId:mineStep.bookingId,end:choice.dataset.mineEnd};mineError='';renderMine(true);return;}
  if(event.target.closest('#mine-cancel-confirm')){runMineCancel();return;}
  if(event.target.closest('#mine-end-confirm'))runMineEndEarly();
});
addEventListener('popstate',()=>{
  const wants=new URLSearchParams(location.search).get('view')==='mine';
  if(wants&&!mineDialog.open)openMine({view:'list'},false);
  else if(!wants&&mineDialog.open)closeMine(false);
});
$('#step-body').addEventListener('input',event=>{if(event.target.id==='guest-name')draft.name=event.target.value;if(event.target.id==='reserved-for'){draft.reservedFor=event.target.value;draft.purposeOther=draft.purpose==='other'?event.target.value:'';}});
$('#step-body').addEventListener('submit',event=>{
  event.preventDefault();if(pending||!draftReady())return;
  if(event.target.id==='name-form'){
    const name=$('#guest-name').value.trim(),value=$('#reserved-for').value.trim();if(!visibleText(name)||!visibleText(value)){$('#name-error').textContent='Please add your name and the reserved-for detail.';$('#reserved-for').focus();return;}draft.name=name;draft.reservedFor=value;draft.purposeOther=draft.purpose==='other'?value:'';go('confirm');
  }
});
$('#step-body').addEventListener('click',async event=>{
  if(event.target.closest('#see-reservation')){closeBooking();const card=$('.recent-saved');if(card){card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});card.focus({preventScroll:true});}return;}
  if(pending||!draftReady())return;
  const type=event.target.closest('[data-choose-type]');if(type){draft.type=type.dataset.chooseType;go('purpose');return;}
  const purpose=event.target.closest('[data-purpose]');if(purpose){draft.purpose=purpose.dataset.purpose;draft.purposeOther='';go(draft.direct?'end':'start');return;}
  const start=event.target.closest('[data-start-choice]');if(start){const value=Number(start.dataset.startChoice),choice=reserveStartChoices(draft.date,draft.type,draft.purpose).find(item=>item.time===value);draft.start=value;draft.unit=choice?.unit??null;draft.override=Boolean(choice?.override);draft.end=null;go('end');return;}
  const end=event.target.closest('[data-end-choice]');if(end){
    const requestedEnd=Number(end.dataset.endChoice);
    const choice=rangeChoice(draft.date,draft.type,draft.start,requestedEnd,draft.purpose,draft.direct?draft.unit:null);
    if(!choice){renderStep();return;}
    draft.end=requestedEnd;draft.unit=choice.unit;draft.override=choice.override;go('reservedFor');return;
  }
  if(event.target.closest('#confirm-reservation')){
    const choice=rangeChoice(draft.date,draft.type,draft.start,draft.end,draft.purpose,draft.unit);
    if(!choice||choice.unit!==draft.unit||choice.override!==Boolean(draft.override)){$('#save-error').textContent='This space is no longer open for the full time. Go back to choose another time.';return;}
    if(!visibleText(draft.name)||!visibleText(draft.reservedFor)){$('#save-error').textContent='Please go back and add your name and the reserved-for detail.';return;}
    pending=true;$('#save-error').textContent='';updateDialogAvailability();
    try{
      const result=await submit({day:draft.date,type:draft.type,unit:draft.unit,start:draft.start,end:draft.end,name:(draft.name||draft.reservedFor).trim(),reservedFor:draft.reservedFor.trim(),purpose:draft.purpose,purposeOther:draft.purpose==='other'?draft.reservedFor.trim():''});
      if(!result||result.status!=='approved')throw new Error('The reservation could not be confirmed. Please try again.');
      saved=normalizeBooking(result);
      bookings=[...bookings.filter(booking=>booking.key!==saved.key),saved];
      draft={...draft,date:saved.date,type:saved.type,unit:saved.unit,start:saved.start,end:saved.end,purpose:saved.purpose};
      selectedDate=saved.date;selectedType=saved.type;pending=false;step='done';renderSchedule();renderStep();
      $('#announcement').textContent=connection.demo?'Practice reservation saved in this browser tab.':'Your reservation is confirmed.';
    }catch(error){
      pending=false;updateDialogAvailability();$('#save-error').textContent=error?.message||'Your reservation could not be saved. Your details are still here. Please try again.';
    }finally{pending=false;updateDialogAvailability();}
    return;
  }
  if(event.target.closest('#another-reservation')){draft=blankDraft();step='resource';history=[];renderStep();}
});

renderSchedule();
subscribe(snapshot=>{
  const previousStatus=connection.status;
  const openDetailKey=detailBooking?.key;
  connection={status:snapshot.status,canBook:!!snapshot.canBook,demo:!!snapshot.demo,error:String(snapshot.error||'')};
  dates=(snapshot.days||[]).map(day=>({key:day.key,label:String(day.label),weekday:Number(day.weekday)}));
  myReservations=(snapshot.myBookings||[]).filter(booking=>booking&&typeof booking.id==='string'&&booking.id);
  bookings=(snapshot.bookings||[]).map(normalizeBooking).filter(booking=>types[booking.type]&&Number.isInteger(booking.unit)&&booking.unit>=1&&booking.unit<=types[booking.type].count&&Number.isFinite(booking.start)&&Number.isFinite(booking.end)&&booking.end>booking.start);
  if(!eligible(selectedDate))selectedDate=dates[0]?.key||null;
  renderSchedule();
  if($('#detail-dialog').open&&openDetailKey){const updated=bookings.find(booking=>booking.key===openDetailKey);if(updated)renderDetail(updated);else closeDetail();}
  if(dialog.open&&!pending&&['start','end'].includes(step))renderStep();
  renderMine();
  if(previousStatus!==connection.status)$('#announcement').textContent=ready()?(connection.demo?'Demo schedule ready.':'Live schedule connected.'):'Schedule connection is unavailable. Reconnect to reserve.';
});
if(new URLSearchParams(location.search).get('view')==='mine')openMine({view:'list'},false);
