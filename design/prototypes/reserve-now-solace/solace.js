'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const icon = (type) => `<svg viewBox="0 0 24 24" aria-hidden="true">${{room:'<path d="M5 21V4l12-2v19M3 21h18M13 11v2"/>',whiteboard:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 8h10M7 12h6"/>',tv:'<rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 22h8m-4-4v4"/>'}[type]}</svg>`;
  const types = {room:{label:'Study Rooms',one:'Room',count:4,description:'A quiet space for conversation'},whiteboard:{label:'Whiteboards',one:'Whiteboard',count:5,description:'Make a little room for ideas'},tv:{label:'TVs',one:'TV',count:3,description:'Share a lesson on screen'}};
  const purposes = {contact:{label:'Contact',description:'A conversation with a contact'},new:{label:'New Member',description:'Time to learn and grow together'},other:{label:'Other',description:'Another meaningful use of the space'}};
  const serviceRules = {6:[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']],2:[[1170,1230,'Evening service']]};
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const today = new Date(Date.UTC(dateParts.year,dateParts.month-1,dateParts.day));
  const dates = [2,6].map(dow=>{const date=new Date(today);date.setUTCDate(date.getUTCDate()+((dow-date.getUTCDay()+7)%7));return {key:date.toISOString().slice(0,10),dow,date,short:new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(date),long:new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(date),month:new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(date)};}).sort((a,b)=>a.date-b.date);
  const fmt = (minutes) => {const hour=Math.floor(minutes/60);return `${hour%12||12}:${String(minutes%60).padStart(2,'0')} ${hour<12?'AM':'PM'}`;};
  const hourLabel = (minutes) => fmt(minutes).replace(':00','');
  const range = (start,end) => `${fmt(start)} to ${fmt(end)}`;
  const duration = (minutes) => `${Math.floor(minutes/60)?`${Math.floor(minutes/60)} hr`:''}${minutes%60?`${minutes>=60?' ':''}30 min`:''}`;
  const dateLabel = (key) => {const day=dates.find(d=>d.key===key);return `${day.long}, ${day.month}`;};
  const fixtureRows = [
    [6,'room',1,660,750,'Nora L.','contact'],[6,'room',2,690,780,'Eli M.','new'],[6,'room',4,660,720,'Maya R.','other'],[6,'room',3,780,870,'Luca B.','contact'],[6,'room',1,930,1020,'Theo A.','new'],[6,'room',4,990,1110,'Isla C.','contact'],[6,'room',2,1080,1170,'Owen K.','other'],[6,'room',3,1230,1320,'Aria P.','new'],[6,'room',1,1350,1380,'Remy J.','other'],
    [6,'whiteboard',1,660,750,'Nora L.','contact'],[6,'whiteboard',3,750,810,'Eli M.','new'],[6,'whiteboard',5,960,1050,'Luca B.','other'],[6,'whiteboard',2,1080,1140,'Isla C.','contact'],[6,'whiteboard',4,1230,1320,'Aria P.','new'],
    [6,'tv',2,660,780,'Maya R.','new'],[6,'tv',1,960,1050,'Theo A.','contact'],[6,'tv',3,1230,1290,'Remy J.','other'],
    [2,'room',2,600,690,'Isla C.','contact'],[2,'room',4,660,750,'Luca B.','new'],[2,'room',1,780,870,'Eli M.','other'],[2,'room',3,990,1080,'Nora L.','contact'],[2,'room',2,1080,1170,'Theo A.','new'],[2,'room',1,1260,1320,'Aria P.','other'],
    [2,'whiteboard',2,630,720,'Luca B.','contact'],[2,'whiteboard',4,870,960,'Eli M.','new'],[2,'whiteboard',1,1080,1140,'Maya R.','other'],[2,'tv',1,690,780,'Nora L.','contact'],[2,'tv',3,990,1080,'Theo A.','new']
  ];
  const fixtures = () => fixtureRows.map(([dow,type,unit,start,end,name,purpose])=>({date:dates.find(d=>d.dow===dow).key,type,unit,start,end,name,purpose}));
  const requestedState = new URLSearchParams(location.search).get('state');
  let displayState = ['loading','empty','error'].includes(requestedState)?requestedState:'ready';
  let bookings = displayState==='empty'?[]:fixtures();
  let selectedDate=dates[0].key,selectedType='room',draft={},step='resource',history=[],lastOpener=null,saved=null;
  const dialog=$('#booking-dialog');
  const serviceAt = (date,time) => (serviceRules[dates.find(d=>d.key===date).dow]||[]).find(([start,end])=>time>=start&&time<end);
  const occupant = (date,type,unit,time) => bookings.find(b=>b.date===date&&b.type===type&&b.unit===unit&&time>=b.start&&time<b.end);
  const free = (date,type,unit,time) => time>=600&&time<1380&&!serviceAt(date,time)&&!occupant(date,type,unit,time);
  const freeUntil = (date,type,unit,start) => {let end=start;while(free(date,type,unit,end))end+=30;return end;};
  const allUnits = (type) => Array.from({length:types[type].count},(_,i)=>i+1);
  const validUnits = (date,type,start,end) => allUnits(type).filter(unit=>freeUntil(date,type,unit,start)>=end);
  const publicName = (name) => {const words=name.trim().split(/\s+/);return words.length>1?`${words[0]} ${Array.from(words[words.length-1])[0]}.`:words[0];};
  const visibleName = (name) => name.replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF]/g,'').length>0;

  function renderNavigation(){
    $('#dates').innerHTML=dates.map(day=>`<button type="button" class="date-button" data-date="${day.key}" aria-pressed="${selectedDate===day.key}" aria-label="${dateLabel(day.key)}"><b>${day.long}</b><i class="day-dot" aria-hidden="true"></i><span>${day.month}</span></button>`).join('');
    $('#resources').innerHTML=Object.entries(types).map(([key,type])=>`<button type="button" class="resource-button" data-type="${key}" aria-pressed="${selectedType===key}">${icon(key)}<span>${type.label}</span></button>`).join('');
    const count=types[selectedType].count;
    $('.schedule-surface').style.setProperty('--units',count);
    $('.schedule-surface').classList.toggle('dense',count===5);
    $('#unit-headings').innerHTML=`<span>Time</span>${allUnits(selectedType).map(unit=>`<span>${selectedType==='whiteboard'?'Board':types[selectedType].one} <b>${unit}</b>${selectedType==='whiteboard'?`<small>${unit<=3?'Large':'Vertical'}</small>`:''}</span>`).join('')}`;
    $('#day-caption').textContent=dateLabel(selectedDate);
    $('#reserve').disabled=['loading','error'].includes(displayState);
  }

  function renderSchedule(){
    renderNavigation();
    const message=$('#state-message');
    if(displayState==='error'){
      message.innerHTML='<h3>A pause in the day.</h3><p>The sample schedule could not load.<br>Try again to bring your spaces back.</p><button type="button" class="text-button" data-recover>Try again</button>';
      $('#schedule').innerHTML='';return;
    }
    if(displayState==='loading'){
      message.innerHTML='<div class="loading-spinner" aria-hidden="true"></div><h3>Preparing your day.</h3><p>Loading the sample schedule.</p><button type="button" class="text-button" data-recover>Show sample schedule</button>';
      $('#schedule').innerHTML=Array.from({length:24},(_,i)=>`<span class="skeleton-cell" aria-hidden="true" style="grid-column:${i%types[selectedType].count+2};grid-row:${Math.floor(i/types[selectedType].count)+1}"></span>`).join('');
      return;
    }
    message.innerHTML=displayState==='empty'?'<h3>A fresh page.</h3><p>All reservable spaces are open. Service times are set aside.</p><button type="button" class="text-button" data-recover>Show sample bookings</button>':'';
    let html='<div class="time-track" aria-hidden="true"></div>';
    for(let time=600;time<=1380;time+=60)html+=`<span class="hour-label ${time===1380?'last':''}" style="grid-row:${time===1380?26:(time-600)/30+1}">${hourLabel(time)}</span>`;
    for(const unit of allUnits(selectedType)){
      for(let time=600;time<1380;time+=30){
        if(serviceAt(selectedDate,time))continue;
        const booking=occupant(selectedDate,selectedType,unit,time);
        const row=(time-600)/30+1;
        if(booking){
          if(time!==booking.start)continue;
          const span=(booking.end-booking.start)/30;
          html+=`<article class="booking ${booking.purpose} ${span===1?'short':''} ${booking===saved?'recent-saved':''}" tabindex="-1" style="grid-column:${unit+1};grid-row:${row}/span ${span}" aria-label="${esc(booking.name)}, ${purposes[booking.purpose].label}, ${types[selectedType].one} ${unit}, ${range(booking.start,booking.end)}"><span class="booking-name">${esc(booking.name)}</span><span class="booking-purpose">${purposes[booking.purpose].label}</span></article>`;
        }else{
          html+=`<button type="button" class="open-slot" data-unit="${unit}" data-start="${time}" style="grid-column:${unit+1};grid-row:${row}" aria-label="Reserve ${types[selectedType].one} ${unit}, ${dateLabel(selectedDate)}, starting ${fmt(time)}"><span>Open</span></button>`;
        }
      }
    }
    for(const [start,end,label] of serviceRules[dates.find(d=>d.key===selectedDate).dow])html+=`<div class="service-band" style="grid-row:${(start-600)/30+1}/span ${(end-start)/30}" aria-label="${label}, ${range(start,end)}, unavailable"><span aria-hidden="true">✧</span><span>${label}<small>Time set aside together</small></span></div>`;
    $('#schedule').innerHTML=html;
  }

  function title(text,hint){return `<h2 id="step-title" tabindex="-1">${text}</h2><p class="hint">${hint}</p>`;}
  function summary(){return `<div class="summary"><h3>${types[draft.type].one} ${draft.unit}</h3><dl><div><dt>Day</dt><dd>${dateLabel(draft.date)}</dd></div><div><dt>Time</dt><dd>${range(draft.start,draft.end)}</dd></div><div><dt>Purpose</dt><dd>${purposes[draft.purpose].label}</dd></div><div><dt>Reserved for</dt><dd>${esc(publicName(draft.name))}</dd></div></dl></div>`;}
  function renderStep(){
    $('#back').style.visibility=history.length&&step!=='done'?'visible':'hidden';
    $('#step-count').textContent=step==='done'?'A little space, just for you':`Your reservation · ${['resource','purpose','start','end','name','confirm'].indexOf(step)+1} of 6`;
    const crumbs=[dateLabel(draft.date)];
    if(draft.type)crumbs.push(`${types[draft.type].one}${draft.unit?` ${draft.unit}`:''}`);
    if(draft.start!=null)crumbs.push(fmt(draft.start));
    $('#selection-context').innerHTML=step==='done'?'':crumbs.map(value=>`<span>${esc(value)}</span>`).join('');
    let html='';
    if(step==='resource')html=title('What would you like to reserve?','A place to meet, a way to share, a little room to grow.')+`<div class="choices">${Object.entries(types).map(([key,type])=>`<button class="choice" type="button" data-choose-type="${key}"><span class="choice-icon">${icon(key)}</span><span class="choice-copy"><b>${type.label}</b><small>${type.count} available to reserve</small></span><span class="choice-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`;
    if(step==='purpose')html=title('What is this reservation for?',draft.direct?`Your ${types[draft.type].one.toLowerCase()} and ${fmt(draft.start)} start are selected.`:'Choose the purpose that feels right.')+`<div class="choices">${Object.entries(purposes).map(([key,purpose])=>`<button type="button" class="choice" data-purpose="${key}"><span class="purpose-dot ${key}" aria-hidden="true"></span><span class="choice-copy"><b>${purpose.label}</b><small>${purpose.description}</small></span><span class="choice-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`;
    if(step==='start'){
      const starts=[];for(let time=600;time<1380;time+=30)if(allUnits(draft.type).some(unit=>free(draft.date,draft.type,unit,time)))starts.push(time);
      html=title('When would you like to start?','Choose a beginning. Only available times appear below.')+(starts.length?`<div class="time-choices">${starts.map(time=>`<button type="button" class="time-choice" data-start-choice="${time}">${fmt(time)}</button>`).join('')}</div>`:'<p class="hint">Every space is reserved. Close this sheet to choose the other day.</p>');
    }
    if(step==='end'){
      const max=draft.direct?freeUntil(draft.date,draft.type,draft.unit,draft.start):Math.max(...allUnits(draft.type).map(unit=>freeUntil(draft.date,draft.type,unit,draft.start)));
      const ends=[];for(let time=draft.start+30;time<=max;time+=30)ends.push(time);
      html=title('When would you like to end?',`Starting at ${fmt(draft.start)}. Each ending fits around reservations and service.`)+(ends.length?`<div class="time-choices">${ends.map(time=>`<button type="button" class="time-choice" data-end-choice="${time}">${fmt(time)}<small>${duration(time-draft.start)}</small></button>`).join('')}</div>`:'<p class="inline-error">This opening has changed. Go back and choose another start.</p>');
    }
    if(step==='name')html=title('Who is this for?','Add a fictional name to try the reservation experience.')+`<form id="name-form"><label class="field-label" for="guest-name">Your name</label><input class="name-field" id="guest-name" name="name" placeholder="e.g. Avery Lane" maxlength="40" autocomplete="off" value="${esc(draft.name||'')}" required><p class="field-note">Shown as a first name and last initial on the schedule.</p><p class="inline-error" id="name-error" role="alert"></p><button class="primary" type="submit">Continue</button></form>`;
    if(step==='confirm')html=title('Confirm your reservation.','A moment to make sure everything feels right.')+summary()+'<p class="summary-note">This sample reservation saves only in this browser tab.</p><p class="inline-error" id="save-error" role="alert"></p><button type="button" class="primary" id="confirm-reservation">Confirm reservation</button>';
    if(step==='done')html=`<div class="done-symbol" aria-hidden="true">✓</div>`+title('Your sample space is saved.','A little room for a good moment. The schedule now reflects your reservation.')+summary()+'<p class="summary-note">Simulated confirmation. Saved only in this browser tab.</p><button type="button" class="primary" id="see-reservation">See it on the schedule</button><button type="button" class="text-button" id="another-reservation">Reserve another space</button>';
    $('#step-body').innerHTML=`<section class="step ${step==='done'?'done':''}">${html}</section>`;
    dialog.scrollTop=0;
    requestAnimationFrame(()=>$('#step-title')?.focus({preventScroll:true}));
  }
  function go(next){history.push(step);step=next;renderStep();}
  function openBooking(preset){
    lastOpener=document.activeElement;
    draft={date:selectedDate,name:'',type:preset?selectedType:null,unit:preset?.unit||null,start:preset?.start??null,end:null,purpose:null,direct:!!preset};
    step=preset?'purpose':'resource';history=[];renderStep();
    if(!dialog.open)dialog.showModal();
    document.body.style.overflow='hidden';
  }
  function closeBooking(){dialog.close();document.body.style.overflow='';if(lastOpener?.isConnected)lastOpener.focus({preventScroll:true});else $('#reserve').focus({preventScroll:true});}
  function recover(){displayState='ready';bookings=fixtures();saved=null;renderSchedule();$('#announcement').textContent='Sample schedule loaded. Choose an open space.';$('#resources button').focus({preventScroll:true});}

  $('#dates').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(!button)return;selectedDate=button.dataset.date;renderSchedule();$(`#dates [data-date="${selectedDate}"]`).focus({preventScroll:true});$('#announcement').textContent=`Showing ${dateLabel(selectedDate)}.`;});
  $('#resources').addEventListener('click',event=>{const button=event.target.closest('[data-type]');if(!button)return;selectedType=button.dataset.type;renderSchedule();$(`#resources [data-type="${selectedType}"]`).focus({preventScroll:true});$('#announcement').textContent=`Showing ${types[selectedType].count} ${types[selectedType].label.toLowerCase()}.`;});
  $('#schedule').addEventListener('click',event=>{const button=event.target.closest('.open-slot');if(button)openBooking({unit:Number(button.dataset.unit),start:Number(button.dataset.start)});});
  $('#state-message').addEventListener('click',event=>{if(event.target.closest('[data-recover]'))recover();});
  $('#reserve').addEventListener('click',()=>openBooking());
  $('#close').addEventListener('click',closeBooking);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeBooking();});
  $('#back').addEventListener('click',()=>{if(!history.length)return;step=history.pop();if(step==='start'&&!draft.direct){draft.start=null;draft.unit=null;}if(step==='end'){draft.end=null;if(!draft.direct)draft.unit=null;}renderStep();});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeBooking();}});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const items=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(el=>getComputedStyle(el).visibility!=='hidden'&&el.getClientRects().length);
    if(!items.length)return;
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('#step-title'))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  $('#step-body').addEventListener('submit',event=>{if(event.target.id!=='name-form')return;event.preventDefault();const value=$('#guest-name').value.trim();if(!visibleName(value)){$('#name-error').textContent='Please add a visible fictional name.';$('#guest-name').focus();return;}draft.name=value;go('confirm');});
  $('#step-body').addEventListener('click',event=>{
    const type=event.target.closest('[data-choose-type]');if(type){draft.type=type.dataset.chooseType;go('purpose');return;}
    const purpose=event.target.closest('[data-purpose]');if(purpose){draft.purpose=purpose.dataset.purpose;go(draft.direct?'end':'start');return;}
    const start=event.target.closest('[data-start-choice]');if(start){draft.start=Number(start.dataset.startChoice);draft.unit=null;draft.end=null;go('end');return;}
    const end=event.target.closest('[data-end-choice]');if(end){draft.end=Number(end.dataset.endChoice);if(!draft.direct)draft.unit=validUnits(draft.date,draft.type,draft.start,draft.end)[0];go('name');return;}
    if(event.target.closest('#confirm-reservation')){
      if(!validUnits(draft.date,draft.type,draft.start,draft.end).includes(draft.unit)){$('#save-error').textContent='This space is no longer open for the full time. Go back to choose another time.';return;}
      saved={date:draft.date,type:draft.type,unit:draft.unit,start:draft.start,end:draft.end,purpose:draft.purpose,name:publicName(draft.name)};
      bookings.push(saved);selectedDate=draft.date;selectedType=draft.type;displayState='ready';renderSchedule();step='done';renderStep();$('#announcement').textContent='Sample reservation saved in this browser tab.';return;
    }
    if(event.target.closest('#see-reservation')){closeBooking();const card=$('.recent-saved');if(card){card.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});card.focus({preventScroll:true});}return;}
    if(event.target.closest('#another-reservation')){draft={date:selectedDate,name:'',type:null,unit:null,start:null,end:null,purpose:null,direct:false};step='resource';history=[];renderStep();}
  });
  renderSchedule();
})();
