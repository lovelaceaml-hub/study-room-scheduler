'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const TYPES = {
  room: {label:'Study Rooms',single:'Study Room',short:'Room',count:4,description:'A quiet place to study together.'},
  whiteboard: {label:'Whiteboards',single:'Whiteboard',short:'Board',count:5,description:'Make room for ideas to take shape.'},
  tv: {label:'TVs',single:'TV',short:'TV',count:3,description:'Share a lesson on a bigger screen.'}
};
const PURPOSES = {contact:'Contact',new:'New Member',other:'Other'};
const purposeDescriptions = {contact:'A study with a contact.',new:'A study with a new member.',other:'Another meaningful gathering.'};
const SERVICE = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
const localToday = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Los_Angeles'}));
localToday.setHours(0,0,0,0);
const days = [2,6].map(weekday => {const date=new Date(localToday);date.setDate(date.getDate()+(weekday-date.getDay()+7)%7);return date;}).sort((a,b)=>a-b);
const keyOf = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dayLabel = date => date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
const time = minutes => `${(Math.floor(minutes/60)+11)%12+1}${minutes%60?':30':':00'} ${minutes<720?'AM':'PM'}`;
const hour = minutes => time(minutes).replace(':00','');
const range = (start,end) => `${time(start)} to ${time(end)}`;
let selectedDay=0, resource='room', bookings=[], savedName='', draft={}, flow=[], flowIndex=0, opener=null, bookingSerial=0;
let viewState=new URLSearchParams(location.search).get('state')||'ready';
if(!['loading','empty','error'].includes(viewState)) viewState='ready';
function fixtures(){
  return days.flatMap(date => {
    const isSaturday=date.getDay()===6, day=keyOf(date);
    const seed=isSaturday?[
      ['room',1,660,780,'Maya T.','contact'],['room',2,690,750,'Eli R.','new'],['room',3,660,720,'Nora L.','other'],['room',4,750,840,'Luca P.','contact'],
      ['room',2,930,1020,'Anna W.','new'],['room',3,990,1110,'Theo C.','contact'],['room',1,1080,1140,'June S.','other'],['room',4,1230,1320,'Owen B.','new'],
      ['whiteboard',1,660,750,'Maya T.','contact'],['whiteboard',3,720,810,'Nora L.','new'],['whiteboard',5,930,1020,'Eli R.','other'],['whiteboard',2,1080,1140,'Luca P.','contact'],
      ['tv',1,690,780,'Theo C.','new'],['tv',2,960,1050,'June S.','other'],['tv',3,1230,1320,'Anna W.','contact']
    ]:[
      ['room',1,600,720,'Nora L.','contact'],['room',2,630,750,'Eli R.','new'],['room',4,720,810,'Maya T.','other'],['room',3,900,1020,'Theo C.','contact'],['room',2,1080,1140,'June S.','new'],['room',1,1230,1320,'Owen B.','other'],
      ['whiteboard',2,660,750,'Anna W.','new'],['whiteboard',4,840,930,'Luca P.','other'],['whiteboard',1,1080,1140,'Nora L.','contact'],
      ['tv',1,630,720,'Eli R.','contact'],['tv',3,900,990,'June S.','new'],['tv',2,1260,1350,'Theo C.','other']
    ];
    return seed.map(([type,unit,start,end,name,purpose],index)=>({id:`sample-${day}-${index}`,day,type,unit,start,end,name,purpose}));
  });
}
bookings=viewState==='empty'?[]:fixtures();
function services(day=selectedDay){return SERVICE[days[day].getDay()];}
function inService(start,day=selectedDay){return services(day).some(([from,to])=>start>=from&&start<to);}
function occupant(type,unit,start,day=selectedDay){return bookings.find(item=>item.day===keyOf(days[day])&&item.type===type&&item.unit===unit&&start>=item.start&&start<item.end);}
function free(type,unit,start,day=selectedDay){return start>=600&&start<1380&&!inService(start,day)&&!occupant(type,unit,start,day);}
function availableEnds(){const ends=[];for(let current=draft.start;current<1380&&free(draft.type,draft.unit,current,draft.day);current+=30)ends.push(current+30);return ends;}
function validDraft(){return draft.name&&/[\p{L}\p{N}]/u.test(draft.name)&&draft.end>draft.start&&availableEnds().includes(draft.end);}
function renderSchedule(){
  const date=days[selectedDay], type=TYPES[resource];
  $('#selected-date').textContent=dayLabel(date);
  $('#date-detail').textContent=`${date.getTime()===localToday.getTime()?'Today':'Upcoming'} · September schedule`.replace('September',date.toLocaleDateString('en-US',{month:'long'}));
  $('#previous-date').disabled=selectedDay===0;$('#next-date').disabled=selectedDay===days.length-1;
  document.querySelectorAll('[data-resource]').forEach(button=>{button.classList.toggle('active',button.dataset.resource===resource);button.setAttribute('aria-pressed',String(button.dataset.resource===resource));});
  const isUnavailable=viewState==='loading'||viewState==='error';
  $('#reserve-now').disabled=isUnavailable;
  const stateCopy={loading:['Opening the day...','The sample schedule is getting ready.','Show schedule'],error:['The day could not be loaded.','This is a simulated error. You can try again.','Try again'],empty:['A little room for something new.','There are no sample reservations on this day.','Restore samples']};
  $('#state-notice').innerHTML=viewState==='ready'?'':`<div class="state-card"><div><p>${stateCopy[viewState][0]}</p><small>${stateCopy[viewState][1]}</small></div><button id="recover-state">${stateCopy[viewState][2]}</button></div>`;
  let headers=`<span class="time-heading">Time</span>`;
  for(let unit=1;unit<=type.count;unit++)headers+=`<div class="unit-heading">${type.short} ${unit}${resource==='whiteboard'?`<small>${unit<=3?'Large':'Vertical'}</small>`:''}</div>`;
  let rail='', rules='';
  for(let at=0;at<=26;at+=2){rail+=`<span class="hour-label" style="--at:${at}">${hour(600+at*30)}</span>`;rules+=`<div class="hour-rule" style="--at:${at}" aria-hidden="true"></div>`;}
  let columns='';
  for(let unit=1;unit<=type.count;unit++){
    let slots='';
    for(let start=600;start<1380;start+=30){
      if(inService(start))continue;
      const at=(start-600)/30, item=occupant(resource,unit,start);
      if(isUnavailable){if(at%3===0)slots+=`<span class="skeleton" style="--at:${at};--length:2" aria-hidden="true"></span>`;continue;}
      if(item){
        if(item.start!==start)continue;
        const length=(item.end-item.start)/30;
        slots+=`<article class="slot reserved ${item.purpose}${item.id===draft.savedId?' new-reservation':''}" data-booking="${esc(item.id)}" style="--at:${at};--length:${length}" aria-label="${esc(`${type.single} ${unit}, ${item.name}, ${PURPOSES[item.purpose]}, ${range(item.start,item.end)}`)}"><span class="person">${esc(item.name)}</span><span class="purpose">${PURPOSES[item.purpose]}</span>${length>=3?`<span class="reservation-time">${range(item.start,item.end)}</span>`:''}</article>`;
      }else slots+=`<button class="slot open-slot" data-unit="${unit}" data-start="${start}" style="--at:${at};--length:1" aria-label="Reserve ${type.single} ${unit} from ${time(start)} on ${dayLabel(date)}"><span class="open-label">Open</span></button>`;
    }
    columns+=`<div class="unit-column">${slots}</div>`;
  }
  const bands=services().map(([start,end,label])=>`<div class="service" style="--at:${(start-600)/30}"><span>${label}</span><small>${range(start,end)}</small></div>`).join('');
  $('#schedule').innerHTML=`<div class="schedule-head" style="--units:${type.count}">${headers}</div><div class="schedule-body${isUnavailable?' loading-schedule':''}" style="--units:${type.count}" ${isUnavailable?'aria-busy="true"':''}>${rules}<div class="time-rail">${rail}</div>${columns}${bands}</div>`;
  $('#schedule').classList.remove('page-turn');void $('#schedule').offsetWidth;$('#schedule').classList.add('page-turn');
}
function begin(preset){
  if(viewState==='loading'||viewState==='error')return;
  opener=document.activeElement;
  draft={day:selectedDay,type:preset?.type||null,unit:preset?.unit||1,start:preset?.start??null,end:null,purpose:null,name:savedName,direct:Boolean(preset)};
  flow=preset?['purpose','end','name','confirm']:['resource','purpose','start','end','name','confirm'];flowIndex=0;
  renderStep();$('#booking-dialog').showModal();focusStep();
}
function focusStep(){requestAnimationFrame(()=>{$('#step-title')?.focus();$('#booking-dialog').scrollTop=0;});}
function next(){flowIndex++;renderStep();focusStep();}
function closeDialog(){if($('#booking-dialog').open)$('#booking-dialog').close();if(opener?.isConnected)opener.focus();else $('#reserve-now').focus();}
function context(){const parts=[dayLabel(days[draft.day])];if(draft.type)parts.push(`${TYPES[draft.type].single}${draft.start!==null?' '+draft.unit:''}`);if(draft.start!==null)parts.push(time(draft.start));return parts.join(' · ');}
function titleBlock(title,hint){return `<p class="flow-context">${esc(context())}</p><h2 id="step-title" tabindex="-1">${title}</h2><p id="step-hint">${hint}</p>`;}
function renderStep(){
  const step=flow[flowIndex];$('#back-step').disabled=flowIndex===0||step==='success';$('#step-counter').textContent=step==='success'?'A moment, reserved':`Reservation · ${flowIndex+1} of ${flow.length}`;
  let html='';
  if(step==='resource')html=titleBlock('What would you like<br>to reserve?','Choose the space or resource for your time together.')+`<div class="choices">${Object.entries(TYPES).map(([key,type])=>`<button class="choice" data-type="${key}"><span><b>${type.single}</b><small>${type.description}</small></span><span class="choice-arrow" aria-hidden="true">&#8594;</span></button>`).join('')}</div>`;
  if(step==='purpose')html=titleBlock('What brings you<br>together?','Choose the purpose of your reservation.')+`<div class="choices">${Object.entries(PURPOSES).map(([key,label])=>`<button class="choice purpose-choice" data-purpose="${key}"><span class="purpose-dot ${key}" aria-hidden="true"></span><span><b>${label}</b><small>${purposeDescriptions[key]}</small></span><span class="choice-arrow" aria-hidden="true">&#8594;</span></button>`).join('')}</div>`;
  if(step==='start'){
    const type=TYPES[draft.type];let options='';for(let unit=1;unit<=type.count;unit++)options+=`<option value="${unit}" ${unit===draft.unit?'selected':''}>${type.single} ${unit}${draft.type==='whiteboard'?` (${unit<=3?'Large':'Vertical'})`:''}</option>`;
    let times='';for(let start=600;start<1380;start+=30)if(free(draft.type,draft.unit,start,draft.day))times+=`<button class="time-choice" data-time-start="${start}">${time(start)}</button>`;
    html=titleBlock('When shall we begin?','Choose your preferred unit, then an available start time.')+`<label class="field-label" for="unit-select">Your ${type.single.toLowerCase()}</label><select class="field" id="unit-select">${options}</select><div class="time-choices">${times||'<p>No open times. Choose another unit.</p>'}</div>`;
  }
  if(step==='end')html=titleBlock('And when will<br>you finish?','These endings fit before the next reservation or service.')+`<div class="time-choices">${availableEnds().map(end=>`<button class="time-choice" data-time-end="${end}">${time(end)}<small>${end-draft.start} minutes together</small></button>`).join('')}</div>`;
  if(step==='name')html=titleBlock('Who is this for?','Use a fictional display name while you try this preview.')+`<form id="name-form"><label class="field-label" for="display-name">Display name</label><input class="field" id="display-name" name="name" autocomplete="off" maxlength="32" value="${esc(draft.name)}" placeholder="For example, Robin A." required><p class="validation" id="name-error" hidden>Please enter a visible name.</p><button class="primary-action" type="submit">Review reservation &#8594;</button></form>`;
  if(step==='confirm')html=titleBlock('Everything in<br>its place.','Review the details before saving your sample reservation.')+`<div class="review-card"><h3>${TYPES[draft.type].single} ${draft.unit}</h3><div class="review-row"><span>Day</span><strong>${dayLabel(days[draft.day])}</strong></div><div class="review-row"><span>Time</span><strong>${range(draft.start,draft.end)}</strong></div><div class="review-row"><span>Purpose</span><strong>${PURPOSES[draft.purpose]}</strong></div><div class="review-row"><span>For</span><strong>${esc(draft.name)}</strong></div></div><p class="validation" id="save-error" hidden>The time is no longer open. Go back and choose another time.</p><button class="primary-action" id="confirm-reservation">Confirm sample reservation</button>`;
  if(step==='success')html=`<div class="success-copy"><div class="success-mark" aria-hidden="true">&#10003;</div>${titleBlock('A moment,<br>made yours.','Your sample reservation is now on the schedule.')}<div class="review-card"><h3>${TYPES[draft.type].single} ${draft.unit}</h3><p>${dayLabel(days[draft.day])}<br>${range(draft.start,draft.end)}<br>${esc(draft.name)} · ${PURPOSES[draft.purpose]}</p></div><button class="primary-action" id="see-reservation">See it on the schedule</button><button class="secondary-action" id="reserve-another">Reserve something else</button></div>`;
  $('#step-content').innerHTML=html;$('#step-content').classList.remove('page-turn');void $('#step-content').offsetWidth;$('#step-content').classList.add('page-turn');
}
$('#previous-date').addEventListener('click',()=>{if(selectedDay>0){selectedDay--;renderSchedule();}});
$('#next-date').addEventListener('click',()=>{if(selectedDay<days.length-1){selectedDay++;renderSchedule();}});
$('.resource-bar').addEventListener('click',event=>{const button=event.target.closest('[data-resource]');if(button){resource=button.dataset.resource;renderSchedule();}});
$('#schedule').addEventListener('click',event=>{const slot=event.target.closest('.open-slot');if(slot)begin({type:resource,unit:Number(slot.dataset.unit),start:Number(slot.dataset.start)});});
$('#reserve-now').addEventListener('click',()=>begin());
$('#close-dialog').addEventListener('click',closeDialog);
$('#booking-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
$('#back-step').addEventListener('click',()=>{if(flowIndex>0){flowIndex--;renderStep();focusStep();}});
$('#state-notice').addEventListener('click',event=>{if(event.target.closest('#recover-state')){if(viewState==='empty')bookings=fixtures();viewState='ready';const url=new URL(location.href);url.searchParams.delete('state');history.replaceState(null,'',url);renderSchedule();}});
$('#step-content').addEventListener('change',event=>{if(event.target.id==='unit-select'){draft.unit=Number(event.target.value);draft.start=null;draft.end=null;renderStep();$('#unit-select').focus();}});
$('#step-content').addEventListener('input',event=>{if(event.target.id==='display-name')draft.name=event.target.value;});
$('#step-content').addEventListener('submit',event=>{
  if(event.target.id!=='name-form')return;event.preventDefault();draft.name=$('#display-name').value.trim();
  if(!/[\p{L}\p{N}]/u.test(draft.name)){$('#name-error').hidden=false;$('#display-name').setAttribute('aria-invalid','true');$('#display-name').focus();return;}next();
});
$('#step-content').addEventListener('click',event=>{
  const type=event.target.closest('[data-type]');if(type){draft.type=type.dataset.type;draft.unit=1;draft.start=null;draft.end=null;next();return;}
  const purpose=event.target.closest('[data-purpose]');if(purpose){draft.purpose=purpose.dataset.purpose;next();return;}
  const start=event.target.closest('[data-time-start]');if(start){draft.start=Number(start.dataset.timeStart);draft.end=null;next();return;}
  const end=event.target.closest('[data-time-end]');if(end){draft.end=Number(end.dataset.timeEnd);next();return;}
  if(event.target.closest('#confirm-reservation')){
    if(!validDraft()){$('#save-error').hidden=false;return;}
    const id=`preview-${++bookingSerial}`;bookings.push({id,day:keyOf(days[draft.day]),type:draft.type,unit:draft.unit,start:draft.start,end:draft.end,name:draft.name,purpose:draft.purpose});draft.savedId=id;savedName=draft.name;selectedDay=draft.day;resource=draft.type;if(viewState==='empty')viewState='ready';renderSchedule();flow=['success'];flowIndex=0;renderStep();focusStep();return;
  }
  if(event.target.closest('#see-reservation')){
    const id=draft.savedId;closeDialog();const reservation=document.querySelector(`[data-booking="${id}"]`);reservation?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});if(reservation){reservation.setAttribute('tabindex','-1');reservation.focus({preventScroll:true});}$('#toast').textContent='Sample reservation added. This page only.';$('#toast').hidden=false;setTimeout(()=>{$('#toast').hidden=true;},4200);return;
  }
  if(event.target.closest('#reserve-another')){closeDialog();begin();}
});
renderSchedule();
