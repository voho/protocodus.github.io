import { mountCompactPlay } from './compact-play.js';
import { captureGame, encodeCapturedGame } from './background-jobs.js';
import { savePreparedGame } from './autosave-storage.js';
import { SAVE_KEY } from './model.js';
import { takeStartupGame, openStartMenu } from './start-menu.js';
import { surfaceHeight, tileSurface, MAX_HEIGHT } from './terrain-geometry.js';
import { refreshRouteConnections, getVehiclePurchase, getVehicleUpgrade, getFleetUpgrade, upgradeRouteVehicle, upgradeFleet, priceFor, inflationInfo, addRoute, removeRoute, tick, saveGame, BIOMES, INDUSTRIES, CARGO, BUILD_COSTS, stationCoverage, industryConditions, settlementSuitability, weatherAt } from './model.js';
import { createRenderer } from './renderer.js';
import { quoteBuildPlan, buildPlan } from './construction-plan.js';
import { routeTileIndex } from './route-tiles.js';
import { TILE } from './sprites.js';
import { drawUIArtwork } from './ui-art.js';
import { BUILDINGS, BUILDING_GROUPS } from './buildings.js';
import { ZOOM_LEVELS, ZOOM_VIEWS, zoomIndex } from './zoom.js';
import { cargoIcon, cargoBadge, cargoRecipe } from './cargo-icons.js';
import { filterRoutes, validateRoutePlan, routeCargoList, routeCargoOptions, defaultRouteName } from './route-planner.js';
import { TOWN_CARGO } from './data.js';
import { findIndustryTargets } from './chains.js';
import { mountChains } from './chains-view.js';
import { mountSaves } from './saves-view.js';
import { loadVisibility, saveVisibility, normalizeLayers, layerPreset } from './visibility.js';
import { mountVisibility } from './visibility-view.js';
import { townService, industryStatus, routeHealth, nextProject } from './gameplay-insights.js';
import { collectNotices, groupNotices, crossedMilestone, newYearNotice, toastType } from './ui-notices.js';
import { preloadHouses, onHouseAssetsChange } from './raster-houses.js';
import { preloadWorldArt, onWorldArtChange } from './atlas-runtime.js';
import { industryContains, industrySize, industryFootprint } from './industry-sites.js';
import { buildingAt, buildingSize, buildingFootprint } from './building-sites.js';
import { terrainObjectAt, terrainObjectSize } from './terrain-objects.js';
import { showLoading, updateLoading, hideLoading, isLoading, paintLoading } from './loading-screen.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer = value => Math.floor(Number(value) || 0).toLocaleString('en-US');
const money = value => '$' + integer(Math.abs(value));
const compactMoney = value => value >= 1000 ? '$' + (value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : money(value);
const iconPaths = {
 map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>',
 route:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"/>',
 chains:'<rect x="2" y="3" width="6" height="6" rx="1"/><rect x="2" y="15" width="6" height="6" rx="1"/><rect x="16" y="9" width="6" height="6" rx="1"/><path d="M8 6h4v12H8m4-6h4"/>',
 factory:'<path d="M3 21V11l6 3V9l6 4V3h4v18zM7 17v1m4-1v1m4-1v1M3 21h18"/>',
 city:'<path d="M3 21V9h7V3h7v8h4v10zM6 13v1m0 3v1m7-11v1m0 3v1m0 3v1m5 0v2M10 9v12"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.4 8.8a2.8 2.8 0 0 1 5.3 1c0 1.8-2.7 2-2.7 4M12 17h.01"/>',
 save:'<path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
 globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 rain:'<path d="M6 14a4 4 0 0 1-.6-7.9A6 6 0 0 1 17 5a4.5 4.5 0 0 1 1 9M7 17l-1 3m6-3-1 3m6-3-1 3"/>',
 grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m6-18v18M3 9h18M3 15h18"/>',
 layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7M6 10h12"/>',
 focus:'<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="12" r="3"/>',
 compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
 volume:'<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 muted:'<path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6"/>',
 road:'<path d="m7 2-3 20M17 2l3 20M12 3v3m0 5v3m0 5v2"/>',
 rail:'<path d="M7 2v20M17 2v20M4 5h16M4 10h16M4 15h16M4 20h16"/>',
 bridge:'<path d="M2 17h20M4 17V5m16 12V5M4 7q8 12 16 0M8 12v5m4-3v3m4-5v5M2 21h20"/>',
 tunnel:'<path d="M2 20h20M4 20V11a8 8 0 0 1 16 0v9M8 20v-8a4 4 0 0 1 8 0v8M10 16l-1 4m5-4 1 4M2 9l3-6h14l3 6"/>',
 raise:'<path d="m2 20 5-5 5 2 5-2 5 5M12 13V3m-4 4 4-4 4 4"/>',
 level:'<path d="M3 18h18M6 5v8m-3-3 3 3 3-3M18 13V5m-3 3 3-3 3 3"/>',
 lower:'<path d="m2 18 5-3 5 5 5-5 5 3M12 3v10m-4-4 4 4 4-4"/>',
 bus:'<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M9 3v8M7 18v3m10-3v3M8 14h1m6 0h1"/>',
 ship:'<path d="M4 13V7h5V3h6v4h5v6M3 13l9-3 9 3-3 6H6zM8 7h8M2 21q2-2 4 0t4 0 4 0 4 0 4 0"/>',
 port:'<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 10h8M4 13v3a8 8 0 0 0 16 0v-3M2 15l2-2 2 2m12 0 2-2 2 2"/>',
 train:'<rect x="5" y="2" width="14" height="16" rx="4"/><path d="M5 11h14M12 2v9M8 15h1m6 0h1M9 18l-3 4m9-4 3 4M8 21h8"/>',
 house:'<path d="m2 11 10-8 10 8M5 9v12h14V9M9 21v-7h6v7"/>',
 shop:'<path d="m3 9 2-6h14l2 6M3 9v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9zM5 15v6h14v-6M9 21v-5h6v5"/>',
 bulldoze:'<path d="M2 17h15l4 3V10M5 17V9h7l3 8M6 9V5h5l1 4M5 21h11a2 2 0 0 0 0-4H5a2 2 0 0 0 0 4z"/>',
 inspect:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6m-3-3h6"/>',
 tree:'<path d="m12 2-6 8h3l-5 7h16l-5-7h3zM12 17v5"/>',
 mine:'<path d="m3 21 6-13 3 5 4-10 6 18zM3 4q9-5 16 4M12 4 6 16"/>',
 arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',
 arrowup:'<path d="M6 18 18 6M6 6h12v12"/>',
 swap:'<path d="M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4"/>',
 warning:'<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
 leaf:'<path d="M20 3C8 2 2 8 5 15s16 5 15-12zM4 21l11-11"/>',
 snow:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>'
};
function icon(name, cls = '') { return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.factory}</svg>`; }
const transportName = mode => ({road:'Road',rail:'Rail',water:'Water'})[mode] || 'Transport';
const transportIcon = mode => mode==='water'?'ship':mode==='rail'?'train':'bus';
const stopName = mode => mode==='water'?'port':mode==='rail'?'rail station':'road stop';
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
hydrateIcons();

const TOOL_INFO = {
 inspect:{name:'Explore', icon:'inspect', detail:'Click to inspect. Drag to pan.'},
 road:{name:'Road',icon:'road',key:'R',detail:'Drag to build. Bridges and tunnels are automatic.'},
 rail:{name:'Rail',icon:'rail',key:'T',detail:'Drag to build. Bridges and tunnels are automatic.'},
 bridge:{name:'Road bridge',icon:'bridge',key:'B',detail:'Drag between flat banks at the same level, across water or lower land. Start back from the shoreline.'},
 railbridge:{name:'Rail bridge',icon:'bridge',key:'B',detail:'Drag between flat banks at the same level, across water or lower land. Start back from the shoreline.'},
 tunnel:{name:'Road tunnel',icon:'tunnel',key:'N',detail:'Drag between flat portal sites at the same level, through higher dry land.'},
 railtunnel:{name:'Rail tunnel',icon:'tunnel',key:'N',detail:'Drag between flat portal sites at the same level, through higher dry land.'},
 raise:{name:'Raise land',icon:'raise',key:']',detail:'Click or drag: +1 level per grid point, up to 7. Clear adjoining buildings and networks first.'},
 level:{name:'Level land',icon:'level',key:'E',detail:'Drag an area to match its first grid point’s height. Each changed point is charged per level. Clear buildings and networks first.'},
 lower:{name:'Lower land',icon:'lower',key:'[',detail:'Click or drag: −1 level per grid point, down to level 1. Water stays unchanged.'},
 stop:{name:'Stop',icon:'bus',key:'S',detail:'Click a road or railway near customers.'},
 'bus-stop':{name:'Road stop',icon:'bus',key:'S',detail:'Place on a road, within 5 tiles of customers.'},
 'train-stop':{name:'Rail station',icon:'train',detail:'Place on rail, within 5 tiles of customers.'},
 port:{name:'Port',icon:'port',key:'P',detail:'Place on water beside a bank, within 5 tiles of customers. Ships follow connected rivers, lakes and seas.'},
 residential:{name:'Residential',icon:'house',key:'1',detail:'Zone homes by roads. Transport brings residents.'},
 commercial:{name:'Commercial',icon:'shop',key:'2',detail:'Zone shops by roads. Transport drives growth.'},
 industrial:{name:'Industrial',icon:'factory',key:'3',detail:'Zone industry by roads. Transport drives growth.'},
 city:{name:'Found a town',icon:'city',detail:'Place on open land. Add roads, zones and transport.'},
 bulldoze:{name:'Bulldozer',icon:'bulldoze',key:'X',detail:'Click or drag to clear buildings, groves, rocks or individual network tiles. Each whole site is charged once. Retire routes before removing stops.'}
};
updateLoading('Preparing terrain and your company…',1);
await paintLoading();
let game;
game=takeStartupGame()||await openStartMenu();
updateLoading('Loading buildings, vehicles and landscapes…',2);
await paintLoading();
await Promise.all([preloadHouses({biome:game.biome}),preloadWorldArt({biome:game.biome})]);
const canvas = $('#world');
let sceneRevision=0;
const invalidateScene=()=>{sceneRevision++;};
const renderer = createRenderer(canvas, game,{onInvalidate:invalidateScene});
document.fonts?.ready.then(invalidateScene);
let pricingYear = inflationInfo(game).year;
let mapLayers = loadVisibility(), layersView = null, layerStorageNotice = false;
renderer.setLayers(mapLayers);
let compactUI=null;
let view = 'build', category = 'network', tool = 'inspect', speed = 1, previousSpeed = 1;
let buildingGroup = 'homes';
let hover = null, selected = null, preview = [];
let pointer = null, spaceDown = false, spaceUsedForPan = false, sounds = false, audioContext;
let preferredMode = 'road', touchGesture = null, engineeringOpen = false;
const touchPoints = new Map();
let lastFrame = performance.now(), hudAt = 0, saveAt = performance.now(), minimapAt = 0, panelAt = 0;
let worldSerial=0,savedWorld=-1,savedDay=-1,savedRevision=-1;
let pendingSave=null, capturingSave=false, menuOpening=false;
let formDraft = { name:'', mode:'road', from:'', to:'', cargo:'passengers' };
const ROUTES_PER_PAGE = 50;
let routePage = 0;
let routeFilters = { query:'', mode:'all', status:'all', cargo:'all' }, routePicking = '';
let entityFilters = { towns:'', industry:'', kind:'all' };
let lastRevision = -1;
let lastNoticeId = game.day<1 ? undefined : game.notifications[0]?.id;
let goalChoice = null, goalSignature = '', goalOpen = false, goalCollapsed = (() => { try { return localStorage.getItem('transport-next-goal-v1') || ''; } catch { return ''; } })();
let noticeQueue=[],noticeAt=0,pacedNoticeAt=-Infinity,panelPricesStale=false,knownRoutes=new Set(),firstDeliveryPending=new Set(),townPeaks=new Map(),townDay=-1;
resetMoments();
const spanTools = new Set(['bridge','railbridge','tunnel','railtunnel']);
const terrainTools = new Set(['raise','lower','level']);
const lineTools = new Set(['road','rail',...spanTools,...terrainTools,'residential','commercial','industrial','bulldoze']);
const mobileToggle = document.createElement('button');
mobileToggle.className = 'mobile-panel-toggle'; mobileToggle.innerHTML = icon('road')+'<span>Manage</span>'; mobileToggle.setAttribute('aria-label','Toggle construction and management panel'); mobileToggle.setAttribute('aria-expanded','false');
$('.workspace').append(mobileToggle);
mobileToggle.addEventListener('click', () => { cancelGesture();const open = $('.sidebar').classList.toggle('mobile-open'); mobileToggle.classList.toggle('open',open); mobileToggle.setAttribute('aria-expanded',String(open)); mobileToggle.innerHTML=icon(open?'close':'road')+'<span>Manage</span>'; });
function closeMobile() { $('.sidebar').classList.remove('mobile-open'); mobileToggle.classList.remove('open'); mobileToggle.setAttribute('aria-expanded','false'); mobileToggle.innerHTML=icon('road')+'<span>Manage</span>'; compactUI?.syncManagement(); }
function syncLayerControls() {
 $('#grid-button').setAttribute('aria-pressed',String(mapLayers.grid));
 $('#grid-button').classList.toggle('active',mapLayers.grid);
 $('#routes-toggle').setAttribute('aria-pressed',String(mapLayers.routes));
 $('#routes-toggle').classList.toggle('active',mapLayers.routes);
 layersView?.refresh();
}
function setMapLayers(patch) {
 mapLayers=normalizeLayers({...mapLayers,...patch});renderer.setLayers(mapLayers);syncLayerControls();
 renderer.drawMinimap($('#minimap'));minimapAt=performance.now();
 if(saveVisibility(mapLayers))layerStorageNotice=false;
 else if(!layerStorageNotice){layerStorageNotice=true;toast('Layers changed. This browser could not remember the settings.',true);}
}

function beep(type='ok') {
 if (!sounds) return;
 try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume(); const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.type='sine'; oscillator.frequency.setValueAtTime(type==='error'?190:560,audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(type==='error'?120:830,audioContext.currentTime+.09); gain.gain.setValueAtTime(.025,audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.13); oscillator.start(); oscillator.stop(audioContext.currentTime+.14); } catch { sounds=false; }
}
function toast(message, options=false) {
 const {type=options===true?'error':'ok',action=null,key=message,silent=false}=typeof options==='object'&&options?options:{},region=$('#toast-region');
 let el=[...region.children].find(node=>node.toastKey===key),count=1;
 if(el){count=el.toastCount+1;clearTimeout(el.toastTimer);}else{el=document.createElement('div');region.append(el);}
 el.className='toast'+(type==='ok'?'':' '+type);el.toastKey=key;el.toastCount=count;
 el.innerHTML=icon(type==='ok'||type==='milestone'?'check':'warning')+`<span>${escapeHTML(message)}</span>`+(count>1?`<b class="toast-count">×${count}</b>`:'')+(action?`<button type="button" class="toast-action">${escapeHTML(action.label)}</button>`:'');
 if(action)el.querySelector('.toast-action').onclick=()=>{el.remove();action.run();};
 while(region.children.length>3) region.firstChild.remove();
 el.toastTimer=setTimeout(()=>el.remove(),type==='warning'||type==='error'?8000:5000); $('#status-message').textContent=message; if(!silent&&type!=='ok')beep(type==='milestone'?'ok':'error');
}
function changeSpeed(next) { if(next>0)previousSpeed=next; speed=next; $$('.speed-control button').forEach(el=>{el.classList.toggle('active',Number(el.dataset.speed)===speed);el.setAttribute('aria-pressed',String(Number(el.dataset.speed)===speed));}); }
function closeMapMenus(restoreFocus=false) {
 for(const [menuId,buttonId] of [['zoom-menu','zoom-level'],['map-options','map-options-button']]){
  const menu=$('#'+menuId),button=$('#'+buttonId);if(!menu||menu.hidden)continue;
  menu.hidden=true;button.setAttribute('aria-expanded','false');if(restoreFocus)button.focus({preventScroll:true});
 }
}
function toggleMapMenu(menuId,buttonId) {
 const menu=$('#'+menuId),opening=menu.hidden;closeMapMenus();layersView?.close();
 if(opening){cancelGesture();menu.hidden=false;$('#'+buttonId).setAttribute('aria-expanded','true');menu.querySelector('button')?.focus({preventScroll:true});}
}
function syncToolControls() {
 const bar=$('#active-tool-bar');if(!bar)return;
 bar.hidden=tool==='inspect'||isRoutePicking();
 const info=TOOL_INFO[tool]||BUILDINGS[tool]||INDUSTRIES[tool];
 $('#active-tool-icon').innerHTML=icon(info?.icon||'factory');
 $('#active-tool-name').textContent=info?.name||'Build';
 $('#active-tool-hint').textContent=lineTools.has(tool)?window.innerWidth<=700?'Drag to build · Two fingers to move':'Drag to build · Done to explore':window.innerWidth<=700?'Tap to place · Drag to move':'Click to place · Drag to move';
 if(tool==='bulldoze')$('#active-tool-hint').textContent='Click or drag · Clears whole sites';
 if(BUILDINGS[tool]||INDUSTRIES[tool]){const size=BUILDINGS[tool]?buildingFootprint(tool):industryFootprint(tool);$('#active-tool-hint').textContent=`${size} × ${size} site · Click to place`;}
 if(terrainTools.has(tool))$('#active-tool-hint').textContent=tool==='level'?'Drag an area · Match the first point':`Click or drag · ${tool==='raise'?'+1':'−1'} level per point`;
 if(spanTools.has(tool))$('#active-tool-hint').textContent='Drag straight · Flat ends at the same level';
 $('#map-hint').hidden=tool!=='inspect'||isRoutePicking();
}
function setTool(next) {
 cancelGesture();closeMapMenus();cancelRoutePicking();
 if(['road','bridge','tunnel','bus-stop'].includes(next))preferredMode='road';
 if(['rail','railbridge','railtunnel','train-stop'].includes(next))preferredMode='rail';
 if(spanTools.has(next)||terrainTools.has(next)){category='network';engineeringOpen=true;}
 tool=['bus-stop','train-stop'].includes(next)?'stop':next;selected=null;hover=null;
 $('#inspector').hidden=true;canvas.classList.toggle('build-mode',tool!=='inspect');
 $('#status-message').textContent=toolDescription(tool);renderPanel();syncToolControls();
 closeMobile();canvas.focus({preventScroll:true});
}
function setView(next) {
 const changedView=view!==next;
 cancelGesture();closeMapMenus();if(next!=='routes')cancelRoutePicking();
 if(next!=='build'&&tool!=='inspect'){tool='inspect';canvas.classList.remove('build-mode');}
 view=next;$$('[data-mobile-view]').forEach(el=>el.classList.toggle('active',el.dataset.mobileView===next));
 $$('.nav-button[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
 renderPanel();if(changedView)$('#panel-content').scrollTop=0;syncToolControls();if(compactUI){compactUI.openManagement();updateHud();}else if(window.innerWidth<=700&&!$('.sidebar').classList.contains('mobile-open'))mobileToggle.click();
}
function infrastructureKind(key) {
 return ({stop:preferredMode==='rail'?'train-stop':'bus-stop',bridge:'road-bridge',railbridge:'rail-bridge',tunnel:'road-tunnel',railtunnel:'rail-tunnel'})[key]||(['road','rail','port','bus-stop','train-stop'].includes(key)?key:'');
}
function infrastructurePortrait(kind,cls='tool-art') { return `<canvas class="${cls}" width="72" height="56" data-infrastructure-sprite="${kind}" aria-hidden="true"></canvas>`; }
function industryPortrait(kind,cls='entity-art') { return `<canvas class="${cls}" width="112" height="112" data-industry-sprite="${kind}" aria-hidden="true"></canvas>`; }
function toolCard(key, label) {
 const info=TOOL_INFO[key],base=key==='stop'?Math.min(BUILD_COSTS['bus-stop'],BUILD_COSTS['train-stop']):BUILD_COSTS[key],automatic=['road','rail','stop'].includes(key);
 return `<button class="tool-card ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}" title="${escapeHTML(info.detail)}">${infrastructureKind(key)?infrastructurePortrait(infrastructureKind(key)):icon(info.icon)}<span class="tool-title">${label||info.name}</span><span class="tool-cost">${automatic?'from ':''}${compactMoney(priceFor(game,base))}${lineTools.has(key)?key==='bulldoze'?' / site':key==='level'?' / step':terrainTools.has(key)?' / point':' / tile':''}</span>${info.key?`<span class="shortcut">${info.key}</span>`:''}</button>`;
}
function toolDescription(key) {
 if (TOOL_INFO[key]) return TOOL_INFO[key].detail;
 if (BUILDINGS[key]) { const b=BUILDINGS[key];return `${b.name} · ${buildingFootprint(key)} × ${buildingFootprint(key)} clear tiles near roads.`; }
 if (INDUSTRIES[key]) {const d=INDUSTRIES[key];return `${d.name} · ${industryFootprint(key)} × ${industryFootprint(key)} clear tiles. Add a stop within 5 tiles.`;}
 return 'Choose a tool.';
}
function buildingBenefit(kind) {
 const definition=BUILDINGS[kind];
 if(definition.residents)return `${definition.residents} residents per level when placed within 10 tiles of a town. Nearby services and greenery help homes flourish.`;
 const effects={school:'Helps nearby neighborhoods develop and supports local factory productivity.',hospital:'Improves neighborhood appeal and supports local factory productivity.','police-station':'Supports local traffic and lowers nearby vehicle upkeep.','fire-station':'Lowers nearby factory upkeep and improves neighborhood appeal.'};
 return effects[kind]||(definition.group==='shops'?'Attracts nearby development and supports local passenger demand.':definition.group==='services'?'Attracts nearby development and supports local transport and industry.':'Improves neighborhood appeal and supports local passenger demand.');
}
function buildingPalette() {
 return `<div class="section-divider"></div><div class="panel-heading"><h2>Buildings</h2><span>26 designs</span></div><label class="building-filter"><span class="sr-only">Building collection</span><select id="building-group" aria-label="Building collection">${Object.entries(BUILDING_GROUPS).map(([key,g])=>`<option value="${key}" ${buildingGroup===key?'selected':''}>${g.name} · ${Object.values(BUILDINGS).filter(b=>b.group===key).length}</option>`).join('')}</select></label><div class="building-grid">${Object.entries(BUILDINGS).filter(([,b])=>b.group===buildingGroup).map(([key,b])=>`<button class="building-card ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}" title="${escapeHTML(b.name)} · ${buildingFootprint(key)} × ${buildingFootprint(key)} site · ${money(priceFor(game,b.cost))} · ${escapeHTML(buildingBenefit(key))}"><canvas width="96" height="100" data-building-sprite="${key}" aria-hidden="true"></canvas><span class="building-tier">${b.tier||BUILDING_GROUPS[b.group].name}</span><strong>${escapeHTML(b.name)}</strong><span class="building-price">${money(priceFor(game,b.cost))}<small>${buildingFootprint(key)} × ${buildingFootprint(key)}</small></span></button>`).join('')}</div>`;
}
function drawPaletteSprites(root = document) { drawUIArtwork(root, game); }

function projectCard() {
 const project=nextProject(game,{source:goalChoice});
 return `<details class="project-card"><summary>${escapeHTML(project.title)}</summary><p>${escapeHTML(project.detail)}</p><button class="small-button" data-project-action="${project.action}" ${project.target?`data-project-target="${escapeHTML(project.target)}"`:''}>${escapeHTML(project.button)} ${icon('arrow')}</button><button type="button" class="project-show" data-goal-show>Show on map</button></details>`;
}
function runProjectAction(action,target,extra={}) {
 if(action==='source')locateIndustry(target);
 else if(action==='city')locateDestination(target,'city');
 else if(action==='stop'||action==='connect'){
  category='network';setView('build');setTool(extra.tool);
  // Frame both sites; the Region view keeps a long first route or a narrow screen in view.
  const center=site=>{const industry=game.industries.find(i=>i.id===site.id);return industry?{x:industry.x+(industrySize(industry)-1)/2,y:industry.y+(industrySize(industry)-1)/2}:site;};
  if(extra.choice){
   const a=center(extra.choice.source),b=center(extra.choice.buyer),fits=()=>[a,b].every(p=>{const s=renderer.worldToScreen(p.x,p.y);return s.x>40&&s.y>40&&s.x<canvas.clientWidth-40&&s.y<canvas.clientHeight-40;});
   renderer.setZoom(1);renderer.focus((a.x+b.x)/2,(a.y+b.y)/2);if(Math.hypot(a.x-b.x,a.y-b.y)>20||!fits()){renderer.setZoom(.5);renderer.focus((a.x+b.x)/2,(a.y+b.y)/2);}updateHud();
  }
 }
 else if(action==='launch'){formDraft={name:'',mode:extra.mode,from:String(extra.from??''),to:String(extra.to??''),cargo:extra.cargo};setView('routes');$('#route-form')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 else if(action==='chains')openChains();
 else if(action==='routes')setView('routes');
 else if(action==='towns'){category='towns';setView('build');$('#panel-content').scrollTop=0;}
 else openAtlas();
}
// The next goal card repaints only when its text, checklist or progress changes.
function storeGoalCollapsed(title) { goalCollapsed=title;try{if(title)localStorage.setItem('transport-next-goal-v1',title);else localStorage.removeItem('transport-next-goal-v1');}catch{} }
function renderGoal() {
 const project=nextProject(game,{source:goalChoice}),steps=project.steps||[],current=steps.findIndex(step=>!step.done),collapsed=goalCollapsed===project.title;
 const signature=[project.title,project.detail,steps.map(step=>`${step.done}${step.label}${step.button}`).join(),current,project.progress?.value,project.choice,project.choices?.length,collapsed,goalOpen].join('|');
 if(signature===goalSignature)return;goalSignature=signature;
 const card=$('#objective-card');card.hidden=false;card.classList.toggle('collapsed',collapsed);card.classList.toggle('open',goalOpen&&!collapsed);
 $('#objective-chip-title').textContent=project.title;$('#objective-title').textContent=project.title;$('#objective-detail').textContent=project.detail;
 $('#objective-steps').hidden=!steps.length;
 $('#objective-steps').innerHTML=steps.map((step,index)=>`<li class="objective-step${step.done?' done':''}${index===current?' current':''}">${step.done?icon('check'):`<span class="step-circle">${index+1}</span>`}<span>${escapeHTML(step.label)}${step.done?'<span class="sr-only"> · done</span>':''}</span>${index===current&&step.button?`<button type="button" class="small-button" data-goal-step="${index}">${escapeHTML(step.button)}</button>`:''}</li>`).join('');
 $('#objective-progress').hidden=!project.progress;$('#goal-bar').style.width=(project.progress?project.progress.value/project.progress.max*100:0)+'%';
 $('#objective-action').innerHTML=escapeHTML(project.button)+icon('arrow');$('#objective-another').hidden=!(project.choices?.length>1);$('#guide-button').hidden=!steps.length;
}
function goalClick(e) {
 const button=e.target.closest('button');if(!button||button.id==='guide-button')return;
 const project=nextProject(game,{source:goalChoice}),keyboard=e.detail===0;
 if(button.id==='dismiss-objective'){storeGoalCollapsed(project.title);goalOpen=false;}
 else if(button.id==='objective-chip'){storeGoalCollapsed('');goalOpen=true;}
 else if(button.id==='objective-another'){goalChoice=project.choices[(project.choice+1)%project.choices.length].source.id;if(view==='build')renderPanel();}
 else if(button.id==='objective-action'){goalOpen=false;runProjectAction(project.action,project.target);}
 else if(button.dataset.goalStep){const step=project.steps[Number(button.dataset.goalStep)];goalOpen=false;if(step?.action)runProjectAction(step.action,project.target,{...step,choice:project.choices[project.choice]});}
 renderGoal();
 if(keyboard&&button.id==='dismiss-objective')$('#objective-chip').focus({preventScroll:true});
 if(keyboard&&button.id==='objective-chip')$('#dismiss-objective').focus({preventScroll:true});
}
function engineeringTools() {
 return `<details class="engineering-tools" ${engineeringOpen?'open':''}><summary>${icon('raise')} Terrain &amp; crossings</summary><div class="tool-grid">${toolCard('raise','Raise +1')}${toolCard('lower','Lower −1')}${toolCard('level','Level area')}</div><div class="stop-mode-picker" role="group" aria-label="Bridge and tunnel transport"><span>Crossings</span>${['road','rail'].map(mode=>`<button data-crossing-mode="${mode}" aria-pressed="${preferredMode===mode}">${icon(mode)} ${mode==='road'?'Road':'Rail'}</button>`).join('')}</div><div class="tool-grid">${toolCard(preferredMode==='rail'?'railbridge':'bridge','Bridge')}${toolCard(preferredMode==='rail'?'railtunnel':'tunnel','Tunnel')}</div></details>`;
}
function buildPanel() {
 const groups={network:['road','rail','stop','port','bulldoze'],towns:['residential','commercial','industrial','city']};
 const tabs=`<div class="build-tabs" role="tablist" aria-label="Construction categories">${[['network','Network'],['towns','Town'],['industry','Industry']].map(([key,label])=>`<button role="tab" aria-selected="${category===key}" data-category="${key}" class="${category===key?'active':''}">${label}</button>`).join('')}</div>`;
 const industries=`<div class="tool-list">${Object.entries(INDUSTRIES).filter(([,d])=>d.biomes.includes(game.biome)).map(([key,d])=>`<button class="industry-tool ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}"><canvas class="industry-art" width="112" height="112" data-industry-sprite="${key}" aria-hidden="true"></canvas><span class="industry-tool-summary"><strong>${d.name}</strong>${cargoRecipe(d.inputs,d.outputs,{counts:false})}</span><span class="tool-cost">${compactMoney(priceFor(game,d.cost))}<small>${industryFootprint(key)} × ${industryFootprint(key)}</small></span></button>`).join('')}</div>`;
 return `<div class="panel-heading"><h2>Build</h2></div>${tabs}${category==='industry'?industries:`<div class="tool-grid">${groups[category].map(key=>toolCard(key)).join('')}</div>`}${tool==='stop'?`<div class="stop-mode-picker" role="group" aria-label="Stop type at road and rail crossings"><span>At crossings</span>${['road','rail'].map(mode=>`<button data-stop-mode="${mode}" aria-pressed="${preferredMode===mode}">${icon(mode)} ${mode==='road'?'Road':'Rail'}</button>`).join('')}</div>`:''}${category==='network'?engineeringTools():''}<div class="tool-description">${category==='network'&&tool==='inspect'?'Roads and rails climb straight slopes. Level awkward ground in Terrain & crossings.':escapeHTML(toolDescription(tool))}</div><div class="build-bottom-tools"><button class="compact-tool ${tool==='inspect'?'active':''}" data-tool="inspect">${icon('inspect')} Explore <span>Esc</span></button>${category!=='network'?`<button class="compact-tool danger ${tool==='bulldoze'?'active':''}" data-tool="bulldoze">${icon('bulldoze')} Bulldozer <span>X</span></button>`:''}</div>${category==='towns'?buildingPalette():projectCard()+`<button class="text-button" data-action="help">How to play <span>↗</span></button>`}`;
}
function cargoChoices(options=[]) {
 const available=routeCargoList(game).map(key=>[key,CARGO[key]]),verdicts=new Map(options.map(option=>[option.cargo,option]));
 const fit=(key,c)=>{const option=verdicts.get(key);return (option?` data-fits="${option.valid}"`:'')+` title="${escapeHTML(option&&!option.valid?option.message:c.name)}"`;};
 return `<fieldset class="cargo-field"><legend>Cargo</legend><select name="cargo" hidden aria-hidden="true" tabindex="-1">${available.map(([key,c])=>`<option value="${key}" ${formDraft.cargo===key?'selected':''}>${c.name}</option>`).join('')}</select><div class="cargo-picker" role="group" aria-label="Choose cargo">${available.map(([key,c])=>`<button type="button" class="cargo-choice" data-cargo-choice="${key}" aria-pressed="${formDraft.cargo===key}"${fit(key,c)}>${cargoIcon(key,{decorative:true})}<span>${c.name}</span>${verdicts.get(key)?.valid?`${icon('check','cargo-fit')}<span class="sr-only"> · fits these stops</span>`:''}</button>`).join('')}</div></fieldset>`;
}
function coverageNote(id,key,interactive=false) {
 const station=game.stations.find(s=>String(s.id)===String(id));if(!station)return '';
 const cargo=stationCoverage(game,station)[key];
 const badge=key=>interactive&&Object.hasOwn(CARGO,key)?`<button type="button" class="coverage-pick" data-cargo-pick="${key}" title="Carry ${escapeHTML(CARGO[key].name.toLowerCase())}">${cargoBadge(key)}</button>`:cargoBadge(key);
 return `<div class="coverage-note"><strong>${key==='produces'?'Loads':'Accepts'}</strong><span class="coverage-cargo">${cargo.length?cargo.map(badge).join(''):'No cargo nearby'}</span></div>`;
}
function routeForm() {
 const stations=game.stations.filter(s=>s.mode===formDraft.mode),purchase=getVehiclePurchase(game,formDraft.mode);
 const opts=(current)=>'<option value="">Choose a stop…</option>'+stations.map(s=>`<option value="${s.id}" ${String(s.id)===String(current)?'selected':''}>${escapeHTML(s.name)}</option>`).join('');
 const plan=validateRoutePlan(game,formDraft),options=formDraft.from&&formDraft.to?routeCargoOptions(game,formDraft):[];
 const stopField=(key,label,coverage)=>`<div class="route-stop-field"><div class="route-stop-label"><span>${label}</span><button type="button" data-pick-route="${key}" aria-pressed="${routePicking===key}" aria-label="Select ${key==='from'?'start':'end'} stop on map">${icon('focus')} Pick on map</button></div><label class="form-field"><span class="sr-only">${label} stop</span><select name="${key}" required>${opts(formDraft[key])}</select></label>${coverageNote(formDraft[key],coverage,true)}</div>`;
 const swap=`<div class="route-swap"><button type="button" id="swap-route-stops" aria-label="Swap start and end" title="Swap start and end" ${formDraft.from||formDraft.to?'':'disabled'}>${icon('swap')}</button></div>`;
 return `<details id="route-planner" class="route-planner" ${routePicking||formDraft.open!==false||!game.routes.length?'open':''}><summary>${icon('route')}<h3>New route</h3></summary><form id="route-form" class="panel-form"><p class="form-note">Pick a start, then an end. We’ll check the connection and suggest cargo.</p><label class="form-field"><span>Name (optional)</span><input name="name" maxlength="36" placeholder="${escapeHTML(defaultRouteName(game,plan,formDraft.cargo)||'Route name')}" value="${escapeHTML(formDraft.name)}"></label><label class="form-field"><span>Transport</span><select name="mode"><option value="road" ${formDraft.mode==='road'?'selected':''}>Road · bus / truck</option><option value="rail" ${formDraft.mode==='rail'?'selected':''}>Rail · train</option><option value="water" ${formDraft.mode==='water'?'selected':''}>Water · ship / ferry</option></select></label>${formDraft.mode==='water'?'<p class="form-note">Ports need connected water. Ships pass beneath bridges.</p>':''}${stopField('from','Start','produces')}${swap}${stopField('to','End','accepts')}${cargoChoices(options)}<div id="route-connection" class="route-connection" role="status" aria-live="polite" data-state="${plan.state}" data-valid="${plan.valid}" data-message="${escapeHTML(routePlanText(plan))}">${routePlanMessage(plan)}</div><div class="purchase-vehicle"><canvas width="80" height="64" data-vehicle-sprite="purchase" data-mode="${formDraft.mode}" data-cargo="${formDraft.cargo}" data-level="${purchase.level}" aria-hidden="true"></canvas><div class="form-summary"><span id="vehicle-purchase-spec">Gen ${purchase.level+1} · ${purchase.capacity} units</span><strong id="vehicle-purchase-price">${money(purchase.cost)}</strong></div></div><button class="button button-primary full" type="submit" ${plan.valid?'':'disabled'}>${icon(transportIcon(formDraft.mode))} Launch route</button><p class="form-note">Route earnings must cover daily upkeep. Upgrade only when demand needs more capacity.</p></form></details>`;
}
function routesPanel() {
 const options=(entries,current)=>entries.map(([key,label])=>`<option value="${key}" ${key===current?'selected':''}>${escapeHTML(label)}</option>`).join('');
 const routes=filterRoutes(game,routeFilters);
 return `<div class="panel-heading"><h2>Routes</h2><button class="small-button" id="new-route-button">+ New route</button></div>${routeForm()}${fleetControls()}<div class="route-filters"><label class="route-search-field"><span class="sr-only">Search routes</span><input id="route-search" type="search" placeholder="Search routes, stops or cargo" aria-label="Search routes, stops or cargo" value="${escapeHTML(routeFilters.query)}"></label><label><span>Transport</span><select id="route-filter-mode">${options([['all','All transport'],['road','Road'],['rail','Rail'],['water','Water · ships']],routeFilters.mode)}</select></label><label><span>Status</span><select id="route-filter-status">${options([['all','All statuses'],['running','Connected'],['disconnected','Disconnected']],routeFilters.status)}</select></label><label class="route-cargo-filter"><span class="sr-only">Filter routes by cargo</span><select id="route-filter-cargo" aria-label="Filter routes by cargo">${options([['all','All cargo'],...Object.entries(CARGO).map(([key,cargo])=>[key,cargo.name])],routeFilters.cargo)}</select></label></div><div class="route-list-heading"><span id="route-results-count" role="status">${routes.length} of ${game.routes.length} routes</span><button class="small-button" id="clear-route-filters">Clear filters</button></div><div id="route-list">${routePageCards(routes)}</div>`;
}
function visibleRoutePage(routes) {
 routePage=Math.min(routePage,Math.max(0,Math.ceil(routes.length/ROUTES_PER_PAGE)-1));
 return routes.slice(routePage*ROUTES_PER_PAGE,(routePage+1)*ROUTES_PER_PAGE);
}
function routePageCards(routes) {
 const visible=visibleRoutePage(routes),pages=Math.ceil(routes.length/ROUTES_PER_PAGE);
 const controls=pages>1?`<nav class="route-pagination" aria-label="Route pages"><button class="small-button" data-route-page="previous" ${routePage===0?'disabled':''}>Previous</button><span>Page ${routePage+1} of ${pages}</span><button class="small-button" data-route-page="next" ${routePage===pages-1?'disabled':''}>Next</button></nav>`:'';
 return controls+routeCards(visible)+controls;
}
function routeCards(routes) {
 const stopsById=new Map(game.stations.map(stop=>[stop.id,stop]));
 return routes.length?routes.map(route=>{
 const from=stopsById.get(route.stops[0]),to=stopsById.get(route.stops[1]),health=routeHealth(game,route),profit=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0);
 return `<article class="route-card" data-route-id="${route.id}"><div class="route-header"><span class="route-dot" style="background:${escapeHTML(route.color||'#d9965c')}"></span><strong>${escapeHTML(route.name)}</strong><span data-route-status="${route.id}">${escapeHTML(health.label)}</span></div><div class="route-journey">${escapeHTML(from?.name||'Removed stop')}${icon('arrow')}${escapeHTML(to?.name||'Removed stop')}</div><div class="route-stats"><span class="route-mode-icon" title="${transportName(route.mode)}"><canvas width="80" height="64" data-vehicle-sprite="${route.id}" aria-hidden="true"></canvas><span class="sr-only">${transportName(route.mode)}</span></span>${cargoBadge(route.cargo,{label:true})}<span data-route-stat="${route.id}">${integer(route.delivered)} moved</span></div><div class="route-earnings"><span>Net earned</span><strong data-route-revenue="${route.id}" title="Revenue minus route upkeep; excludes construction.">${profit<0?'−':''}${money(profit)}</strong><span data-route-load="${route.id}"></span></div><p class="route-health" data-route-health="${route.id}" title="${escapeHTML(health.detail)}">${escapeHTML(health.detail)}</p><div class="route-vehicle-spec" data-vehicle-spec="${route.id}">${vehicleSpec(getVehicleUpgrade(game,route.id))}</div><div class="route-actions"><button class="small-button" data-focus-route="${route.id}">Show</button>${upgradeButton(route)}<button class="small-button danger" data-remove-route="${route.id}">Retire</button></div></article>`;}).join(''):`<div class="empty-state">${icon('route')}${game.routes.length?'No routes match these filters.':'Connect two stops to start.'}</div>`;
}
function vehicleSpec(quote) { return `<span>Gen ${quote.level+1} · ${quote.capacity} units</span><span>${quote.speedMultiplier.toFixed(1)}× speed</span>`; }
function upgradeTitle(quote) {
 return quote.available?`${quote.capacity} → ${quote.nextCapacity} capacity · ${quote.speedMultiplier.toFixed(1)}× → ${quote.nextSpeedMultiplier.toFixed(1)}× speed${quote.affordable?'':' · More funds needed'}`:`Next vehicle model: January ${1951+quote.targetLevel}`;
}
function upgradeButton(route) {
 const quote=getVehicleUpgrade(game,route.id);
 return `<button class="small-button route-upgrade-button" data-upgrade-route="${escapeHTML(route.id)}" title="${escapeHTML(upgradeTitle(quote))}" ${quote.available&&quote.affordable?'':'disabled'}>${quote.available?'Upgrade · '+compactMoney(quote.cost):'Latest model'}</button>`;
}
function fleetControls() {
 const quote=getFleetUpgrade(game);
 return `<div class="fleet-upgrades"><div class="fleet-upgrade-heading"><strong>Fleet upgrades</strong><small id="fleet-upgrade-note">${quote.available?quote.count+' vehicles ready':'Next: Jan '+(1951+quote.targetLevel)}</small></div><button id="upgrade-fleet" ${quote.available&&quote.affordable?'':'disabled'} title="Upgrade every eligible route to the latest available vehicle">${quote.available?'Upgrade all · '+money(quote.cost):'Fleet up to date'}</button></div>`;
}
function refreshUpgradeControls() {
 const fleetButton=$('#upgrade-fleet');if(!fleetButton)return;
 const fleet=getFleetUpgrade(game);
 fleetButton.disabled=!fleet.available||!fleet.affordable;
 fleetButton.textContent=fleet.available?'Upgrade all · '+money(fleet.cost):'Fleet up to date';
 fleetButton.title=fleet.available?`Upgrade ${fleet.count} vehicles to generation ${fleet.targetLevel+1}${fleet.affordable?'':' · More funds needed'}`:`New models arrive in January ${1951+fleet.targetLevel}`;
 $('#fleet-upgrade-note').textContent=fleet.available?fleet.count+' vehicles ready':'Next: Jan '+(1951+fleet.targetLevel);
 $$('[data-upgrade-route]').forEach(button=>{
  const quote=getVehicleUpgrade(game,button.dataset.upgradeRoute);
  button.disabled=!quote.available||!quote.affordable;button.title=upgradeTitle(quote);
  button.textContent=quote.available?'Upgrade · '+compactMoney(quote.cost):'Latest model';
 });
 $$('[data-vehicle-spec]').forEach(el=>{const content=vehicleSpec(getVehicleUpgrade(game,el.dataset.vehicleSpec));if(el.innerHTML!==content)el.innerHTML=content;});
 const purchase=getVehiclePurchase(game,formDraft.mode);
 if($('#vehicle-purchase-price'))$('#vehicle-purchase-price').textContent=money(purchase.cost);
 if($('#vehicle-purchase-spec'))$('#vehicle-purchase-spec').textContent=`Gen ${purchase.level+1} · ${purchase.capacity} units`;
 const portrait=$('[data-vehicle-sprite="purchase"]');if(portrait){Object.assign(portrait.dataset,{mode:formDraft.mode,cargo:formDraft.cargo,level:String(purchase.level)});drawPaletteSprites($('#route-form'));}
}
function performUpgrade(routeId) {
 const restoreFocus=document.activeElement?.matches('[data-upgrade-route],#upgrade-fleet');
 const result=routeId?upgradeRouteVehicle(game,routeId):upgradeFleet(game);
 toast(result.message,!result.ok);
 if(result.ok){refreshRouteList();updateHud();persist();if(restoreFocus){const target=routeId?$$('[data-focus-route]').find(button=>button.dataset.focusRoute===routeId):$('#new-route-button');target?.focus({preventScroll:true});}}
}
function routePlanText(plan) { return formDraft.autoNote?`${plan.message.replace(/\.$/,'')} · ${formDraft.autoNote}`:plan.message; }
function routePlanMessage(plan) { return icon(plan.valid?'check':plan.state==='missing'?'route':'warning')+`<span>${escapeHTML(routePlanText(plan))}</span>`; }
function refreshRoutePlan() {
 const status=$('#route-connection'),form=$('#route-form');if(!status||!form)return;
 const plan=validateRoutePlan(game,formDraft),text=routePlanText(plan),name=form.querySelector('[name=name]'),placeholder=defaultRouteName(game,plan,formDraft.cargo)||'Route name';
 if(status.dataset.message!==text){status.innerHTML=routePlanMessage(plan);status.dataset.message=text;}
 if(name.placeholder!==placeholder)name.placeholder=placeholder;
 status.dataset.state=plan.state;status.dataset.valid=String(plan.valid);form.querySelector('[type=submit]').disabled=!plan.valid;
}
// Suggest cargo once per change of stops or transport. A cargo that still fits is never replaced.
function autoSelectCargo() {
 const key=`${formDraft.from}|${formDraft.to}|${formDraft.mode}`;if(formDraft.autoKey===key)return;formDraft.autoKey=key;
 const stops=[formDraft.from,formDraft.to].map(id=>id?game.stations.find(s=>String(s.id)===String(id)):null);if(!stops[0]){formDraft.autoNote='';return;}
 const options=stops[1]?routeCargoOptions(game,formDraft):[];let next='';
 if(options.length)next=options[0].valid&&!options.some(option=>option.valid&&option.cargo===formDraft.cargo)?options[0].cargo:'';
 else if(!stops.some(stop=>stop&&stationCoverage(game,stop).produces.includes(formDraft.cargo)))next=stationCoverage(game,stops[0]).produces.find(cargo=>cargo!=='passengers'&&routeCargoList(game).includes(cargo))||'';
 if(next&&next!==formDraft.cargo){formDraft.cargo=next;formDraft.autoNote=`Cargo set to ${CARGO[next].name}`;}
}
function bindRouteCards(root) {
 root.querySelectorAll('[data-route-page]').forEach(button=>button.addEventListener('click',()=>{
  const direction=button.dataset.routePage;routePage+=direction==='next'?1:-1;refreshRouteList();
  $('#route-list').scrollIntoView({block:'start'});
  $(`#route-list [data-route-page="${direction}"]:not(:disabled)`)?.focus({preventScroll:true});
 }));
 root.querySelectorAll('[data-upgrade-route]').forEach(button=>button.addEventListener('click',()=>performUpgrade(button.dataset.upgradeRoute)));
 root.querySelectorAll('[data-focus-route]').forEach(el=>el.addEventListener('click',()=>{const r=game.routes.find(r=>String(r.id)===el.dataset.focusRoute);const s=r&&game.stations.find(s=>s.id===r.stops[0]);if(!s)return;cancelRoutePicking();renderer.focus(s.x,s.y);setMapLayers({routes:true});closeMobile();}));
 root.querySelectorAll('[data-remove-route]').forEach(el=>el.addEventListener('click',()=>retireRoute(el.dataset.removeRoute)));
}
function refreshRouteList() {
 const list=$('#route-list');if(!list)return;const routes=filterRoutes(game,routeFilters);
 list.innerHTML=routePageCards(routes);$('#route-results-count').textContent=`${routes.length} of ${game.routes.length} routes`;bindRouteCards(list);drawPaletteSprites(list);
}
function flashRoute(routeId) {
 const index=filterRoutes(game,routeFilters).findIndex(route=>route.id===routeId);if(index<0)return;
 if(routePage!==Math.floor(index/ROUTES_PER_PAGE)){routePage=Math.floor(index/ROUTES_PER_PAGE);refreshRouteList();}
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===routeId);if(!card)return;
 revealInPanel(card,card.querySelector('[data-focus-route]'));card.classList.add('route-flash');setTimeout(()=>card.classList.remove('route-flash'),1200);
}
function isRoutePicking() { return Boolean(routePicking); }
function routePickStops() { return view==='routes'?[formDraft.from,formDraft.to].map(id=>game.stations.find(s=>String(s.id)===String(id))).filter(Boolean):[]; }
function cancelRoutePicking() {
 const wasPicking=Boolean(routePicking);
 routePicking='';canvas.classList.remove('route-picking');$('#route-pick-banner')?.remove();
 $$('[data-pick-route]').forEach(button=>button.setAttribute('aria-pressed','false'));
 if(wasPicking){cancelGesture();$('#status-message').textContent=toolDescription(tool);syncToolControls();}
}
function showRoutePickHint() {
 let banner=$('#route-pick-banner');if(!banner){banner=document.createElement('div');banner.id='route-pick-banner';banner.className='route-pick-banner';banner.setAttribute('role','status');$('.map-section').append(banner);}
 const label=routePicking==='from'?'start':'end',mode=stopName(formDraft.mode);
 banner.innerHTML=`<div><strong>Click the ${label} ${mode}</strong><span>Drag to explore · Esc to cancel</span></div><button type="button" id="cancel-route-pick">Cancel</button>`;
 $('#cancel-route-pick').onclick=()=>{cancelRoutePicking();setView('routes');};
 $('#status-message').textContent=`Click the ${label} ${mode}.`;canvas.classList.add('route-picking');
}
function beginRoutePicking(key) {
 setTool('inspect');routePicking=key;renderPanel();syncToolControls();showRoutePickHint();closeMobile();canvas.focus({preventScroll:true});
}
function pickRouteStopAt(x,y) {
 if(!routePicking)return false;
 const station=game.stations.find(s=>s.x===x&&s.y===y);
 if(!station){toast(`Click a ${stopName(formDraft.mode)}.`,true);return true;}
 if(station.mode!==formDraft.mode){toast(`This is a ${stopName(station.mode)}. Choose a ${stopName(formDraft.mode)}.`,true);return true;}
 if(routePicking==='to'&&String(station.id)===String(formDraft.from)){toast('Choose two different stops.',true);return true;}
 if(routePicking==='from'&&String(station.id)===String(formDraft.to))formDraft.to='';
 formDraft[routePicking]=String(station.id);
 if(routePicking==='from'){routePicking='to';renderPanel();showRoutePickHint();}
 else{cancelRoutePicking();setView('routes');$('#route-form [type=submit]')?.scrollIntoView({block:'nearest',behavior:'smooth'});const plan=validateRoutePlan(game,formDraft);$('#status-message').textContent=plan.message;}
 return true;
}
function entityMatches(entity, query, extra='') {
 const text=[entity.name,extra].join(' ').toLocaleLowerCase();
 return query.toLocaleLowerCase().trim().split(/\s+/).every(word=>text.includes(word));
}
function entityCards() {
 if(view==='towns')return game.cities.filter(city=>entityMatches(city,entityFilters.towns)).map(city=>`<button class="entity-card" data-city="${city.id}"><h3>${escapeHTML(city.name)}${icon('arrowup')}</h3><p>${cargoBadge('passengers',{count:Math.floor(city.population)})} <span>residents</span></p><div class="entity-metric"><span>Transport</span><span>${townService(game,city).label}</span></div></button>`).join('');
 return game.industries.filter(site=>(entityFilters.kind==='all'||site.kind===entityFilters.kind)&&entityMatches(site,entityFilters.industry,[INDUSTRIES[site.kind].name,...Object.keys(INDUSTRIES[site.kind].inputs),...Object.keys(INDUSTRIES[site.kind].outputs)].join(' '))).map(site=>{const def=INDUSTRIES[site.kind],status=industryStatus(site);return `<button class="entity-card" data-industry="${site.id}"><div class="entity-heading">${industryPortrait(site.kind)}<h3>${escapeHTML(site.name||def.name)}${icon('arrowup')}</h3></div>${cargoRecipe(def.inputs,def.outputs)}<p class="site-status" data-state="${status.state}">${escapeHTML(status.label)}</p><div class="entity-metric"><span>${integer(Object.values(site.inventory||{}).reduce((a,b)=>a+b,0))} stored</span><span>${Math.round((site.capacity||1)*100)}% capacity</span></div></button>`;}).join('');
}
function entitySearch(label) {
 return `<label class="entity-search"><span class="sr-only">${label}</span><input id="entity-search" type="search" aria-label="${label}" placeholder="${label}" value="${escapeHTML(entityFilters[view])}"></label>`;
}
function townsPanel() { return `<div class="panel-heading"><h2>Towns</h2><span>${game.cities.length}</span></div>${entitySearch('Find a town')}<div id="entity-list">${entityCards()}</div><div class="section-divider"></div><button class="button button-primary full" data-tool="city">${icon('city')} Found town · ${compactMoney(priceFor(game,BUILD_COSTS.city))}</button><button class="text-button" data-action="development">Zone a neighborhood <span>↗</span></button>`; }
function industryPanel() { return `<div class="panel-heading"><h2>Industries</h2><span>${game.industries.length} sites</span></div>${entitySearch('Find a site or cargo')}<label class="entity-search"><span class="sr-only">Industry type</span><select id="industry-kind" aria-label="Industry type"><option value="all">All industries</option>${Object.entries(INDUSTRIES).filter(([,def])=>def.biomes.includes(game.biome)).map(([key,def])=>`<option value="${key}" ${entityFilters.kind===key?'selected':''}>${escapeHTML(def.name)}</option>`).join('')}</select></label><div id="entity-list">${entityCards()}</div><div class="section-divider"></div><button class="button button-primary full" data-action="industry-build">${icon('factory')} Build industry</button><button class="text-button" data-action="chains">Production chains <span>↗</span></button>`; }
function bindEntityCards(root) {
 root.querySelectorAll('[data-city]').forEach(el=>el.addEventListener('click',e=>{const city=game.cities.find(c=>String(c.id)===el.dataset.city);setTool('inspect');renderer.focus(city.x,city.y);inspect(city.x,city.y,'city',e.detail===0?'keyboard':'');closeMobile();}));
 root.querySelectorAll('[data-industry]').forEach(el=>el.addEventListener('click',e=>locateIndustry(el.dataset.industry,e.detail===0?'keyboard':'')));
}
function refreshEntities() {
 const list=$('#entity-list');if(!list)return;
 list.innerHTML=entityCards()||'<p class="empty-state">No matches. Try another name or cargo.</p>';bindEntityCards(list);drawPaletteSprites(list);
}
function renderPanel() {
 const panel=$('#panel-content'), scroll=panel.scrollTop;
 if(view==='routes')autoSelectCargo();
 panel.innerHTML=view==='build'?buildPanel():view==='routes'?routesPanel():view==='towns'?townsPanel():industryPanel(); panel.scrollTop=scroll;
 drawPaletteSprites();
 panel.querySelectorAll('[data-stop-mode]').forEach(el=>el.addEventListener('click',()=>{preferredMode=el.dataset.stopMode;renderPanel();canvas.focus({preventScroll:true});}));
 panel.querySelector('.engineering-tools')?.addEventListener('toggle',e=>{engineeringOpen=e.currentTarget.open;});
 panel.querySelectorAll('[data-crossing-mode]').forEach(el=>el.addEventListener('click',()=>{
  preferredMode=el.dataset.crossingMode;
  if(spanTools.has(tool))setTool((preferredMode==='rail'?'rail':'')+(tool.includes('bridge')?'bridge':'tunnel'));
  else{renderPanel();canvas.focus({preventScroll:true});}
 }));
 if($('#building-group'))$('#building-group').addEventListener('change',e=>{buildingGroup=e.target.value;renderPanel();});
 panel.querySelectorAll('[data-tool]').forEach(el=>el.addEventListener('click',()=>setTool(el.dataset.tool)));
 panel.querySelectorAll('[data-category]').forEach(el=>el.addEventListener('click',()=>{category=el.dataset.category;renderPanel();$('#panel-content').scrollTop=0;}));
 panel.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>{const a=el.dataset.action;if(a==='help')openHelp();if(a==='chains')openChains();if(a==='development'||a==='industry-build'){category=a==='development'?'towns':'industry';setView('build');}}));
 bindEntityCards(panel);
 if($('#entity-search'))$('#entity-search').oninput=e=>{entityFilters[view]=e.target.value;refreshEntities();};
 if($('#industry-kind'))$('#industry-kind').onchange=e=>{entityFilters.kind=e.target.value;refreshEntities();};
 panel.querySelectorAll('[data-project-action]').forEach(button=>button.onclick=()=>runProjectAction(button.dataset.projectAction,button.dataset.projectTarget));
 panel.querySelectorAll('[data-goal-show]').forEach(button=>button.onclick=()=>{storeGoalCollapsed('');goalOpen=true;if(window.innerWidth<=1100)closeMobile();renderGoal();});
 bindRouteCards(panel);
 if($('#upgrade-fleet'))$('#upgrade-fleet').onclick=()=>performUpgrade();
 if($('#route-search'))$('#route-search').addEventListener('input',e=>{routeFilters.query=e.target.value;routePage=0;refreshRouteList();});
 for(const key of ['mode','status','cargo'])if($(`#route-filter-${key}`))$(`#route-filter-${key}`).addEventListener('change',e=>{routeFilters[key]=e.target.value;routePage=0;refreshRouteList();});
 if($('#clear-route-filters'))$('#clear-route-filters').onclick=()=>{routePage=0;routeFilters={query:'',mode:'all',status:'all',cargo:'all'};$('#route-search').value='';for(const key of ['mode','status','cargo'])$(`#route-filter-${key}`).value='all';refreshRouteList();};
 if($('#new-route-button'))$('#new-route-button').onclick=()=>{formDraft.open=true;$('#route-planner').open=true;$('#route-planner').scrollIntoView({block:'start',behavior:'smooth'});$('#route-form [name=name]').focus({preventScroll:true});};
 const planner=panel.querySelector('#route-planner');if(planner){planner.querySelector('summary').onclick=()=>{formDraft.open=!planner.open;};planner.addEventListener('toggle',()=>{if(planner.isConnected)formDraft.open=planner.open;});}
 if($('#swap-route-stops'))$('#swap-route-stops').onclick=()=>{cancelRoutePicking();[formDraft.from,formDraft.to]=[formDraft.to,formDraft.from];renderPanel();$('#swap-route-stops')?.focus({preventScroll:true});};
 panel.querySelectorAll('[data-pick-route]').forEach(el=>el.addEventListener('click',()=>beginRoutePicking(el.dataset.pickRoute)));
 panel.querySelectorAll('[data-cargo-choice],[data-cargo-pick]').forEach(el=>el.addEventListener('click',()=>{
  formDraft.cargo=el.dataset.cargoChoice||el.dataset.cargoPick;formDraft.autoNote='';$('#route-form select[name=cargo]').value=formDraft.cargo;
  panel.querySelectorAll('[data-cargo-choice]').forEach(choice=>choice.setAttribute('aria-pressed',String(choice.dataset.cargoChoice===formDraft.cargo)));
  refreshRoutePlan();refreshUpgradeControls();
 }));
 const form=$('#route-form');
 if(form){
  form.addEventListener('input',e=>{if(e.target.name)formDraft[e.target.name]=e.target.value;});
  form.addEventListener('change',e=>{
   const key=e.target.name;if(!key)return;formDraft[key]=e.target.value;
   if(key==='cargo'){panel.querySelectorAll('[data-cargo-choice]').forEach(choice=>choice.setAttribute('aria-pressed',String(choice.dataset.cargoChoice===formDraft.cargo)));refreshRoutePlan();refreshUpgradeControls();}
   else if(key==='mode'){cancelRoutePicking();formDraft.from='';formDraft.to='';renderPanel();$('#route-form [name=mode]')?.focus({preventScroll:true});}
   else if(key==='from'||key==='to'){cancelRoutePicking();const s=game.stations.find(s=>String(s.id)===e.target.value);if(s)renderer.focus(s.x,s.y);renderPanel();$(`#route-form [name=${key}]`)?.focus({preventScroll:true});}
  });
  form.addEventListener('submit',e=>{
   e.preventDefault();const plan=validateRoutePlan(game,formDraft);refreshRoutePlan();if(!plan.valid)return toast(plan.message,true);
   const [a,b]=plan.stations,result=addRoute(game,{name:formDraft.name.trim()||defaultRouteName(game,plan,formDraft.cargo),mode:formDraft.mode,stops:[a.id,b.id],cargo:formDraft.cargo});
   toast(result.message,!result.ok);if(result.ok){cancelRoutePicking();formDraft.name='';formDraft.autoNote='';formDraft.open=false;renderPanel();updateHud();persist();flashRoute(result.route.id);}
  });
 }
}
function retireRoute(routeId) {
 const route=game.routes.find(r=>String(r.id)===routeId);if(!route)return;
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><span class="eyebrow">Network</span><h2>Retire this connection?</h2><p>${escapeHTML(route.name)} will stop carrying ${escapeHTML(CARGO[route.cargo]?.name.toLowerCase())}. Its vehicle will be sold; roads, tracks, stops and ports stay in place.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="modal-actions"><button class="button button-outline" data-close>Keep running</button><button class="button button-orange" id="confirm-retire">Retire route</button></div></div>`);
 $('#confirm-retire').addEventListener('click',()=>{const result=removeRoute(game,route.id);closeModal();toast(result.message,!result.ok);renderPanel();updateHud();persist();});
}
function updateWeather() {
 const camera=renderer.getCamera(), x=Math.max(0,Math.min(game.width-1,Math.floor(camera.x/TILE))), y=Math.max(0,Math.min(game.height-1,Math.floor(camera.y/TILE)));
 const weather=weatherAt(game,x,y), label=weather.cold>.65?(weather.wetness>.43?'Snow':'Cold'):weather.wetness>.58?'Rain':weather.heat>.62&&weather.wetness<.3?'Dry':'Mild';
 const symbol=label==='Snow'||label==='Cold'?'snow':label==='Rain'?'rain':'sun';
 const el=$('#weather');if(el.dataset.condition!==label){el.innerHTML=icon(symbol)+`<span>${label}</span>`;el.dataset.condition=label;}
 el.title=`Local weather at ${x}, ${y}`;
}
function updateRegion() { updateWeather();$('#minimap').style.aspectRatio=game.width+'/'+game.height; }
function updateHud() {
 updateWeather();
 const pricing=inflationInfo(game);
 $('#inflation-rate').textContent=pricing.rate?`+${(pricing.rate*100).toFixed(2)}% / year`:'Base prices';
 $('#inflation-rate').title=`Prices are ${((pricing.index-1)*100).toFixed(1)}% above 1950. New inflation rate each January.`;
 if(pricing.year!==pricingYear){if(pricing.year>pricingYear)queueNewYear(pricing);pricingYear=pricing.year;if(view==='routes')refreshRouteList();else if(view==='build'||view==='towns'){if($('#panel-content').contains(document.activeElement)&&document.activeElement.matches('input,select,textarea'))panelPricesStale=true;else renderPanel();}}
 const hudMoney=value=>Math.abs(value)>=(window.innerWidth<=1100?10000:1000000)?'$'+Math.abs(value).toLocaleString('en-US',{notation:'compact',maximumFractionDigits:1}):money(value);
 $('#balance').textContent=(game.money<0?'−':'')+hudMoney(game.money);$('#balance').title=(game.money<0?'−':'')+money(game.money);
 const profit=(game.monthlyIncome||0)-(game.monthlyIncomeAtAccountingStart||0)-(game.monthlyOperatingExpenses||0);$('#profit').textContent=(profit>=0?'+':'−')+hudMoney(profit);$('#profit').title=(profit>=0?'+':'−')+money(profit)+' operating profit this month';$('#profit').className=profit>=0?'positive':'negative';
 $('#balance-exact').textContent=(game.money<0?'−':'')+money(game.money);$('#profit-exact').textContent=(profit>=0?'+':'−')+money(profit);
 $('#income-exact').textContent=money((game.monthlyIncome||0)-(game.monthlyIncomeAtAccountingStart||0));$('#running-exact').textContent=money(game.monthlyOperatingExpenses||0);
 $('#building-exact').textContent=money(Math.max(0,(game.monthlyExpenses||0)-(game.monthlyOperatingExpenses||0)));
 const lastProfit=game.history.at(-1)?.operatingProfit;$('#previous-profit').textContent=Number.isFinite(lastProfit)?(lastProfit>=0?'+':'−')+money(lastProfit):'—';
 $('#profit-exact').title='Operating figures tracked since '+new Date(Date.UTC(1950,0,1+Math.floor(game.accountingStartDay||0))).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 $('#delivered').innerHTML=integer(game.totalDelivered)+' <small>units</small>';
 const activeStopIds=new Set(game.routes.filter(route=>route.active).flatMap(route=>route.stops));
 const activeStops=game.stations.filter(stop=>activeStopIds.has(stop.id));
 const served=game.cities.filter(city=>townService(game,city,activeStops).connected).length;
 watchTowns(activeStops);
 $('#connected').innerHTML=served+` <small>/ ${game.cities.length}</small>`;$('#route-count').textContent=game.routes.length;
 const date=new Date(Date.UTC(1950,0,1+Math.floor(game.day)));$('#date').textContent=date.toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});$('#date').title=date.toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 renderGoal();
 const zoom=renderer.getCamera().zoom, currentZoom=zoomIndex(zoom);
 const zoomLabel=ZOOM_VIEWS[currentZoom].name+' · '+Math.round(zoom*100)+'%';
 $('#zoom-label').textContent=Math.round(zoom*100)+'%';
 $('#zoom-level').setAttribute('aria-label',zoomLabel+' · Choose zoom');$('#zoom-level').title=zoomLabel;
 $$('[data-zoom-level]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.zoomLevel)===zoom)));
 $('#zoom-out').disabled=currentZoom===0;$('#zoom-in').disabled=currentZoom===ZOOM_LEVELS.length-1;
 const showingRoutes=view==='routes'&&!$('.sidebar').inert;
 const routesById=showingRoutes?new Map(game.routes.map(route=>[String(route.id),route])):null;
 const loadsByRoute=new Map();
 if(showingRoutes)for(const vehicle of game.vehicles){const key=String(vehicle.routeId),load=loadsByRoute.get(key)||{load:0,capacity:0};load.load+=vehicle.load;load.capacity+=vehicle.capacity;loadsByRoute.set(key,load);}
 if(showingRoutes)$$('[data-route-status]').forEach(el=>{const r=routesById?.get(el.dataset.routeStatus);if(r){const health=routeHealth(game,r);el.textContent=health.label;el.classList.toggle('route-offline',health.state!=='running');}});
 if(showingRoutes)$$('[data-route-revenue]').forEach(el=>{const r=routesById?.get(el.dataset.routeRevenue);if(r){const net=r.revenue-(r.revenueAtAccountingStart||0)-(r.expenses||0);el.textContent=(net<0?'−':'')+money(net);el.title=`Fares ${money(r.revenue-(r.revenueAtAccountingStart||0))} · Route upkeep ${money(r.expenses||0)} · Tracked since ${new Date(Date.UTC(1950,0,1+Math.floor(r.accountingStartDay||0))).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})} · Excludes construction`;}});
 if(showingRoutes)$$('[data-route-health]').forEach(el=>{const r=routesById?.get(el.dataset.routeHealth);if(r){const health=routeHealth(game,r);el.textContent=health.detail;el.title=health.detail;el.dataset.state=health.state;}});
 if(showingRoutes)$$('[data-route-load]').forEach(el=>{const load=loadsByRoute.get(el.dataset.routeLoad);if(load)el.textContent=integer(load.load)+' / '+integer(load.capacity)+' loaded';});
 if(showingRoutes)$$('[data-route-stat]').forEach(el=>{const r=routesById?.get(el.dataset.routeStat);if(r)el.textContent=integer(r.delivered)+' moved';});
 if(showingRoutes){
  refreshRoutePlan();refreshUpgradeControls();
  const filtered=filterRoutes(game,routeFilters),ids=visibleRoutePage(filtered).map(route=>String(route.id));
  $('#route-results-count').textContent=`${filtered.length} of ${game.routes.length} routes`;
  if(ids.join('|')!==$$('#route-list [data-route-id]').map(el=>el.dataset.routeId).join('|'))refreshRouteList();
 }
}
function tileAt(x,y){return x>=0&&y>=0&&x<game.width&&y<game.height?game.tiles[y*game.width+x]:null;}
function localConditions(conditions) {
 const positives=conditions.positive.slice(0,3),negatives=conditions.negative.slice(0,2);
 return `<section class="local-conditions" aria-label="Local conditions"><h4>Local conditions</h4><div class="condition-list">${positives.map(text=>`<span class="condition-chip">${icon('check')}${escapeHTML(text)}</span>`).join('')}${negatives.map(text=>`<span class="condition-chip condition-concern">${icon('warning')}${escapeHTML(text)}</span>`).join('')}</div></section>`;
}
function industryDestinations(industry) {
 const outputs=Object.keys(INDUSTRIES[industry.kind].outputs), targets=findIndustryTargets(game,industry,5);
 const uses=outputs.map(cargo=>{
  const consumers=Object.values(INDUSTRIES).filter(d=>d.biomes.includes(game.biome)&&d.inputs[cargo]).map(d=>d.name);
  if(TOWN_CARGO.includes(cargo))consumers.push('Towns');
  return `<div class="industry-use">${cargoBadge(cargo,{label:true})}<span class="cargo-arrow" aria-hidden="true">→</span><span>${escapeHTML(consumers.join(', ')||'No buyers in this region')}</span></div>`;
 }).join('');
 return `<section class="industry-destinations" aria-label="Output destinations"><div class="destination-heading"><h4>Deliver to</h4><button class="small-button" id="industry-chain">${icon('chains')} Full chain</button></div>${uses}<h4>Nearest targets <span>${targets.length}</span></h4><p class="destination-note">Direct distance · transport required</p><div class="industry-target-list">${targets.map((target,index)=>`<button class="industry-target" data-target-id="${escapeHTML(target.id)}" data-target-kind="${target.kind}" aria-label="Locate ${escapeHTML(target.name)} at ${target.x}, ${target.y}"><span class="target-number">${index+1}</span><span class="target-detail"><strong>${escapeHTML(target.name)}</strong><small>${Math.round(target.distance)} tiles · ${target.x}, ${target.y}</small></span><span class="target-cargo">${target.cargo.map(c=>cargoIcon(c,{decorative:true})).join('')}</span>${icon('focus')}</button>`).join('')||'<p class="destination-note">No buyers yet. Open the chain to build one.</p>'}</div></section>`;
}
function locateIndustry(id,origin='') {
 const industry=game.industries.find(i=>String(i.id)===String(id));
 if(!industry)return;
 setTool('inspect');closeModal();closeMobile();renderer.setZoom(1);renderer.focus(industry.x+(industrySize(industry)-1)/2,industry.y+(industrySize(industry)-1)/2);inspect(industry.x,industry.y,'industry',origin);updateHud();
}
function locateDestination(id,kind,origin='') {
 if(kind==='industry'){locateIndustry(id,origin);return;}
 const city=game.cities.find(c=>String(c.id)===String(id));if(!city)return;
 setTool('inspect');closeModal();closeMobile();renderer.setZoom(1);renderer.focus(city.x,city.y);inspect(city.x,city.y,'city',origin);updateHud();
}
// The last generated markup, not box.innerHTML: drawn portraits change their canvas attributes.
let inspectorHTML='', inspectorKey='', panelPress=false, panelReleasedAt=-Infinity;
function inspect(x,y,kind='',origin='') {
 const site=kind!=='city'?buildingAt(game,x,y):null;if(site){x=site.x;y=site.y;}
 const terrainSite=kind!=='city'&&!site?terrainObjectAt(game,x,y):null,nature=terrainSite?.object.kind==='mountain'?null:terrainSite;if(nature){x=nature.x;y=nature.y;}
 const tile=tileAt(x,y);if(!tile)return;const changed=!selected||selected.x!==x||selected.y!==y||selected.kind!==kind;selected={x,y,kind};
 const station=game.stations.find(s=>s.x===x&&s.y===y),industry=game.industries.find(i=>industryContains(i,x,y)), city=game.cities.find(c=>c.x===x&&c.y===y)||game.cities.find(c=>Math.hypot(c.x-x,c.y-y)<4&&tile.building);
 let title,tag,body;
 if(station&&kind!=='city'&&kind!=='industry'){title=station.name;tag=stopName(station.mode).replace(/^./,c=>c.toUpperCase());body=`${infrastructurePortrait(station.mode==='water'?'port':station.mode==='rail'?'train-stop':'bus-stop','inspector-station-art')}<div class="inspector-grid"><div><small>Network</small><strong>${transportName(station.mode)}</strong></div><div><small>Coverage</small><strong>5 tiles</strong></div></div>${coverageNote(station.id,'produces')}${coverageNote(station.id,'accepts')}<button class="button button-primary full" id="station-route">${icon('route')} New route</button>`;}
 else if(industry){const d=INDUSTRIES[industry.kind],conditions=industryConditions(game,industry),typical=Object.values(d.outputs).reduce((a,b)=>a+b,0)*(industry.capacity||1)*conditions.productivity;title=industry.name||d.name;tag=`Industry · ${industrySize(industry)} × ${industrySize(industry)} site`;const status=industryStatus(industry);body=`<div class="inspector-industry-art">${industryPortrait(industry.kind)}${cargoRecipe(d.inputs,d.outputs)}</div><div class="industry-condition" data-state="${status.state}"><strong>${escapeHTML(status.label)}</strong><p>${escapeHTML(status.detail)}</p></div>${industryDestinations(industry)}<div class="inspector-grid"><div><small>Capacity</small><strong>${Math.round((industry.capacity||1)*100)}%</strong></div><div><small>Potential / day</small><strong>${typical.toLocaleString('en-US',{maximumFractionDigits:1})}</strong></div></div>${localConditions(conditions)}<div class="section-divider"></div><div class="ledger">${Object.entries(industry.inventory||{}).map(([key,n])=>`<div class="ledger-row">${cargoBadge(key,{label:true})}<strong>${integer(n)}</strong></div>`).join('')||'<span class="micro-note">Storage empty</span>'}</div><p>Add a stop within 5 tiles.</p>${industrySize(industry)<industryFootprint(industry.kind)?'<p class="micro-note">Compact legacy site. New construction uses a larger plot.</p>':''}`;}
 else if(kind!=='city'&&tile.building&&BUILDINGS[tile.building.kind]){const b=BUILDINGS[tile.building.kind],span=buildingSize(tile.building);title=b.name;tag=`${span} × ${span} site · ${b.tier?b.tier+' home':BUILDING_GROUPS[b.group].name}`;const nearest=game.cities.reduce((best,c)=>!best||Math.hypot(c.x-x,c.y-y)<Math.hypot(best.x-x,best.y-y)?c:best,null);body=`<div class="inspector-building"><canvas width="96" height="100" data-building-sprite="${tile.building.kind}" aria-hidden="true"></canvas><p>${escapeHTML(b.tier||BUILDING_GROUPS[b.group].name)} · ${nearest&&Math.hypot(nearest.x-x,nearest.y-y)<=10?escapeHTML(nearest.name):'Countryside'}</p></div><div class="inspector-grid"><div><small>Collection</small><strong>${escapeHTML(BUILDING_GROUPS[b.group].name)}</strong></div><div><small>Development</small><strong>Level ${tile.building.level||1}</strong></div></div><p>${escapeHTML(buildingBenefit(tile.building.kind))}</p>${span<buildingFootprint(tile.building.kind)?'<p class="micro-note">Compact legacy site. New construction uses a larger plot.</p>':''}`;}
 else if(kind!=='city'&&tile.building?.kind==='factory'){const span=buildingSize(tile.building);title='Neighborhood workshop';tag=`${span} × ${span} site`;body='<div class="inspector-building"><canvas width="96" height="100" data-building-sprite="factory" aria-hidden="true"></canvas><p>Local industry</p></div><p>Road access and town deliveries drive development. Each level supports local town activity.</p>';}
 else if(city&&(kind==='city'||!tile.zone)){title=city.name;tag='Town';body=`<div class="inspector-grid"><div><small>Population</small><strong>${integer(city.population)}</strong></div><div><small>Activity</small><strong>${integer(city.activity||0)}</strong></div></div><p class="site-status">${townService(game,city).label}</p>${localConditions(settlementSuitability(game,city))}<button class="button button-primary full" id="zone-town">${icon('house')} Add zones</button>`;}
 else{title=tile.zone?TOOL_INFO[tile.zone].name+' zone':tile.road?'Road':tile.rail?'Railway':{grass:'Open countryside',forest:'Woodland',water:'Water',mountain:'Mountain ridge',rock:'Rocky ground',sand:'Desert sands',snow:'Snowfield'}[tile.terrain]||'Countryside';if(tile.detail&&!tile.road&&!tile.rail&&!tile.zone)title=tile.detail.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());tag=`${nature?terrainObjectSize(nature.object)+' × '+terrainObjectSize(nature.object)+' site · ':''}Level ${[...new Set(tileSurface(game,x,y).corners.map(p=>p.height))].sort((a,b)=>a-b).join('–')} · ${x}, ${y}`;body=`<p>${nature&&nature.object.kind!=='mountain'?'A natural '+(nature.object.kind==='forest'?'grove':'outcrop')+' on level ground. Bulldoze any part to clear the whole site.':tile.zone?'Develops gradually with local demand.':tile.terrain==='water'?'Build a port on water beside a bank. Ships follow connected water and pass beneath bridges.':tile.terrain==='mountain'?'Use Terrain & crossings to tunnel through higher ground, or reshape clear land.':'Build on flat ground or a straight slope. Use Terrain & crossings to reshape or level clear land.'}</p>`;}
 if(tile.zone){const zone=game.zones.find(zone=>zone.x===x&&zone.y===y);body+=`<p>Development: ${Math.round((zone?.progress||0)/3*100)}% · Road access and regular town deliveries required.</p>`+localConditions(settlementSuitability(game,{x,y},tile.zone));}
 const box=$('#inspector'),html=`<div class="inspector-top"><span class="eyebrow">${tag}</span><button class="tiny-button" aria-label="Close inspector">×</button></div><h3 id="inspector-title" tabindex="-1">${escapeHTML(title)}</h3>${body}`,key=`${worldSerial}|${x},${y},${kind}`;
 const focusTitle=()=>{if(origin==='keyboard')$('#inspector-title').focus({preventScroll:true});};
 if(!changed&&!box.hidden&&html===inspectorHTML&&key===inspectorKey){focusTitle();return;}
 box.innerHTML=inspectorHTML=html;inspectorKey=key;box.hidden=false;drawPaletteSprites();box.querySelector('.tiny-button').onclick=()=>{box.hidden=true;selected=null;inspectorHTML='';};
 if($('#station-route'))$('#station-route').onclick=()=>{if(formDraft.mode!==station.mode||formDraft.to===String(station.id))formDraft.to='';formDraft.mode=station.mode;formDraft.from=String(station.id);setView('routes');$('#route-form')?.scrollIntoView({block:'nearest',behavior:'smooth'});};
 if($('#zone-town'))$('#zone-town').onclick=()=>{category='towns';setView('build');};
 if($('#industry-chain'))$('#industry-chain').onclick=()=>openChains({industryKind:industry.kind});
 box.querySelectorAll('[data-target-id]').forEach(el=>el.onclick=e=>locateDestination(el.dataset.targetId,el.dataset.targetKind,e.detail===0?'keyboard':''));
 if(changed)box.scrollTop=0;
 focusTitle();
}
// Construction saves wait for a pause in building, so a drag never holds vehicles.
let constructionSaveTimer=0,saveHealthy=true;
function persistSoon(delay=3000){clearTimeout(constructionSaveTimer);constructionSaveTimer=setTimeout(()=>{constructionSaveTimer=0;if(!menuOpening)persist();},delay);}
function markSaveFailed(){
 const announce=saveHealthy,button=$('#game-menu-button');saveHealthy=false;saveAt=performance.now()+40000;
 $('#save-status').textContent='Save unavailable';$('#save-status').classList.add('save-failed');
 button?.setAttribute('data-alert','');button?.setAttribute('aria-label','Game menu · autosave failed');
 if(announce)toast('Autosave failed: browser storage is full or blocked. Delete older saves in Save / load (Ctrl+S) to free space.',{type:'error',key:'autosave-failed'});
 return announce;
}
function saveRecovered(){saveHealthy=true;$('#save-status').classList.remove('save-failed');$('#game-menu-button')?.removeAttribute('data-alert');$('#game-menu-button')?.setAttribute('aria-label','Game menu');[...$('#toast-region').children].find(el=>el.toastKey==='autosave-failed')?.remove();toast('Autosave is working again.');}
function cancelPendingSave(){clearTimeout(constructionSaveTimer);constructionSaveTimer=0;const job=pendingSave;pendingSave=null;capturingSave=false;job?.controller.abort();}
function saveFinished(world,day,revision){savedWorld=world;savedDay=day;savedRevision=revision;saveAt=performance.now();$('#save-status').textContent='Saved just now';if(!saveHealthy)saveRecovered();}
function persist(notify=false){
 saveAt=performance.now();
 if(pendingSave){pendingSave.again=true;pendingSave.notify||=notify;return pendingSave.promise;}
 const job={controller:new AbortController(),again:false,notify,world:worldSerial,game};pendingSave=job;
 const current=()=>pendingSave===job&&game===job.game&&worldSerial===job.world;
 job.promise=(async()=>{
  let retries=0;
  try{
   do{
    job.again=false;const day=game.day,revision=game.revision;
    $('#save-status').textContent='Saving…';capturingSave=true;
    let snapshot;
    try{snapshot=await captureGame(job.game,{signal:job.controller.signal,isCurrent:current});}
    catch(error){if(error.name==='SnapshotChangedError'&&current()&&retries++<3){job.again=true;continue;}throw error;}
    finally{if(current())capturingSave=false;}
    const serialized=await encodeCapturedGame(snapshot,{signal:job.controller.signal});
    if(!current())return false;
    localStorage.setItem(SAVE_KEY,serialized);saveFinished(job.world,day,revision);
   }while(job.again&&current());
   if(job.notify&&current())toast('Game saved.');return true;
  }catch(error){
   if(current()&&error.name!=='AbortError'){
    // A world edited through every retry saves on the next timer; only real failures alert.
    const announced=error.name!=='SnapshotChangedError'&&markSaveFailed();
    if(!announced){$('#save-status').textContent='Save unavailable';if(job.notify)toast('Your browser could not save this world. Check available storage.',true);}
   }
   return false;
  }finally{if(current()){pendingSave=null;capturingSave=false;}}
 })();
 return job.promise;
}
// Browsers may stop workers as soon as the page leaves. The final checkpoint
// must finish synchronously; cancelling the old job prevents a late overwrite.
function flushSave(){
 cancelPendingSave();
 if(savedWorld===worldSerial&&savedDay===game.day&&savedRevision===game.revision)return;
 const result=saveGame(game);
 if(result?.ok)saveFinished(worldSerial,game.day,game.revision);
 else markSaveFailed();
}

let modalPreviousSpeed = null;
let chainSelection = {}, chainExplorer = null;
let saveDialogController = null;
function openModal(html) {
 layersView?.close();closeMapMenus();cancelRoutePicking();cancelGesture();spaceDown=false;
 saveDialogController?.dispose();saveDialogController=null;chainExplorer?.dispose();chainExplorer=null;
 if(!$('#modal').open){modalPreviousSpeed=speed;changeSpeed(0);}
 $('#modal-content').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();
 $$('#modal .close-modal, #modal [data-close]').forEach(el=>el.addEventListener('click',closeModal));
}
function closeModal(){if($('#modal').open)$('#modal').close();}
function activateGame(next) {
 cancelPendingSave();
 cancelRoutePicking();cancelGesture();closeMapMenus();
 game=next;worldSerial++;spaceDown=false;selected=null;inspectorHTML='';hover=null;tool='inspect';preferredMode='road';
 view='build';category='network';buildingGroup='homes';chainSelection={};
 formDraft={name:'',mode:'road',from:'',to:'',cargo:'passengers'};
 routePage=0;routeFilters={query:'',mode:'all',status:'all',cargo:'all'};entityFilters={towns:'',industry:'',kind:'all'};
 goalChoice=null;goalOpen=false;goalSignature='';lastNoticeId=game.day<1?undefined:game.notifications[0]?.id;lastRevision=-1;minimapAt=0;panelAt=0;lastFrame=performance.now();
 resetMoments();
 canvas.classList.remove('build-mode','dragging','route-picking');$('#placement-tip').hidden=true;
 $('#inspector').hidden=true;$('#inspector').replaceChildren();$('#toast-region').replaceChildren();
 renderer.setGame(game);renderer.setZoom(1);
 const center=game.cities[0]||{x:game.width/2,y:game.height/2};
 const framing=(window.innerWidth<=700?2:9)/2;
 renderer.focus(center.x+framing,center.y-framing);
 updateRegion();setView('build');updateHud();closeMobile();
 $('#panel-content').scrollTop=0;$('#status-message').textContent=toolDescription(tool);
}
async function drawLoadedWorld() {
 updateLoading('Drawing your world…',3);await paintLoading();
 renderer.render(performance.now(),{tool,hover,preview,selected,preferredMode,routeStops:routePickStops()});
 renderer.drawMinimap($('#minimap'));minimapAt=performance.now();lastRevision=game.revision;
 await paintLoading();
}
async function openGameMenu() {
 if(menuOpening||$('#start-menu')?.open||isLoading())return;
 menuOpening=true;
 const resumeSpeed=speed;changeSpeed(0);
 let saveFailed=false;
 if(pendingSave||savedWorld!==worldSerial||savedDay!==game.day||savedRevision!==game.revision){showLoading({title:'Saving your company',status:'Keeping your latest progress…'});saveFailed=!await persist();}
 cancelGesture();cancelRoutePicking();closeMapMenus();closeMobile();
 const next=await openStartMenu({canResume:true,biome:game.biome,notice:saveFailed?'Your latest changes could not be saved. Resume your company or free some browser storage.':''});
 if(next){
  activateGame(next);
  await Promise.all([preloadHouses({biome:game.biome}),preloadWorldArt({biome:game.biome})]);
  await drawLoadedWorld();hideLoading();
  savedWorld=worldSerial;savedDay=game.day;savedRevision=game.revision;saveAt=performance.now();
 }
 menuOpening=false;lastFrame=performance.now();changeSpeed(next?1:resumeSpeed);canvas.focus({preventScroll:true});
}
function openSaves() {
 cancelPendingSave();
 closeMobile();openModal('');
 saveDialogController=mountSaves($('#modal-content'),game,{
  onClose:closeModal,
  onLoad:async(next,slot,{isActive,signal}={})=>{
   if(!$('#modal').open||!saveDialogController)return {ok:false,message:'Load cancelled.'};
   // Commit the resumed world first; a failed write keeps the current world and
   // its autosave intact instead of unexpectedly reverting on the next reload.
   updateLoading('Restoring your transport company…',2);await paintLoading();
   if(!$('#modal').open||!saveDialogController||signal?.aborted||isActive?.()===false)return {ok:false,message:'Load cancelled.'};
   const saved=savePreparedGame(next);
   if(!saved.ok)return {ok:false,message:'Could not activate this save. Free some local storage and try again. Your current world is unchanged.'};
   activateGame(next);saveFinished(worldSerial,game.day,game.revision);showLoading({title:'Loading your world',status:'Drawing your world…',stage:3});await drawLoadedWorld();closeModal();
   toast(`${slot.name||'Autosave'} loaded.`);
   return {ok:true};
  }
 });
 $('#modal .close-modal')?.focus({preventScroll:true});
}
function openChains(options={}) {
 chainExplorer?.dispose();
 closeMobile();openModal('');
 chainExplorer=mountChains($('#modal-content'),game,{onLocate:id=>locateDestination(id,game.cities.some(c=>String(c.id)===String(id))?'city':'industry'),onBuild:kind=>{closeModal();category='industry';setView('build');setTool(kind);},onClose:closeModal,onChange:selection=>{chainSelection=selection;}},Object.keys(options).length?options:chainSelection);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
$('#modal').addEventListener('close',()=>{saveDialogController?.dispose();saveDialogController=null;chainExplorer?.dispose();chainExplorer=null;if(modalPreviousSpeed!==null){changeSpeed(modalPreviousSpeed);modalPreviousSpeed=null;}});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const b=$('#modal').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeModal();}});
function openWorld() { void openGameMenu(); }
function openAtlas() {
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>World map</h2><p>Click a location to explore.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><canvas id="atlas-map" width="640" height="480" tabindex="0" aria-label="World atlas. Click to center the world map on a location."></canvas><div class="atlas-legend"><span><i class="atlas-town"></i> Towns</span><span><i class="atlas-industry"></i> Industries</span><span><i class="atlas-route"></i> Your network</span><span>Use H to return home</span></div></div>`);
 const atlas=$('#atlas-map');atlas.style.aspectRatio=game.width+'/'+game.height;atlas.style.setProperty('--atlas-ratio',game.width/game.height);renderer.drawMinimap(atlas);
 atlas.addEventListener('click',e=>{const rect=atlas.getBoundingClientRect(),left=atlas.clientLeft,top=atlas.clientTop;renderer.focus(Math.max(0,Math.min(1,(e.clientX-rect.left-left)/atlas.clientWidth))*game.width,Math.max(0,Math.min(1,(e.clientY-rect.top-top)/atlas.clientHeight))*game.height);closeModal();closeMobile();});
 atlas.addEventListener('keydown',e=>{if(e.key==='Enter'){renderer.focus(game.cities[0].x,game.cities[0].y);closeModal();}});
}
function openHelp(tab='basics') {
 if(tab==='chains'){openChains();return;}
 const basics=`<div class="guide-grid"><div class="guide-item"><span>${icon('road')}Build a network</span><p>Roads and rails climb straight slopes; turns need flat ground. Terrain has eight levels, 0–7. Use Terrain &amp; crossings to raise or lower grid points, or drag an area level. Bridges and tunnels need flat ends at the same level. Choose Road or Rail before building.</p></div><div class="guide-item"><span>${icon('route')}Connect two stops</span><p>Place stops or ports within 5 tiles of customers. Connect them, choose cargo, then launch a bus, train or ship.</p></div><div class="guide-item"><span>${icon('factory')}Supply factories</span><p>Deliver every input in a recipe. Towns buy finished goods. Freight returns empty; passengers travel both ways.</p></div><div class="guide-item"><span>${icon('leaf')}Slow, local growth</span><p>Zone within 10 tiles of a town, beside roads. Regular deliveries drive growth; services and greenery help.</p></div><div class="guide-item"><span>${icon('leaf')}Build at your own pace</span><p>Your starter bus earns money while you plan. Start small, supply every factory input, and expand when demand fills your vehicles. Next projects are optional.</p></div><div class="guide-item"><span>${icon('route')}Understand the money</span><p>Profit shows operations this calendar month. Tap Balance for building spend and last month. Routes show fares minus upkeep since tracking began, excluding construction.</p></div></div><div class="keyboard-help"><span><kbd>R</kbd> Road</span><span><kbd>T</kbd> Rail</span><span><kbd>S</kbd> Stop on road / rail</span><span><kbd>P</kbd> Port</span><span><kbd>Right drag</kbd> Move map</span><span><kbd>Two fingers</kbd> Move / pinch to zoom</span><span><kbd>X</kbd> Bulldozer</span><span><kbd>G</kbd> Grid</span><span><kbd>L</kbd> Layers</span><span><kbd>H</kbd> Home</span><span><kbd>M</kbd> Map</span><span><kbd>Space</kbd> Pause / hold to pan</span><span><kbd>Esc</kbd> Done</span></div>`;
 const chainBody=`<p class="panel-description">Base recipes · output varies by local conditions</p><div class="help-chain-grid">${Object.values(INDUSTRIES).filter(d=>d.biomes.includes(game.biome)).map(d=>`<article class="chain-card"><h4>${d.name}</h4>${cargoRecipe(d.inputs,d.outputs)}</article>`).join('')}</div>`;
 const resources=`<div class="resource-legend">${Object.entries(CARGO).map(([key,c])=>`<div class="resource-entry">${cargoIcon(key,{decorative:true})}<span>${c.name}</span></div>`).join('')}</div>`;
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>Field guide</h2></div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="modal-tabbar"><button data-help-tab="basics" class="${tab==='basics'?'active':''}">Basics</button><button data-help-tab="chains" class="${tab==='chains'?'active':''}">Production</button><button data-help-tab="resources" class="${tab==='resources'?'active':''}">Resources</button></div>${tab==='basics'?basics:tab==='chains'?chainBody:resources}<div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $$('[data-help-tab]').forEach(el=>el.addEventListener('click',()=>openHelp(el.dataset.helpTab)));
}

// Notices reach the HUD through one queue: model notices, grouped by topic, and
// moments derived here so the simulation never spends ids on presentation.
function resetMoments() {
 noticeQueue=[];pricingYear=inflationInfo(game).year;panelPricesStale=false;townDay=-1;
 knownRoutes=new Set(game.routes.map(route=>route.id));firstDeliveryPending=new Set(game.routes.filter(route=>route.cargo!=='passengers'&&route.delivered===0).map(route=>route.id));
 townPeaks=new Map(game.cities.map(city=>[city.id,city.population]));
}
function showQueuedNotices(now) {
 const urgent=entry=>entry.type==='warning'||entry.type==='error'?1:0;noticeQueue.sort((a,b)=>urgent(b)-urgent(a));
 let shown=0,beeped=false;
 for(let i=0;i<noticeQueue.length&&shown<2;){
  const entry=noticeQueue[i];if(entry.paced&&now-pacedNoticeAt<2000){i++;continue;}
  noticeQueue.splice(i,1);if(entry.paced)pacedNoticeAt=now;
  const target=entry.targets?.find(noticeTargetExists);
  toast(entry.message,{type:entry.type,action:entry.action||(target?{label:'Show',run:()=>showNoticeTarget(target)}:null),silent:beeped});beeped||=entry.type!=='ok';shown++;
 }
}
function queueNewYear(pricing) {
 noticeQueue.push({message:newYearNotice(pricing.year,pricing.rate),type:'milestone',action:getFleetUpgrade(game).available?{label:'Review upgrades',run:reviewUpgrades}:null});
}
function reviewUpgrades() { closeModal();setView('routes');revealInPanel($('.fleet-upgrades'),$('#upgrade-fleet')); }
// Scroll only the drawer's own list; the drawer may still be sliding in, so focus retries once it is visible.
function revealInPanel(el,focusTarget=el) {
 const panel=$('#panel-content');if(!el||!panel.contains(el))return;
 const box=el.getBoundingClientRect(),area=panel.getBoundingClientRect();panel.scrollTop+=box.top-area.top-Math.max(0,(area.height-box.height)/2);
 // Focus moved for a mouse click keeps Space as pause, so a press never activates the revealed control.
 const owned=pointerFocus!==null,focus=()=>{focusTarget.focus({preventScroll:true});if(owned&&document.activeElement===focusTarget)pointerFocus=focusTarget;};
 if(focusTarget)focus();if(focusTarget&&document.activeElement!==focusTarget)setTimeout(()=>{if(!document.activeElement||document.activeElement===document.body)focus();},200);
}
// Every freight route launched this session is watched; loaded routes only if they have not delivered yet.
function watchRoutes() {
 for(const route of game.routes){
  if(!knownRoutes.has(route.id)){knownRoutes.add(route.id);if(route.cargo!=='passengers')firstDeliveryPending.add(route.id);}
  if(route.delivered>0&&firstDeliveryPending.delete(route.id))noticeQueue.push({message:`First ${CARGO[route.cargo].name.toLowerCase()} delivered on ${route.name} · +${money(route.revenue)}`,type:'milestone',targets:[{kind:'route',id:route.id}]});
 }
}
function watchTowns(activeStops) {
 const day=Math.floor(game.day);if(day===townDay)return;townDay=day;
 for(const city of game.cities){
  const peak=townPeaks.get(city.id);if(peak!==undefined&&city.population<=peak)continue;townPeaks.set(city.id,city.population);if(peak===undefined)continue;
  const reached=crossedMilestone(peak,city.population);
  if(reached&&townService(game,city,activeStops).connected)noticeQueue.push({message:`${city.name} reached ${integer(reached)} residents`,type:'milestone',targets:[{kind:'city',id:city.id}],paced:true});
 }
}
function noticeTargetExists(target) { return Boolean(target)&&(target.kind==='route'?game.routes:target.kind==='city'?game.cities:game.industries).some(item=>String(item.id)===target.id); }
function showNoticeTarget(target) {
 if(!noticeTargetExists(target))return;
 if(target.kind!=='route'){locateDestination(target.id,target.kind);return;}
 closeModal();
 if(!filterRoutes(game,routeFilters).some(route=>String(route.id)===target.id))routeFilters={query:'',mode:'all',status:'all',cargo:'all'};
 routePage=Math.max(0,Math.floor(filterRoutes(game,routeFilters).findIndex(route=>String(route.id)===target.id)/ROUTES_PER_PAGE));setView('routes');
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===target.id);revealInPanel(card,card?.querySelector('[data-focus-route]'));
}
function openNews() {
 const notices=[...game.notifications],date=day=>new Date(Date.UTC(1950,0,1+Math.floor(day))).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 const items=notices.map((notice,index)=>{const type=toastType(notice.type);return `<li class="news-item" data-type="${type}">${icon(type==='ok'||type==='milestone'?'check':'warning')}<div><time>${date(notice.day)}</time><p>${escapeHTML(notice.message)}</p></div>${noticeTargetExists(notice.target)?`<button class="small-button" data-news-target="${index}">Show</button>`:''}</li>`;}).join('');
 closeMobile();openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>News</h2><p>Recent company notices, newest first. The log keeps the latest 24.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><ol class="news-list">${items||'<li class="news-empty">No news yet. Notices about your network, towns and industries appear here.</li>'}</ol><div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $$('[data-news-target]').forEach(el=>el.addEventListener('click',()=>showNoticeTarget(notices[Number(el.dataset.newsTarget)].target)));
 $('#modal .close-modal')?.focus({preventScroll:true});
}
// A January repricing waits while the player types in the panel's search.
$('#panel-content').addEventListener('focusout',()=>setTimeout(()=>{if(panelPricesStale&&!$('#panel-content').contains(document.activeElement)){panelPricesStale=false;if(view==='build'||view==='towns')renderPanel();}}));
// A stop's New route opens the planner even when the draft already holds that stop.
$('#inspector').addEventListener('click',e=>{if(e.target.closest?.('#station-route'))formDraft.open=true;},true);

function gridLine(a,b) { const points=[];let x=a.x,y=a.y;points.push({x,y});const horizontalFirst=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y);const stepX=()=>{while(x!==b.x){x+=Math.sign(b.x-x);points.push({x,y});}};const stepY=()=>{while(y!==b.y){y+=Math.sign(b.y-y);points.push({x,y});}};if(horizontalFirst){stepX();stepY();}else{stepY();stepX();}return points; }
function constructionLine(a,b,key) {
 if(key==='level'){const points=[a];for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)if(x!==a.x||y!==a.y)points.push({x,y});return points;}
 if(spanTools.has(key))b=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?{x:b.x,y:a.y}:{x:a.x,y:b.y};
 return gridLine(a,b);
}
function paintPath(points) {
 if(spanTools.has(tool)&&points.length<3){toast('Drag a straight span of at least 3 tiles, including both ends.',true);preview=[];return;}
 const result=buildPlan(game,tool,points,{preferredMode});toast(result.message,{type:!result.ok?'error':result.built>0&&result.failed>0?'warning':'ok'});preview=[];if(result.ok)refreshRouteConnections(game);updateHud();if(result.ok){persistSoon();if(view!=='build')renderPanel();}
 if(hover&&updatePlacementTip.at)updatePlacementTip(); // Re-quote the tile under the pointer, never the finished stroke.
}
function pickMapTile(clientX,clientY,clamp=false) {
 if(isRoutePicking()) {
  const rect=canvas.getBoundingClientRect();
  // Station signs stay fourteen screen pixels wide, including at Region zoom.
  // Their clickable area therefore extends beyond their underlying map tile.
  for(const station of mapLayers.stations?game.stations:[]) {
   const marker=renderer.stationMarker(station),x=rect.left+marker.x,y=rect.top+marker.y;
   if(clientX>=x&&clientX<=x+14&&clientY>=y&&clientY<=y+14)return {x:station.x,y:station.y};
  }
  return renderer.screenToTile(clientX,clientY);
 }
 if(terrainTools.has(tool))return renderer.screenToVertex(clientX,clientY,{clamp});
 return tool==='inspect'?renderer.screenToInspectTile(clientX,clientY):renderer.screenToTile(clientX,clientY,{clamp});
}
function cancelGesture() {
 const captures=new Set([...touchPoints.keys(),...(pointer?[pointer.id]:[])]);
 pointer=null;preview=[];touchGesture=null;touchPoints.clear();
 for(const id of captures)if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
 canvas.classList.remove('dragging');$('#placement-tip').hidden=true;
}
function touchFrame() {
 const [a,b]=[...touchPoints.values()];if(!a||!b)return null;
 return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
}
// A valid stop names what it will serve; a bulldozer names the services it would cut.
const coverageTips=new WeakMap();
function placementNote(effective,plan) {
 if(['bus-stop','train-stop','port'].includes(effective)&&plan.placements.length===1){
  const {x,y}=plan.placements[0],key=`${x},${y}:${game.revision}`;let cache=coverageTips.get(game);if(!cache)coverageTips.set(game,cache=new Map());
  if(!cache.has(key)){
   const c=stationCoverage(game,{x,y}),list=items=>items.slice(0,3).join(', ')+(items.length>3?` +${items.length-3}`:''),cargo=keys=>keys.filter(k=>k!=='passengers').map(k=>CARGO[k].name.toLowerCase());
   const parts=[[cargo(c.produces),'Loads'],[cargo(c.accepts),'Accepts'],[c.cities.map(city=>city.name),'serves']].filter(([items])=>items.length).map(([items,label])=>`${label} ${list(items)}`);
   if(cache.size>=64)cache.delete(cache.keys().next().value);
   cache.set(key,parts.length?{text:parts.join(' · ')}:{text:'No customers within 5 tiles',warning:true});
  }
  return cache.get(key);
 }
 if(tool!=='bulldoze')return {text:''};
 const index=routeTileIndex(game),names=new Set(plan.placements.flatMap(p=>index.get(p.y*game.width+p.x)||[]));
 return names.size?{text:`breaks ${names.size===1?`the ${[...names][0]} route`:names.size+' routes'}`,warning:true}:{text:''};
}
function updatePlacementTip(e=updatePlacementTip.at) {
 const tip=$('#placement-tip');updatePlacementTip.at={clientX:e.clientX,clientY:e.clientY};
 if(tool==='inspect'||!hover||!tileAt(hover.x,hover.y)||pointer?.pan||touchGesture){tip.hidden=true;return;}
 const points=preview.length?preview:[hover],n=points.length,plan=spanTools.has(tool)&&n<3?{ok:false,message:'Drag at least 3 tiles between level ends.',placements:[],cost:0}:quoteBuildPlan(game,tool,points,{preferredMode});
 const effective=n===1&&!spanTools.has(tool)?plan.placements[0]?.tool:tool;
 const name=TOOL_INFO[effective]?.name||BUILDINGS[effective]?.name||INDUSTRIES[effective]?.name||'Build';
 const levels=tool==='level'?`Level ${plan.level??surfaceHeight(game,points[0].x,points[0].y)}`:terrainTools.has(tool)?n===1?`Level ${surfaceHeight(game,hover.x,hover.y)} → ${Math.max(1,Math.min(MAX_HEIGHT,surfaceHeight(game,hover.x,hover.y)+(tool==='raise'?1:-1)))}`:`${tool==='raise'?'+1':'−1'} level / point`:spanTools.has(tool)&&Number.isFinite(plan.height)?`Level ${plan.height}`:'';
 const nature=tool==='bulldoze'&&n===1?terrainObjectAt(game,hover.x,hover.y):null;
 const siteSize=BUILDINGS[effective]?buildingFootprint(effective):INDUSTRIES[effective]?industryFootprint(effective):nature&&nature.object.kind!=='mountain'?terrainObjectSize(nature.object):0;
 const note=plan.ok===false?{text:''}:placementNote(effective,plan);
 tip.textContent=plan.ok===false?plan.message:`${name}${siteSize?' · '+siteSize+' × '+siteSize:''}${levels?' · '+levels:''} · ${money(plan.cost)}${plan.placements.length>1?' · '+plan.placements.length+(tool==='bulldoze'?' sites':terrainTools.has(tool)?' points':' tiles'):''}${plan.partial?' · '+plan.message:''}${note.text?' · '+note.text:''}`;
 tip.classList.toggle('invalid',plan.ok===false);tip.classList.toggle('partial',plan.ok!==false&&Boolean(plan.partial));tip.classList.toggle('warning',Boolean(note.warning));
 const rect=canvas.getBoundingClientRect();tip.hidden=false;
 tip.style.left=Math.max(4,Math.min(rect.width-tip.offsetWidth-4,e.clientX-rect.left+17))+'px';tip.style.top=Math.max(4,Math.min(rect.height-tip.offsetHeight-4,e.clientY-rect.top+18))+'px';
}
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0&&e.button!==1&&e.button!==2)return;
 if(e.pointerType==='touch'){
  touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);
  if(touchPoints.size>1){pointer=null;preview=[];hover=null;touchGesture={...touchFrame(),zoomed:false};canvas.classList.add('dragging');$('#placement-tip').hidden=true;e.preventDefault();return;}
  if(touchGesture)return;
 }else if(pointer){if(e.button===2)setTool('inspect');return;}
 canvas.focus({preventScroll:true});const tile=pickMapTile(e.clientX,e.clientY);
 pointer={id:e.pointerId,button:e.button,tool,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,start:tile,moved:false,pan:tool==='inspect'||e.button!==0||spaceDown};
 canvas.setPointerCapture(e.pointerId);
 if(spaceDown)spaceUsedForPan=true;
 if(pointer.pan)canvas.classList.add('dragging');else preview=[tile];
 updatePlacementTip(e);
});
canvas.addEventListener('pointermove',e=>{
 if(touchPoints.has(e.pointerId))touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(touchGesture){
  const next=touchFrame();if(next){renderer.pan(next.x-touchGesture.x,next.y-touchGesture.y);const ratio=next.distance/touchGesture.distance;
   if(!touchGesture.zoomed&&(ratio>1.25||ratio<.8)){renderer.zoomAt(ratio>1?2:.5,next.x,next.y);touchGesture.zoomed=true;updateHud();}
   touchGesture.x=next.x;touchGesture.y=next.y;
  }e.preventDefault();return;
 }
 hover=pickMapTile(e.clientX,e.clientY,pointer&&!pointer.pan&&!pointer.cancelled&&lineTools.has(pointer.tool));$('#tile-coordinates').textContent=`${hover.x}, ${hover.y} · ${BIOMES[game.biome].name}`;
 if(pointer&&pointer.id===e.pointerId){
  // A chorded right press arrives as a move; it abandons the stroke but keeps the tool.
  if(!pointer.cancelled&&e.pointerType==='mouse'&&pointer.button===0&&!pointer.pan&&(e.buttons&2)){pointer.cancelled=true;preview=[];canvas.classList.remove('dragging');}
  if(pointer.cancelled){pointer.lastX=e.clientX;pointer.lastY=e.clientY;$('#placement-tip').hidden=true;return;}
  const dx=e.clientX-pointer.lastX,dy=e.clientY-pointer.lastY;
  if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>5)pointer.moved=true;
  if(pointer.moved&&!lineTools.has(pointer.tool)){pointer.pan=true;preview=[];canvas.classList.add('dragging');}
  if(pointer.pan){renderer.pan(dx,dy);if(spaceDown)spaceUsedForPan=true;}
  else if(lineTools.has(pointer.tool))preview=constructionLine(pointer.start,hover,pointer.tool);
  pointer.lastX=e.clientX;pointer.lastY=e.clientY;
 }
 updatePlacementTip(e);
});
canvas.addEventListener('pointerup',e=>{
 touchPoints.delete(e.pointerId);
 if(touchGesture){if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(!touchPoints.size){touchGesture=null;canvas.classList.remove('dragging');}preview=[];hover=null;return;}
 if(!pointer||pointer.id!==e.pointerId)return;
 const p=pointer;pointer=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 if(p.cancelled){preview=[];$('#placement-tip').hidden=true;return;}
 if(p.button!==0){preview=[];if(p.button===2&&!p.moved)setTool('inspect');return;}
 if(p.tool!==tool){preview=[];return;}
 if(!p.moved&&!spaceDown&&pickRouteStopAt(p.start.x,p.start.y))return;
 if(p.pan){preview=[];if(!p.moved&&!spaceDown)inspect(p.start.x,p.start.y);return;}
 if(p.moved&&!lineTools.has(p.tool)){preview=[];return;}
 const points=preview.length?preview:[p.start];
 if(points.every(p=>tileAt(p.x,p.y)))paintPath(points);else{toast('Keep construction within the world boundary.',true);preview=[];}
});
canvas.addEventListener('pointercancel',cancelGesture);
canvas.addEventListener('lostpointercapture',e=>{if(pointer?.id===e.pointerId||touchPoints.has(e.pointerId))cancelGesture();});
canvas.addEventListener('pointerleave',()=>{if(!pointer)hover=null;$('#placement-tip').hidden=true;});
canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(pointer&&!pointer.pan&&!touchPoints.has(pointer.id)&&(e.pointerType||'mouse')==='mouse'){pointer.cancelled=true;preview=[];$('#placement-tip').hidden=true;}});
// Safari and iPad never focus a pressed button, so live refreshes wait out a press instead of replacing its target.
$('#inspector').setAttribute('role','region');$('#inspector').setAttribute('aria-labelledby','inspector-title');
for(const el of [$('#inspector'),$('#panel-content')])el.addEventListener('pointerdown',()=>{panelPress=true;},true);
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(panelPress){panelPress=false;panelReleasedAt=performance.now();}},true);
let wheelAt=-Infinity, wheelDelta=0, wheelConsumed=false;
canvas.addEventListener('wheel',e=>{
 e.preventDefault();if(!e.deltaY)return;
 const now=performance.now();
 if(now-wheelAt>180){wheelDelta=0;wheelConsumed=false;}
 wheelAt=now;if(wheelConsumed)return;
 wheelDelta+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1);
 if(Math.abs(wheelDelta)<12)return;
 // One step per gesture keeps trackpad momentum from skipping a view.
 wheelConsumed=true;renderer.zoomAt(wheelDelta<0?2:.5,e.clientX,e.clientY);updateHud();
},{passive:false});
$('#minimap').addEventListener('click',e=>{const box=e.currentTarget.getBoundingClientRect();renderer.focus((e.clientX-box.left)/box.width*game.width,(e.clientY-box.top)/box.height*game.height);});
$('#minimap').addEventListener('keydown',e=>{if(e.key==='Enter'){renderer.focus(game.cities[0].x,game.cities[0].y);}});
$$('.nav-button[data-view]').forEach(el=>el.addEventListener('click',()=>compactUI?compactUI.toggleManagement(el.dataset.view):setView(el.dataset.view)));
$$('[data-open-chains]').forEach(el=>el.addEventListener('click',()=>openChains()));
$$('[data-mobile-view]').forEach(el=>el.addEventListener('click',()=>setView(el.dataset.mobileView)));
$$('[data-speed]').forEach(el=>el.addEventListener('click',()=>changeSpeed(Number(el.dataset.speed))));
$('#panel-help').onclick=()=>openHelp();$('#panel-save').onclick=openSaves;
$('#atlas-button').onclick=openAtlas;
$('#world-button').onclick=openWorld;$('#help-button').onclick=()=>openHelp();$('#guide-button').onclick=()=>openHelp();$('#save-button').onclick=openSaves;
$('#objective-card').addEventListener('click',goalClick);
$('#grid-button').onclick=()=>setMapLayers({grid:!mapLayers.grid});
$('#routes-toggle').onclick=()=>setMapLayers({routes:!mapLayers.routes});
$('#zoom-in').onclick=()=>{closeMapMenus();renderer.zoomAt(1.2);updateHud();};$('#zoom-out').onclick=()=>{closeMapMenus();renderer.zoomAt(1/1.2);updateHud();};$('#home-view').onclick=()=>renderer.focus(game.cities[0].x,game.cities[0].y);
$$('[data-zoom-level]').forEach(el=>el.addEventListener('click',()=>{renderer.setZoom(Number(el.dataset.zoomLevel));closeMapMenus(true);updateHud();}));
$('#zoom-level').onclick=()=>toggleMapMenu('zoom-menu','zoom-level');
$('#map-options-button').onclick=()=>toggleMapMenu('map-options','map-options-button');
$('#cancel-tool-button').onclick=()=>setTool('inspect');
$('#layers-button').addEventListener('click',()=>{closeMapMenus();cancelGesture();});
$('#map-options').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>closeMapMenus(true)));
document.addEventListener('pointerdown',e=>{
 const open=[['zoom-menu','zoom-level'],['map-options','map-options-button']].find(([menuId])=>!$('#'+menuId).hidden);
 if(open&&!$('#'+open[0]).contains(e.target)&&!$('#'+open[1]).contains(e.target)){closeMapMenus();if(e.target===canvas){e.preventDefault();e.stopPropagation();}}
},true);
$('#audio-button').onclick=()=>{sounds=!sounds;$('#audio-button').innerHTML=icon(sounds?'volume':'muted');$('#audio-button').setAttribute('aria-label',sounds?'Disable sound':'Enable sound');beep();};$('#audio-button').innerHTML=icon('muted');
$('#company-stats').onclick=()=>{const el=$('#company-stats');el.setAttribute('aria-expanded',String(el.getAttribute('aria-expanded')!=='true'));};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.hud-finance-wrap'))$('#company-stats').setAttribute('aria-expanded','false');});
$('#company-stats').addEventListener('keydown',e=>{if(e.key==='Escape'){$('#company-stats').setAttribute('aria-expanded','false');e.currentTarget.blur();}});
let spaceStarted=0;
// Mouse clicks leave focus on HUD buttons; Space should still pause rather than click them again.
let pointerFocus=null,spaceConsumed=false;
document.addEventListener('pointerdown',e=>{pointerFocus=e.target.closest?.('button,a,summary,[role=button]')||null;},true);
document.addEventListener('focusin',e=>{if(e.target!==pointerFocus)pointerFocus=null;});
document.addEventListener('keydown',e=>{
 if(e.defaultPrevented||isLoading()||$('#start-menu')?.open)return;
 if(e.key==='Escape'&&(!$('#zoom-menu').hidden||!$('#map-options').hidden)){e.preventDefault();closeMapMenus(true);return;}
 if(e.key==='Escape'&&!$('#layers-panel').hidden){e.preventDefault();layersView?.close();return;}
 if(e.key.toLowerCase()==='s'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(!saveDialogController)openSaves();return;}
 if(e.key==='Escape'&&isRoutePicking()){e.preventDefault();cancelRoutePicking();return;}
 if($('#modal').open||e.target.matches('input,select,textarea')||e.target.closest('#layers-panel, #layers-button'))return;
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.code==='Space'){
  const control=e.target.closest('button,a,summary,[role=button]');if(control&&control!==pointerFocus)return;
  e.preventDefault();spaceConsumed=true;if(!e.repeat){spaceDown=true;spaceUsedForPan=false;spaceStarted=performance.now();if(pointer){pointer.pan=true;preview=[];spaceUsedForPan=true;canvas.classList.add('dragging');}}return;
 }
 if(e.repeat)return;const key=e.key.toLowerCase();
 if(key==='escape'){if(pointer&&!pointer.pan&&tool!=='inspect'){cancelGesture();return;}setTool('inspect');closeMobile();return;}
 // Physical keys keep brackets and digits reachable on QWERTZ and AZERTY layouts; a printed + still zooms.
 const rail=preferredMode==='rail',keys={r:'road',t:'rail',s:'stop',p:'port',b:rail?'railbridge':'bridge',x:'bulldoze','1':'residential','2':'commercial','3':'industrial'},codes={KeyE:'level',BracketLeft:'lower',BracketRight:key==='+'?null:'raise',KeyN:rail?'railtunnel':'tunnel',Digit1:'residential',Digit2:'commercial',Digit3:'industrial'},next=keys[key]||codes[e.code];
 if(next){category=['residential','commercial','industrial'].includes(next)?'towns':'network';view='build';setView('build');setTool(next);return;}
 if(key==='l'){e.preventDefault();closeMapMenus();cancelGesture();layersView?.toggle();}
 if(key==='m')openAtlas();if(key==='c'&&!e.ctrlKey&&!e.metaKey)openChains();if(key==='g')$('#grid-button').click();if(key==='h')$('#home-view').click();if(key==='?')openHelp();
 if(key==='='||key==='+')$('#zoom-in').click();if(key==='-')$('#zoom-out').click();
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();renderer.pan(e.key==='ArrowLeft'?90:e.key==='ArrowRight'?-90:0,e.key==='ArrowUp'?90:e.key==='ArrowDown'?-90:0);}
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){if(spaceConsumed){e.preventDefault();spaceConsumed=false;}if(!isLoading()&&spaceDown&&!spaceUsedForPan&&!pointer&&performance.now()-spaceStarted<260)changeSpeed(speed===0?previousSpeed:0);spaceDown=false;}});
window.addEventListener('blur',()=>{spaceDown=false;spaceUsedForPan=false;cancelGesture();});
window.addEventListener('resize',()=>{renderer.resize();syncToolControls();refreshArtwork();});
const pageZoomed=()=>(window.visualViewport?.scale||1)>1.01,syncPageZoom=()=>$('#app').classList.toggle('page-zoomed',pageZoomed());
window.visualViewport?.addEventListener('resize',syncPageZoom);syncPageZoom();
// Safari pinches arrive as gesture events: the chrome never zooms the page, but dialogs and an already zoomed page still pinch.
for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,e=>{if(!$('#modal').open&&!$('#start-menu')?.open&&!pageZoomed())e.preventDefault();},{passive:false});
window.addEventListener('pagehide',()=>{if((!isLoading()||menuOpening)&&!$('#start-menu')?.open)flushSave();});
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();if(document.hidden&&(!isLoading()||menuOpening)&&!$('#start-menu')?.open)flushSave();});

layersView=mountVisibility($('#layers-panel'),$('#layers-button'),{getLayers:()=>({...mapLayers}),onChange:(key,visible)=>setMapLayers({[key]:visible}),onPreset:name=>setMapLayers(layerPreset(name))});
compactUI=mountCompactPlay({onMenu:openGameMenu,onNews:openNews,onView:setView,getView:()=>view,onCancelGesture:cancelGesture,onMinimapOpen:()=>{renderer.drawMinimap($('#minimap'));invalidateScene();}});
const refreshArtwork=()=>{
 invalidateScene();
 drawPaletteSprites();
};
let artworkRefreshPending=false;
function queueArtworkRefresh(){
 invalidateScene();if(artworkRefreshPending)return;artworkRefreshPending=true;
 requestAnimationFrame(()=>{artworkRefreshPending=false;refreshArtwork();});
}
onHouseAssetsChange(queueArtworkRefresh);onWorldArtChange(queueArtworkRefresh);
window.addEventListener('online',()=>{void preloadHouses({retry:true,biome:game.biome});void preloadWorldArt({retry:true,biome:game.biome});});
syncLayerControls();
updateRegion();renderPanel();syncToolControls();updateHud();changeSpeed(1);renderer.resize();if(window.innerWidth<=700)renderer.focus(game.cities[0].x+1,game.cities[0].y-1);
// The start menu has already saved a new world or loaded its checkpoint.
savedWorld=worldSerial;savedDay=game.day;savedRevision=game.revision;saveAt=performance.now();
await drawLoadedWorld();hideLoading();lastFrame=performance.now();
let painted=null,hudState=null,minimapState=null,panelDay=-1,panelRevision=-1;
function frame(now){
 const elapsed=Math.min((now-lastFrame)/1000,.15);lastFrame=now;
 if(isLoading()||document.hidden||$('#start-menu')?.open){requestAnimationFrame(frame);return;}
 // A capture holds only the next daily step; vehicles keep moving inside the day.
 if(speed>0){if(!capturingSave)tick(game,elapsed*speed);else{const room=Math.floor(game.day+1e-8)+1-game.day-1e-6;if(room>0)tick(game,Math.min(elapsed*speed,room));}}
 const camera=renderer.getCamera(),w=canvas.width,h=canvas.height;
 const changed=!painted||painted.game!==game||painted.day!==game.day||painted.revision!==game.revision||painted.money!==game.money||painted.scene!==sceneRevision||painted.x!==camera.x||painted.y!==camera.y||painted.height!==camera.height||painted.zoom!==camera.zoom||painted.w!==w||painted.h!==h||painted.layers!==mapLayers||painted.tool!==tool||painted.hover!==hover||painted.preview!==preview||painted.selected!==selected||painted.mode!==preferredMode||painted.view!==view||painted.from!==formDraft.from||painted.to!==formDraft.to;
 if(changed){
  renderer.render(now,{tool,hover,preview,selected,preferredMode,routeStops:routePickStops()});
  painted={game,day:game.day,revision:game.revision,money:game.money,scene:sceneRevision,x:camera.x,y:camera.y,height:camera.height,zoom:camera.zoom,w,h,layers:mapLayers,tool,hover,preview,selected,mode:preferredMode,view,from:formDraft.from,to:formDraft.to};
 }
 if(now-hudAt>400&&(!hudState||hudState.game!==game||hudState.day!==game.day||hudState.revision!==game.revision||hudState.money!==game.money||hudState.zoom!==camera.zoom||hudState.w!==w||hudState.view!==view)){
  updateHud();hudAt=now;hudState={game,day:game.day,revision:game.revision,money:game.money,zoom:camera.zoom,w,view};
  const fresh=collectNotices(game.notifications,lastNoticeId);lastNoticeId=game.notifications[0]?.id;for(const entry of groupNotices(fresh))noticeQueue.push({...entry,type:toastType(entry.type)});watchRoutes();
  if(selected&&!$('#inspector').hidden&&!$('#inspector').contains(document.activeElement)&&!panelPress&&now-panelReleasedAt>250)inspect(selected.x,selected.y,selected.kind);
 }
 if(noticeQueue.length&&now-noticeAt>400){noticeAt=now;showQueuedNotices(now);}
 if((!compactUI||compactUI.isMinimapVisible())&&(!minimapState||minimapState.game!==game||minimapState.revision!==game.revision||minimapState.layers!==mapLayers||minimapState.x!==camera.x||minimapState.y!==camera.y||minimapState.height!==camera.height||minimapState.zoom!==camera.zoom||minimapState.w!==w||minimapState.h!==h)){
  renderer.drawMinimap($('#minimap'));minimapAt=now;lastRevision=game.revision;
  minimapState={game,revision:game.revision,layers:mapLayers,x:camera.x,y:camera.y,height:camera.height,zoom:camera.zoom,w,h};
 }
 // No world state changes while paused: avoid rescanning millions of tiles to
 // rewrite the same autosave. Explicit saves and page-leave saves still run.
 // While running, start early in a day so the capture fits before the next one.
 if(now-saveAt>20000&&!saveDialogController&&(!speed||game.day-Math.floor(game.day)<.25)){if(savedWorld!==worldSerial||savedDay!==game.day||savedRevision!==game.revision)persist();else saveAt=now;}
 if(now-panelAt>7000&&!$('.sidebar').inert&&(view==='industry'||view==='towns')&&(panelDay!==game.day||panelRevision!==game.revision)){
  if(!$('#entity-list')?.contains(document.activeElement)&&!panelPress&&now-panelReleasedAt>250)refreshEntities();panelAt=now;panelDay=game.day;panelRevision=game.revision;
 }
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// Explicit diagnostic surface for deterministic browser regression checks; no internal state duplicated.
window.transport={get game(){return game;},get renderer(){return renderer;},get speed(){return speed;},setSpeed:changeSpeed,setTool,setView,inspect,persist};
