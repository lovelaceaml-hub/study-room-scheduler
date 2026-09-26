import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleDays,serviceBlocksFor,projectBookings,projectOwnedBookings,validateInput,validRange,publicName,parsePublicName,validateReservedFor,overrideUnitForRange,endEarlyOptions,endEarlyNowOption,endedEarly,groupMyReservations,reservationResource,reservationStatusLabel,reservationPurposeLabel,priorityNoticeText} from '../experiences/shared/model.js';
const days=eligibleDays(new Date('2026-09-12T20:00:00Z'));
test('eligible days use Los Angeles calendar at UTC midnight',()=>{
 // Before the special day opens on 13 September, only the usual Tuesday and Saturday.
 assert.deepEqual(eligibleDays(new Date('2026-09-13T01:00:00Z')).map(d=>d.key),['2026-09-12','2026-09-15']);
 // Once it opens, the 21 September special scheduling day joins them.
 assert.deepEqual(eligibleDays(new Date('2026-09-13T08:00:00Z')).map(d=>d.key),['2026-09-15','2026-09-19','2026-09-21']);
 assert.deepEqual(eligibleDays(new Date('2026-09-22T08:00:00Z')).map(d=>d.key),['2026-09-22','2026-09-26']);
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
 const exactOverride=validateInput({day,type:'room',unit:1,start:660,end:720,name:'Robin Test',purpose:'contact'},bookings,days);
 assert.equal(exactOverride.availableUnit,1);
 assert.equal(exactOverride.override,true);
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
const mineRow=(overrides={})=>({id:'mine-1',date:'2026-09-12',start:'11:00',end:'13:00',name:'Robin Fixture',displayName:'Robin F',purpose:'contact',reservedFor:'Fictional contact',status:'approved',blocked:false,needs:{room:true},assignments:{room:'room-2'},endedEarlyFrom:null,priorityNotice:null,canCancel:true,canEndEarly:true,...overrides});
test('End early offers every 30-minute boundary after the start and before the ending',()=>{
 assert.deepEqual(endEarlyOptions(mineRow()),['11:30','12:00','12:30']);
 assert.deepEqual(endEarlyOptions(mineRow({start:'11:00',end:'11:30'})),[]);
 assert.deepEqual(endEarlyOptions(mineRow({start:'10:00',end:'11:00'})),['10:30']);
 assert.deepEqual(endEarlyOptions({}),[]);
 assert.deepEqual(endEarlyOptions(mineRow({start:'noon',end:'13:00'})),[]);
});
test('the "now" ending is the last Los Angeles boundary already passed, and only today',()=>{
 assert.equal(endEarlyNowOption(mineRow(),new Date('2026-09-12T19:40:00Z')),'12:30');
 assert.equal(endEarlyNowOption(mineRow(),new Date('2026-09-12T18:30:00Z')),'11:30');
 assert.equal(endEarlyNowOption(mineRow(),new Date('2026-09-12T17:00:00Z')),null);
 assert.equal(endEarlyNowOption(mineRow(),new Date('2026-09-13T19:40:00Z')),null);
 assert.equal(endEarlyNowOption(mineRow({start:'11:00',end:'11:30'}),new Date('2026-09-12T19:40:00Z')),null);
});
test('a shortened reservation keeps the ending it was booked with',()=>{
 assert.equal(endedEarly(mineRow({end:'12:00',endedEarlyFrom:'13:00'})),true);
 assert.equal(endedEarly(mineRow()),false);
 assert.equal(endedEarly(mineRow({end:'13:00',endedEarlyFrom:'13:00'})),false);
});
test('my reservations split into the ones still standing and the closed ones, in day and time order',()=>{
 const rows=[
  mineRow({id:'b',date:'2026-09-15',start:'11:00',status:'approved'}),
  mineRow({id:'a',date:'2026-09-12',start:'12:00',status:'pending'}),
  mineRow({id:'c',date:'2026-09-12',start:'11:00',status:'cancelled'}),
  mineRow({id:'d',date:'2026-09-12',start:'10:00',status:'overridden'}),
  mineRow({id:'e',date:'2026-09-15',start:'09:00',status:'declined'})
 ];
 const {upcoming,past}=groupMyReservations(rows);
 assert.deepEqual(upcoming.map(row=>row.id),['a','b']);
 assert.deepEqual(past.map(row=>row.id),['d','c','e']);
 assert.deepEqual(groupMyReservations(null),{upcoming:[],past:[]});
});
test('a reservation names the room, board or TV it holds',()=>{
 assert.deepEqual(reservationResource(mineRow()),{type:'room',unit:2,label:'Study Room 2'});
 assert.deepEqual(reservationResource(mineRow({needs:{whiteboard:true},assignments:{whiteboard:'wb-4'}})),{type:'whiteboard',unit:4,label:'Whiteboard 4'});
 assert.deepEqual(reservationResource(mineRow({needs:{tv:true},assignments:{tv:'tv-3'}})),{type:'tv',unit:3,label:'TV 3'});
 assert.deepEqual(reservationResource(mineRow({needs:{room:true},assignments:{}})),{type:'room',unit:null,label:'Study room'});
 assert.equal(reservationResource(mineRow({needs:{},assignments:{}})),null);
 assert.equal(reservationResource(mineRow({needs:{room:true},assignments:{room:'room-9'}})).unit,null);
});
test('status and purpose read the same in every design',()=>{
 assert.equal(reservationStatusLabel(mineRow()),'Approved');
 assert.equal(reservationStatusLabel(mineRow({status:'pending'})),'Pending review');
 assert.equal(reservationStatusLabel(mineRow({status:'cancelled'})),'Cancelled');
 assert.equal(reservationStatusLabel(mineRow({status:'declined'})),'Declined');
 assert.equal(reservationStatusLabel(mineRow({status:'overridden'})),'Given to a higher priority');
 assert.equal(reservationStatusLabel(mineRow({status:'unknown'})),'');
 assert.equal(reservationPurposeLabel(mineRow()),'Contact');
 assert.equal(reservationPurposeLabel(mineRow({purpose:'new'})),'New Member');
 assert.equal(reservationPurposeLabel(mineRow({purpose:'new-member'})),'New Member');
 assert.equal(reservationPurposeLabel(mineRow({purpose:'other'})),'Other');
});
test('a priority update reads as a plain sentence, or nothing at all',()=>{
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'moved',byPurpose:'contact',type:'room',fromUnit:'room-1',toUnit:'room-2'}})),
  'A Contact reservation took Study Room 1. You kept your time in Study Room 2.');
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'released',byPurpose:'new-member',type:'room'}})),
  'A New Member reservation took your study room time. Nothing else was open, so please choose another time.');
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'moved',type:'room'}})),
  'A higher priority reservation took your study room. You kept your time in another study room.');
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'shortened',byPurpose:'contact',type:'room',fromUnit:'room-2',toUnit:'room-2',fromEnd:'14:00',toEnd:'12:30'}})),
  'A Contact reservation needed Study Room 2, so your reservation now ends at 12:30 PM.');
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'shortened',type:'room',toEnd:'09:30'}})),
  'A higher priority reservation needed your study room, so your reservation now ends at 9:30 AM.');
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'shortened',type:'room'}})),
  'A higher priority reservation needed your study room, so your reservation now ends early.');
 assert.equal(priorityNoticeText(mineRow()),'');
 assert.equal(priorityNoticeText(mineRow({priorityNotice:{kind:'other'}})),'');
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

/* One shared service rule. Every design reads this, so a design can no longer
   offer a time the server refuses, or hide a day the server accepts. */
test('the shared service table covers Saturday, Tuesday and the September 21 special day',()=>{
 const window=eligibleDays(new Date('2026-09-19T20:00:00Z'));
 assert.deepEqual(window.map(d=>d.key),['2026-09-19','2026-09-21','2026-09-22']);
 const saturday=window.find(d=>d.key==='2026-09-19'),special=window.find(d=>d.key==='2026-09-21'),tuesday=window.find(d=>d.key==='2026-09-22');
 assert.deepEqual(serviceBlocksFor(saturday),[[600,660,'Morning service'],[870,930,'Afternoon service'],[1170,1230,'Evening service']]);
 assert.deepEqual(serviceBlocksFor(tuesday),[[1170,1230,'Evening service']]);
 // The one-off Monday keeps the morning and afternoon services and has no evening service.
 assert.deepEqual(serviceBlocksFor(special),[[600,660,'Morning service'],[870,930,'Afternoon service']]);
 // A day key on its own, and a design's own copy that names the weekday `dow`, resolve the same way.
 assert.deepEqual(serviceBlocksFor('2026-09-21'),serviceBlocksFor(special));
 assert.deepEqual(serviceBlocksFor({key:'2026-09-19',dow:6}),serviceBlocksFor(saturday));
 assert.deepEqual(serviceBlocksFor('2026-09-23'),[]);
 // The table is copied out, so a design cannot change what everyone else sees.
 serviceBlocksFor(saturday)[0][0]=0;
 assert.equal(serviceBlocksFor(saturday)[0][0],600);
});
test('validRange follows the same table on the September 21 special day',()=>{
 const window=eligibleDays(new Date('2026-09-19T20:00:00Z')),special='2026-09-21';
 // The two services that day are closed, and the times around them are open.
 assert.equal(validRange(special,600,660,window),false);
 assert.equal(validRange(special,870,930,window),false);
 assert.equal(validRange(special,660,720,window),true);
 assert.equal(validRange(special,930,990,window),true);
 // There is no evening service that day, so the Saturday evening block is open.
 assert.equal(validRange(special,1170,1230,window),true);
 assert.equal(validRange('2026-09-19',1170,1230,window),false);
 // A day that is not a scheduling day is still refused outright.
 assert.equal(validRange('2026-09-23',660,720,window),false);
});
