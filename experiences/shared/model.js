export const units = {room:4,whiteboard:5,tv:3};
export const prefixes = {room:'room-',whiteboard:'wb-',tv:'tv-'};
export function eligibleDays(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=type=>parts.find(p=>p.type===type).value;
  const today=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  return [2,6].map(weekday=>{const date=new Date(today);date.setUTCDate(date.getUTCDate()+(weekday-date.getUTCDay()+7)%7);return {key:date.toISOString().slice(0,10),label:date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}),weekday};}).sort((a,b)=>a.key.localeCompare(b.key));
}
export function publicName(value) {
  const parts=String(value||'').trim().split(/\s+/).filter(Boolean).filter(p=>!/^(brother|sister|elder|missionary|deacon|deaconess|pastor)$/i.test(p));
  if(parts.length>1&&/^[BSEMDP]\.$/i.test(parts[0]))parts.shift();
  if(!parts.length)return 'Reserved';
  return parts.length===1?parts[0]:`${parts[0]} ${parts.at(-1).charAt(0).toUpperCase()}.`;
}
export function minutes(value) {return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;}
export function clock(value) {return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
export function priorityForPurpose(purpose) {return ({contact:0,new:1,'new-member':1,other:3,blocked:4}[purpose]??3);}
export function overrideUnitForRange(type,day,start,end,purpose,bookings,exactUnit=null) {
  const candidatePriority=priorityForPurpose(purpose);
  if(!['contact','new'].includes(purpose))return null;
  const ids=Array.from({length:units[type]||0},(_,i)=>i+1).filter(unit=>exactUnit==null||exactUnit===unit);
  const free=ids.some(unit=>!bookings.some(b=>b.day===day&&b.type===type&&b.unit===unit&&start<b.end&&end>b.start));
  if(free)return null;
  return ids.find(unit=>{
    const holders=bookings.filter(b=>b.day===day&&b.type===type&&b.unit===unit&&start<b.end&&end>b.start);
    return holders.length&&holders.every(b=>!b.blocked&&priorityForPurpose(b.purpose)>candidatePriority&&['new','other'].includes(b.purpose));
  })||null;
}
export function projectBookings(records,days=eligibleDays()) {
  const output=[];
  for(const b of records){
    if(!b||b.status!=='approved'||!days.some(d=>d.key===b.date))continue;
    const start=minutes(b.start),end=minutes(b.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)continue;
    for(const [type,count] of Object.entries(units)){
      const raw=b.assignments?.[type];const unit=typeof raw==='string'&&raw.startsWith(prefixes[type])?Number(raw.slice(prefixes[type].length)):NaN;
      if(!b.needs?.[type]||!Number.isInteger(unit)||unit<1||unit>count)continue;
      const blocked=b.purpose==='blocked';
      output.push({key:`slot-${b.date}-${type}-${unit}-${start}-${end}`,day:b.date,type,unit,start,end,name:blocked?'Reserved':publicName(b.name),purpose:blocked?'blocked':b.purpose==='contact'?'contact':['new','new-member'].includes(b.purpose)?'new':'other',blocked});
    }
  }
  return output;
}
export function validRange(day,start,end,days=eligibleDays()) {
  const date=days.find(d=>d.key===day);
  if(!date||!Number.isInteger(start)||!Number.isInteger(end)||start%30||end%30||start<600||end>1380||start>=end)return false;
  const services=date.weekday===6?[[600,660],[870,930],[1170,1230]]:[[1170,1230]];
  return !services.some(([a,b])=>start<b&&end>a);
}
export function validateInput(input,bookings,days=eligibleDays()) {
  const {day,type,start,end}=input;
  if(!Object.hasOwn(units,type)||!validRange(day,start,end,days))throw new Error('Choose an available time on an upcoming Tuesday or Saturday.');
  const unit=input.unit==null?null:Number(input.unit);
  if(unit!==null&&(!Number.isInteger(unit)||unit<1||unit>units[type]))throw new Error('Choose a valid room or resource.');
  const name=String(input.name||'').trim(), purpose=input.purpose, purposeOther=String(input.purposeOther||'').trim();
  if(!/[\p{L}\p{N}]/u.test(name)||name.length>120)throw new Error('Please enter your name (up to 120 characters).');
  if(!['contact','new','other'].includes(purpose))throw new Error('Choose a purpose.');
  if(purpose==='other'&&(!purposeOther||purposeOther.length>240))throw new Error('Describe the purpose in 240 characters or fewer.');
  const free=Array.from({length:units[type]},(_,i)=>i+1).filter(n=>(unit===null||unit===n)&&!bookings.some(b=>b.day===day&&b.type===type&&b.unit===n&&start<b.end&&end>b.start));
  const overrideUnit=free.length||unit!==null?null:overrideUnitForRange(type,day,start,end,purpose,bookings,null);
  if(!free.length&&!overrideUnit)throw new Error('That space is no longer open for the whole time. Please choose another time.');
  return {day,type,start,end,unit,name,purpose,purposeOther,availableUnit:free[0]??overrideUnit,override:Boolean(overrideUnit)};
}
