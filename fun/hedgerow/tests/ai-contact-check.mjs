// A contact call must come from a living observer and survive only when heard.
import assert from 'node:assert/strict';
import {aiFixture,soldier,advance,forceCombat} from './ai-fixture.mjs';

function observedCall() {
  const f=aiFixture({player:[0,40],boxes:[{x:5,y:1.5,z:20,hx:.2,hy:1.5,hz:25}],definitions:[soldier(0,0,{hold:true}),soldier(10,0,{hold:true,yaw:180})]});
  const {G,enemies}=f,[observer,listener]=enemies.list;
  forceCombat(observer,G);observer.perceiveTimer=0;
  advance(G,enemies,.05);
  assert.ok(observer.sees,'the caller personally sees the real player');
  assert.ok(listener.pendingContact,'the living observer begins a real local call');
  assert.equal(listener.sees,false,'the recipient cannot see through the wall');
  assert.equal(listener.state,'idle','the human communication delay has not finished');
  return {...f,observer,listener};
}

{
  const {G,enemies}=aiFixture({player:[0,-120],boxes:[{x:4,y:1.5,z:0,hx:.2,hy:1.5,hz:4}],definitions:[soldier(0,0),soldier(8,0)]});
  G.player.visible=0;const [victim,listener]=enemies.list;
  G.events.emit('noise',{x:0,z:-120,radius:75,kind:'shot'});
  assert.equal(listener.lastKnown,null,'the real gunshot is outside hearing range');
  victim.damage(1000,G.player.pos,'head',true);advance(G,enemies,2);
  assert.equal(victim.lastSeen,-99,'the casualty never saw the shooter');
  assert.equal(listener.contact,null,'an instant unseen death cannot invent a confirmed shooter report');
  assert.equal(listener.lastKnown,null,'a hidden casualty cannot reveal a distant shooter through a wall');
  assert.equal(listener.state,'idle');
}
console.log('ok    an instant unseen killing hit cannot generate a post-mortem shooter contact');

{
  const {G,enemies,listener}=observedCall();advance(G,enemies,2);
  assert.equal(listener.state,'combat');assert.ok(listener.lastKnown.z>39);
  assert.equal(listener.lastSeen,-99,'a local call remains a report, not personal vision');
}
{
  const {G,enemies,observer,listener}=observedCall();
  assert.ok(listener.pendingContact.at>G.time);
  observer.damage(1000,G.player.pos,'head',true);advance(G,enemies,2);
  assert.equal(listener.pendingContact,null,'death interrupts a call before its human delay finishes');
  assert.equal(listener.contact,null);assert.equal(listener.state,'idle');
}
console.log('ok    living visual calls arrive normally, while an interrupted unfinished call cannot finish after death');

{
  const {G,enemies,observer,listener}=observedCall();advance(G,enemies,2);
  const known={...listener.contact};observer.damage(1000,G.player.pos,'head',true);advance(G,enemies,.2);
  assert.deepEqual(listener.contact,known,'death cannot erase a contact that a comrade already heard');
  assert.equal(listener.state,'combat');
}
{
  const {G,enemies,observer,listener}=observedCall();
  // Delivery is already due, but the recipient has not taken his next
  // update yet. This is a completed call, not an unfinished one.
  G.time=listener.pendingContact.at;
  observer.damage(1000,G.player.pos,'head',true);advance(G,enemies,.1);
  assert.ok(listener.contact,'an already-due call survives recipient update ordering');
  assert.equal(listener.state,'combat');
}
{
  const {G,enemies}=aiFixture({player:[0,-20],definitions:[soldier(0,0,{hold:true})]});
  const e=enemies.list[0];G.events.emit('noise',{x:0,z:-20,radius:75,kind:'shot'});advance(G,enemies,2);
  assert.ok(e.lastKnown,'a genuine nearby shot still warns a living guard');
  assert.ok(e.awareness>0,'fairness does not suppress real audible danger');
}
console.log('ok    delivered/due intel survives, and genuine living gunshot hearing still works');
