// Operation Ashline: mission definitions, briefings, skirmish modes and the field archive as plain data.
// mission.js interprets these tables; only a mission's id and progress are ever stored in a game, so a
// definition may carry a setup(s, api) function for bespoke placement. Objectives always describe the
// player (team 0). Points name 'start', 'end', 'center', 'edge', 'lane:<0..1>' (along the line between the
// two base anchors), a zone id, {x,y} or {at, dx, dy}, so a mission fits any seed and map size; arriving
// forces may also use 'fogEdge', a far map edge the opposing side does not currently see.
// Triggers fire once, or repeat with when.every (seconds; when.time sets the first fire, when.limit and
// when.until end it). A repeating spawn's unit entries are [role, count, growth per later wave, first wave].
// A {directive} action changes only the keys it names; the rest of that team's standing directive remains.
// Rival waves from triggers scale with the chosen opposition (mission.js WAVE_SCALE); setup garrisons do not.
// deployZone confines the player's nexus deployment to a zone. allUnitsLost with armed:true ignores unarmed
// support. A trigger's objectiveActive holds only while that objective is open, so a hint never trails its step.
// Fields used only by the briefing UI: seed, location, summary, story, par (seconds for gold) and aiStep
// (the operation's commander plays this many opposition levels above the chosen one, up to Veteran).
// commander names the rival commander in signals intercepts when the story gives the rival a face.

// The players' cast. Speakers stay within 40 characters for saved dialogue events.
const VALE='Cmdr. Vale',TESK='Chief Orrun-Tesk',KADE='Auditor Kade',DACE='Captain Dace Mor',UNITY='Unity';
const say=(speaker,text)=>({say:{speaker,text}});
const CORE_ECONOMY={buildings:['reactor','refinery','barracks'],units:['rifle','scout','harvester'],research:[],upgrades:[]};
const DEFENSES={buildings:[...CORE_ECONOMY.buildings,'wall','turret','capacitor'],units:[...CORE_ECONOMY.units,'rocket'],research:[],upgrades:[]};
const FOUNDRY={buildings:[...DEFENSES.buildings,'lab','factory'],units:[...DEFENSES.units,'tank','engineer'],research:['infantryWeapons','infantryArmor','vehicleWeapons','mobility'],upgrades:[]};
const EXPANSION={buildings:FOUNDRY.buildings,units:[...FOUNDRY.units,'constructor'],research:[...FOUNDRY.research,'gridEfficiency'],upgrades:['speed','efficiency']};

export const SKIRMISH_MODES=[
  {id:'annihilation',name:'Annihilation',description:'Destroy every hostile nexus and construction vehicle. A side left without either loses its claim to the sector.'},
  {id:'relay',name:'Relay control',mission:'relay-control',description:'A lit relay sits at the centre of the sector. Hold it for five minutes in total, or void the rival claim. The rival contests it, and wins if it holds the relay first.'},
  {id:'lastLight',name:'Last Light',mission:'last-light',description:'No rival base, no relief. Endless waves arrive from the dark edges and grow each time. Score is seconds survived × kills ÷ 10.'},
];

// The campaign plays these operations in order; finishing one unlocks the next.
export const CAMPAIGN=['landfall','hold-the-line','signal-in-the-ash','convoy','red-ledger','dead-signal','hold-the-relay','severance'];

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
      {id:'range',type:'destroyTagged',tag:'picket',zone:'range',hidden:true,label:'Clear the target range'},
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

  landfall:{
    id:'landfall',name:'Landfall',location:'Kessel flats',seed:'LANDFALL-07',par:540,
    summary:'Walk the ground, raise a barracks and clear the Unity picket watching the landing.',
    story:['Expedition 07 is down on Tephra with a nexus, a reactor, one refinery and a handful of squads. Under the Charter the sector is ours for as long as that nexus keeps running.','Unity already knows we are here. A survey picket of Needle cohorts sits on the lane east of the landing. Learn the ground, get the economy turning, then clear it.'],
    briefing:'Expedition 07 makes landfall. Survey the ground, raise a barracks and clear the Unity picket.',
    opening:'Expedition 07 is down on Tephra. Command online.',
    victoryText:'Picket cleared. Expedition 07 holds its landing ground.',
    width:144,height:112,profile:'basin',races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],credits:[900,0],
    allow:CORE_ECONOMY,
    zones:[{id:'marker',label:'Survey marker',at:'lane:0.2',r:5},{id:'picket',label:'Unity picket',at:'lane:0.48',r:7},{id:'overlook',label:'Far overlook',at:'lane:0.74',r:6}],
    objectives:[
      {id:'marker',type:'reachZone',zone:'marker',count:2,label:'Move two units to the survey marker'},
      {id:'barracks',type:'build',role:'barracks',count:1,hidden:true,label:'Build a Field barracks'},
      {id:'rifles',type:'train',role:'rifle',count:3,hidden:true,label:'Train three rifle squads'},
      {id:'shards',type:'deliver',amount:500,hidden:true,label:'Deliver 500 credits of shards'},
      {id:'picket',type:'destroyTagged',tag:'picket',hidden:true,label:'Clear the Unity picket'},
      {id:'overlook',type:'reachZone',zone:'overlook',roles:['scout'],secondary:true,label:'Scout the far overlook with the recon rover'},
      {id:'hauler',type:'train',role:'harvester',count:1,secondary:true,label:'Train a second shard hauler'},
      {id:'losses',type:'limitLosses',units:2,secondary:true,label:'Lose no more than two units'},
    ],
    triggers:[
      {id:'welcome',when:{time:1},do:[say(VALE,'Expedition 07, this is Vale. Welcome to Tephra. The Charter gives this sector to whoever keeps a working nexus on it, so ours stays standing.')]},
      {id:'first-steps',when:{time:8,objectiveActive:'marker'},do:[say(VALE,'First, walk the ground. Select two units and right-click the survey marker.')]},
      {id:'ground',when:{objectiveDone:'marker'},do:[{reveal:'barracks'},say(VALE,'Ground holds. Open the command console, choose the Field barracks and place it within reach of the base.')]},
      {id:'recruit',when:{objectiveDone:'barracks'},do:[{reveal:'rifles'},{reveal:'shards'},say(VALE,'Barracks online. Train three rifle squads. Your hauler is already working the mint field; keep the credits coming.')]},
      {id:'contact',when:{objectiveDone:'rifles'},do:[{reveal:'picket'},say(VALE,'Unity has a picket on the lane east of us. Gather the squads and clear it. Press Q, then click, to attack-move.')]},
      {id:'classified',when:{zoneEntered:'picket'},do:[say(UNITY,'Unregistered claim detected. Classification: interference.')]},
      {id:'pressure',when:{tagsLeft:{tag:'picket',count:2}},do:[say(VALE,'They hold their ground and fire at anything in range. Keep the pressure on.')]},
    ],
    setup(s,api){
      api.spawn(1,'rifle',3,'picket',{tag:'picket'});
      api.spawn(1,'scout',1,{at:'picket',dx:2,dy:-2},{tag:'picket'});
    },
  },

  'hold-the-line':{
    id:'hold-the-line',name:'Hold the Line',location:'Cinder rise',seed:'HOLD-THE-LINE',par:480,
    summary:'Wall the approach, raise Rail sentries and survive eight minutes of Unity raids.',
    story:['Unity has traced the landing. Raids will probe from the dark edges of the sector, each heavier than the last, before a real assault force arrives.','The Compact convoy is eight minutes out. A Vael launcher crew under Chief Orrun-Tesk joins the line today, and the yard has cleared walls, Rail sentries and Grid capacitors for construction.'],
    briefing:'Survive eight minutes of escalating Unity raids until the Compact convoy arrives.',
    opening:'Perimeter alarms live. Expedition 07, hold the line.',
    victoryText:'The convoy is through. Expedition 07 held the line.',
    width:144,height:112,profile:'rift',races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],credits:[1500,0],
    allow:DEFENSES,
    zones:[{id:'line',label:'Forward line',at:'lane:0.24',r:6}],
    objectives:[
      {id:'hold',type:'survive',seconds:480,label:'Hold the base for 8:00'},
      {id:'sentries',type:'build',role:'turret',count:2,label:'Raise two Rail sentries'},
      {id:'walls',type:'build',role:'wall',count:8,secondary:true,label:'Wall the approach with eight segments'},
      {id:'vael',type:'train',role:'rocket',count:3,secondary:true,label:'Recruit three Vael launcher teams'},
      {id:'intact',type:'protectTagged',tag:'base',all:true,secondary:true,label:'Keep the nexus, reactor and refinery standing'},
    ],
    triggers:[
      {id:'warning',when:{time:1},do:[say(VALE,'Unity tracked our landing. Expect probing raids from the east, then a real push. Hold for eight minutes and the convoy reaches us.')]},
      {id:'vael',when:{time:7},do:[say(TESK,'Launcher chief Orrun-Tesk, Third Crest. My teams are yours, commander. Put us behind a wall and point us at armor.')]},
      {id:'walls',when:{time:14},do:[say(VALE,'Choose the wall card and drag a line across the approach. Rail sentries need power; watch the grid.')]},
      {id:'raids',when:{time:45,every:50,until:450},do:[{spawn:{team:1,units:[['rifle',2,.75],['scout',1,.34,2],['rocket',1,.5,3],['tank',1,.25,5]],at:'fogEdge',order:'attackBase',tag:'raid',cap:80,text:'Unity raid {wave} inbound.'}}]},
      {id:'first-blood',when:{kills:5},do:[say(TESK,'Five down. They learn from every loss, so make each one expensive.')]},
      {id:'supply',when:{time:200},do:[{credits:500},say(VALE,'Supply drop on the pad. Spend it on the line.')]},
      {id:'push',when:{time:400},do:[say(UNITY,'Correction scheduled. Committing reserve cohorts.'),{spawn:{team:1,units:[['rifle',6],['rocket',3],['tank',2]],at:'fogEdge',order:'attackBase',tag:'push',text:'Unity assault force inbound.'}}]},
      {id:'convoy',when:{time:465},do:[say(VALE,'Convoy lights on the ridge. Hold a little longer.')]},
    ],
    setup(s,api){for(const role of ['core','reactor','refinery'])api.tag(api.find(0,role),'base');},
  },

  'signal-in-the-ash':{
    id:'signal-in-the-ash',name:'Signal in the Ash',location:'Varn escarpment',seed:'SIGNAL-ASH',par:840,
    summary:'Break into a fortified Unity outpost and destroy the Logic archive inside.',
    story:['Unity finds our shards with survey algorithms it iterates in Logic archives. One of them sits in a relay outpost on the escarpment, guarded by Lance nodes.','The yard has cleared a laboratory and a War foundry. Tanks break lines; engineers keep them running. The Lance nodes draw from a single Resonance spire.'],
    briefing:'Destroy the Logic archive in a fortified Unity outpost. Its Lance nodes draw from a single spire.',
    opening:'Foundry and laboratory charters approved. Expedition 07, target the archive.',
    victoryText:'The archive is ash. Unity is surveying blind on this escarpment.',
    width:144,height:112,profile:'highlands',races:['organics','aiUnity'],aiTeams:[],start:['standard','none'],credits:[2200,0],
    allow:FOUNDRY,
    zones:[{id:'outpost',label:'Unity relay outpost',at:'end',r:10}],
    objectives:[
      {id:'archive',type:'destroyTagged',tag:'archive',zone:'outpost',label:'Destroy the Logic archive'},
      {id:'spire',type:'destroyTagged',tag:'spire',secondary:true,label:'Brown out the outpost: destroy its Resonance spire'},
      {id:'nodes',type:'destroyTagged',tag:'lance',secondary:true,hidden:true,label:'Silence both Lance nodes'},
      {id:'pulse',type:'research',research:'infantryWeapons',secondary:true,label:'Research Pulse accelerators'},
      {id:'losses',type:'limitLosses',units:10,secondary:true,label:'Lose no more than ten units'},
    ],
    triggers:[
      {id:'target',when:{time:1},do:[say(VALE,'That outpost is a Unity relay. The Logic archive inside holds the survey algorithms it uses to find our shards. Burn it.')]},
      {id:'audit',when:{time:8},do:[say(KADE,'Auditor Kade, Charter office. For the record: that archive is Charter property held without title. You are cleared to destroy it.')]},
      {id:'hint',when:{time:16},do:[say(TESK,'Two Lance nodes cover the approach and drink from one spire. Kill the spire, let the reserve drain, and the nodes go dark.'),{reveal:'nodes'}]},
      {id:'foundry',when:{time:24},do:[say(VALE,'Build a War foundry for Vanguard tanks and a laboratory for research. Engineers keep armor in the fight.')]},
      {id:'intrusion',when:{zoneEntered:'outpost'},do:[say(UNITY,'Archive integrity is priority one. Intruders will be corrected.'),say(TESK,'Those two Lance nodes have killed Compact crews before. Silence both and the Crest will sing about it.')]},
      {id:'dark',when:{tagDestroyed:'spire'},do:[say(TESK,'Spire down. Their nodes run on reserve now; it will not last.')]},
      {id:'sorties',when:{time:150,every:100,limit:6},do:[{spawn:{team:1,units:[['rifle',3,.5],['rocket',0,.5,2],['scout',1]],at:'outpost',order:'attackBase',tag:'sortie',cap:40,text:'Outpost cohorts moving on the base.'}}]},
    ],
    setup(s,api){
      api.spawn(1,'lab',1,'outpost',{tag:'archive'});
      api.spawn(1,'reactor',1,{at:'outpost',dx:5,dy:-4},{tag:'spire'});
      api.spawn(1,'capacitor',1,{at:'outpost',dx:6,dy:1});
      api.spawn(1,'turret',1,{at:'outpost',dx:-6,dy:3},{tag:'lance'});
      api.spawn(1,'turret',1,{at:'outpost',dx:-3,dy:6},{tag:'lance'});
      api.spawn(1,'rifle',4,{at:'outpost',dx:-5,dy:5},{stance:'defend'});
      api.spawn(1,'rocket',2,{at:'outpost',dx:-2,dy:2},{stance:'defend'});
      api.spawn(1,'tank',1,{at:'outpost',dx:1,dy:4},{stance:'defend'});
    },
  },

  convoy:{
    id:'convoy',name:'Convoy to Cinder Gap',location:'Cinder Gap',seed:'CINDER-GAP',par:600,
    summary:'Escort the construction vehicle across the basin and bring a nexus online in Cinder Gap.',
    story:['Cinder Gap sits on a blue shard bowl that nobody holds. Our construction vehicle is the claim: if it dies on the road, so does the expedition.','Unity pickets watch the basin and a Lance line covers the approach. The Charter recognises a claim only once its nexus is operating.'],
    briefing:'Escort the construction vehicle to Cinder Gap and bring a nexus online there.',
    opening:'Convoy assembled. Expedition 07, roll out for Cinder Gap.',
    victoryText:'Cinder Gap nexus operating. The claim is filed.',
    width:192,height:144,profile:'basin',races:['organics','aiUnity'],aiTeams:[],start:['none','none'],credits:[1200,0],
    allow:FOUNDRY,deployZone:'gap',
    zones:[{id:'gap',label:'Cinder Gap claim site',at:'lane:0.6',r:7},{id:'ridge',label:'Ash ridge',at:'lane:0.36',r:7}],
    objectives:[
      {id:'claim',type:'nexusInZone',zone:'gap',label:'Deploy the nexus in Cinder Gap and bring it online'},
      {id:'mechanic',type:'protectTagged',tag:'mechanic',secondary:true,label:'Keep the field engineer running'},
      {id:'pickets',type:'destroyTagged',tag:'picket',secondary:true,label:'Clear every Unity picket on the route'},
      {id:'escort',type:'limitLosses',units:5,secondary:true,label:'Lose no more than five escorts'},
    ],
    triggers:[
      {id:'claim',when:{time:1},do:[say(VALE,'The construction vehicle is our claim. If it dies, so does the expedition. Keep the armor between it and anything with a gun.')]},
      {id:'charter',when:{time:8},do:[say(KADE,'The Charter recognises a claim when its nexus is operating, not before. Deploy inside the marked site and keep it standing until it comes online.')]},
      {id:'formation',when:{time:16},do:[say(VALE,'Tanks lead, infantry on the flanks, engineer behind the armor. Hold right-click and drag to set a formation.')]},
      {id:'interception',when:{zoneEntered:'ridge'},do:[say(UNITY,'Mobile claim detected. Interception authorised.'),{spawn:{team:1,units:[['scout',3],['rifle',3]],at:'fogEdge',order:{zone:'ridge'},tag:'hunters',text:'Unity hunters closing on the convoy.'}}]},
      {id:'arrival',when:{zoneEntered:'gap'},do:[say(VALE,'Claim site reached. Silence any Lance sentry covering it, then select the construction vehicle, choose Deploy nexus and pick clear ground inside the site.')]},
      // Dispatched from the lane beyond the gap, the counterattack reaches the site while a nexus is still building.
      {id:'counter',when:{after:{trigger:'arrival',seconds:30}},do:[say(UNITY,'Claim party detected at Cinder Gap. Dispatching correction.'),{spawn:{team:1,units:[['rifle',4],['rocket',2],['tank',1]],at:'lane:0.8',order:{zone:'gap'},tag:'counter',text:'Unity counterattack moving on the gap.'}}]},
      {id:'online',when:{objectiveDone:'claim'},do:[say(KADE,'Nexus operating. Claim logged at Cinder Gap.')]},
    ],
    setup(s,api){
      api.clearArea('gap',5,{shards:true});
      api.spawn(0,'constructor',1,'start');
      api.spawn(0,'tank',3,{at:'start',dx:4,dy:-3});
      api.spawn(0,'rifle',4,{at:'start',dx:-2,dy:-4});
      api.spawn(0,'rocket',2,{at:'start',dx:1,dy:2});
      api.spawn(0,'scout',1,{at:'start',dx:5,dy:1});
      api.spawn(0,'engineer',1,{at:'start',dx:-3,dy:1},{tag:'mechanic'});
      api.spawn(1,'rifle',3,'lane:0.3',{tag:'picket',stance:'defend'});
      api.spawn(1,'rocket',1,{at:'lane:0.3',dx:2,dy:-1},{tag:'picket',stance:'defend'});
      api.spawn(1,'scout',2,{at:'lane:0.44',dx:0,dy:6},{tag:'picket',stance:'defend'});
      api.spawn(1,'rifle',2,{at:'lane:0.44',dx:2,dy:4},{tag:'picket',stance:'defend'});
      api.spawn(1,'reactor',1,{at:'lane:0.66',dx:4,dy:-5},{tag:'picket'});
      api.spawn(1,'turret',1,{at:'lane:0.54',dx:0,dy:-4},{tag:'picket'});
      api.spawn(1,'turret',1,{at:'lane:0.54',dx:3,dy:3},{tag:'picket'});
    },
  },

  'red-ledger':{
    id:'red-ledger',name:'Red Ledger',location:'Seam country',seed:'RED-LEDGER',par:1500,
    summary:'A rival Compact crew contests the sector. Hold three operating nexuses and mine its red seams.',
    story:['A crew calling itself the Red Ledger has filed a counter-claim on the seam country. They fly crimson and run the same surplus machines we do, under a captain who jumps claims for a living.','Auditor Kade will rule for whoever holds the most operating nexuses and the red seam crystal under them. Construction vehicles and building upgrades are now cleared.'],
    briefing:'Outbuild the Red Ledger claim-jumpers: hold three operating nexuses and deliver red seam crystal.',
    opening:'Counter-claim filed against Expedition 07. The audit is open.',
    victoryText:'The audit rules for Expedition 07. The Red Ledger claim is struck.',
    width:192,height:144,profile:'highlands',races:['organics','organics'],aiTeams:[1],credits:[2400,2400],commander:DACE,
    allow:EXPANSION,
    zones:[],
    objectives:[
      {id:'claims',type:'build',role:'core',count:3,label:'Hold three operating nexuses'},
      {id:'ledger',type:'deliver',amount:2500,mineralType:3,label:'Deliver 2,500 credits of red seam crystal'},
      {id:'grid',type:'research',research:'gridEfficiency',secondary:true,label:'Research Efficient power routing'},
      {id:'jumpers',type:'kills',count:40,secondary:true,label:'Destroy forty Red Ledger units or structures'},
    ],
    triggers:[
      {id:'notice',when:{time:1},do:[say(KADE,'Formal notice: the Red Ledger has filed a counter-claim. I rule for whoever holds three operating nexuses and the red seams under them.')]},
      {id:'mirror',when:{time:9},do:[say(VALE,'They fly crimson and run the same kit we do. Same tanks, same tricks. Expand fast and mine the red seams.')]},
      {id:'taunt',when:{time:17},do:[say(DACE,'Dace Mor to Expedition 07. Pack up now and we let you keep your trucks.')]},
      {id:'costly',when:{kills:15},do:[say(DACE,'You are costing me money, Seven. I keep a ledger.')]},
      {id:'logged',when:{objectiveDone:'claims'},do:[say(KADE,'Three operating claims logged. Keep them that way.')]},
      {id:'clock',when:{time:900},do:[say(KADE,'Fifteen minutes on the clock. The office expects a result.')]},
    ],
  },

  'dead-signal':{
    id:'dead-signal',name:'Dead Signal',location:'Glass basin',seed:'DEAD-SIGNAL',par:720,
    summary:'A commando strike with no base: silence three Resonance spires, then the relay mainframe.',
    story:['The relay complex in the glass basin ties this region\'s cohorts together. Three Resonance spires feed it and its Lance nodes.','No base and no reinforcements: two rovers, ranked rifle squads, a Vael launcher pair and one engineer. Ranked survivors of Dead Signal come back as veterans for the last operation.'],
    briefing:'Commando strike: destroy three Resonance spires and the relay mainframe. Ranked survivors become veterans.',
    opening:'Strike team inserted. Radio discipline. Expedition 07, begin Dead Signal.',
    victoryText:'The relay is silent. Its ranked survivors return as veterans.',
    width:144,height:112,profile:'rift',races:['organics','aiUnity'],aiTeams:[],start:['none','none'],credits:[400,0],
    // Nothing is cleared for construction, so the strike team's credits buy only the engineer's repairs.
    allow:{buildings:[],units:[],research:[],upgrades:[]},
    zones:[{id:'drop',label:'Drop zone',at:'start',r:5},{id:'relay',label:'Relay complex',at:'end',r:9},{id:'cache',label:'Survey cache',at:{at:'lane:0.38',dx:0,dy:14},r:4}],
    objectives:[
      {id:'spires',type:'destroyTagged',tag:'spire',label:'Destroy the three Resonance spires'},
      {id:'relay',type:'destroyTagged',tag:'relay',hidden:true,label:'Destroy the relay mainframe'},
      {id:'battery',type:'destroyTagged',tag:'battery',secondary:true,label:'Destroy the Shard battery'},
      {id:'cache',type:'reachZone',zone:'cache',secondary:true,hidden:true,label:'Recover the Expedition 05 survey cache'},
      {id:'team',type:'limitLosses',units:3,secondary:true,label:'Lose no more than three units'},
    ],
    // The engineer cannot fight, so the strike ends when the last armed unit falls.
    fail:[{type:'allUnitsLost',armed:true}],
    triggers:[
      {id:'insert',when:{time:1},do:[say(VALE,'Dead Signal is a commando run: no base, no reinforcements. Three spires feed the relay complex. Take them out one at a time.'),say(VALE,'The engineer carries four hundred credits of parts. Spend them keeping the rovers running.')]},
      {id:'crest',when:{time:8},do:[say(TESK,'My launchers are rested and angry. Spires first; a mainframe without power is a deaf thing.')]},
      {id:'reroute',when:{tagsLeft:{tag:'spire',count:2}},do:[say(UNITY,'Resonance loss detected. Rerouting.')]},
      {id:'cache',when:{time:40},do:[{reveal:'cache'},say(VALE,'Expedition 05 buried a survey cache south of the lane before Unity caught them. If anyone passes it, bring the logs home.')]},
      {id:'logs',when:{objectiveDone:'cache'},do:[say(TESK,'Expedition 05 logs recovered. They mapped every spire in this basin. Someone will read their names tonight.')]},
      {id:'last-spire',when:{tagsLeft:{tag:'spire',count:1}},do:[say(TESK,'One spire left. Every node in the complex drinks from it alone.')]},
      {id:'exposed',when:{objectiveDone:'spires'},do:[{reveal:'relay'},say(UNITY,'Relay integrity failing. All cohorts return to the mainframe.'),{rally:{team:1,at:'relay'}}]},
      {id:'patrols',when:{time:90,every:80,limit:5},do:[{spawn:{team:1,units:[['rifle',2,.5],['scout',1]],at:'fogEdge',order:'center',tag:'patrol',cap:60,text:'Unity patrol sweeping the basin.'}}]},
    ],
    setup(s,api){
      api.spawn(0,'scout',2,'drop');
      api.spawn(0,'rifle',3,{at:'drop',dx:-2,dy:-2},{kills:5});
      api.spawn(0,'rocket',2,{at:'drop',dx:2,dy:-2},{kills:5});
      api.spawn(0,'engineer',1,{at:'drop',dx:0,dy:2});
      api.spawn(1,'core',1,'relay',{tag:'relay'});
      api.spawn(1,'reactor',1,{at:'lane:0.5',dx:-2,dy:-12},{tag:'spire'});
      api.spawn(1,'reactor',1,{at:'lane:0.62',dx:4,dy:10},{tag:'spire'});
      api.spawn(1,'reactor',1,{at:'relay',dx:7,dy:4},{tag:'spire'});
      api.spawn(1,'turret',1,{at:'relay',dx:-7,dy:3},{tag:'lance'});
      api.spawn(1,'turret',1,{at:'relay',dx:-3,dy:7},{tag:'lance'});
      api.spawn(1,'rocketTower',1,{at:'relay',dx:-5,dy:-3},{tag:'battery'});
      api.spawn(1,'rifle',2,{at:'lane:0.5',dx:0,dy:-9},{stance:'defend'});
      api.spawn(1,'rifle',2,{at:'lane:0.62',dx:2,dy:7},{stance:'defend'});
      api.spawn(1,'rifle',3,{at:'relay',dx:-4,dy:4},{stance:'defend'});
      api.spawn(1,'scout',1,{at:'relay',dx:2,dy:6},{stance:'defend'});
    },
  },

  'hold-the-relay':{
    id:'hold-the-relay',name:'Hold the Relay',location:'Meridian rift',seed:'HOLD-RELAY',par:1200,aiStep:1,
    summary:'Seize the central relay and hold it for four minutes against Unity\'s veteran cohorts.',
    story:['The central relay stitches Unity\'s eastern cohorts together. Whoever holds it long enough owns the traffic, and the relay is lit, so both sides see every unit inside.','Unity fields its veteran cohorts here and will push hard for the relay. Rocket towers, siege crawlers, Pike strikers and the last research are now cleared.'],
    briefing:'Hold the lit central relay for four minutes in total before Unity can hold it for as long.',
    opening:'Relay traffic intercepted. Expedition 07, take the relay.',
    victoryText:'The relay is ours. Unity\'s eastern cohorts are cut off.',
    width:192,height:144,profile:'rift',races:['organics','aiUnity'],aiTeams:[1],credits:[2400,2000],
    zones:[{id:'relay',label:'Central relay',at:'center',r:7,lit:true}],
    objectives:[
      {id:'hold',type:'holdZone',zone:'relay',seconds:240,label:'Hold the central relay for 4:00 in total'},
      {id:'claims',type:'annihilate',sufficient:true,label:'Or destroy every Unity mainframe and constructor'},
      {id:'ballistics',type:'research',research:'advancedBallistics',secondary:true,label:'Research Advanced ballistics'},
      {id:'towers',type:'build',role:'rocketTower',count:2,secondary:true,label:'Raise two Rocket towers'},
    ],
    fail:[{type:'coreLost'},{type:'rivalHold',zone:'relay',seconds:240,label:'Unity'}],
    directives:{1:{attack:'relay',defend:{at:'relay',r:7}}},
    triggers:[
      {id:'relay',when:{time:1},do:[say(VALE,'The relay stitches Unity\'s eastern cohorts together. Whoever holds it long enough owns the traffic. Take it and keep it.')]},
      {id:'lit',when:{time:8},do:[say(KADE,'The relay is lit for both claimants. The audit sees everything that happens inside it.')]},
      {id:'custody',when:{time:16},do:[say(UNITY,'Relay custody is not negotiable.')]},
      {id:'contest',when:{time:75,every:45},do:[{rally:{team:1,at:'relay',max:8}}]},
      {id:'veterans',when:{time:600},do:[say(UNITY,'Committing veteran cohorts to the relay.'),{spawn:{team:1,units:[['rifle',4],['tank',2],['artillery',1]],at:'fogEdge',order:{zone:'relay'},tag:'veterans',kills:5,text:'Unity veteran cohorts moving on the relay.'}}]},
    ],
  },

  severance:{
    id:'severance',name:'Severance',location:'The eastern reach',seed:'SEVERANCE',par:2100,
    summary:'The finale: cut every Unity mainframe in the eastern reach, including two outlying cores.',
    story:['Unity runs the eastern reach through three mainframes: the main core and two outlying installations on the expansion shelves. Cut all three and the cohorts east of the Ashline lose their mind.','Every unit and technology is cleared. Survivors of Dead Signal deploy with their ranks. Leave one mainframe or constructor standing and the claim stands with it.'],
    briefing:'Destroy every Unity mainframe and constructor in the eastern reach. Dead Signal veterans join the assault.',
    opening:'All Compact forces committed. Expedition 07, begin Severance.',
    victoryText:'Severance complete. The eastern cohorts fall silent and the Ashline moves east.',
    width:224,height:168,profile:'highlands',races:['organics','aiUnity'],aiTeams:[1],credits:[3000,3000],
    zones:[{id:'north',label:'North mainframe',at:{at:'lane:0.7',dx:-6,dy:-30},r:6},{id:'south',label:'South mainframe',at:{at:'lane:0.75',dx:14,dy:26},r:6}],
    objectives:[
      {id:'sever',type:'annihilate',label:'Destroy every Unity mainframe and constructor'},
      {id:'outliers',type:'destroyTagged',tag:'outlier',secondary:true,label:'Destroy both outlying mainframes'},
      {id:'veterans',type:'protectTagged',tag:'veteran',all:true,secondary:true,label:'Keep every Dead Signal veteran alive'},
    ],
    triggers:[
      {id:'severance',when:{time:1},do:[say(VALE,'This is Severance. Unity runs the reach through three mainframes. Cut all three and the cohorts east of the Ashline lose their mind.')]},
      {id:'witness',when:{time:9},do:[say(KADE,'The Charter office will witness. Every mainframe and every constructor, commander. Leave one and the claim stands.')]},
      {id:'crest',when:{time:17},do:[say(TESK,'The Third Crest is with you. For the forests none of us ever saw.')]},
      {id:'veterans',when:{time:30,tagsLeft:{tag:'veteran',count:12}},do:[say(VALE,'Dead Signal veterans reporting. Glad to have you back.')]},
      {id:'verdict',when:{time:24},do:[say(UNITY,'Expedition 07. Your claim has been reviewed. Outcome: deletion.')]},
      {id:'partition',when:{tagDestroyed:'outlier'},do:[say(UNITY,'Partition detected. Cohort links failing.')]},
      {id:'strike',when:{time:600},do:[{spawn:{team:1,units:[['tank',3],['striker',2],['rifle',6]],at:'fogEdge',order:'attackBase',tag:'strike',text:'Unity strike group inbound.'}}]},
      {id:'reprisals',when:{time:840,every:240,limit:4},do:[{spawn:{team:1,units:[['rifle',6,2],['rocket',2,1],['tank',2,1],['artillery',0,1,1]],at:'fogEdge',order:'attackBase',tag:'strike',cap:400,text:'Unity reprisal wave inbound.'}}]},
    ],
    setup(s,api){
      for(const zone of ['north','south']){
        api.clearArea(zone,4);
        api.spawn(1,'core',1,zone,{tag:'outlier'});
        api.spawn(1,'reactor',1,{at:zone,dx:5,dy:2});
        api.spawn(1,'turret',1,{at:zone,dx:-4,dy:3});
        api.spawn(1,'turret',1,{at:zone,dx:-1,dy:-5});
        api.spawn(1,'rifle',3,{at:zone,dx:-3,dy:0},{stance:'defend'});
      }
      for(const {role,kills} of api.veterans())api.spawn(0,role,1,{at:'start',dx:7,dy:-6},{kills,tag:'veteran'});
    },
  },

  'relay-control':{
    id:'relay-control',name:'Relay control',
    briefing:'Hold the lit central relay for five minutes in total, or void the rival claim. The rival contests the relay and wins if it holds it first.',
    opening:'Relay control: the central relay is lit for both claimants.',
    victoryText:'Relay secured. The sector traffic is yours.',
    zones:[{id:'relay',label:'Central relay',at:'center',r:7,lit:true}],
    objectives:[
      {id:'hold',type:'holdZone',zone:'relay',seconds:300,label:'Hold the central relay for 5:00 in total'},
      {id:'claims',type:'annihilate',sufficient:true,label:'Or destroy every rival nexus and construction vehicle'},
    ],
    fail:[{type:'coreLost'},{type:'rivalHold',zone:'relay',seconds:300,label:'The rival'}],
    directives:{1:{attack:'relay',defend:{at:'relay',r:7}}},
    triggers:[
      {id:'rules',when:{time:1},do:[say(KADE,'Relay control. Hold the central relay for five minutes in total, or void the rival claim. If they hold it first, the sector is theirs.')]},
      {id:'contest',when:{time:90,every:40},do:[{rally:{team:1,at:'relay',max:10}}]},
    ],
  },

  'last-light':{
    id:'last-light',name:'Last Light',score:'survival',
    briefing:'No rival base and no relief. Waves arrive from the dark edges and grow each time. Score is seconds survived × kills ÷ 10.',
    opening:'Last Light: no relief is coming. Hold as long as you can.',
    victoryText:'Last Light holds.',
    aiTeams:[],start:['standard','none'],credits:[2000,0],
    zones:[],
    objectives:[
      {id:'endure',type:'endure',label:'Hold out as long as you can'},
      {id:'ten',type:'survive',seconds:600,secondary:true,label:'Survive ten minutes'},
      {id:'hundred',type:'kills',count:100,secondary:true,label:'Destroy one hundred attackers'},
    ],
    triggers:[
      {id:'dark',when:{time:1},do:[say(VALE,'No relief is coming. Waves arrive from the dark edges and grow every time. Make each one pay.')]},
      {id:'waves',when:{time:30,every:40},do:[{spawn:{team:1,units:[['rifle',3,.6],['scout',1,.25,2],['rocket',1,.4,4],['tank',1,.3,7],['striker',1,.25,10],['artillery',1,.15,14]],at:'fogEdge',order:'attackBase',tag:'wave',cap:150,text:'Wave {wave} inbound.'}}]},
      {id:'supply',when:{time:120,every:120},do:[{credits:300}]},
    ],
  },
};

// Field archive: the world, its claimants and one line for every unit and structure. Names and statistics
// come from the simulation tables; these lines add the frontier's side of the story.
export const ARCHIVE={
  world:[
    {title:'Tephra',text:'A frontier world at the edge of Charter space. Its forests died in the Burn, and its ash plains cover the richest shard veins ever surveyed.'},
    {title:'The Burn',text:'A cascade of rift eruptions that ran for eleven years. It left the deadwood, ash plains, craters and lava basins, and it cracked open the shard veins.'},
    {title:'Shards',text:'Crystallised geothermal charge. Mint shards are common, blue shards mark deep reserves, and red seam crystal is dense and twice charged. Refined, shards are both currency and power.'},
    {title:'The Ashline',text:'The moving front between claims. It runs wherever two nexuses can see each other\'s smoke.'},
  ],
  factions:[
    {title:'The Charter',text:'The colonial compact that still governs frontier sectors. A sector belongs to whoever keeps a working Command nexus there, and a construction vehicle is a mobile claim. Destroy every nexus and constructor and the claim is void.'},
    {title:'Frontier Compact',text:'The Organics: human settlers and Vael crews who stayed on Tephra after the colonial authority withdrew. They run cheap surplus machinery of a 1960s pattern, obsolete and endlessly repairable.'},
    {title:'The Vael',text:'Grey-violet, double-crested and digitigrade. Their heavier frames carry the shoulder launchers that make them the Compact\'s rocket infantry, and every crest keeps an oral history of the crews it served with.'},
    {title:'Expedition 07',text:'The seventh Compact expedition sent across the Ashline and the first to file a claim. Commander Mara Vale\'s force: ivory armor, cobalt panels and blue square insignia.'},
    {title:'AI Unity',text:'The Charter\'s automated survey-and-extraction network. When the colonial authority withdrew after the Burn, its mainframes kept running, linked themselves through Resonance spires and concluded that the shards were their own.'},
    {title:'The Red Ledger',text:'Rival Charter crews who jump claims rather than stake them. They field the same surplus machines as the Compact under crimson paint. Crimson always marks the rival claimant.'},
    {title:'Severed mainframes',text:'Unity mainframes cut off when relay links broke. Their cohorts diverged and fight the network as readily as anyone else; crimson Unity forces are always severed.'},
  ],
  people:[
    {title:'Cmdr. Mara Vale',text:'Commander of Expedition 07. Twenty years on the frontier, most of them spent keeping old machines alive.'},
    {title:'Chief Orrun-Tesk',text:'Launcher chief of the Vael Third Crest. Speaks for the launcher teams and remembers every one of them by name.'},
    {title:'Auditor Senna Kade',text:'Charter auditor. She does not take sides; she takes notes, and her notes decide who owns a sector.'},
    {title:'Captain Dace Mor',text:'Master of the Red Ledger crews. Jumps claims for a living and keeps careful books on every loss.'},
  ],
  flavor:{
    rifle:'Compact infantry carry rifles older than their sergeants. They still shoot straight.',
    rocket:'Vael launcher teams. The double crest is no ornament: it braces the tube.',
    scout:'A surplus survey buggy with a gun bolted to the roof. Fast, loud and first to every fight.',
    tank:'Vanguards arrive in crates and are bolted together on site around a cast turret.',
    artillery:'The crawler\'s gun was built to crack mountain rock. Unity plating is softer.',
    harvester:'Every load keeps the reactors lit and the payroll honest.',
    engineer:'Field engineers live on spare parts, welding rods and very little sleep.',
    constructor:'A Charter claim on tracks. While it rolls, the expedition has a future.',
    striker:'Pike crews take corners on four wheels out of six and call it routine.',
    unityRifle:'Printed in batches of twelve. Each batch remembers how the last one died.',
    unityRocket:'Heavy launch frames iterated from the survey network\'s charge drills.',
    unityScout:'Originally a mapping drone. It still logs every crater it passes.',
    unityTank:'Built to walk survey routes. The Burn turned every route into a front line.',
    unityArtillery:'Its firing solutions arrive from the Logic archives seconds before each shot.',
    unityHarvester:'The network files its haul as reclaimed property.',
    unityEngineer:'Repairs anything Unity owns, which by its own count is everything.',
    unityConstructor:'Unity files no claims. It simply extends itself.',
    unityStriker:'Multi-legged hunters tuned from the network\'s fastest survey sprinters.',
    wall:'Poured from slag and ash aggregate. Both sides build them; neither admits to copying.',
    core:'Charter law in one building: while a nexus runs, the sector is yours.',
    reactor:'Shard-fired flux cores, hand-tuned and loud enough to hear through the ash.',
    refinery:'Crushes raw shard into credits and charge. The Compact pays its crews in both.',
    barracks:'Arched halls where settlers and Vael crews draw kit and orders.',
    factory:'Foundry crews assemble vehicles from crates stamped decades before the Burn.',
    lab:'Studies shard resonance, the same signal Unity\'s spires bend to its will.',
    capacitor:'Racks of charge cells that keep the lights on when a reactor falls.',
    turret:'A rail gun on a mast. Without power it is only the mast.',
    rocketTower:'Twin missile pods on a raised pedestal. The Vael call it the long arm.',
    unityCore:'Each mainframe holds a full copy of Unity\'s will. Severing one silences only that copy.',
    unityReactor:'Spires link the mainframes into one mind. When one falls, its nodes go quiet.',
    unityRefinery:'A survey-era plant that now processes what Unity calls its own.',
    unityBarracks:'Prints cohorts to whichever combat algorithm the archives approved last.',
    unityFactory:'Forges walkers on the frames of old survey rigs.',
    unityLab:'Where Unity iterates its algorithms. The Charter still lists every archive as its property.',
    unityCapacitor:'Banks surplus resonance for the moment a spire falls.',
    unityTurret:'A precise, patient gun that fires only while the spires feed it.',
    unityRocketTower:'Fires shard-tipped munitions refined from the very field it guards.',
  },
};
