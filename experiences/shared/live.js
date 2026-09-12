import {eligibleDays,projectBookings,validateInput,publicName,prefixes,units,clock} from './model.js';
const demo=new URLSearchParams(location.search).get('demo')==='1';
let state={status:'loading',canBook:false,demo,error:'',days:eligibleDays(),bookings:[]};
let listeners=new Set(),started=false,unsubscribe=null,generation=0,timer=null,backend=null,pending=false,serial=0;
function emit(patch){state={...state,...patch};for(const listener of listeners)listener({...state,bookings:state.bookings.map(b=>({...b})),days:state.days.map(d=>({...d}))});}
export function subscribe(listener){listeners.add(listener);listener({...state});if(!started){started=true;connect();}return ()=>listeners.delete(listener);}
export function retry(){if(pending)return;connect();}
function sampleBookings(){return state.days.flatMap(d=>[
 {date:d.key,status:'approved',start:d.weekday===6?'11:00':'10:00',end:'12:30',name:'Robin Sample',purpose:'contact',needs:{room:true},assignments:{room:'room-1'}},
 {date:d.key,status:'approved',start:'11:30',end:'12:30',name:'Jordan Example',purpose:'new-member',needs:{room:true},assignments:{room:'room-2'}},
 {date:d.key,status:'approved',start:'12:00',end:'13:00',name:'Private administrative hold',purpose:'blocked',needs:{room:true},assignments:{room:'room-3'}},
 {date:d.key,status:'approved',start:'11:30',end:'12:30',name:'Avery Example',purpose:'other',needs:{whiteboard:true},assignments:{whiteboard:'wb-1'}},
 {date:d.key,status:'approved',start:'12:00',end:'13:00',name:'Morgan Sample',purpose:'new-member',needs:{tv:true},assignments:{tv:'tv-2'}}]);}
async function connect(){
  const token=++generation;unsubscribe?.();unsubscribe=null;clearTimeout(timer);backend=null;
  emit({status:'loading',canBook:false,error:'',days:eligibleDays(),bookings:[]});
  if(demo){const mode=new URLSearchParams(location.search).get('state');if(mode==='error'&&serial++===0){emit({status:'error',error:'Simulated connection error. Try again.'});return;}emit({status:'demo',canBook:true,bookings:mode==='empty'?[]:projectBookings(sampleBookings(),state.days)});return;}
  timer=setTimeout(()=>{if(token===generation&&!state.canBook)emit({status:'error',canBook:false,error:'The shared schedule is taking longer to connect. Please try again.'});},12000);
  try {
    await import('/firebase-config.js');
    const [appMod,fs,authMod,fn]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js')]);
    if(token!==generation)return;
    const app=appMod.getApps().length?appMod.getApp():appMod.initializeApp(window.FIREBASE_CONFIG);
    const auth=authMod.getAuth(app);
    await new Promise((resolve,reject)=>{let stop=authMod.onAuthStateChanged(auth,()=>{stop();resolve();},reject);});
    if(!auth.currentUser)await authMod.signInAnonymously(auth);
    if(token!==generation)return;
    const functions=fn.getFunctions(app,'us-west1');
    backend={auth,call:fn.httpsCallable(functions,'memberSubmitBooking')};
    const query=fs.query(fs.collection(fs.getFirestore(app),'bookings'),fs.where('date','in',state.days.map(d=>d.key)));
    unsubscribe=fs.onSnapshot(query,{includeMetadataChanges:true},snap=>{
      if(token!==generation)return;
      if(snap.metadata.fromCache){emit({status:'offline',canBook:false,error:'Reconnecting to the shared schedule. Reservations are paused until it is live.'});return;}
      clearTimeout(timer);emit({status:'live',canBook:true,error:'',bookings:projectBookings(snap.docs.map(d=>d.data()),state.days)});
    },()=>{clearTimeout(timer);emit({status:'error',canBook:false,error:'The shared schedule could not connect. Please try again.'});});
  }catch{if(token===generation){clearTimeout(timer);emit({status:'error',canBook:false,error:'Could not establish a secure connection. Please try again.'});}}
}
export async function submit(input){
  if(pending)throw new Error('Your reservation is still saving. Please wait.');
  if(!state.canBook||(!demo&&(!backend?.auth.currentUser||state.status!=='live')))throw new Error('The shared schedule is reconnecting. Please wait until it is live.');
  if(eligibleDays().map(d=>d.key).join()!==state.days.map(d=>d.key).join()){retry();throw new Error('The available dates changed. Please choose your time again.');}
  const safe=validateInput(input,state.bookings,state.days);pending=true;
  try{
    let unit=safe.availableUnit;
    if(!demo){
      const result=await backend.call({date:safe.day,start:clock(safe.start),end:clock(safe.end),name:safe.name,resourceType:safe.type,purpose:safe.purpose==='new'?'new-member':safe.purpose,purposeOther:safe.purpose==='other'?safe.purposeOther:'',...(safe.override||safe.unit===null?{}:{requestedUnit:prefixes[safe.type]+safe.unit})});
      const data=result.data;
      if(!data||typeof data.bookingId!=='string'||data.status!=='approved')throw new Error('The server could not confirm the reservation. Check My reservations before trying again.');
      try{const saved=JSON.parse(localStorage.getItem('srs-my-bookings')||'[]');const ids=Array.isArray(saved)?saved.filter(x=>typeof x==='string'):[];localStorage.setItem('srs-my-bookings',JSON.stringify([...new Set([...ids,data.bookingId])]));localStorage.setItem('srs-name',safe.name);}catch{}
      const assignment=data.assignment;
      unit=typeof assignment==='string'&&assignment.startsWith(prefixes[safe.type])?Number(assignment.slice(prefixes[safe.type].length)):NaN;
      if(!Number.isInteger(unit)||unit<1||unit>units[safe.type]||(safe.unit!==null&&unit!==safe.unit))throw new Error('Your booking was saved with a different assignment. Please check My reservations.');
    }
    const saved={key:`slot-${safe.day}-${safe.type}-${unit}-${safe.start}-${safe.end}`,day:safe.day,type:safe.type,unit,start:safe.start,end:safe.end,name:publicName(safe.name),purpose:safe.purpose,blocked:false,status:'approved',override:Boolean(safe.override)};
    if(demo&&safe.override){
      state={...state,bookings:state.bookings.filter(b=>!(b.day===saved.day&&b.type===saved.type&&b.unit===saved.unit&&saved.start<b.end&&saved.end>b.start))};
    }
    // The server result is authoritative. Avoid duplicating an already-arrived snapshot.
    const exists=state.bookings.some(b=>b.day===saved.day&&b.type===saved.type&&b.unit===saved.unit&&b.start===saved.start&&b.end===saved.end);
    emit({bookings:exists?state.bookings:[...state.bookings,saved]});
    return saved;
  }catch(error){
    if(error?.code){const code=String(error.code);if(code.includes('already-exists'))throw new Error('That space was just reserved. Please choose another time.');if(code.includes('resource-exhausted'))throw new Error('The reservation limit was reached. Please wait or check My reservations.');if(code.includes('deadline')||code.includes('unavailable'))throw new Error('The connection was interrupted. Check My reservations before submitting again.');throw new Error('The reservation was not confirmed. Please check your details and try again.');}
    throw error;
  }finally{pending=false;}
}
addEventListener('offline',()=>{if(!demo)emit({status:'offline',canBook:false,error:'You are offline. Reconnect to make a reservation.'});});
addEventListener('online',()=>{if(!demo&&started&&!pending)retry();});
document.addEventListener('visibilitychange',()=>{if(!demo&&started&&!document.hidden&&!pending&&(state.status!=='live'||eligibleDays().map(d=>d.key).join()!==state.days.map(d=>d.key).join()))retry();});
