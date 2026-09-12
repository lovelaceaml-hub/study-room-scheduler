import { subscribe, submit, retry } from '../shared/live.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const TYPES = {
  room: {label:'Study Rooms',single:'Study Room',short:'Room',count:4,description:''},
  whiteboard: {label:'Whiteboards',single:'Whiteboard',short:'Board',count:5,description:''},
  tv: {label:'TVs',single:'TV',short:'TV',count:3,description:''}
};
const PURPOSES = {contact:'Contact',new:'New Member',other:'Other'};
const purposeDescriptions = {contact:'',new:'',other:''};
const SERVICE = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
const time = minutes => `${(Math.floor(minutes/60)+11)%12+1}${minutes%60?':30':':00'} ${minutes<720?'AM':'PM'}`;
const hour = minutes => time(minutes).replace(':00','');
const range = (start,end) => `${time(start)} to ${time(end)}`;
const visibleText = value => /[^\s\p{Cf}\p{Cc}]/u.test(String(value || ''));
let days=[], selectedDay=0, resource='room', bookings=[], savedName='', draft={}, flow=[], flowIndex=0, opener=null, saving=false;
let connection={status:'loading',canBook:false,demo:false,error:''};
let toastTimer;

function selectedDate(){return days[selectedDay];}
function dayLabel(key){return days.find(day=>day.key===key)?.label || (draft.day===key?draft.dateLabel:'') || key;}
function canBook(){return connection.canBook && ['live','demo'].includes(connection.status) && days.length>0;}
function canBookDay(key){return canBook() && days.some(day=>day.key===key);}
function services(key=selectedDate()?.key){return SERVICE[days.find(day=>day.key===key)?.weekday] || [];}
function inService(start,key=selectedDate()?.key){return services(key).some(([from,to])=>start>=from&&start<to);}
function occupant(type,unit,start,key=selectedDate()?.key){return bookings.find(item=>item.day===key&&item.type===type&&item.unit===unit&&start>=item.start&&start<item.end);}
function free(type,unit,start,key=selectedDate()?.key){return start>=600&&start<1380&&!inService(start,key)&&!occupant(type,unit,start,key);}
function availableEnds(){const ends=[];for(let current=draft.start;current<1380&&free(draft.type,draft.unit,current,draft.day);current+=30)ends.push(current+30);return ends;}
function validDraft(){return canBookDay(draft.day)&&visibleText(draft.name)&&draft.end>draft.start&&availableEnds().includes(draft.end)&&Boolean(PURPOSES[draft.purpose])&&(draft.purpose!=='other'||visibleText(draft.purposeOther));}
function errorText(error){return typeof error==='string'?error:error?.message||'The reservation could not be saved. Your details are kept. Please try again.';}
function connectionMessage(){
  if(connection.status==='loading')return ['Connecting to the schedule','Booking will open when the connection is ready.'];
  if(connection.status==='offline')return ['You are offline. Booking is paused.','Your reservation details are kept. Reconnect to continue.'];
  if(connection.status==='error')return ['The schedule could not be loaded.',connection.error || 'Please retry the connection to continue.'];
  if(!canBook())return ['Booking is temporarily unavailable.','Please retry the connection to continue.'];
  return null;
}
function renderConnection(){
  const warning=connectionMessage();
  const label=warning?({loading:'Connecting to schedule',offline:'Offline. Booking paused.',error:'Connection unavailable'}[connection.status] || 'Booking unavailable'):(connection.demo?'Fictional demo data':'Live availability');
  $('#connection-label').classList.toggle('connection-warning',Boolean(warning));
  $('#connection-label').innerHTML=`<i aria-hidden="true"></i>${esc(label)}`;
  $('#state-notice').innerHTML=warning?`<div class="state-card"><div><p>${esc(warning[0])}</p><small>${esc(warning[1])}</small></div><button id="recover-state">Retry</button></div>`:connection.demo?'<div class="state-card"><div><p>Demo mode</p><small>Fictional reservations let you try the full experience without booking with LV Zion.</small></div></div>':'';
  let dialogMessage=warning;
  if(!warning&&draft.day&&!days.some(day=>day.key===draft.day)&&flow[flowIndex]!=='success')dialogMessage=['This date is no longer available.','Close this sheet and choose one of the current dates.'];
  $('#dialog-connection').innerHTML=dialogMessage?`<div class="dialog-status"><span>${esc(dialogMessage[0])} ${esc(dialogMessage[1])}</span>${warning?'<button id="dialog-retry">Retry</button>':''}</div>`:'';
  $('.sheet-disclaimer').textContent=connection.demo?'Demo mode. Nothing is booked with LV Zion.':'Your reservation saves only after you confirm.';
  $('.schedule-foot>span:last-child').textContent=connection.demo?'Fictional demo reservations stay in this browser session.':'Reservations are confirmed after saving.';
  $('#reserve-now').disabled=!canBook()||saving;
  updateBookingControls();
}
function renderSchedule(){
  const date=selectedDate(), type=TYPES[resource], bookable=canBook();
  $('#selected-date').textContent=date?.label || 'Choose a day';
  $('#date-detail').textContent=date?'Tuesday and Saturday reservations':'Connecting to available dates';
  $('#previous-date').disabled=selectedDay===0||!date;
  $('#next-date').disabled=selectedDay>=days.length-1;
  document.querySelectorAll('[data-resource]').forEach(button=>{button.classList.toggle('active',button.dataset.resource===resource);button.setAttribute('aria-pressed',String(button.dataset.resource===resource));});
  let headers='<span class="time-heading">Time</span>';
  for(let unit=1;unit<=type.count;unit++)headers+=`<div class="unit-heading">${type.short} ${unit}${resource==='whiteboard'?`<small>${unit<=3?'Large':'Vertical'}</small>`:''}</div>`;
  let rail='', rules='';
  for(let at=0;at<=26;at+=2){rail+=`<span class="hour-label" style="--at:${at}">${hour(600+at*30)}</span>`;rules+=`<div class="hour-rule" style="--at:${at}" aria-hidden="true"></div>`;}
  let columns='';
  for(let unit=1;unit<=type.count;unit++){
    let slots='', start=600;
    while(start<1380){
      if(inService(start)){start+=30;continue;}
      const at=(start-600)/30, item=occupant(resource,unit,start);
      if(item){
        let end=start+30;
        while(end<1380&&!inService(end)&&occupant(resource,unit,end)?.key===item.key)end+=30;
        const length=(end-start)/30, blocked=item.blocked||item.purpose==='blocked';
        const purpose=PURPOSES[item.purpose] || 'Other';
        slots+=`<article class="slot reserved ${blocked?'blocked':esc(item.purpose)}${item.key===draft.saved?.key?' new-reservation':''}" data-booking="${esc(item.key)}" style="--at:${at};--length:${length}" aria-label="${esc(blocked?`${type.single} ${unit}, Reserved`:`${type.single} ${unit}, ${item.name}, ${purpose}, ${range(start,end)}`)}"><span class="person">${blocked?'Reserved':esc(item.name)}</span>${blocked?'':`<span class="purpose">${purpose}</span>${length>=3?`<span class="reservation-time">${range(start,end)}</span>`:''}`}</article>`;
        start=end;continue;
      }
      if(connection.status==='loading'){
        if(at%3===0)slots+=`<span class="skeleton" style="--at:${at};--length:${Math.min(2,26-at)}" aria-hidden="true"></span>`;
      }else if(bookable&&date){
        slots+=`<button class="slot open-slot" data-unit="${unit}" data-start="${start}" style="--at:${at};--length:1" aria-label="Reserve ${type.single} ${unit} from ${time(start)} on ${esc(date.label)}"><span class="open-label">Open</span></button>`;
      }else slots+=`<span class="slot unavailable-slot" style="--at:${at};--length:1">Unavailable</span>`;
      start+=30;
    }
    columns+=`<div class="unit-column">${slots}</div>`;
  }
  const bands=services().map(([start,end,label])=>`<div class="service" style="--at:${(start-600)/30}"><span>${label}</span><small>${range(start,end)}</small></div>`).join('');
  $('#schedule').innerHTML=`<div class="schedule-head" style="--units:${type.count}">${headers}</div><div class="schedule-body${connection.status==='loading'?' loading-schedule':''}" style="--units:${type.count}" ${connection.status==='loading'?'aria-busy="true"':''}>${rules}<div class="time-rail">${rail}</div>${columns}${bands}</div>`;
  renderConnection();
}
function animateSchedule(){const schedule=$('#schedule');schedule.classList.remove('page-turn');void schedule.offsetWidth;schedule.classList.add('page-turn');}
function begin(preset){
  if(!canBook()||saving)return;
  opener=document.activeElement;
  draft={day:selectedDate().key,dateLabel:selectedDate().label,type:preset?.type||null,unit:preset?.unit||1,start:preset?.start??null,end:null,purpose:null,purposeOther:'',name:savedName,direct:Boolean(preset),submitError:''};
  flow=preset?['purpose','end','name','confirm']:['resource','purpose','start','end','name','confirm'];flowIndex=0;
  renderStep();$('#booking-dialog').showModal();focusStep();
}
function focusStep(){requestAnimationFrame(()=>{$('#step-title')?.focus();$('#booking-dialog').scrollTop=0;});}
function next(){flowIndex++;renderStep();focusStep();}
function closeDialog(){if(saving)return;if($('#booking-dialog').open)$('#booking-dialog').close();if(opener?.isConnected)opener.focus();else $('#reserve-now').focus();}
function context(){const parts=[dayLabel(draft.day)];if(draft.type)parts.push(`${TYPES[draft.type].single}${draft.start!==null?' '+draft.unit:''}`);if(draft.start!==null)parts.push(time(draft.start));return parts.join(' · ');}
function titleBlock(title,hint){return `<p class="flow-context">${esc(context())}</p><h2 id="step-title" tabindex="-1">${title}</h2><p id="step-hint">${hint}</p>`;}
function updateBookingControls(){
  const blocked=saving||!canBookDay(draft.day);
  document.querySelectorAll('#step-content [data-booking-action]').forEach(button=>{button.disabled=blocked;});
  if($('#purpose-next'))$('#purpose-next').disabled=blocked||!visibleText(draft.purposeOther);
  if($('#unit-select'))$('#unit-select').disabled=blocked;
  $('#close-dialog').disabled=saving;
  $('#back-step').disabled=saving||flowIndex===0||flow[flowIndex]==='success';
  const confirm=$('#confirm-reservation');
  if(confirm)confirm.textContent=saving?'Saving your reservation...':connection.demo?'Confirm demo reservation':'Confirm reservation';
  if($('#submit-status'))$('#submit-status').textContent=saving?'Please wait while your reservation is saved.':'';
  if($('#reserve-another'))$('#reserve-another').disabled=!canBook()||saving;
}
function reviewCard(saved=false){
  const item=saved?draft.saved:draft, label=PURPOSES[item.purpose] || 'Other';
  return `<div class="review-card"><h3>${TYPES[item.type].single} ${item.unit}</h3><div class="review-row"><span>Day</span><strong>${esc(dayLabel(item.day))}</strong></div><div class="review-row"><span>Time</span><strong>${range(item.start,item.end)}</strong></div><div class="review-row"><span>Purpose</span><strong>${label}</strong></div>${!saved&&item.purpose==='other'?`<div class="review-row"><span>Details</span><strong>${esc(item.purposeOther)}</strong></div>`:''}<div class="review-row"><span>For</span><strong>${esc(item.name)}</strong></div></div>`;
}
function renderStep(){
  const step=flow[flowIndex];$('#step-counter').textContent=step==='success'?'Reservation confirmed':`Reservation · ${flowIndex+1} of ${flow.length}`;
  let html='';
  if(step==='resource')html=titleBlock('What would you like<br>to reserve?','Select a resource.')+`<div class="choices">${Object.entries(TYPES).map(([key,type])=>`<button class="choice" data-type="${key}" data-booking-action><span><b>${type.single}</b>${type.description?`<small>${type.description}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">&#8594;</span></button>`).join('')}</div>`;
  if(step==='purpose')html=titleBlock('What is this<br>reservation for?','Select a purpose.')+`<div class="choices">${Object.entries(PURPOSES).map(([key,label])=>`<button class="choice purpose-choice${draft.purpose===key?' selected':''}" data-purpose="${key}" data-booking-action><span class="purpose-dot ${key}" aria-hidden="true"></span><span><b>${label}</b>${purposeDescriptions[key]?`<small>${purposeDescriptions[key]}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">&#8594;</span></button>`).join('')}</div>${draft.purpose==='other'?`<form class="purpose-details" id="purpose-form"><label class="field-label" for="purpose-other">What is the reservation for?</label><input class="field" id="purpose-other" name="purposeOther" maxlength="200" autocomplete="off" value="${esc(draft.purposeOther)}" placeholder="For example, Bible study preparation" required><button class="primary-action" id="purpose-next" type="submit" data-booking-action>Continue &#8594;</button></form>`:''}`;
  if(step==='start'){
    const type=TYPES[draft.type];let options='';for(let unit=1;unit<=type.count;unit++)options+=`<option value="${unit}" ${unit===draft.unit?'selected':''}>${type.single} ${unit}${draft.type==='whiteboard'?` (${unit<=3?'Large':'Vertical'})`:''}</option>`;
    let times='';for(let start=600;start<1380;start+=30)if(free(draft.type,draft.unit,start,draft.day))times+=`<button class="time-choice" data-time-start="${start}" data-booking-action>${time(start)}</button>`;
    html=titleBlock('When shall we begin?','Choose your preferred unit, then an available start time.')+`<label class="field-label" for="unit-select">Your ${type.single.toLowerCase()}</label><select class="field" id="unit-select">${options}</select><div class="time-choices">${times||'<p>No open times. Choose another unit.</p>'}</div>`;
  }
  if(step==='end'){
    const ends=availableEnds();
    html=titleBlock('And when will<br>you finish?',ends.length?'These endings fit before the next reservation or service.':'This start is no longer open. Go back to choose another time.')+`<div class="time-choices">${ends.map(end=>`<button class="time-choice" data-time-end="${end}" data-booking-action>${time(end)}<small>${end-draft.start} minutes together</small></button>`).join('')}</div>`;
  }
  if(step==='name')html=titleBlock('Who is this for?',connection.demo?'Use a fictional name while you try this demo.':'Enter your name so your reservation can be recognized.')+`<form id="name-form"><label class="field-label" for="display-name">Your full name</label><input class="field" id="display-name" name="name" autocomplete="${connection.demo?'off':'name'}" maxlength="80" value="${esc(draft.name)}" placeholder="Your full name" required><p class="validation" id="name-error" hidden>Please enter a visible name.</p><button class="primary-action" type="submit" data-booking-action>Review reservation &#8594;</button></form>`;
  if(step==='confirm')html=titleBlock('Review your<br>reservation.',connection.demo?'Review the details before saving your demo reservation.':'Review the details before confirming your reservation.')+reviewCard()+`<p class="validation" id="save-error" role="alert" ${draft.submitError?'':'hidden'}>${esc(draft.submitError)}</p><button class="primary-action" id="confirm-reservation" data-booking-action>Confirm reservation</button><p class="submit-status" id="submit-status" role="status"></p>`;
  if(step==='success')html=`<div class="success-copy"><div class="success-mark" aria-hidden="true">&#10003;</div>${titleBlock('Reservation<br>confirmed.',connection.demo?'Your demo reservation is now on the schedule.':'Your reservation is confirmed and on the schedule.')}${reviewCard(true)}<button class="primary-action" id="see-reservation">See it on the schedule</button><button class="secondary-action" id="reserve-another">Reserve something else</button></div>`;
  $('#step-content').innerHTML=html;$('#step-content').classList.remove('page-turn');void $('#step-content').offsetWidth;$('#step-content').classList.add('page-turn');renderConnection();
}
async function saveReservation(){
  if(saving)return;
  draft.submitError='';
  if(!validDraft()){
    draft.submitError=!canBookDay(draft.day)?'Booking is unavailable. Your details are kept. Check the connection or choose a current date.':'That exact unit or time is no longer available, or a required detail is missing. Go back to update your reservation.';
    $('#save-error').textContent=draft.submitError;$('#save-error').hidden=false;return;
  }
  saving=true;$('#save-error').hidden=true;updateBookingControls();$('#reserve-now').disabled=true;
  try{
    const saved=await submit({day:draft.day,type:draft.type,unit:draft.unit,start:draft.start,end:draft.end,name:draft.name.trim(),purpose:draft.purpose,purposeOther:draft.purpose==='other'?draft.purposeOther.trim():''});
    draft.saved=saved;savedName=draft.name;resource=saved.type;const index=days.findIndex(day=>day.key===saved.day);if(index>=0)selectedDay=index;
    bookings=[...bookings.filter(item=>item.key!==saved.key),saved];
    flow=['success'];flowIndex=0;saving=false;renderSchedule();renderStep();focusStep();
  }catch(error){
    draft.submitError=errorText(error);$('#save-error').textContent=draft.submitError;$('#save-error').hidden=false;
  }finally{saving=false;renderConnection();}
}
function reconnect(){try{retry();}catch(error){connection={...connection,status:'error',canBook:false,error:errorText(error)};renderSchedule();}}
$('#previous-date').addEventListener('click',()=>{if(selectedDay>0){selectedDay--;renderSchedule();animateSchedule();}});
$('#next-date').addEventListener('click',()=>{if(selectedDay<days.length-1){selectedDay++;renderSchedule();animateSchedule();}});
$('.resource-bar').addEventListener('click',event=>{const button=event.target.closest('[data-resource]');if(button){resource=button.dataset.resource;renderSchedule();animateSchedule();}});
$('#schedule').addEventListener('click',event=>{const slot=event.target.closest('.open-slot');if(slot&&canBook()&&free(resource,Number(slot.dataset.unit),Number(slot.dataset.start)))begin({type:resource,unit:Number(slot.dataset.unit),start:Number(slot.dataset.start)});});
$('#reserve-now').addEventListener('click',()=>begin());
$('#close-dialog').addEventListener('click',closeDialog);
$('#booking-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
$('#back-step').addEventListener('click',()=>{if(flowIndex>0&&!saving){flowIndex--;renderStep();focusStep();}});
$('#state-notice').addEventListener('click',event=>{if(event.target.closest('#recover-state'))reconnect();});
$('#dialog-connection').addEventListener('click',event=>{if(event.target.closest('#dialog-retry'))reconnect();});
$('#step-content').addEventListener('change',event=>{if(event.target.id==='unit-select'){draft.unit=Number(event.target.value);draft.start=null;draft.end=null;renderStep();$('#unit-select').focus();}});
$('#step-content').addEventListener('input',event=>{
  if(event.target.id==='display-name')draft.name=event.target.value;
  if(event.target.id==='purpose-other'){draft.purposeOther=event.target.value;updateBookingControls();}
});
$('#step-content').addEventListener('submit',event=>{
  if(event.target.id!=='name-form'&&event.target.id!=='purpose-form')return;event.preventDefault();if(!canBookDay(draft.day)||saving)return;
  if(event.target.id==='purpose-form'){draft.purposeOther=$('#purpose-other').value.trim();if(visibleText(draft.purposeOther))next();return;}
  draft.name=$('#display-name').value.trim();
  if(!visibleText(draft.name)){$('#name-error').hidden=false;$('#display-name').setAttribute('aria-invalid','true');$('#display-name').focus();return;}next();
});
$('#step-content').addEventListener('click',event=>{
  if(event.target.closest('#see-reservation')){
    const key=draft.saved.key;closeDialog();const reservation=[...document.querySelectorAll('[data-booking]')].find(element=>element.dataset.booking===key);
    reservation?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    if(reservation){reservation.setAttribute('tabindex','-1');reservation.focus({preventScroll:true});}
    $('#toast').textContent=connection.demo?'Demo reservation added. This browser session only.':'Reservation confirmed.';$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4200);return;
  }
  if(event.target.closest('#reserve-another')){closeDialog();begin();return;}
  if(!canBookDay(draft.day)||saving)return;
  const type=event.target.closest('[data-type]');if(type){draft.type=type.dataset.type;draft.unit=1;draft.start=null;draft.end=null;next();return;}
  const purpose=event.target.closest('[data-purpose]');if(purpose){draft.purpose=purpose.dataset.purpose;if(draft.purpose==='other'){renderStep();$('#purpose-other').focus();}else{draft.purposeOther='';next();}return;}
  const start=event.target.closest('[data-time-start]');if(start){const value=Number(start.dataset.timeStart);if(!free(draft.type,draft.unit,value,draft.day)){renderStep();return;}draft.start=value;draft.end=null;next();return;}
  const end=event.target.closest('[data-time-end]');if(end){const value=Number(end.dataset.timeEnd);if(!availableEnds().includes(value)){renderStep();return;}draft.end=value;next();return;}
  if(event.target.closest('#confirm-reservation'))saveReservation();
});

renderSchedule();
subscribe(snapshot=>{
  const chosenKey=selectedDate()?.key;
  connection={status:snapshot.status,canBook:Boolean(snapshot.canBook),demo:Boolean(snapshot.demo),error:snapshot.error || ''};
  days=Array.isArray(snapshot.days)?snapshot.days:[];
  const index=days.findIndex(day=>day.key===chosenKey);selectedDay=index>=0?index:0;
  bookings=Array.isArray(snapshot.bookings)?snapshot.bookings:[];
  renderSchedule();
});
