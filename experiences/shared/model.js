export const units = {room:4,whiteboard:5,tv:3};
export const prefixes = {room:'room-',whiteboard:'wb-',tv:'tv-'};
export const SPECIAL_BOOKING_DATE = '2026-09-21';
const TITLE_INITIALS = {brother:'B',sister:'S',elder:'E',missionary:'M',deacon:'D',deaconess:'D',pastor:'P'};
const MEMBER_PURPOSES = ['contact','new','new-member','other'];
const RESERVED_FOR_LIMITS = {contact:120,'new':120,'new-member':120,other:240};
const RESERVED_FOR_LABELS = {contact:'Contact name',new:'Member name','new-member':'Member name',other:'Purpose description'};

function nameKey(value) {return String(value||'').normalize('NFKC').trim().toLocaleLowerCase('en-US');}
function surnameInitial(value) {
  const first=[...String(value||'').replace(/^[^\p{L}\p{N}]+/u,'')][0];
  return first?first.toLocaleUpperCase('en-US'):'';
}
export function parsePublicName(value) {
  const tokens=String(value||'').trim().split(/\s+/).filter(Boolean);
  let titleInitial='';
  if(tokens.length){
    const candidate=tokens[0].replace(/[.,]+$/g,'');
    const titleWord=TITLE_INITIALS[candidate.toLocaleLowerCase('en-US')];
    if(titleWord)titleInitial=titleWord;
    else if(/^[BSEMDP]$/i.test(candidate))titleInitial=candidate.toUpperCase();
    if(titleInitial)tokens.shift();
  }
  const givenName=tokens.shift()||'';
  const surname=tokens.join(' ');
  const surnameParts=surname.split(/\s+/).filter(Boolean);
  const surnameText=surnameParts.join(' ');
  const cleanedSurname=surnameText.replace(/[.,]+/g,'');
  const surnameKey=surnameParts.length===1&&/^[\p{L}]$/u.test(cleanedSurname)
    ? `initial:${nameKey(cleanedSurname)}`
    : `name:${nameKey(surnameText)}`;
  return {titleInitial,givenName,surname,surnameKey,givenKey:nameKey(givenName),surnameInitial:surnameInitial(surnameText)};
}
function peerNameValues(peers) {
  if(!Array.isArray(peers))return [];
  return peers.map(peer=>{
    if(typeof peer==='string')return peer;
    if(!peer||typeof peer!=='object'||peer.blocked===true||peer.purpose==='blocked')return '';
    return peer.name||peer.displayName||'';
  }).filter(Boolean);
}
export function publicName(value,peers=[]) {
  const parsed=parsePublicName(value);
  if(!parsed.givenName)return 'Reserved';
  const collision=peerNameValues(peers).some(peer=>{
    const other=parsePublicName(peer);
    return other.givenKey===parsed.givenKey&&other.surnameKey!==parsed.surnameKey;
  });
  return [parsed.titleInitial,parsed.givenName,collision?parsed.surnameInitial:''].filter(Boolean).join(' ');
}
export function reservedForLabel(purpose) {return RESERVED_FOR_LABELS[purpose]||'Reserved for';}
export function validateReservedFor(purpose,value,{required=true}={}) {
  if(!MEMBER_PURPOSES.includes(purpose))return '';
  const text=String(value??'').trim();
  const label=reservedForLabel(purpose);
  if(!/[\p{L}\p{N}]/u.test(text)){
    if(required)throw new Error(`${label} is required.`);
    return '';
  }
  const limit=RESERVED_FOR_LIMITS[purpose];
  if(text.length>limit)throw new Error(`${label} must be ${limit} characters or fewer.`);
  return text;
}
export function eligibleDays(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=type=>parts.find(p=>p.type===type).value;
  const todayKey=`${part('year')}-${part('month')}-${part('day')}`;
  const today=new Date(`${todayKey}T12:00:00Z`);
  const days=[2,6].map(weekday=>{const date=new Date(today);date.setUTCDate(date.getUTCDate()+(weekday-date.getUTCDay()+7)%7);return {key:date.toISOString().slice(0,10),label:date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}),weekday};});
  if(todayKey<=SPECIAL_BOOKING_DATE){
    const date=new Date(`${SPECIAL_BOOKING_DATE}T12:00:00Z`);
    days.push({key:SPECIAL_BOOKING_DATE,label:date.toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'}),weekday:1});
  }
  return Array.from(new Map(days.map(day=>[day.key,day])).values()).sort((a,b)=>a.key.localeCompare(b.key));
}
export function minutes(value) {return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;}
export function clock(value) {return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
export function priorityForPurpose(purpose) {return ({contact:0,new:1,'new-member':1,other:3,blocked:4}[purpose]??3);}
function projectedPurpose(purpose) {return purpose==='blocked'?'blocked':purpose==='contact'?'contact':['new','new-member'].includes(purpose)?'new':'other';}
function projectedReservedFor(booking,purpose=projectedPurpose(booking?.purpose)) {const value=typeof booking?.reservedFor==='string'&&booking.reservedFor.trim()?booking.reservedFor:purpose==='other'&&typeof booking?.purposeOther==='string'?booking.purposeOther:'';return String(value||'').trim();}
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
  const source=Array.isArray(records)?records:[];
  const publicNames=source.filter(b=>b&&b.status==='approved'&&b.purpose!=='blocked').map(b=>b.name).filter(Boolean);
  const output=[];
  for(const b of source){
    if(!b||b.status!=='approved'||!days.some(d=>d.key===b.date))continue;
    const start=minutes(b.start),end=minutes(b.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)continue;
    for(const [type,count] of Object.entries(units)){
      const raw=b.assignments?.[type];const unit=typeof raw==='string'&&raw.startsWith(prefixes[type])?Number(raw.slice(prefixes[type].length)):NaN;
      if(!b.needs?.[type]||!Number.isInteger(unit)||unit<1||unit>count)continue;
      const blocked=b.purpose==='blocked';
      output.push({key:`slot-${b.date}-${type}-${unit}-${start}-${end}`,day:b.date,type,unit,start,end,name:blocked?'Reserved':publicName(b.name,publicNames),purpose:projectedPurpose(b.purpose),reservedFor:blocked?'':projectedReservedFor(b),blocked});
    }
  }
  return output;
}
export function projectOwnedBookings(records,days=eligibleDays(),ownerUid) {
  if(!ownerUid)return [];
  const source=Array.isArray(records)?records:[];
  const publicNames=source.filter(b=>b&&b.status==='approved'&&b.purpose!=='blocked').map(b=>b.name).filter(Boolean);
  return source.filter(b=>b&&b.ownerUid===ownerUid&&days.some(d=>d.key===b.date)).map(b=>{
    const blocked=b.purpose==='blocked';
    const purpose=projectedPurpose(b.purpose);
    const resource=Object.entries(units).map(([type,count])=>{
      const raw=b.assignments?.[type];
      const unit=typeof raw==='string'&&raw.startsWith(prefixes[type])?Number(raw.slice(prefixes[type].length)):NaN;
      return Number.isInteger(unit)&&unit>=1&&unit<=count?{type,unit}:null;
    }).find(Boolean);
    const reservedFor=typeof b.reservedFor==='string'&&b.reservedFor.trim()
      ?b.reservedFor.trim()
      :purpose==='other'&&typeof b.purposeOther==='string'?b.purposeOther.trim():'';
    return {
      id:typeof b.id==='string'?b.id:'',key:resource?`slot-${b.date}-${resource.type}-${resource.unit}-${minutes(b.start)}-${minutes(b.end)}`:'',date:b.date,start:b.start,end:b.end,
      name:String(b.name||''),displayName:blocked?'Reserved':publicName(b.name,publicNames),purpose,
      purposeOther:purpose==='other'?(typeof b.purposeOther==='string'?b.purposeOther.trim():''):'',reservedFor,
      status:b.status,blocked,needs:{...(b.needs||{})},assignments:{...(b.assignments||{})},
      endedEarlyFrom:typeof b.endedEarlyFrom==='string'?b.endedEarlyFrom:null,
      priorityNotice:b.priorityNotice||null,
      canCancel:b.status==='pending'||b.status==='approved',
      canEndEarly:b.status==='approved'&&minutes(b.end)-minutes(b.start)>30
    };
  });
}
export function validRange(day,start,end,days=eligibleDays()) {
  const date=days.find(d=>d.key===day);
  if(!date||!Number.isInteger(start)||!Number.isInteger(end)||start%30||end%30||start<600||end>1380||start>=end)return false;
  const services=date.key===SPECIAL_BOOKING_DATE
    ?[[600,660],[870,930]]
    :date.weekday===6?[[600,660],[870,930],[1170,1230]]:[[1170,1230]];
  return !services.some(([a,b])=>start<b&&end>a);
}
export function validateInput(input,bookings,days=eligibleDays()) {
  const {day,type,start,end}=input;
  if(!Object.hasOwn(units,type)||!validRange(day,start,end,days))throw new Error('Choose an available time on an eligible scheduling day.');
  const unit=input.unit==null?null:Number(input.unit);
  if(unit!==null&&(!Number.isInteger(unit)||unit<1||unit>units[type]))throw new Error('Choose a valid room or resource.');
  const name=String(input.name||'').trim(), purpose=input.purpose, purposeOther=String(input.purposeOther||'').trim();
  if(!/[\p{L}\p{N}]/u.test(name)||name.length>120)throw new Error('Please enter your name (up to 120 characters).');
  if(!['contact','new','other'].includes(purpose))throw new Error('Choose a purpose.');
  const hasReservedFor=Object.hasOwn(input,'reservedFor');
  const reservedFor=hasReservedFor
    ?validateReservedFor(purpose,input.reservedFor)
    :validateReservedFor(purpose,purpose==='other'?purposeOther:'',{required:false});
  if(purpose==='other'&&!reservedFor)throw new Error('Describe the purpose in 240 characters or fewer.');
  const free=Array.from({length:units[type]},(_,i)=>i+1).filter(n=>(unit===null||unit===n)&&!bookings.some(b=>b.day===day&&b.type===type&&b.unit===n&&start<b.end&&end>b.start));
  const overrideUnit=free.length?null:overrideUnitForRange(type,day,start,end,purpose,bookings,unit);
  if(!free.length&&!overrideUnit)throw new Error('That space is no longer open for the whole time. Please choose another time.');
  return {day,type,start,end,unit,name,purpose,purposeOther:purpose==='other'?reservedFor:purposeOther,reservedFor,availableUnit:free[0]??overrideUnit,override:Boolean(overrideUnit)};
}