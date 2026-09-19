import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,extname} from 'node:path';
import {eligibleDays} from '../experiences/shared/model.js';
const root=resolve(new URL('..',import.meta.url).pathname),results=[];
// Fixtures follow the schedule's own calendar, so they never age out.
const fixtureDay=eligibleDays()[0].key;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const path=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));if(!path.startsWith(root+'/'))throw 0;res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const configs={solace:{reserve:'#reserve',resource:'#resources [data-type]',open:'.open-slot',end:'[data-end-choice]',name:'#guest-name',reservedFor:'#reserved-for',form:'#name-form',confirm:'#confirm-reservation',success:'#see-reservation',error:'#save-error'},velum:{reserve:'#reserve-now',resource:'[data-resource]',open:'.open-slot',end:'[data-time-end]',name:'#display-name',reservedFor:'#reserved-for',form:'#name-form',confirm:'#confirm-reservation',success:'#see-reservation',error:'#save-error'},cove:{reserve:'[data-reserve]:visible',resource:'.resource[data-resource]',open:'.open',end:'[data-end]',name:'#guest-name',reservedFor:'#reserved-for',form:'#reserved-for-form',confirm:'#confirm',success:'#view-booking',error:'#form-error'},petal:{reserve:'#reserve',resource:'[data-resource]',open:'.open',end:'[data-end]',name:'#guestName',reservedFor:'#reservedFor',form:'#nameForm',confirm:'#confirm',success:'#seeReservation',error:'#draftError'}};
configs.atlas={reserve:'#reserve',resource:'.meter[data-type]',open:'.roomSlot.open',end:'[data-end]',name:'#name',reservedFor:'#reservedFor',form:'#reservedForForm',confirm:'#confirm',success:'#finish',error:'#dialogError'};
configs.lattice={reserve:'#reserve',resource:'.overview [data-type]',open:'button.slot.open',end:'[data-end-choice]',name:'#name',reservedFor:'#reservedFor',form:'#reservedForForm',confirm:'#confirm',success:'#finish',error:'#flowNotice'};
async function mock(context){
 await context.addInitScript(()=>{window.__calls=[];window.__rejectNext=localStorage.getItem('srs-override-fixture')!=='1';});
 await context.route('**/firebasejs/10.12.2/firebase-*.js',route=>{
  const part=route.request().url().split('firebase-').pop();let body='';
  if(part==='app.js')body='export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});';
  if(part==='auth.js')body="export const getAuth=()=>({currentUser:{uid:'fixture-current-owner'}});export const onAuthStateChanged=(a,cb)=>{queueMicrotask(()=>cb(a.currentUser));return ()=>{};};export const signInAnonymously=()=>{throw Error('Existing identity must be restored');};";
  if(part==='firestore.js')body="export const getFirestore=()=>({});export const collection=()=>({});export const where=(...a)=>a;export const query=(...a)=>a;export function onSnapshot(q,opts,cb){window.__snapshot=cb;window.__query=q;queueMicrotask(()=>cb({metadata:{fromCache:false},empty:true,docs:[]}));return ()=>{};}export const doc=()=>({});export const setDoc=()=>{throw Error('Unexpected direct write');};export const updateDoc=()=>{throw Error('Unexpected direct write');};export const serverTimestamp=()=>0;export const Timestamp={};";
  if(part==='functions.js')body=`export const getFunctions=()=>({});
const readMine=()=>{try{return JSON.parse(localStorage.getItem('srs-mine-fixture')||'[]');}catch{return [];}};
const writeMine=rows=>{try{localStorage.setItem('srs-mine-fixture',JSON.stringify(rows));}catch{}};
export const httpsCallable=(f,name)=>async payload=>{
 window.__calls.push({name,payload});
 await new Promise(r=>setTimeout(r,name==='memberSchedule'&&localStorage.getItem('srs-slow-schedule')==='1'?1200:80));
 if(name==='memberSubmitBooking'&&window.__rejectNext){window.__rejectNext=false;throw {code:'functions/already-exists'};}
 if(name==='memberSchedule'){
  if(localStorage.getItem('srs-schedule-error')==='1')throw {code:'functions/unavailable'};
  const bookings=(window.__overrideFixture||localStorage.getItem('srs-override-fixture')==='1')?[{id:'fixture-lower-priority',day:'${fixtureDay}',type:'room',unit:2,start:750,end:810,name:'Lower Priority Holder',purpose:'other',reservedFor:'Fixture purpose',status:'approved'}]:[];
  window.__fixtureCount=bookings.length;
  const mine=readMine();
  const asMinutes=value=>Number(String(value).slice(0,2))*60+Number(String(value).slice(3));
  const owned=mine.filter(row=>row.status==='approved').map(row=>{
   const entry=Object.entries(row.assignments||{}).find(pair=>typeof pair[1]==='string'&&pair[1]);
   if(!entry)return null;
   const type=entry[0],unit=Number(entry[1].split('-')[1]),start=asMinutes(row.start),end=asMinutes(row.end);
   const detail={authorized:true,bookingId:row.id,name:row.displayName,displayName:row.displayName,reservedFor:row.reservedFor,canCancel:row.canCancel===true,canEndEarly:row.canEndEarly===true};
   return {id:row.id+':'+type,bookingId:row.id,key:'slot-'+row.date+'-'+type+'-'+unit+'-'+start+'-'+end,day:row.date,date:row.date,type,unit,start,end,name:row.displayName,publicName:row.displayName,displayName:row.displayName,purpose:row.purpose,reservedFor:row.reservedFor,blocked:false,status:'approved',needs:row.needs,assignments:row.assignments,override:false,ownerDetail:detail};
  }).filter(Boolean);
  return {data:{version:1,days:[],bookings:bookings.concat(owned),myBookings:mine}};
 }
 if(name==='memberCancelBooking'){writeMine(readMine().map(row=>row.id===payload.bookingId?{...row,status:'cancelled',canCancel:false,canEndEarly:false}:row));return {data:{ok:true}};}
 if(name==='memberEndBookingEarly'){writeMine(readMine().map(row=>row.id===payload.bookingId?{...row,end:payload.end,endedEarlyFrom:row.endedEarlyFrom||row.end,canEndEarly:false}:row));return {data:{end:payload.end}};}
 return {data:{bookingId:'fixture-owned-id-'+window.__calls.length,status:'approved',assignment:payload.requestedUnit||({room:'room-1',whiteboard:'wb-1',tv:'tv-1'})[payload.resourceType]}};
};`;
  return route.fulfill({contentType:'text/javascript',body});
 });
}
for(const name of (process.argv.slice(2).length?process.argv.slice(2):Object.keys(configs))){
 const c=configs[name],context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});await mock(context);const page=await context.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`${base}/experiences/${name}/`);await page.locator(c.open).first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator(c.reserve).click();assert.equal(await page.locator('dialog[open] [data-purpose]').count(),0);await page.keyboard.press('Escape');
  for(const [index,type] of ['room','whiteboard','tv'].entries()){
    await page.locator(c.resource).nth(index).click();const slot=page.locator(c.open+'[data-unit="2"][data-start]').first();await slot.click();assert.equal(await page.locator('[data-purpose]').count(),3);
    await page.locator('[data-purpose="'+(index===1?'other':index===2?'new':'contact')+'"]').click();
    await page.locator(c.end).first().click();await page.locator(c.name).fill('Robin Test');await page.locator(c.reservedFor).fill(index===1?'Fictional lesson review':index===2?'Fictional member':'Fictional contact');await page.locator(c.form+' button[type=submit]').click();await page.locator(c.confirm).click();
    if(index===0){await page.locator(c.error).filter({hasText:/space|reserved|time|confirm/i}).waitFor();assert.equal(await page.locator(c.success).count(),0);await page.locator(c.confirm).click();}
    await page.locator(c.success).waitFor();await page.locator(c.success).click();
    const call=await page.evaluate(()=>window.__calls.at(-1));assert.equal(call.name,'memberSubmitBooking');assert.equal(call.payload.resourceType,type);assert.equal(call.payload.requestedUnit,({room:'room-',whiteboard:'wb-',tv:'tv-'})[type]+'2');assert.equal(call.payload.purpose,index===2?'new-member':index===1?'other':'contact');
    if(index===1)assert.equal(call.payload.purposeOther,'Fictional lesson review');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('srs-my-bookings')).length),index+1);
    assert(await page.getByText('Robin',{exact:true}).count()>0);
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.equal(await page.locator(c.open).count(),0);
  assert.equal(await page.locator(c.reserve).isEnabled(),false);
  assert.equal(errors.length,0,errors.join('; '));
  await page.goto(`${base}/experiences/${name}/`);await page.evaluate(()=>{localStorage.setItem('srs-override-fixture','1');window.__rejectNext=false;});await page.reload();await page.locator(c.open+'[data-unit="2"][data-start="720"]').waitFor();
  await page.locator(c.open+'[data-unit="2"][data-start="720"]').click();await page.locator('[data-purpose="contact"]').click();
  const overrideEnd=page.locator('[data-end="810"],[data-end-choice="810"],[data-time-end="810"]').first();await overrideEnd.waitFor();assert(await overrideEnd.getByText('Priority override',{exact:true}).count()>0);
  await overrideEnd.click();await page.locator(c.name).fill('Robin Exact');await page.locator(c.reservedFor).fill('Exact contact');await page.locator(c.form+' button[type=submit]').click();await page.locator(c.confirm).click();await page.locator(c.success).waitFor();
  const exactCall=await page.evaluate(()=>window.__calls.at(-1));assert.equal(exactCall.name,'memberSubmitBooking');assert.equal(exactCall.payload.requestedUnit,'room-2');
  await page.locator(c.success).click();
  await page.goto(`${base}/experiences/${name}/?demo=1`);await page.locator(c.open).first().waitFor();
  assert(!await page.getByText('Private administrative hold',{exact:true}).count());
  const evidence=resolve(root,'docs/live-design-evidence');await mkdir(evidence,{recursive:true});await page.screenshot({path:resolve(evidence,name+'-phone.png')});await page.setViewportSize({width:1280,height:720});await page.screenshot({path:resolve(evidence,name+'-desktop.png')});
  results.push({name,passed:true,checks:['resource-first','three exact-unit backend payloads','exact-unit priority override indicator and payload','Other details','failed save retained draft','canonical success','ownership preserved','offline blocks Open and submit','390px no overflow','phone and desktop captures'],errors});
 }catch(e){results.push({name,passed:false,error:e.message,at:String(e.stack||'').split('\n').find(line=>line.includes('member-design-smoke'))?.trim(),errors});}
 await context.close();
}

const choiceContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});await mock(choiceContext);const choicePage=await choiceContext.newPage();choicePage.setDefaultTimeout(6000);
try{
 await choicePage.goto(base+'/?choose=1');await choicePage.locator('dialog.design-picker[open]').waitFor();assert.equal(await choicePage.locator('[data-design]').count(),6);
 assert.equal(await choicePage.locator('[data-design="solace"] .dp-default').textContent(),'Default');
 await choicePage.screenshot({path:resolve(root,'docs/live-design-evidence/chooser-phone.png')});
 await choicePage.locator('[data-design="cove"]').click();await choicePage.waitForURL('**/experiences/cove/');assert.equal(await choicePage.evaluate(()=>localStorage.getItem('srs-design-v1')),'cove');
 await choicePage.goto(base+'/');await choicePage.waitForURL('**/experiences/cove/');
 await choicePage.goto(base+'/?classic=1&tab=mine');await choicePage.waitForURL('**/experiences/cove/?view=mine');assert.equal(await choicePage.evaluate(()=>localStorage.getItem('srs-design-v1')),'cove');
 await choicePage.evaluate(()=>localStorage.setItem('srs-design-v1','classic'));
 await choicePage.goto(base+'/');await choicePage.locator('dialog.design-picker[open]').waitFor();
 await choicePage.keyboard.press('Escape');await choicePage.waitForURL('**/experiences/solace/');assert.equal(await choicePage.evaluate(()=>localStorage.getItem('srs-design-v1')),'solace');
 assert.equal(await choicePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 results.push({name:'chooser',passed:true,checks:['six choices and no keep-the-old-app option','Solace marked Default','chosen design remembered and opened','classic tab=mine forwards to the design with view=mine','stored classic counts as no choice','closing selects Solace','phone no overflow']});
}catch(e){results.push({name:'chooser',passed:false,error:e.message});}
await choiceContext.close();

/* Solace My reservations: every state the retired classic screen showed, with
   fictional reservations only. */
const day=fixtureDay,mineRow=(overrides)=>({bookingId:overrides.id,key:'booking-'+overrides.id,day,date:day,name:'Robin F',displayName:'Robin F',purpose:'contact',reservedFor:'Fictional contact',status:'approved',blocked:false,needs:{room:true},assignments:{room:'room-2'},endedEarlyFrom:null,priorityNotice:null,canCancel:true,canEndEarly:false,...overrides});
const mineFixture=[
 mineRow({id:'fixture-mine-room',start:'11:00',end:'13:00',canEndEarly:true}),
 mineRow({id:'fixture-mine-pending',start:'12:00',end:'12:30',status:'pending',purpose:'new',reservedFor:'Fictional member',needs:{tv:true},assignments:{}}),
 mineRow({id:'fixture-mine-short',start:'14:00',end:'14:30',purpose:'other',reservedFor:'Fictional study',needs:{whiteboard:true},assignments:{whiteboard:'wb-4'}}),
 mineRow({id:'fixture-mine-ended',start:'13:00',end:'14:00',endedEarlyFrom:'15:00',canEndEarly:true,needs:{room:true},assignments:{room:'room-3'},priorityNotice:{kind:'moved',byPurpose:'contact',type:'room',fromUnit:'room-1',toUnit:'room-3'}}),
 mineRow({id:'fixture-mine-cancelled',start:'15:00',end:'16:00',status:'cancelled',canCancel:false}),
 mineRow({id:'fixture-mine-declined',start:'16:00',end:'17:00',status:'declined',canCancel:false}),
 mineRow({id:'fixture-mine-overridden',start:'17:00',end:'18:00',status:'overridden',canCancel:false,priorityNotice:{kind:'released',byPurpose:'contact',type:'room'}})
];
const mineContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});await mock(mineContext);
const minePage=await mineContext.newPage();minePage.setDefaultTimeout(6000);const mineErrors=[];minePage.on('pageerror',e=>mineErrors.push(e.message));
const mineSeed=async(rows,flags={})=>{
 await minePage.goto(base+'/experiences/solace/');
 await minePage.evaluate(([fixture,extra])=>{localStorage.setItem('srs-mine-fixture',JSON.stringify(fixture));localStorage.removeItem('srs-slow-schedule');localStorage.removeItem('srs-schedule-error');for(const [key,value] of Object.entries(extra))localStorage.setItem(key,value);},[rows,flags]);
};
const mineNoOverflow=async()=>{
 for(const width of [320,360,375,390]){
  await minePage.setViewportSize({width,height:844});
  assert.equal(await minePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal scroll at '+width+'px');
 }
 await minePage.setViewportSize({width:390,height:844});
};
try{
 // Every reservation state the classic screen carried.
 await mineSeed(mineFixture);
 await minePage.goto(base+'/experiences/solace/?view=mine');
 await minePage.locator('#mine-dialog[open]').waitFor();
 await minePage.locator('[data-mine-cancel="fixture-mine-room"]').waitFor();
 await minePage.waitForFunction(()=>document.activeElement?.id==='mine-title');
 assert.equal(await minePage.locator('ul[aria-label="Upcoming reservations"] .mine-card').count(),4);
 assert.equal(await minePage.locator('ul[aria-label="Past reservations"] .mine-card').count(),3);
 for(const label of ['Approved','Pending review','Cancelled','Declined','Given to a higher priority'])assert(await minePage.locator('.mine-badge',{hasText:label}).count()>0,'missing status '+label);
 assert.equal(await minePage.getByText('Ended early · originally booked until 3:00 PM').count(),1);
 assert.equal(await minePage.locator('.mine-priority',{hasText:'You kept your time in Study Room 3'}).count(),1);
 assert.equal(await minePage.locator('.mine-priority',{hasText:'Nothing else was open'}).count(),1);
 assert.equal(await minePage.locator('[data-mine-rebook="fixture-mine-overridden"]').count(),1);
 assert.equal(await minePage.locator('[data-mine-cancel="fixture-mine-pending"]').textContent(),'Cancel request');
 assert.equal(await minePage.locator('[data-mine-cancel="fixture-mine-room"]').textContent(),'Cancel reservation');
 assert.equal(await minePage.locator('[data-mine-end-early="fixture-mine-short"]').count(),0);
 assert.equal(await minePage.getByText('Whiteboard 4',{exact:true}).count(),1);
 assert.equal(await minePage.locator('#mine-dialog a[href*="classic"]').count(),0);
 const small=await minePage.locator('#mine-dialog button').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44).length);
 assert.equal(small,0,'every My reservations control is at least 44px tall');
 await mineNoOverflow();
 await minePage.screenshot({path:resolve(root,'docs/live-design-evidence/solace-mine-phone.png')});

 // Reconnecting: the shared actions wait for a live schedule.
 await minePage.evaluate(()=>window.dispatchEvent(new Event('offline')));
 await minePage.locator('#mine-connection',{hasText:'You are offline'}).waitFor();
 assert.equal(await minePage.locator('[data-mine-cancel="fixture-mine-room"]').isEnabled(),false);
 await minePage.evaluate(()=>window.dispatchEvent(new Event('online')));
 await minePage.waitForFunction(()=>document.querySelector('[data-mine-cancel="fixture-mine-room"]')?.disabled===false);

 // End early, by keyboard, with the confirmation step.
 await minePage.locator('[data-mine-end-early="fixture-mine-room"]').press('Enter');
 await minePage.locator('[data-mine-end="12:00"]').waitFor();
 assert.deepEqual(await minePage.locator('[data-mine-end]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mineEnd)),['11:30','12:00','12:30']);
 await minePage.locator('[data-mine-end="12:00"]').press('Enter');
 await minePage.locator('#mine-end-confirm').waitFor();
 await minePage.locator('#mine-end-confirm').press('Enter');
 await minePage.locator('[data-mine-cancel="fixture-mine-room"]').waitFor();
 const endCall=await minePage.evaluate(()=>window.__calls.at(-1));
 assert.equal(endCall.name,'memberEndBookingEarly');assert.deepEqual(endCall.payload,{bookingId:'fixture-mine-room',end:'12:00'});
 assert.equal(await minePage.getByText('Ended early · originally booked until 1:00 PM').count(),1);

 // Cancel: keeping it returns focus to the reservation it came from.
 await minePage.locator('[data-mine-cancel="fixture-mine-room"]').click();
 await minePage.locator('#mine-cancel-confirm').waitFor();
 await minePage.locator('#mine-step-back').click();
 await minePage.waitForFunction(()=>document.activeElement?.dataset?.mineCancel==='fixture-mine-room');
 await minePage.locator('[data-mine-cancel="fixture-mine-room"]').click();
 await minePage.locator('#mine-cancel-confirm').click();
 await minePage.locator('#mine-cancel-confirm').waitFor({state:'detached'});
 await minePage.locator('ul[aria-label="Past reservations"] .mine-card').nth(3).waitFor();
 const cancelCall=await minePage.evaluate(()=>window.__calls.at(-1));
 assert.equal(cancelCall.name,'memberCancelBooking');assert.deepEqual(cancelCall.payload,{bookingId:'fixture-mine-room'});
 assert.equal(await minePage.locator('ul[aria-label="Upcoming reservations"] .mine-card').count(),3);
 assert.equal(await minePage.locator('ul[aria-label="Past reservations"] .mine-card').count(),4);

 // The footer link opens the same view, and Escape gives the page back.
 await minePage.keyboard.press('Escape');
 await minePage.waitForFunction(()=>!document.querySelector('#mine-dialog').open&&!location.search.includes('view=mine'));
 await minePage.getByRole('link',{name:'My reservations',exact:true}).click();
 await minePage.locator('#mine-dialog[open]').waitFor();
 assert.match(minePage.url(),/\?view=mine$/);
 assert.equal(await minePage.getByRole('link',{name:'Admin',exact:true}).getAttribute('href'),'/admin/');
 await minePage.keyboard.press('Escape');
 await minePage.waitForFunction(()=>document.activeElement?.id==='mine-link');

 // The reservation on the shared schedule carries the same two actions.
 await minePage.keyboard.press('Escape');
 await minePage.waitForFunction(()=>!document.querySelector('#mine-dialog').open);
 await minePage.locator('[data-booking*="room-3"]').first().click();
 await minePage.locator('#detail-dialog[open]').waitFor();
 assert.equal(await minePage.locator('#detail-body [data-detail-action="cancel"]').count(),1);
 assert.equal(await minePage.locator('#detail-body [data-detail-action="endEarly"]').count(),1);
 await minePage.locator('#detail-body [data-detail-action="cancel"]').click();
 await minePage.locator('[data-detail-action="cancel-confirm"]').waitFor();
 await minePage.locator('[data-detail-action="cancel-keep"]').click();
 await minePage.locator('#detail-body [data-detail-action="endEarly"]').waitFor();
 await minePage.locator('#detail-body [data-detail-action="endEarly"]').click();
 await minePage.locator('#mine-dialog[open]').waitFor();
 assert.deepEqual(await minePage.locator('[data-mine-end]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mineEnd)),['13:30']);
 await minePage.locator('#mine-step-back').click();
 await minePage.locator('[data-mine-cancel="fixture-mine-ended"]').waitFor();
 await minePage.keyboard.press('Escape');
 await minePage.waitForFunction(()=>!document.querySelector('#mine-dialog').open);
 await minePage.locator('[data-booking*="room-3"]').first().click();
 await minePage.locator('#detail-body [data-detail-action="cancel"]').click();
 await minePage.locator('[data-detail-action="cancel-confirm"]').click();
 await minePage.locator('#detail-dialog[open]').waitFor({state:'detached'});
 const detailCancel=await minePage.evaluate(()=>window.__calls.at(-1));
 assert.equal(detailCancel.name,'memberCancelBooking');assert.deepEqual(detailCancel.payload,{bookingId:'fixture-mine-ended'});
 assert.equal(await minePage.locator('[data-booking*="room-3"]').count(),0);

 // Loading, empty and error states.
 await mineSeed([],{'srs-slow-schedule':'1'});
 await minePage.goto(base+'/experiences/solace/?view=mine');
 await minePage.getByText('Finding your reservations.').waitFor();
 await minePage.getByText('No reservations yet.').waitFor();
 assert.equal(await minePage.locator('#mine-reserve').count(),1);
 await mineNoOverflow();
 await mineSeed([],{'srs-schedule-error':'1'});
 await minePage.goto(base+'/experiences/solace/?view=mine');
 await minePage.getByText('Reservations unavailable.').waitFor();
 assert.equal(await minePage.locator('#mine-body [data-recover]').count(),1);
 // Demo mode keeps the same screen and never reaches a backend.
 await minePage.goto(base+'/experiences/solace/?demo=1&view=mine');
 await minePage.locator('#mine-dialog[open]').waitFor();
 const demoCancel=minePage.locator('[data-mine-cancel]').first();
 await demoCancel.waitFor();
 const demoId=await demoCancel.getAttribute('data-mine-cancel');
 await demoCancel.click();
 await minePage.locator('#mine-cancel-confirm').click();
 await minePage.locator('#mine-cancel-confirm').waitFor({state:'detached'});
 assert.equal(await minePage.locator('[data-mine-cancel="'+demoId+'"]').count(),0);
 assert.equal(await minePage.evaluate(()=>window.__calls.length),0);
 assert.equal(mineErrors.length,0,mineErrors.join('; '));
 results.push({name:'solace-mine',passed:true,checks:['every classic status, notice and note','44px controls','no horizontal scroll at 320, 360, 375 and 390','offline disables the shared actions','keyboard end early with confirmation and payload','cancel confirmation, focus return and payload','view=mine deep link and footer link','detail sheet cancels in place and hands End early to the in-design view','loading, empty and error states','demo reservations cancel without a backend call'],errors:mineErrors});
}catch(e){results.push({name:'solace-mine',passed:false,error:e.message,at:String(e.stack||'').split('\n').find(line=>line.includes('member-design-smoke'))?.trim(),errors:mineErrors});}
await mineContext.close();

await browser.close();server.close();await writeFile(resolve(root,'docs/live-design-evidence/results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
