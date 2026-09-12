import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleDays,projectBookings,projectOwnedBookings,validateInput,validRange,publicName,parsePublicName,validateReservedFor,overrideUnitForRange} from '../experiences/shared/model.js';
const days=eligibleDays(new Date('2026-09-12T20:00:00Z'));
test('eligible days use Los Angeles calendar at UTC midnight',()=>{
 assert.deepEqual(eligibleDays(new Date('2026-09-13T01:00:00Z')).map(d=>d.key),['2026-09-12','2026-09-15']);
 assert.deepEqual(eligibleDays(new Date('2026-09-13T08:00:00Z')).map(d=>d.key),['2026-09-15','2026-09-19']);
});
test('schedule projection exposes only safe names and renders private holds neutrally',()=>{
 const records=[{date:days[0].key,start:'11:00',end:'12:00',name:'Sister Jordan Example',purpose:'contact',reservedFor:'Joey',status:'approved',needs:{room:true},assignments:{room:'room-2'},ownerUid:'private-owner',note:'private-note',bookingId:'private-id'}, {date:days[0].key,start:'12:00',end:'13:00',name:'Private Admin Name',purpose:'blocked',status:'approved',needs:{tv:true},assignments:{tv:'tv-1'}}];
 const projected=projectBookings(records,days);
 assert.equal(projected[0].name,'S Jordan');assert.equal(projected[0].reservedFor,'Joey');assert.equal(projected[1].name,'Reserved');assert.equal(projected[1].blocked,true);
 assert(!JSON.stringify(projected).includes('private-'));assert(!JSON.stringify(projected).includes('Private Admin'));
 assert.deepEqual(Object.keys(projected[0]).sort(),['key','day','type','unit','start','end','name','purpose','reservedFor','blocked'].sort());
 assert.equal(projectBookings([{...records[0],status:'cancelled'}],days).length,0);
});
test('normalizes leading titles and adds surname initials only for given-name collisions',()=>{
 assert.equal(publicName('Sister Kiana Davis'),'S Kiana');
 assert.equal(publicName('Sister Kiana D'),'S Kiana');
 assert.equal(publicName('S. Kiana'),'S Kiana');
 assert.equal(publicName('Kiana'),'Kiana');
 assert.deepEqual(parsePublicName('Brother Kiana Davis').givenName,'Kiana');
 const records=[
  {date:days[0].key,start:'11:00',end:'12:00',name:'Sister Kiana Davis',purpose:'contact',status:'approved',needs:{room:true},assignments:{room:'room-1'}},
  {date:days[0].key,start:'11:00',end:'12:00',name:'Kiana Rodriguez',purpose:'new-member',status:'approved',needs:{room:true},assignments:{room:'room-2'}},
  {date:days[0].key,start:'11:00',end:'12:00',name:'Kiana Davis',purpose:'other',status:'approved',needs:{room:true},assignments:{room:'room-3'}},
  {date:days[0].key,start:'11:00',end:'12:00',name:'Private Kiana Hold',purpose:'blocked',status:'approved',needs:{room:true},assignments:{room:'room-4'}}
 ];
 const names=projectBookings(records,days).map(row=>row.name);
 assert.deepEqual(names,['S Kiana D','Kiana R','Kiana D','Reserved']);
});
test('direct unit availability never silently substitutes another room',()=>{
 const input={day:days[0].key,type:'room',unit:2,start:660,end:720,name:'Robin Test',purpose:'contact'};
 const booked=[{day:days[0].key,type:'room',unit:2,start:690,end:750}];
 assert.throws(()=>validateInput(input,booked,days),/no longer open/);
 assert.equal(validateInput({...input,unit:null},booked,days).availableUnit,1);
 assert.throws(()=>validateInput({...input,unit:5},[],days),/valid room/);
});
test('Contact sees a lower-priority occupied range as an override candidate',()=>{
 const day=days[0].key;
 const bookings=[
  {day,type:'room',unit:1,start:660,end:720,purpose:'new',blocked:false},
  {day,type:'room',unit:2,start:660,end:720,purpose:'other',blocked:false},
  {day,type:'room',unit:3,start:660,end:720,purpose:'contact',blocked:false},
  {day,type:'room',unit:4,start:660,end:720,purpose:'blocked',blocked:true}
 ];
 assert.equal(overrideUnitForRange('room',day,660,720,'contact',bookings),1);
 assert.equal(overrideUnitForRange('room',day,660,720,'new',bookings),2);
 assert.equal(overrideUnitForRange('room',day,660,720,'other',bookings),null);
 assert.equal(validateInput({day,type:'room',unit:null,start:660,end:720,name:'Robin Test',purpose:'contact'},bookings,days).override,true);
 assert.throws(()=>validateInput({day,type:'room',unit:1,start:660,end:720,name:'Robin Test',purpose:'contact'},bookings,days),/no longer open/);
});
test('time boundaries and Other details are enforced',()=>{
 assert(validRange(days[0].key,660,690,days));assert(!validRange(days[0].key,840,900,days));assert(validRange(days[0].key,1350,1380,days));
 const input={day:days[0].key,type:'tv',unit:3,start:660,end:690,name:'Robin Test',purpose:'other'};
 assert.throws(()=>validateInput(input,[],days),/Describe/);assert.equal(validateInput({...input,purposeOther:'Lesson review'},[],days).purposeOther,'Lesson review');
 assert.throws(()=>validateInput({...input,name:'\u200b',purpose:'contact'},[],days),/name/);
});
test('reserved-for values are validated and round-trip through the shared input model',()=>{
 assert.equal(validateReservedFor('contact','  Sister Kiana  '),'Sister Kiana');
 assert.equal(validateReservedFor('new','Member Kiana'),'Member Kiana');
 assert.equal(validateReservedFor('other','  Bible study  '),'Bible study');
 assert.throws(()=>validateReservedFor('contact','   '),/Contact name is required/);
 assert.throws(()=>validateReservedFor('other','x'.repeat(241)),/240/);
 const input={day:days[0].key,type:'tv',unit:3,start:660,end:690,name:'Robin Test',purpose:'contact',reservedFor:'Sister Kiana'};
 assert.equal(validateInput(input,[],days).reservedFor,'Sister Kiana');
 assert.equal(validateInput({...input,purpose:'other',reservedFor:'Bible study'},[],days).purposeOther,'Bible study');
});
test('public projection includes the requested reservation detail without owner metadata',()=>{
 const record={id:'mine',ownerUid:'owner-1',date:days[0].key,start:'11:00',end:'12:00',name:'Sister Kiana Davis',purpose:'other',purposeOther:'Bible study',reservedFor:'Bible study',status:'approved',needs:{room:true},assignments:{room:'room-1'},note:'private'};
 const mine=projectOwnedBookings([record],days,'owner-1')[0];
 assert.equal(mine.reservedFor,'Bible study');
 assert.equal(mine.purposeOther,'Bible study');
 const publicRows=projectBookings([record],days);
 assert.equal(publicRows[0].name,'S Kiana');
 assert.equal(publicRows[0].reservedFor,'Bible study');
 assert.equal(Object.prototype.hasOwnProperty.call(publicRows[0],'ownerUid'),false);
});
