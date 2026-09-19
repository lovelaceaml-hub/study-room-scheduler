/* Lane 2 My reservations journeys: Velum, Cove and Petal.
   Behaviour only, with the same fictional mocked Firebase the design smoke
   uses. No production data, no backend, and nothing written under docs/. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {eligibleDays} from '../experiences/shared/model.js';

const root=resolve(new URL('..',import.meta.url).pathname),results=[];
// Fixtures follow the schedule's own calendar, so they never age out.
const fixtureDay=eligibleDays()[0].key;

const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const path=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));if(!path.startsWith(root+'/'))throw 0;res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});

/* The fixture block from test/member-design-smoke.mjs: fictional owned
   reservations travel through localStorage['srs-mine-fixture'], the mocked
   memberSchedule returns them as myBookings plus matching public rows with
   ownerDetail, and the mocked cancel and end-early callables mutate them. */
async function mock(context){
 await context.addInitScript(()=>{window.__calls=[];});
 await context.route('**/firebasejs/10.12.2/firebase-*.js',route=>{
  const part=route.request().url().split('firebase-').pop();let body='';
  if(part==='app.js')body='export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});';
  if(part==='auth.js')body="export const getAuth=()=>({currentUser:{uid:'fixture-current-owner'}});export const onAuthStateChanged=(a,cb)=>{queueMicrotask(()=>cb(a.currentUser));return ()=>{};};export const signInAnonymously=()=>{throw Error('Existing identity must be restored');};";
  if(part==='functions.js')body=`export const getFunctions=()=>({});
const readMine=()=>{try{return JSON.parse(localStorage.getItem('srs-mine-fixture')||'[]');}catch{return [];}};
const writeMine=rows=>{try{localStorage.setItem('srs-mine-fixture',JSON.stringify(rows));}catch{}};
export const httpsCallable=(f,name)=>async payload=>{
 window.__calls.push({name,payload});
 await new Promise(r=>setTimeout(r,name==='memberSchedule'&&localStorage.getItem('srs-slow-schedule')==='1'?1200:80));
 if(name==='memberSchedule'){
  if(localStorage.getItem('srs-schedule-error')==='1')throw {code:'functions/unavailable'};
  const mine=readMine();
  const asMinutes=value=>Number(String(value).slice(0,2))*60+Number(String(value).slice(3));
  const owned=mine.filter(row=>row.status==='approved').map(row=>{
   const entry=Object.entries(row.assignments||{}).find(pair=>typeof pair[1]==='string'&&pair[1]);
   if(!entry)return null;
   const type=entry[0],unit=Number(entry[1].split('-')[1]),start=asMinutes(row.start),end=asMinutes(row.end);
   const detail={authorized:true,bookingId:row.id,name:row.displayName,displayName:row.displayName,reservedFor:row.reservedFor,canCancel:row.canCancel===true,canEndEarly:row.canEndEarly===true};
   return {id:row.id+':'+type,bookingId:row.id,key:'slot-'+row.date+'-'+type+'-'+unit+'-'+start+'-'+end,day:row.date,date:row.date,type,unit,start,end,name:row.displayName,publicName:row.displayName,displayName:row.displayName,purpose:row.purpose,reservedFor:row.reservedFor,blocked:false,status:'approved',needs:row.needs,assignments:row.assignments,override:false,ownerDetail:detail};
  }).filter(Boolean);
  return {data:{version:1,days:[],bookings:owned,myBookings:mine}};
 }
 if(name==='memberCancelBooking'){writeMine(readMine().map(row=>row.id===payload.bookingId?{...row,status:'cancelled',canCancel:false,canEndEarly:false}:row));return {data:{ok:true}};}
 if(name==='memberEndBookingEarly'){writeMine(readMine().map(row=>row.id===payload.bookingId?{...row,end:payload.end,endedEarlyFrom:row.endedEarlyFrom||row.end,canEndEarly:false}:row));return {data:{end:payload.end}};}
 return {data:{bookingId:'fixture-owned-id-'+window.__calls.length,status:'approved',assignment:payload.requestedUnit||({room:'room-1',whiteboard:'wb-1',tv:'tv-1'})[payload.resourceType]}};
};`;
  return route.fulfill({contentType:'text/javascript',body});
 });
}

const day=fixtureDay,mineRow=(overrides)=>({bookingId:overrides.id,key:'booking-'+overrides.id,day,date:day,name:'Robin F',displayName:'Robin F',purpose:'contact',reservedFor:'Fictional contact',status:'approved',blocked:false,needs:{room:true},assignments:{room:'room-2'},endedEarlyFrom:null,priorityNotice:null,canCancel:true,canEndEarly:false,...overrides});
const mineFixture=()=>[
 mineRow({id:'fixture-mine-room',start:'11:00',end:'13:00',canEndEarly:true}),
 mineRow({id:'fixture-mine-pending',start:'12:00',end:'12:30',status:'pending',purpose:'new',reservedFor:'Fictional member',needs:{tv:true},assignments:{}}),
 mineRow({id:'fixture-mine-short',start:'14:00',end:'14:30',purpose:'other',reservedFor:'Fictional study',needs:{whiteboard:true},assignments:{whiteboard:'wb-4'}}),
 mineRow({id:'fixture-mine-ended',start:'13:00',end:'14:00',endedEarlyFrom:'15:00',canEndEarly:true,needs:{room:true},assignments:{room:'room-3'},priorityNotice:{kind:'moved',byPurpose:'contact',type:'room',fromUnit:'room-1',toUnit:'room-3'}}),
 mineRow({id:'fixture-mine-cancelled',start:'15:00',end:'16:00',status:'cancelled',canCancel:false}),
 mineRow({id:'fixture-mine-declined',start:'16:00',end:'17:00',status:'declined',canCancel:false}),
 mineRow({id:'fixture-mine-overridden',start:'17:00',end:'18:00',status:'overridden',canCancel:false,priorityNotice:{kind:'released',byPurpose:'contact',type:'room'}})
];

/* Each design keeps its own naming; only the selectors differ. */
const configs={
 velum:{dialog:'#mine-dialog',title:'mine-title',body:'#mine-body',connection:'#mine-connection',back:'#mine-back',reserve:'#mine-reserve',cancelConfirm:'#mine-cancel-confirm',endConfirm:'#mine-end-confirm',stepBack:'#mine-step-back',link:'mine-link',detailDialog:'#detail-dialog',detailBody:'#detail-body',booking:'#schedule [data-booking*="room-3"]',offlineText:'You are offline'},
 cove:{dialog:'#mine-dialog',title:'mine-title',body:'#mine-body',connection:'#mine-connection',back:'#mine-back',reserve:'#mine-reserve',cancelConfirm:'#mine-cancel-confirm',endConfirm:'#mine-end-confirm',stepBack:'#mine-step-back',link:'mine-link',detailDialog:'#reservation-dialog',detailBody:'#reservation-detail-body',booking:'#schedule [data-booking-key*="room-3"]',offlineText:'You are offline'},
 petal:{dialog:'#mineDialog',title:'mineTitle',body:'#mineBody',connection:'#mineConnection',back:'#mineBack',reserve:'#mineReserve',cancelConfirm:'#mineCancelConfirm',endConfirm:'#mineEndConfirm',stepBack:'#mineStepBack',link:'mineLink',detailDialog:'#detailDialog',detailBody:'#detailBody',booking:'#schedule [data-booking*="room-3"]',offlineText:'You are offline'}
};

for(const name of (process.argv.slice(2).length?process.argv.slice(2):Object.keys(configs))){
 const c=configs[name];
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
 await mock(context);
 const page=await context.newPage();page.setDefaultTimeout(8000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const home=`${base}/experiences/${name}/`;
 const seed=async(rows,flags={})=>{
  await page.goto(home);
  await page.evaluate(([fixture,extra])=>{localStorage.setItem('srs-mine-fixture',JSON.stringify(fixture));localStorage.removeItem('srs-slow-schedule');localStorage.removeItem('srs-schedule-error');for(const [key,value] of Object.entries(extra))localStorage.setItem(key,value);},[rows,flags]);
 };
 const noOverflow=async(where)=>{
  for(const width of [320,360,375,390]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`horizontal scroll at ${width}px (${where})`);
  }
  await page.setViewportSize({width:390,height:844});
 };
 try{
  // ---- Every reservation state the retired classic screen carried ----
  await seed(mineFixture());
  await page.goto(`${home}?view=mine`);
  await page.locator(`${c.dialog}[open]`).waitFor();
  await page.locator('[data-mine-cancel="fixture-mine-room"]').waitFor();
  await page.waitForFunction(id=>document.activeElement?.id===id,c.title);
  assert.equal(await page.locator('ul[aria-label="Upcoming reservations"] .mine-card').count(),4,'upcoming list');
  assert.equal(await page.locator('ul[aria-label="Past reservations"] .mine-card').count(),3,'past list');
  for(const label of ['Approved','Pending review','Cancelled','Declined','Given to a higher priority'])
   assert(await page.locator('.mine-badge',{hasText:label}).count()>0,'missing status '+label);
  assert.equal(await page.getByText('Ended early · originally booked until 3:00 PM').count(),1,'ended-early original time');
  assert.equal(await page.locator('.mine-priority',{hasText:'You kept your time in Study Room 3'}).count(),1,'moved notice');
  assert.equal(await page.locator('.mine-priority',{hasText:'Nothing else was open'}).count(),1,'released notice');
  assert.equal(await page.locator('[data-mine-rebook="fixture-mine-overridden"]').count(),1,'Reserve another time');
  assert.equal(await page.locator('[data-mine-cancel="fixture-mine-pending"]').textContent(),'Cancel request');
  assert.equal(await page.locator('[data-mine-cancel="fixture-mine-room"]').textContent(),'Cancel reservation');
  assert.equal(await page.locator('[data-mine-end-early="fixture-mine-short"]').count(),0,'a single block cannot end early');
  assert.equal(await page.getByText('Whiteboard 4',{exact:true}).count(),1,'resource wording');
  assert.equal(await page.locator('a[href*="classic"]').count(),0,'no classic link anywhere on the page');
  assert.equal(await page.getByRole('link',{name:'Current app',exact:true}).count(),0,'no Current app link');
  const small=await page.locator(`${c.dialog} button`).evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44).length);
  assert.equal(small,0,'every My reservations control is at least 44px tall');
  await noOverflow('list');

  // ---- Reconnecting: the shared actions wait for a live schedule ----
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await page.locator(c.connection,{hasText:c.offlineText}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-mine-cancel="fixture-mine-room"]')?.disabled===true);
  assert.equal(await page.locator('[data-mine-end-early="fixture-mine-room"]').isEnabled(),false,'End early waits for a live schedule');
  await noOverflow('offline');
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>document.querySelector('[data-mine-cancel="fixture-mine-room"]')?.disabled===false);

  // ---- End early, driven by the keyboard, with its confirmation step ----
  await page.locator('[data-mine-end-early="fixture-mine-room"]').press('Enter');
  await page.locator('[data-mine-end="12:00"]').waitFor();
  assert.deepEqual(await page.locator('[data-mine-end]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mineEnd)),['11:30','12:00','12:30'],'30 minute boundaries');
  await noOverflow('end early chooser');
  await page.locator('[data-mine-end="12:00"]').press('Enter');
  await page.locator(c.endConfirm).waitFor();
  await page.locator(c.endConfirm).press('Enter');
  await page.locator('[data-mine-cancel="fixture-mine-room"]').waitFor();
  const endCall=await page.evaluate(()=>window.__calls.at(-1));
  assert.equal(endCall.name,'memberEndBookingEarly');
  assert.deepEqual(endCall.payload,{bookingId:'fixture-mine-room',end:'12:00'});
  assert.equal(await page.getByText('Ended early · originally booked until 1:00 PM').count(),1,'new original-time note');

  // ---- Cancel: keeping it returns focus to the button it came from ----
  await page.locator('[data-mine-cancel="fixture-mine-room"]').click();
  await page.locator(c.cancelConfirm).waitFor();
  await noOverflow('cancel confirmation');
  await page.locator(c.stepBack).click();
  await page.waitForFunction(()=>document.activeElement?.dataset?.mineCancel==='fixture-mine-room');
  await page.locator('[data-mine-cancel="fixture-mine-room"]').click();
  await page.locator(c.cancelConfirm).click();
  await page.locator(c.cancelConfirm).waitFor({state:'detached'});
  await page.locator('ul[aria-label="Past reservations"] .mine-card').nth(3).waitFor();
  const cancelCall=await page.evaluate(()=>window.__calls.at(-1));
  assert.equal(cancelCall.name,'memberCancelBooking');
  assert.deepEqual(cancelCall.payload,{bookingId:'fixture-mine-room'});
  assert.equal(await page.locator('ul[aria-label="Upcoming reservations"] .mine-card').count(),3);
  assert.equal(await page.locator('ul[aria-label="Past reservations"] .mine-card').count(),4);

  // ---- Footer navigation, the deep link, Back and Forward ----
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector=>!document.querySelector(selector).open&&!location.search.includes('view=mine'),c.dialog);
  assert.equal(await page.getByRole('link',{name:'My reservations',exact:true}).getAttribute('href'),'?view=mine');
  assert.equal(await page.getByRole('link',{name:'Admin',exact:true}).getAttribute('href'),'/admin/');
  assert.equal(await page.getByRole('link',{name:'Change design',exact:true}).getAttribute('href'),'/?choose=1');
  assert.equal(await page.locator('nav a').last().textContent(),'Admin','Admin is the last member navigation item');
  await page.getByRole('link',{name:'My reservations',exact:true}).click();
  await page.locator(`${c.dialog}[open]`).waitFor();
  assert.match(page.url(),/\?view=mine$/);
  await page.goBack();
  await page.waitForFunction(selector=>!document.querySelector(selector).open,c.dialog);
  assert.doesNotMatch(page.url(),/view=mine/);
  await page.goForward();
  await page.locator(`${c.dialog}[open]`).waitFor();
  assert.match(page.url(),/\?view=mine$/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector=>!document.querySelector(selector).open,c.dialog);
  await page.waitForFunction(id=>document.activeElement?.id===id,c.link);

  // ---- The reservation on the shared schedule carries the same actions ----
  await page.locator(c.booking).first().click();
  await page.locator(`${c.detailDialog}[open]`).waitFor();
  assert.equal(await page.locator(`${c.detailBody} [data-detail-action="cancel"]`).count(),1,'detail Cancel');
  assert.equal(await page.locator(`${c.detailBody} [data-detail-action="endEarly"]`).count(),1,'detail End early');
  await page.locator(`${c.detailBody} [data-detail-action="cancel"]`).click();
  await page.locator('[data-detail-action="cancel-confirm"]').waitFor();
  await page.locator('[data-detail-action="cancel-keep"]').click();
  await page.locator(`${c.detailBody} [data-detail-action="endEarly"]`).waitFor();
  await page.waitForFunction(()=>document.activeElement?.dataset?.detailAction==='cancel');
  await page.locator(`${c.detailBody} [data-detail-action="endEarly"]`).click();
  await page.locator(`${c.dialog}[open]`).waitFor();
  assert.deepEqual(await page.locator('[data-mine-end]').evaluateAll(nodes=>nodes.map(node=>node.dataset.mineEnd)),['13:30'],'end early from the detail sheet');
  await page.locator(c.stepBack).click();
  await page.locator('[data-mine-cancel="fixture-mine-ended"]').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(selector=>!document.querySelector(selector).open,c.dialog);
  await page.locator(c.booking).first().click();
  await page.locator(`${c.detailBody} [data-detail-action="cancel"]`).click();
  await page.locator('[data-detail-action="cancel-confirm"]').click();
  await page.locator(`${c.detailDialog}[open]`).waitFor({state:'detached'});
  const detailCancel=await page.evaluate(()=>window.__calls.at(-1));
  assert.equal(detailCancel.name,'memberCancelBooking');
  assert.deepEqual(detailCancel.payload,{bookingId:'fixture-mine-ended'});
  assert.equal(await page.locator(c.booking).count(),0,'the shared schedule frees the time');

  // ---- Loading, empty and error states ----
  await seed([],{'srs-slow-schedule':'1'});
  await page.goto(`${home}?view=mine`);
  await page.getByText('Finding your reservations.').waitFor();
  await page.getByText('No reservations yet.').waitFor();
  assert.equal(await page.locator(c.reserve).count(),1,'Reserve a space');
  await noOverflow('empty');
  await seed([],{'srs-schedule-error':'1'});
  await page.goto(`${home}?view=mine`);
  await page.getByText('Reservations unavailable.').waitFor();
  assert.equal(await page.locator(`${c.body} [data-recover], ${c.body} [data-retry]`).count(),1,'Retry connection');
  await noOverflow('error');

  // ---- Demo mode: the same screen, and no backend is reached ----
  await page.goto(`${home}?demo=1`);
  await page.getByRole('link',{name:'My reservations',exact:true}).click();
  await page.locator(`${c.dialog}[open]`).waitFor();
  assert.match(page.url(),/\?demo=1&view=mine$/,'other parameters are preserved');
  const demoCancel=page.locator('[data-mine-cancel]').first();
  await demoCancel.waitFor();
  const demoId=await demoCancel.getAttribute('data-mine-cancel');
  await demoCancel.click();
  await page.locator(c.cancelConfirm).click();
  await page.locator(c.cancelConfirm).waitFor({state:'detached'});
  assert.equal(await page.locator(`[data-mine-cancel="${demoId}"]`).count(),0,'demo cancel updates the list');
  assert.equal(await page.evaluate(()=>window.__calls.length),0,'demo mode reaches no backend');
  await noOverflow('demo');

  assert.equal(errors.length,0,errors.join('; '));
  results.push({name:name+'-mine',passed:true,checks:[
   'both lists and every classic status',
   'ended-early original time, moved and released notices, Reserve another time',
   'Cancel reservation and Cancel request, each with a confirmation',
   'keyboard End early with the chooser, confirmation and payload',
   'focus return after Keep it, and to the footer link after closing',
   '44px controls and no horizontal scroll at 320, 360, 375 and 390',
   'offline disables Cancel and End early until the schedule is live',
   '?view=mine deep link with Back and Forward, demo=1 preserved',
   'detail sheet cancels in place and hands End early to the in-design view',
   'loading, empty and error states',
   'demo reservations cancel without a backend call',
   'no classic link and no Current app'
  ],errors});
 }catch(e){
  results.push({name:name+'-mine',passed:false,error:e.message,at:String(e.stack||'').split('\n').find(line=>line.includes('member-mine-smoke-l2'))?.trim(),errors});
 }
 await context.close();
}

await browser.close();server.close();
console.log(JSON.stringify(results,null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
