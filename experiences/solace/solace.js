import * as live from '../shared/live.js';
import { overrideUnitForRange } from '../shared/model.js';

const { subscribe, submit, retry } = live;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icon = (type) => `<svg viewBox="0 0 24 24" aria-hidden="true">${{room:'<path d="M5 21V4l12-2v19M3 21h18M13 11v2"/>',whiteboard:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 8h10M7 12h6"/>',tv:'<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 22h8m-4-4v4"/>'}[type]}</svg>`;
const types = {room:{label:'Study Rooms',one:'Room',count:4,description:''},whiteboard:{label:'Whiteboards',one:'Whiteboard',count:5,description:''},tv:{label:'TVs',one:'TV',count:3,description:''}};
const purposes = {contact:{label:'Contact',description:''},new:{label:'New Member',description:''},other:{label:'Other',description:''}};
const reservedForLabels = {contact:'Contact Name',new:'Member Name',other:'Purpose'};
const reservedForPlaceholders = {contact:'e.g. Kiana Davis',new:'e.g. Kiana Davis',other:'e.g. Family Bible study'};
const serviceRules = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
const fmt = (minutes) => {const hour=Math.floor(minutes/60);return `${hour%12||12}:${String(minutes%60).padStart(2,'0')} ${hour<12?'AM':'PM'}`;};
const hourLabel = (minutes) => fmt(minutes).replace(':00','');
const range = (start,end) => `${fmt(start)} to ${fmt(end)}`;
const duration = (minutes) => `${Math.floor(minutes/60)?`${Math.floor(minutes/60)} hr`:''}${minutes%60?`${minutes>=60?' ':''}30 min`:''}`;
const visibleText = (value) => String(value).replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF]/g,'').length>0;

let connection={status:'loading',canBook:false,demo:false,error:''};
let dates=[],bookings=[],selectedDate=null,selectedType='room';
let draft={},step='resource',history=[],lastOpener=null,saved=null,pending=false,detailBooking=null,detailReturnFocus=null,actionPending=false;
const dialog=$('#booking-dialog');
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
  const freeUnits=validUnits(date,type,start,end);
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
    let normal=false,override=false;
    for(let end=start+30;end<=1380;end+=30){
      const choice=rangeChoice(date,type,start,end,purpose);
      if(!choice)continue;
      if(choice.override)override=true;else normal=true;
    }
    if(normal||override)choices.push({time:start,override:!normal&&override});
  }
  return choices;
};
const reserveEndChoices = (date,type,start,purpose) => {
  const choices=[];
  for(let end=start+30;end<=1380;end+=30){
    const choice=rangeChoice(date,type,start,end,purpose);
    if(choice)choices.push({time:end,override:choice.override});
  }
  return choices;
};
const normalizeBooking = (booking) => {
  const purpose=booking.purpose==='new-member'?'new':booking.purpose;
  const blocked=!!booking.blocked||purpose==='blocked'||!purposes[purpose];
  const projectedName=publicProjection(booking);
  return {key:String(booking.key??''),bookingId:booking.bookingId||booking.id||booking.key,day:booking.day??booking.date,date:booking.day??booking.date,type:booking.type,unit:Number(booking.unit),start:Number(booking.start),end:Number(booking.end),name:blocked?'Reserved':projectedName,publicName:blocked?'':projectedName,purpose:blocked?'blocked':purpose,blocked,ownerDetail:authorizedOwnerDetail(booking)};
};
const publicProjection = (booking) => {const projected=booking?.publicName??booking?.displayName??booking?.name;const text=String(projected??'').trim();return text||'Reserved';};
const authorizedOwnerDetail = (booking) => {const detail=booking?.ownerDetail??booking?.ownerDetails??booking?.detail;if(!detail||typeof detail!=='object'||Array.isArray(detail))return null;return detail.authorized===true||detail.ownerAuthorized===true||detail.authorizedForMember===true?detail:null;};
const detailAllows = (detail,action) => Boolean(detail&&(detail[action]===true||detail.permissions?.[action]===true||detail.actions?.[action]===true));
const actionHandler = (action) => {const names=action==='cancel'?['cancelOwnedBooking','cancelBooking','memberCancelBooking','cancel']:['endOwnedBookingEarly','endBookingEarly','memberEndBookingEarly','endEarly'];return names.map(name=>live[name]).find(handler=>typeof handler==='function')||null;};
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

function detailActionMarkup(action,label){return detailAllows(detailBooking?.ownerDetail,action)?`<a class="primary detail-action" href="/?classic=1&amp;tab=mine">${label}</a>`:'';}
function renderDetail(booking,open=false){
  if(!booking)return;
  detailBooking=booking;
  const detail=booking.ownerDetail,purpose=booking.blocked?'':purposes[booking.purpose]?.label||'Other';
  const privateValue=reservedForValue(detail,booking),privateLabel=reservedForLabels[booking.purpose]||'Reserved for';
  const actionMarkup=`${detailActionMarkup('endEarly','End early')}${detailActionMarkup('cancel','Cancel')}`;
  const date=dateLabel(booking.date);
  const ownerName=detail?.name||detail?.displayName||'';
  const rows=`<div class="detail-row"><span>Day</span><b>${esc(date)}</b></div><div class="detail-row"><span>Reservation</span><b>${range(booking.start,booking.end)}</b></div><div class="detail-row"><span>Public name</span><b>${esc(booking.blocked?'Reserved':booking.publicName||booking.name)}</b></div>${purpose?`<div class="detail-row"><span>Purpose</span><b>${esc(purpose)}</b></div>`:''}${ownerName?`<div class="detail-row detail-private"><span>Reserved</span><b>${esc(ownerName)}</b></div>`:''}`;
  $('#detail-body').innerHTML=`<p class="flow-context">${esc(types[booking.type]?.one||'Reservation')} ${booking.unit}</p><h2 id="detail-title" tabindex="-1">Reservation details</h2><div class="detail-card">${rows}${detail&&privateValue?`<div class="detail-row detail-private"><span>${esc(privateLabel)}</span><b>${esc(privateValue)}</b></div>`:''}</div>${actionMarkup?`<div class="detail-actions">${actionMarkup}</div>`:''}<p id="detail-status" class="validation" role="alert"></p>`;
  if(open&&!$('#detail-dialog').open){detailReturnFocus=document.activeElement;$('#detail-dialog').showModal();}
  requestAnimationFrame(()=>$('#detail-title')?.focus({preventScroll:true}));
}
function closeDetail(){if(!$('#detail-dialog').open||actionPending)return;$('#detail-dialog').close();if(detailReturnFocus?.isConnected)detailReturnFocus.focus({preventScroll:true});detailReturnFocus=null;detailBooking=null;}
async function runDetailAction(action){
  if(actionPending||!detailBooking)return;
  const handler=actionHandler(action),detail=detailBooking.ownerDetail;if(!handler||!detailAllows(detail,action))return;
  const booking=detailBooking,bookingId=detail.bookingId??detail.id??booking.bookingId??booking.key,status=$('#detail-status');
  actionPending=true;if(status)status.textContent=action==='cancel'?'Cancelling reservation...':'Ending reservation early...';$('#detail-body').querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await handler({bookingId,bookingKey:booking.key,action});actionPending=false;closeDetail();retry();}
  catch(error){actionPending=false;if(status)status.textContent=error?.message||'That action could not be completed. Please try again.';$('#detail-body').querySelectorAll('button').forEach(button=>button.disabled=false);}
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
  if(step==='reservedFor'){const label=reservedForLabels[draft.purpose]||'Reserved for';const heading=draft.purpose==='other'?'What is this for?':'Who is this for?';const hint=draft.purpose==='other'?'Add a short purpose for this reservation.':'Add the person this reservation is for.';html=title(heading,hint)+`<form id="name-form"><label class="field-label" for="guest-name">Your name</label><input class="name-field" id="guest-name" name="name" placeholder="Your full name" maxlength="120" autocomplete="name" value="${esc(draft.name||'')}" required><label class="field-label" for="reserved-for">${label}</label><input class="name-field" id="reserved-for" name="reservedFor" placeholder="${reservedForPlaceholders[draft.purpose]||'Add a detail'}" maxlength="120" autocomplete="off" value="${esc(draft.reservedFor||'')}" required><p class="field-note">Only the shared public name and purpose appear on the schedule.</p><p class="inline-error" id="name-error" role="alert"></p><button class="primary" type="submit">Continue</button></form>`;}
  if(step==='start'){
    const starts=reserveStartChoices(draft.date,draft.type,draft.purpose);
    html=title('When would you like to start?','Choose a beginning. Only available times appear below.')+(starts.length?`<div class="time-choices">${starts.map(({time,override})=>`<button type="button" class="time-choice${override?' override':''}" data-start-choice="${time}"${override?` aria-label="${esc(`${fmt(time)}, Priority override`)}"`:''}>${fmt(time)}${override?'<small class="override-indicator">Priority override</small>':''}</button>`).join('')}</div>`:`<p class="hint">${draftReady()?'Every space is reserved. Close this sheet to choose the other day.':'Available times will appear when the connection returns.'}</p>`);
  }
  if(step==='end'){
    const ends=draft.direct?Array.from({length:Math.max(0,(freeUntil(draft.date,draft.type,draft.unit,draft.start)-draft.start)/30)},(_,index)=>({time:draft.start+30*(index+1),override:false})):reserveEndChoices(draft.date,draft.type,draft.start,draft.purpose);
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
  const start=event.target.closest('[data-start-choice]');if(start){draft.start=Number(start.dataset.startChoice);draft.unit=null;draft.end=null;go('end');return;}
  const end=event.target.closest('[data-end-choice]');if(end){
    const requestedEnd=Number(end.dataset.endChoice);
    const choice=draft.direct?(validUnits(draft.date,draft.type,draft.start,requestedEnd).includes(draft.unit)?{unit:draft.unit,override:false}:null):rangeChoice(draft.date,draft.type,draft.start,requestedEnd,draft.purpose);
    if(!choice){renderStep();return;}
    draft.end=requestedEnd;draft.unit=choice.unit;draft.override=choice.override;go('reservedFor');return;
  }
  if(event.target.closest('#confirm-reservation')){
    const choice=draft.direct?(validUnits(draft.date,draft.type,draft.start,draft.end).includes(draft.unit)?{unit:draft.unit,override:false}:null):rangeChoice(draft.date,draft.type,draft.start,draft.end,draft.purpose,draft.unit);
    if(!choice||choice.unit!==draft.unit||choice.override!==Boolean(draft.override)){$('#save-error').textContent='This space is no longer open for the full time. Go back to choose another time.';return;}
    if(!visibleText(draft.name)||!visibleText(draft.reservedFor)){$('#save-error').textContent='Please go back and add your name and the reserved-for detail.';return;}
    pending=true;$('#save-error').textContent='';updateDialogAvailability();
    try{
      const result=await submit({day:draft.date,type:draft.type,unit:draft.override?null:draft.unit,start:draft.start,end:draft.end,name:(draft.name||draft.reservedFor).trim(),reservedFor:draft.reservedFor.trim(),purpose:draft.purpose,purposeOther:draft.purpose==='other'?draft.reservedFor.trim():''});
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
  bookings=(snapshot.bookings||[]).map(normalizeBooking).filter(booking=>types[booking.type]&&Number.isInteger(booking.unit)&&booking.unit>=1&&booking.unit<=types[booking.type].count&&Number.isFinite(booking.start)&&Number.isFinite(booking.end)&&booking.end>booking.start);
  if(!eligible(selectedDate))selectedDate=dates[0]?.key||null;
  renderSchedule();
  if($('#detail-dialog').open&&openDetailKey){const updated=bookings.find(booking=>booking.key===openDetailKey);if(updated)renderDetail(updated);else closeDetail();}
  if(dialog.open&&!pending&&['start','end'].includes(step))renderStep();
  if(previousStatus!==connection.status)$('#announcement').textContent=ready()?(connection.demo?'Demo schedule ready.':'Live schedule connected.'):'Schedule connection is unavailable. Reconnect to reserve.';
});
