import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,extname} from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname),results=[];
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const path=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));if(!path.startsWith(root+'/'))throw 0;res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.statusCode=404;res.end('Not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true});
const configs={solace:{reserve:'#reserve',resource:'#resources [data-type]',open:'.open-slot',end:'[data-end-choice]',name:'#guest-name',reservedFor:'#reserved-for',form:'#name-form',confirm:'#confirm-reservation',success:'#see-reservation',error:'#save-error'},velum:{reserve:'#reserve-now',resource:'[data-resource]',open:'.open-slot',end:'[data-time-end]',name:'#display-name',reservedFor:'#reserved-for',form:'#name-form',confirm:'#confirm-reservation',success:'#see-reservation',error:'#save-error'},cove:{reserve:'[data-reserve]:visible',resource:'.resource[data-resource]',open:'.open',end:'[data-end]',name:'#guest-name',reservedFor:'#reserved-for',form:'#reserved-for-form',confirm:'#confirm',success:'#view-booking',error:'#form-error'},petal:{reserve:'#reserve',resource:'[data-resource]',open:'.open',end:'[data-end]',name:'#guestName',reservedFor:'#reservedFor',form:'#nameForm',confirm:'#confirm',success:'#seeReservation',error:'#draftError'}};
configs.atlas={reserve:'#reserve',resource:'.meter[data-type]',open:'.roomSlot.open',end:'[data-end]',name:'#name',reservedFor:'#reservedFor',form:'#reservedForForm',confirm:'#confirm',success:'#finish',error:'#dialogError'};
configs.lattice={reserve:'#reserve',resource:'.overview [data-type]',open:'button.slot.open',end:'[data-end-choice]',name:'#name',reservedFor:'#reservedFor',form:'#reservedForForm',confirm:'#confirm',success:'#finish',error:'#flowNotice'};
async function mock(context){
 await context.addInitScript(()=>{window.__calls=[];window.__rejectNext=true;});
 await context.route('**/firebasejs/10.12.2/firebase-*.js',route=>{
  const part=route.request().url().split('firebase-').pop();let body='';
  if(part==='app.js')body='export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});';
  if(part==='auth.js')body="export const getAuth=()=>({currentUser:{uid:'fixture-current-owner'}});export const onAuthStateChanged=(a,cb)=>{queueMicrotask(()=>cb(a.currentUser));return ()=>{};};export const signInAnonymously=()=>{throw Error('Existing identity must be restored');};";
  if(part==='firestore.js')body="export const getFirestore=()=>({});export const collection=()=>({});export const where=(...a)=>a;export const query=(...a)=>a;export function onSnapshot(q,opts,cb){window.__snapshot=cb;window.__query=q;queueMicrotask(()=>cb({metadata:{fromCache:false},empty:true,docs:[]}));return ()=>{};}export const doc=()=>({});export const setDoc=()=>{throw Error('Unexpected direct write');};export const updateDoc=()=>{throw Error('Unexpected direct write');};export const serverTimestamp=()=>0;export const Timestamp={};";
  if(part==='functions.js')body="export const getFunctions=()=>({});export const httpsCallable=(f,name)=>async payload=>{window.__calls.push({name,payload});await new Promise(r=>setTimeout(r,80));if(name==='memberSubmitBooking'&&window.__rejectNext){window.__rejectNext=false;throw {code:'functions/already-exists'};}if(name==='memberSchedule')return {data:{version:1,days:[],bookings:[],myBookings:[]}};return {data:{bookingId:'fixture-owned-id-'+window.__calls.length,status:'approved',assignment:payload.requestedUnit||({room:'room-1',whiteboard:'wb-1',tv:'tv-1'})[payload.resourceType]}};};";
  return route.fulfill({contentType:'text/javascript',body});
 });
}
for(const name of (process.argv.slice(2).length?process.argv.slice(2):Object.keys(configs))){
 const c=configs[name],context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await mock(context);const page=await context.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
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
  await page.goto(`${base}/experiences/${name}/?demo=1`);await page.locator(c.open).first().waitFor();
  assert(!await page.getByText('Private administrative hold',{exact:true}).count());
  const evidence=resolve(root,'docs/live-design-evidence');await mkdir(evidence,{recursive:true});await page.screenshot({path:resolve(evidence,name+'-phone.png')});await page.setViewportSize({width:1280,height:720});await page.screenshot({path:resolve(evidence,name+'-desktop.png')});
  results.push({name,passed:true,checks:['resource-first','three exact-unit backend payloads','Other details','failed save retained draft','canonical success','ownership preserved','offline blocks Open and submit','390px no overflow','phone and desktop captures'],errors});
 }catch(e){results.push({name,passed:false,error:e.message,errors});}
 await context.close();
}

const choiceContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await mock(choiceContext);const choicePage=await choiceContext.newPage();
try{
 await choicePage.goto(base+'/?choose=1');await choicePage.locator('dialog.design-picker[open]').waitFor();assert.equal(await choicePage.locator('[data-design]').count(),6);
 await choicePage.screenshot({path:resolve(root,'docs/live-design-evidence/chooser-phone.png')});
 await choicePage.locator('[data-design="cove"]').click();await choicePage.waitForURL('**/experiences/cove/');assert.equal(await choicePage.evaluate(()=>localStorage.getItem('srs-design-v1')),'cove');
 await choicePage.goto(base+'/');await choicePage.waitForURL('**/experiences/cove/');
 await choicePage.getByRole('link',{name:'My reservations',exact:true}).click();await choicePage.locator('#tab-mine[aria-selected="true"]').waitFor();assert.equal(await choicePage.evaluate(()=>localStorage.getItem('srs-design-v1')),'cove');
 await choicePage.locator('.design-change-button').click();await choicePage.locator('.dp-current').click();assert.equal(await choicePage.evaluate(()=>localStorage.getItem('srs-design-v1')),'classic');
 await choicePage.goto(base+'/');assert.equal(await choicePage.locator('dialog.design-picker[open]').count(),0);assert.equal(await choicePage.locator('.design-change-button').count(),1);
 assert.equal(await choicePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 results.push({name:'chooser',passed:true,checks:['six choices plus current','remembered design redirects','My reservations retains existing preference and opens mine','remain current persists','change design remains reachable','phone no overflow']});
}catch(e){results.push({name:'chooser',passed:false,error:e.message});}
await choiceContext.close();

await browser.close();server.close();await writeFile(resolve(root,'docs/live-design-evidence/results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
