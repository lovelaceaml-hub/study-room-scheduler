import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleDays,projectBookings,validateInput,validRange,publicName} from '../experiences/shared/model.js';
const days=eligibleDays(new Date('2026-09-12T20:00:00Z'));
test('eligible days use Los Angeles calendar at UTC midnight',()=>{
 assert.deepEqual(eligibleDays(new Date('2026-09-13T01:00:00Z')).map(d=>d.key),['2026-09-12','2026-09-15']);
 assert.deepEqual(eligibleDays(new Date('2026-09-13T08:00:00Z')).map(d=>d.key),['2026-09-15','2026-09-19']);
});
test('schedule projection exposes only safe names and renders private holds neutrally',()=>{
 const records=[{date:days[0].key,start:'11:00',end:'12:00',name:'Sister Jordan Example',purpose:'contact',status:'approved',needs:{room:true},assignments:{room:'room-2'},ownerUid:'private-owner',note:'private-note',bookingId:'private-id'}, {date:days[0].key,start:'12:00',end:'13:00',name:'Private Admin Name',purpose:'blocked',status:'approved',needs:{tv:true},assignments:{tv:'tv-1'}}];
 const projected=projectBookings(records,days);
 assert.equal(projected[0].name,'Jordan E.');assert.equal(projected[1].name,'Reserved');assert.equal(projected[1].blocked,true);
 assert(!JSON.stringify(projected).includes('private-'));assert(!JSON.stringify(projected).includes('Private Admin'));
 assert.deepEqual(Object.keys(projected[0]).sort(),['key','day','type','unit','start','end','name','purpose','blocked'].sort());
 assert.equal(projectBookings([{...records[0],status:'cancelled'}],days).length,0);
});
test('direct unit availability never silently substitutes another room',()=>{
 const input={day:days[0].key,type:'room',unit:2,start:660,end:720,name:'Robin Test',purpose:'contact'};
 const booked=[{day:days[0].key,type:'room',unit:2,start:690,end:750}];
 assert.throws(()=>validateInput(input,booked,days),/no longer open/);
 assert.equal(validateInput({...input,unit:null},booked,days).availableUnit,1);
 assert.throws(()=>validateInput({...input,unit:5},[],days),/valid room/);
});
test('time boundaries and Other details are enforced',()=>{
 assert(validRange(days[0].key,660,690,days));assert(!validRange(days[0].key,840,900,days));assert(validRange(days[0].key,1350,1380,days));
 const input={day:days[0].key,type:'tv',unit:3,start:660,end:690,name:'Robin Test',purpose:'other'};
 assert.throws(()=>validateInput(input,[],days),/Describe/);assert.equal(validateInput({...input,purposeOther:'Lesson review'},[],days).purposeOther,'Lesson review');
 assert.throws(()=>validateInput({...input,name:'\u200b',purpose:'contact'},[],days),/name/);
});
