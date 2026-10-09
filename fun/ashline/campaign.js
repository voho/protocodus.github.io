// Operation Ashline: mission definitions, briefings and skirmish modes as plain data. mission.js
// interprets these tables; only a mission's id and progress are ever stored in a game, so a definition
// may carry a setup(s, api) function for bespoke placement. Objectives always describe the player
// (team 0). Points name 'start', 'end', 'center', 'edge', 'lane:<0..1>' (along the line between the
// two base anchors), a zone id, {x,y} or {at, dx, dy}, so a mission fits any seed and map size.

export const SKIRMISH_MODES=[
  {id:'annihilation',name:'Annihilation',description:'Destroy every hostile nexus and construction vehicle. A side left without either loses its claim to the sector.'},
];

export const MISSIONS={
  drill:{
    id:'drill',name:'Field drill',
    briefing:'Expedition 07 runs a live-fire drill on the near side of the Ashline before the push. Muster at the marker, stand up a barracks, train fresh squads and clear the Unity picket holding the target range.',
    opening:'Range control online. Expedition 07, begin the field drill.',
    victoryText:'Drill complete. Expedition 07 is cleared for the Ashline.',
    races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],credits:[1200,0],
    allow:{buildings:['wall','reactor','refinery','barracks','capacitor','turret'],units:['rifle','rocket','scout','harvester'],research:[],upgrades:[]},
    zones:[{id:'muster',label:'Muster point',at:'lane:0.22',r:4},{id:'range',label:'Target range',at:'lane:0.5',r:6}],
    objectives:[
      {id:'muster',type:'reachZone',zone:'muster',count:3,label:'Move three units to the muster point'},
      {id:'barracks',type:'build',role:'barracks',count:1,label:'Build a Field barracks'},
      {id:'recruits',type:'train',role:'rifle',count:2,label:'Train two rifle squads'},
      {id:'range',type:'destroyTagged',tag:'picket',hidden:true,label:'Clear the target range'},
      {id:'shards',type:'deliver',amount:400,secondary:true,label:'Deliver 400 credits of shards'},
      {id:'depot',type:'protectTagged',tag:'depot',secondary:true,label:'Keep the refinery intact'},
    ],
    fail:[{type:'coreLost'},{type:'timeLimit',seconds:1500}],
    triggers:[
      {id:'briefing',when:{time:0},do:[{say:{speaker:'Range control',text:'Expedition 07, muster three units at the marker, then stand up a barracks.'}}]},
      {id:'supply',when:{objectiveDone:'muster'},do:[{credits:300},{say:{speaker:'Range control',text:'Muster confirmed. Supply crates released for the barracks.'}}]},
      {id:'live-fire',when:{objectiveDone:'recruits'},do:[
        {reveal:'range'},
        {say:{speaker:'Range control',text:'Live fire authorized. A Unity picket holds the target range; clear it.'}},
        {spawn:{team:1,units:[['rifle',2]],at:'range',order:{zone:'muster'},tag:'picket',text:'Picket skirmishers advancing on the muster point.'}},
      ]},
    ],
    setup(s,api){
      api.tag(api.find(0,'refinery'),'depot');
      api.spawn(1,'rifle',3,'range',{tag:'picket'});
      api.spawn(1,'turret',1,{at:'range',dx:1,dy:-1},{tag:'picket'});
    },
  },
};
