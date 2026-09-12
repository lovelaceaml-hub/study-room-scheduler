import { subscribe, submit, retry } from '../shared/live.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icon = (type) => `<svg viewBox="0 0 24 24" aria-hidden="true">${{room:'<path d="M5 21V4l12-2v19M3 21h18M13 11v2"/>',whiteboard:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 8h10M7 12h6"/>',tv:'<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 22h8m-4-4v4"/>'}[type]}</svg>`;
const types = {room:{label:'Study Rooms',one:'Room',count:4,description:''},whiteboard:{label:'Whiteboards',one:'Whiteboard',count:5,description:''},tv:{label:'TVs',one:'TV',count:3,description:''}};
const purposes = {contact:{label:'Contact',description:''},new:{label:'New Member',description:''},other:{label:'Other',description:''}};
const serviceRules = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
const fmt = (minutes) => {const hour=Math.floor(minutes/60);return `${hour%12||12}:${String(minutes%60).padStart(2,'0')} ${hour<12?'AM':'PM'}`;};
const hourLabel = (minutes) => fmt(minutes).replace(':00','');
const range = (start,end) => `${fmt(start)} to ${fmt(end)}`;
const duration = (minutes) => `${Math.floor(minutes/60)?`${Math.floor(minutes/60)} hr`:''}${minutes%60?`${minutes>=60?' ':''}30 min`:''}`;
const visibleText = (value) => String(value).replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF]/g,'').length>0;
const publicName = (name) => {const words=String(name).trim().split(/\s+/);return words.length>1?`${words[0]} ${Array.from(words[words.length-1])[0]}.`:words[0];};

let connection={status:'loading',canBook:false,demo:false,error:''};
let dates=[],bookings=[],selectedDate=null,selectedType='room';
let draft={},step='resource',history=[],lastOpener=null,saved=null,pending=false;
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
const normalizeBooking = (booking) => {
  const blocked=!!booking.blocked||booking.purpose==='blocked'||!purposes[booking.purpose];
  return {key:String(booking.key??''),date:booking.day,type:booking.type,unit:Number(booking.unit),start:Number(booking.start),end:Number(booking.end),name:blocked?'Reserved':String(booking.name||'Reserved'),purpose:blocked?'blocked':booking.purpose,blocked};
};

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
        html+=`<article class="booking ${booking.purpose} ${span===1?'short':''} ${saved&&booking.key===saved.key?'recent-saved':''}" tabindex="-1" style="grid-column:${unit+1};grid-row:${row}/span ${span}" aria-label="${esc(description)}"><span class="booking-name">${esc(booking.blocked?'Reserved':booking.name)}</span>${booking.blocked?'':`<span class="booking-purpose">${purposes[booking.purpose].label}</span>`}</article>`;
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

function title(text,hint){return `<h2 id="step-title" tabindex="-1">${text}</h2><p class="hint">${hint}</p>`;}
function summary(){return `<div class="summary"><h3>${types[draft.type].one} ${draft.unit}</h3><dl><div><dt>Day</dt><dd>${esc(dateLabel(draft.date))}</dd></div><div><dt>Time</dt><dd>${range(draft.start,draft.end)}</dd></div><div><dt>Purpose</dt><dd>${purposes[draft.purpose].label}</dd></div><div><dt>Reserved for</dt><dd>${esc(step==='done'&&saved?saved.name:publicName(draft.name))}</dd></div></dl>${draft.purpose==='other'?`<p class="private-purpose">${esc(draft.purposeOther)}</p>`:''}</div>`;}

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
  const steps=draft.direct?['purpose',...(draft.purpose==='other'?['other']:[]),'end','name','confirm']:['resource','purpose',...(draft.purpose==='other'?['other']:[]),'start','end','name','confirm'];
  $('#step-count').textContent=step==='done'?'Reservation confirmed':`Your reservation · ${Math.max(1,steps.indexOf(step)+1)} of ${steps.length}`;
  const crumbs=[dateLabel(draft.date)];
  if(draft.type)crumbs.push(`${types[draft.type].one}${draft.unit?` ${draft.unit}`:''}`);
  if(draft.start!=null)crumbs.push(fmt(draft.start));
  $('#selection-context').innerHTML=step==='done'?'':crumbs.map(value=>`<span>${esc(value)}</span>`).join('');
  let html='';
  if(step==='resource')html=title('What would you like to reserve?','Select a resource.')+`<div class="choices">${Object.entries(types).map(([key,type])=>`<button class="choice" type="button" data-choose-type="${key}"><span class="choice-icon">${icon(key)}</span><span class="choice-copy"><b>${type.label}</b>${type.description?`<small>${type.description}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`;
  if(step==='purpose')html=title('What is this reservation for?',draft.direct?`Your ${types[draft.type].one.toLowerCase()} and ${fmt(draft.start)} start are selected.`:'Select a purpose.')+`<div class="choices">${Object.entries(purposes).map(([key,purpose])=>`<button type="button" class="choice" data-purpose="${key}"><span class="purpose-dot ${key}" aria-hidden="true"></span><span class="choice-copy"><b>${purpose.label}</b>${purpose.description?`<small>${purpose.description}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`;
  if(step==='other')html=title('Tell us a little more.','A short description helps explain what the reservation is for.')+`<form id="other-form"><label class="field-label" for="other-details">What will you use the space for?</label><textarea class="other-field" id="other-details" name="purposeOther" maxlength="120" placeholder="e.g. Family Bible study" required>${esc(draft.purposeOther||'')}</textarea><p class="field-note">The shared schedule displays only Other.</p><p class="inline-error" id="other-error" role="alert"></p><button type="submit" class="primary">Continue</button></form>`;
  if(step==='start'){
    const starts=[];for(let time=600;time<1380;time+=30)if(allUnits(draft.type).some(unit=>free(draft.date,draft.type,unit,time)))starts.push(time);
    html=title('When would you like to start?','Choose a beginning. Only available times appear below.')+(starts.length?`<div class="time-choices">${starts.map(time=>`<button type="button" class="time-choice" data-start-choice="${time}">${fmt(time)}</button>`).join('')}</div>`:`<p class="hint">${draftReady()?'Every space is reserved. Close this sheet to choose the other day.':'Available times will appear when the connection returns.'}</p>`);
  }
  if(step==='end'){
    const max=draft.direct?freeUntil(draft.date,draft.type,draft.unit,draft.start):Math.max(...allUnits(draft.type).map(unit=>freeUntil(draft.date,draft.type,unit,draft.start)));
    const ends=[];for(let time=draft.start+30;time<=max;time+=30)ends.push(time);
    html=title('When would you like to end?',`Starting at ${fmt(draft.start)}. Each ending fits around reservations and service.`)+(ends.length?`<div class="time-choices">${ends.map(time=>`<button type="button" class="time-choice" data-end-choice="${time}">${fmt(time)}<small>${duration(time-draft.start)}</small></button>`).join('')}</div>`:`<p class="inline-error">${draftReady()?'This opening has changed. Go back and choose another start.':'Available endings will appear when the connection returns.'}</p>`);
  }
  if(step==='name')html=title('Who is this for?',connection.demo?'Use a fictional name to try this practice reservation.':'Add your name so others know who is using the space.')+`<form id="name-form"><label class="field-label" for="guest-name">Your name</label><input class="name-field" id="guest-name" name="name" placeholder="Your full name" maxlength="40" autocomplete="${connection.demo?'off':'name'}" value="${esc(draft.name||'')}" required><p class="field-note">Shown as a first name and last initial on the schedule.</p><p class="inline-error" id="name-error" role="alert"></p><button class="primary" type="submit">Continue</button></form>`;
  if(step==='confirm')html=title('Confirm your reservation.','Review the details before confirming.')+summary()+`<p class="summary-note">${connection.demo?'This practice reservation saves only in this browser tab.':'Your reservation is confirmed after the space is secured.'}</p><p class="inline-error" id="save-error" role="alert"></p><button type="button" class="primary" id="confirm-reservation">Confirm reservation</button>`;
  if(step==='done')html='<div class="done-symbol" aria-hidden="true">✓</div>'+title(connection.demo?'Practice reservation saved.':'Reservation confirmed.','Your reservation is confirmed.')+summary()+`<p class="summary-note">${connection.demo?'Demo confirmation. Saved only in this browser tab.':'Find and manage this booking in My reservations.'}</p><button type="button" class="primary" id="see-reservation">See it on the schedule</button><button type="button" class="text-button" id="another-reservation">Reserve another space</button>`;
  $('#step-body').innerHTML=`<section class="step ${step==='done'?'done':''}">${html}</section>`;
  updateDialogAvailability();
  dialog.scrollTop=0;
  requestAnimationFrame(()=>$('#step-title')?.focus({preventScroll:true}));
}

function go(next){history.push(step);step=next;renderStep();}
function blankDraft(preset){return {date:selectedDate,name:'',purposeOther:'',type:preset?selectedType:null,unit:preset?.unit||null,start:preset?.start??null,end:null,purpose:null,direct:!!preset};}
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
$('#schedule').addEventListener('click',event=>{const button=event.target.closest('.open-slot');if(button)openBooking({unit:Number(button.dataset.unit),start:Number(button.dataset.start)});});
$('#state-message').addEventListener('click',event=>{if(event.target.closest('[data-recover]'))recover();});
$('#reserve').addEventListener('click',()=>openBooking());
$('#close').addEventListener('click',closeBooking);
dialog.addEventListener('cancel',event=>{event.preventDefault();closeBooking();});
$('#back').addEventListener('click',()=>{if(!history.length||pending)return;step=history.pop();if(step==='start'&&!draft.direct){draft.start=null;draft.unit=null;}if(step==='end'){draft.end=null;if(!draft.direct)draft.unit=null;}renderStep();});
dialog.addEventListener('click',event=>{if(event.target.closest('[data-recover]')){recover();return;}if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeBooking();}});
dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>getComputedStyle(el).visibility!=='hidden'&&el.getClientRects().length);
  if(!items.length){event.preventDefault();return;}
  const first=items[0],last=items[items.length-1];
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('#step-title'))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
$('#step-body').addEventListener('input',event=>{if(event.target.id==='guest-name')draft.name=event.target.value;if(event.target.id==='other-details')draft.purposeOther=event.target.value;});
$('#step-body').addEventListener('submit',event=>{
  event.preventDefault();if(pending||!draftReady())return;
  if(event.target.id==='name-form'){
    const value=$('#guest-name').value.trim();if(!visibleText(value)){$('#name-error').textContent='Please add your name.';$('#guest-name').focus();return;}draft.name=value;go('confirm');
  }
  if(event.target.id==='other-form'){
    const value=$('#other-details').value.trim();if(!visibleText(value)){$('#other-error').textContent='Please add a short description.';$('#other-details').focus();return;}draft.purposeOther=value;go(draft.direct?'end':'start');
  }
});
$('#step-body').addEventListener('click',async event=>{
  if(event.target.closest('#see-reservation')){closeBooking();const card=$('.recent-saved');if(card){card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});card.focus({preventScroll:true});}return;}
  if(pending||!draftReady())return;
  const type=event.target.closest('[data-choose-type]');if(type){draft.type=type.dataset.chooseType;go('purpose');return;}
  const purpose=event.target.closest('[data-purpose]');if(purpose){draft.purpose=purpose.dataset.purpose;if(draft.purpose!=='other')draft.purposeOther='';go(draft.purpose==='other'?'other':draft.direct?'end':'start');return;}
  const start=event.target.closest('[data-start-choice]');if(start){draft.start=Number(start.dataset.startChoice);draft.unit=null;draft.end=null;go('end');return;}
  const end=event.target.closest('[data-end-choice]');if(end){
    const requestedEnd=Number(end.dataset.endChoice);const units=validUnits(draft.date,draft.type,draft.start,requestedEnd);
    if((draft.direct&&!units.includes(draft.unit))||!units.length){renderStep();return;}
    draft.end=requestedEnd;if(!draft.direct)draft.unit=units[0];go('name');return;
  }
  if(event.target.closest('#confirm-reservation')){
    if(!validUnits(draft.date,draft.type,draft.start,draft.end).includes(draft.unit)){$('#save-error').textContent='This space is no longer open for the full time. Go back to choose another time.';return;}
    if(draft.purpose==='other'&&!visibleText(draft.purposeOther)){$('#save-error').textContent='Please go back and add a description for Other.';return;}
    pending=true;$('#save-error').textContent='';updateDialogAvailability();
    try{
      const result=await submit({day:draft.date,type:draft.type,unit:draft.unit,start:draft.start,end:draft.end,name:draft.name.trim(),purpose:draft.purpose,purposeOther:draft.purpose==='other'?draft.purposeOther.trim():''});
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
  connection={status:snapshot.status,canBook:!!snapshot.canBook,demo:!!snapshot.demo,error:String(snapshot.error||'')};
  dates=(snapshot.days||[]).map(day=>({key:day.key,label:String(day.label),weekday:Number(day.weekday)}));
  bookings=(snapshot.bookings||[]).map(normalizeBooking).filter(booking=>types[booking.type]&&Number.isInteger(booking.unit)&&booking.unit>=1&&booking.unit<=types[booking.type].count&&Number.isFinite(booking.start)&&Number.isFinite(booking.end)&&booking.end>booking.start);
  if(!eligible(selectedDate))selectedDate=dates[0]?.key||null;
  renderSchedule();
  if(dialog.open&&!pending&&['start','end'].includes(step))renderStep();
  if(previousStatus!==connection.status)$('#announcement').textContent=ready()?(connection.demo?'Demo schedule ready.':'Live schedule connected.'):'Schedule connection is unavailable. Reconnect to reserve.';
});
