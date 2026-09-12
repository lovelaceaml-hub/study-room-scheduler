import * as live from '../shared/live.js';
import { overrideUnitForRange } from '../shared/model.js';

const { subscribe, submit, retry } = live;

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const TYPES = {
  room: {label:'Study Rooms',single:'Study Room',short:'Room',count:4,description:''},
  whiteboard: {label:'Whiteboards',single:'Whiteboard',short:'Board',count:5,description:''},
  tv: {label:'TVs',single:'TV',short:'TV',count:3,description:''}
};
const PURPOSES = {contact:'Contact',new:'New Member',other:'Other'};
const RESERVED_FOR_LABELS = {contact:'Contact Name',new:'Member Name',other:'Purpose'};
const RESERVED_FOR_PLACEHOLDERS = {contact:'e.g. Kiana Davis',new:'e.g. Kiana Davis',other:'e.g. Family Bible study'};
const purposeDescriptions = {contact:'',new:'',other:''};
const SERVICE = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
const time = minutes => `${(Math.floor(minutes/60)+11)%12+1}${minutes%60?':30':':00'} ${minutes<720?'AM':'PM'}`;
const hour = minutes => time(minutes).replace(':00','');
const range = (start,end) => `${time(start)} to ${time(end)}`;
const visibleText = value => /[^\s\p{Cf}\p{Cc}]/u.test(String(value || ''));
let days=[], selectedDay=0, resource='room', bookings=[], savedName='', draft={}, flow=[], flowIndex=0, opener=null, saving=false, detailBooking=null, detailReturnFocus=null, actionPending=false;
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
function freeRange(type,unit,start,end,key=draft.day){
  for(let current=start;current<end;current+=30)if(!free(type,unit,current,key))return false;
  return true;
}
function rangeOptions(start=draft.start){
  if(!draft.type||!draft.day||!Number.isInteger(start))return [];
  const options=[];
  for(let end=start+30;end<=1380;end+=30){
    if(inService(end-30,draft.day))break;
    const normal=freeRange(draft.type,draft.unit,start,end,draft.day);
    const override=!normal?overrideUnitForRange(draft.type,draft.day,start,end,draft.purpose,bookings,draft.unit):null;
    if(normal||override)options.push({end,override:Boolean(override)});
  }
  return options;
}
function startOptions(){
  const starts=[];
  for(let start=600;start<1380;start+=30){
    const options=rangeOptions(start);
    if(options.length)starts.push({start,override:!free(draft.type,draft.unit,start,draft.day)&&options.some(option=>option.override)});
  }
  return starts;
}
function selectedRange(){return rangeOptions().find(option=>option.end===draft.end);}
function validDraft(){return canBookDay(draft.day)&&visibleText(draft.name)&&visibleText(draft.reservedFor)&&draft.end>draft.start&&Boolean(selectedRange())&&Boolean(PURPOSES[draft.purpose]);}
function errorText(error){return typeof error==='string'?error:error?.message||'The reservation could not be saved. Your details are kept. Please try again.';}
function publicProjection(item){const projected=item?.publicName??item?.displayName??item?.name;const text=String(projected??'').trim();return text||'Reserved';}
function authorizedOwnerDetail(item){const detail=item?.ownerDetail??item?.ownerDetails??item?.detail;if(!detail||typeof detail!=='object'||Array.isArray(detail))return null;return detail.authorized===true||detail.ownerAuthorized===true||detail.authorizedForMember===true?detail:null;}
function detailAllows(detail,action){return Boolean(detail&&(detail[action]===true||detail.permissions?.[action]===true||detail.actions?.[action]===true));}
function actionHandler(action){const names=action==='cancel'?['cancelOwnedBooking','cancelBooking','memberCancelBooking','cancel']:['endOwnedBookingEarly','endBookingEarly','memberEndBookingEarly','endEarly'];return names.map(name=>live[name]).find(handler=>typeof handler==='function')||null;}
function reservedForValue(detail,booking){if(!detail)return '';const value=booking?.purpose==='other'?detail.purposeOther??detail.purpose_other??detail.reservedFor??detail.reserved_for:detail.reservedFor??detail.reserved_for??detail.name;return String(value??'').trim();}
function normalizeBooking(item){const purpose=item?.purpose==='new-member'?'new':item?.purpose;const blocked=Boolean(item?.blocked)||purpose==='blocked'||!PURPOSES[purpose];const projected=publicProjection(item);return {...item,key:String(item?.key??item?.bookingId??item?.id??''),bookingId:item?.bookingId??item?.id??item?.key,day:item?.day??item?.date,date:item?.day??item?.date,name:blocked?'Reserved':projected,publicName:blocked?'':projected,purpose:blocked?'blocked':purpose,reservedFor:typeof item?.reservedFor==='string'?item.reservedFor:'',blocked,ownerDetail:authorizedOwnerDetail(item)};}
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
        slots+=`<button type="button" class="slot reserved ${blocked?'blocked':esc(item.purpose)}${item.key===draft.saved?.key?' new-reservation':''}" data-booking="${esc(item.key)}" style="--at:${at};--length:${length}" aria-label="${esc(blocked?`${type.single} ${unit}, Reserved`:`${type.single} ${unit}, ${item.name}, ${purpose}, ${range(start,end)}`)}"><span class="person">${blocked?'Reserved':esc(item.name)}</span>${blocked?'':`<span class="purpose">${purpose}</span>${length>=3?`<span class="reservation-time">${range(start,end)}</span>`:''}`}</button>`;
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
function detailActionMarkup(action,label){return detailAllows(detailBooking?.ownerDetail,action)?`<a class="primary-action detail-action" href="/?classic=1&amp;tab=mine">${label}</a>`:'';}
function renderDetail(booking,open=false){
  if(!booking)return;
  detailBooking=booking;
  const detail=booking.ownerDetail,purpose=booking.blocked?'':PURPOSES[booking.purpose]||'Other';
  const privateValue=reservedForValue(detail,booking)||booking.reservedFor||'',privateLabel=RESERVED_FOR_LABELS[booking.purpose]||'Reserved for';
  const actionMarkup=`${detailActionMarkup('endEarly','End early')}${detailActionMarkup('cancel','Cancel')}`;
  const ownerName=detail?.name||detail?.displayName||booking.publicName||'';
  const rows=`<div class="review-row"><span>Day</span><strong>${esc(dayLabel(booking.day))}</strong></div><div class="review-row"><span>Reservation</span><strong>${range(booking.start,booking.end)}</strong></div><div class="review-row"><span>Public name</span><strong>${esc(booking.blocked?'Reserved':booking.publicName||booking.name)}</strong></div>${purpose?`<div class="review-row"><span>Purpose</span><strong>${esc(purpose)}</strong></div>`:''}${ownerName?`<div class="review-row detail-private"><span>Reserved</span><strong>${esc(ownerName)}</strong></div>`:''}`;
  $('#detail-body').innerHTML=`<div class="flow-context">${esc(TYPES[booking.type]?.single||'Reservation')} ${booking.unit}</div><h2 id="detail-title" tabindex="-1">Reservation details</h2><div class="detail-card">${rows}${privateValue?`<div class="review-row detail-private"><span>${esc(privateLabel)}</span><strong>${esc(privateValue)}</strong></div>`:''}</div>${actionMarkup?`<div class="detail-actions">${actionMarkup}</div>`:''}<p id="detail-status" class="validation" role="alert"></p>`;
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
function animateSchedule(){const schedule=$('#schedule');schedule.classList.remove('page-turn');void schedule.offsetWidth;schedule.classList.add('page-turn');}
function begin(preset){
  if(!canBook()||saving)return;
  opener=document.activeElement;
  draft={day:selectedDate().key,dateLabel:selectedDate().label,type:preset?.type||null,unit:preset?.unit||1,start:preset?.start??null,end:null,purpose:null,purposeOther:'',reservedFor:'',name:savedName||localStorage.getItem('srs-name')||'',direct:Boolean(preset),submitError:''};
  flow=preset?['purpose','end','reservedFor','confirm']:['resource','purpose','start','end','reservedFor','confirm'];flowIndex=0;
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
  const item=saved?draft.saved:draft, label=PURPOSES[item.purpose] || 'Other', reservedForLabel=RESERVED_FOR_LABELS[item.purpose]||'Reserved for';
  const override=saved?Boolean(item.override):Boolean(selectedRange()?.override);
  return `<div class="review-card"><h3>${TYPES[item.type].single} ${item.unit}</h3><div class="review-row"><span>Day</span><strong>${esc(dayLabel(item.day))}</strong></div><div class="review-row"><span>Time</span><strong>${range(item.start,item.end)}</strong></div><div class="review-row"><span>Name</span><strong>${esc(item.name||'')}</strong></div><div class="review-row"><span>Purpose</span><strong>${label}</strong></div>${override?'<div class="review-row"><span>Status</span><strong class="override-status">Priority override</strong></div>':''}<div class="review-row"><span>${reservedForLabel}</span><strong>${esc(saved?draft.saved: item.reservedFor||'')}</strong></div></div>`;
}
function renderStep(){
  const step=flow[flowIndex];$('#step-counter').textContent=step==='success'?'Reservation confirmed':`Reservation · ${flowIndex+1} of ${flow.length}`;
  let html='';
  if(step==='resource')html=titleBlock('What would you like<br>to reserve?','Select a resource.')+`<div class="choices">${Object.entries(TYPES).map(([key,type])=>`<button class="choice" data-type="${key}" data-booking-action><span><b>${type.single}</b>${type.description?`<small>${type.description}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">&#8594;</span></button>`).join('')}</div>`;
  if(step==='purpose')html=titleBlock('What is this<br>reservation for?','Select a purpose.')+`<div class="choices">${Object.entries(PURPOSES).map(([key,label])=>`<button class="choice purpose-choice${draft.purpose===key?' selected':''}" data-purpose="${key}" data-booking-action><span class="purpose-dot ${key}" aria-hidden="true"></span><span><b>${label}</b>${purposeDescriptions[key]?`<small>${purposeDescriptions[key]}</small>`:''}</span><span class="choice-arrow" aria-hidden="true">&#8594;</span></button>`).join('')}</div>`;
  if(step==='start'){
    const type=TYPES[draft.type];let options='';for(let unit=1;unit<=type.count;unit++)options+=`<option value="${unit}" ${unit===draft.unit?'selected':''}>${type.single} ${unit}${draft.type==='whiteboard'?` (${unit<=3?'Large':'Vertical'})`:''}</option>`;
    const starts=startOptions();let times=starts.map(({start,override})=>override?`<button class="time-choice override-choice" data-time-start="${start}" data-booking-action aria-label="Start at ${esc(time(start))}. Priority override available.">${time(start)}<span class="override-indicator">Priority override</span></button>`:`<button class="time-choice" data-time-start="${start}" data-booking-action>${time(start)}</button>`).join('');
    html=titleBlock('When shall we begin?','Choose your preferred unit, then an available start time.')+`<label class="field-label" for="unit-select">Your ${type.single.toLowerCase()}</label><select class="field" id="unit-select">${options}</select><div class="time-choices">${times||'<p>No open times. Choose another unit.</p>'}</div>`;
  }
  if(step==='end'){
    const ends=rangeOptions();
    html=titleBlock('And when will<br>you finish?',ends.length?'These endings fit before the next reservation or service.':'This start is no longer open. Go back to choose another time.')+`<div class="time-choices">${ends.map(({end,override})=>override?`<button class="time-choice override-choice" data-time-end="${end}" data-booking-action aria-label="End at ${esc(time(end))}. Priority override required. ${end-draft.start} minutes together">${time(end)}<span class="override-indicator">Priority override</span></button>`:`<button class="time-choice" data-time-end="${end}" data-booking-action>${time(end)}<small>${end-draft.start} minutes together</small></button>`).join('')}</div>`;
  }
  if(step==='reservedFor'){const label=RESERVED_FOR_LABELS[draft.purpose]||'Reserved for';const heading=draft.purpose==='other'?'What is this for?':'Who is this for?';const hint=draft.purpose==='other'?'Add a short purpose for this reservation.':'Add the person this reservation is for.';html=titleBlock(heading,hint)+`<form id="name-form"><label class="field-label" for="display-name">Your name</label><input class="field" id="display-name" name="name" autocomplete="name" maxlength="120" value="${esc(draft.name||'')}" placeholder="Your full name" required><label class="field-label" for="reserved-for">${label}</label><input class="field" id="reserved-for" name="reservedFor" autocomplete="off" maxlength="120" value="${esc(draft.reservedFor||'')}" placeholder="${RESERVED_FOR_PLACEHOLDERS[draft.purpose]||'Add a detail'}" required><p class="validation" id="name-error" hidden>Please enter both your name and the reservation detail.</p><button class="primary-action" type="submit" data-booking-action>Review reservation &#8594;</button></form>`;}
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
    const saved=await submit({day:draft.day,type:draft.type,unit:draft.unit,start:draft.start,end:draft.end,name:(draft.name||draft.reservedFor).trim(),reservedFor:draft.reservedFor.trim(),purpose:draft.purpose,purposeOther:draft.purpose==='other'?draft.reservedFor.trim():''});
    const booking=normalizeBooking(saved);draft.saved=booking;savedName=draft.name;resource=booking.type;const index=days.findIndex(day=>day.key===booking.day);if(index>=0)selectedDay=index;
    bookings=[...bookings.filter(item=>item.key!==booking.key),booking];
    flow=['success'];flowIndex=0;saving=false;renderSchedule();renderStep();focusStep();
  }catch(error){
    draft.submitError=errorText(error);$('#save-error').textContent=draft.submitError;$('#save-error').hidden=false;
  }finally{saving=false;renderConnection();}
}
function reconnect(){try{retry();}catch(error){connection={...connection,status:'error',canBook:false,error:errorText(error)};renderSchedule();}}
$('#previous-date').addEventListener('click',()=>{if(selectedDay>0){selectedDay--;renderSchedule();animateSchedule();}});
$('#next-date').addEventListener('click',()=>{if(selectedDay<days.length-1){selectedDay++;renderSchedule();animateSchedule();}});
$('.resource-bar').addEventListener('click',event=>{const button=event.target.closest('[data-resource]');if(button){resource=button.dataset.resource;renderSchedule();animateSchedule();}});
$('#schedule').addEventListener('click',event=>{const bookingButton=event.target.closest('[data-booking]');if(bookingButton){const booking=bookings.find(item=>item.key===bookingButton.dataset.booking);if(booking)renderDetail(booking,true);return;}const slot=event.target.closest('.open-slot');if(slot&&canBook()&&free(resource,Number(slot.dataset.unit),Number(slot.dataset.start)))begin({type:resource,unit:Number(slot.dataset.unit),start:Number(slot.dataset.start)});});
$('#reserve-now').addEventListener('click',()=>begin());
$('#close-dialog').addEventListener('click',closeDialog);
$('#booking-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
$('#detail-close').addEventListener('click',closeDetail);
$('#detail-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
$('#detail-dialog').addEventListener('click',event=>{if(event.target!==$('#detail-dialog'))return;const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDetail();});
$('#detail-body').addEventListener('click',event=>{const action=event.target.closest('[data-detail-action]')?.dataset.detailAction;if(action)runDetailAction(action);});
$('#back-step').addEventListener('click',()=>{if(flowIndex>0&&!saving){flowIndex--;renderStep();focusStep();}});
$('#state-notice').addEventListener('click',event=>{if(event.target.closest('#recover-state'))reconnect();});
$('#dialog-connection').addEventListener('click',event=>{if(event.target.closest('#dialog-retry'))reconnect();});
$('#step-content').addEventListener('change',event=>{if(event.target.id==='unit-select'){draft.unit=Number(event.target.value);draft.start=null;draft.end=null;renderStep();$('#unit-select').focus();}});
$('#step-content').addEventListener('input',event=>{
  if(event.target.id==='display-name')draft.name=event.target.value;
  if(event.target.id==='reserved-for'){draft.reservedFor=event.target.value;draft.purposeOther=draft.purpose==='other'?event.target.value:'';}
});
$('#step-content').addEventListener('submit',event=>{
  if(event.target.id!=='name-form')return;event.preventDefault();if(!canBookDay(draft.day)||saving)return;
  draft.name=$('#display-name').value.trim();draft.reservedFor=$('#reserved-for').value.trim();draft.purposeOther=draft.purpose==='other'?draft.reservedFor:'';
  if(!visibleText(draft.name)||!visibleText(draft.reservedFor)){$('#name-error').hidden=false;(!visibleText(draft.name)?$('#display-name'):$('#reserved-for')).focus();return;}next();
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
  const purpose=event.target.closest('[data-purpose]');if(purpose){draft.purpose=purpose.dataset.purpose;draft.purposeOther='';next();return;}
  const start=event.target.closest('[data-time-start]');if(start){const value=Number(start.dataset.timeStart);if(!startOptions().some(option=>option.start===value)){renderStep();return;}draft.start=value;draft.end=null;next();return;}
  const end=event.target.closest('[data-time-end]');if(end){const value=Number(end.dataset.timeEnd),option=rangeOptions().find(item=>item.end===value);if(!option){renderStep();return;}draft.end=value;draft.override=option.override;next();return;}
  if(event.target.closest('#confirm-reservation'))saveReservation();
});

renderSchedule();
subscribe(snapshot=>{
  const chosenKey=selectedDate()?.key;
  const openDetailKey=detailBooking?.key;
  connection={status:snapshot.status,canBook:Boolean(snapshot.canBook),demo:Boolean(snapshot.demo),error:snapshot.error || ''};
  days=Array.isArray(snapshot.days)?snapshot.days:[];
  const index=days.findIndex(day=>day.key===chosenKey);selectedDay=index>=0?index:0;
  bookings=Array.isArray(snapshot.bookings)?snapshot.bookings.map(normalizeBooking):[];
  renderSchedule();
  if($('#detail-dialog').open&&openDetailKey){const updated=bookings.find(item=>item.key===openDetailKey);if(updated)renderDetail(updated);else closeDetail();}
});
