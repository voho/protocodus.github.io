import { mountCompactPlay } from './compact-play.js';
import { captureGame, encodeCapturedGame } from './background-jobs.js';
import { savePreparedGame, noteAutosaveTime } from './autosave-storage.js';
import { SAVE_KEY } from './model.js';
import { takeStartupGame, openStartMenu } from './start-menu.js';
import { surfaceHeight, tileSurface, MAX_HEIGHT } from './terrain-geometry.js';
import { refreshRouteConnections, getVehiclePurchase, getVehicleUpgrade, getFleetUpgrade, upgradeRouteVehicle, upgradeFleet, priceFor, inflationInfo, addRoute, removeRoute, tick, saveGame, BIOMES, INDUSTRIES, CARGO, BUILD_COSTS, stationCoverage, industryConditions, settlementSuitability, weatherAt } from './model.js';
import { createRenderer } from './renderer.js';
import { quoteBuildPlan, buildPlan } from './construction-plan.js';
import { captureUndo, finishUndo, undoConstruction, undoStale } from './construction-undo.js';
import { gridLine, planNetworkStroke } from './network-router.js';
import { planConnection } from './network-router.js';
import { routeTileIndex } from './route-tiles.js';
import { nearbyStations } from './simulation-spatial.js';
import { routesNeedingAttention } from './gameplay-insights.js';
import { TILE } from './sprites.js';
import { drainDeliveryEvents } from './model.js';
import { renameStation, renameRoute } from './model.js';
import { editRoute } from './model.js';
import { drawUIArtwork } from './ui-art.js';
import { integerText, tenthsText, compactText, dayText, monthText, longDayText } from './formatters.js';
import { BUILDINGS, BUILDING_GROUPS } from './buildings.js';
import { ZOOM_LEVELS, ZOOM_VIEWS, zoomIndex } from './zoom.js';
import { cargoIcon, cargoBadge, cargoRecipe } from './cargo-icons.js';
import { filterRoutes, validateRoutePlan, routeCargoList, routeCargoOptions, defaultRouteName } from './route-planner.js';
import { addRouteVehicle, sellRouteVehicle, getRouteFleet, getRetirementRefund, vehicleNoun, MAX_VEHICLES } from './model.js';
import { TOWN_CARGO } from './data.js';
import { STATION_RADIUS } from './model.js';
import { townNeeds, NEED_WINDOW, townGrowth, townOutlook } from './settlements.js';
import { forecastRoute } from './route-planner.js';
import { findIndustryTargets, lensCargo } from './chains.js';
import { mountChains } from './chains-view.js';
import { mountSaves } from './saves-view.js';
import { loadVisibility, saveVisibility, normalizeLayers, layerPreset } from './visibility.js';
import { mountVisibility } from './visibility-view.js';
import { townService, industryStatus, routeHealth, nextProject } from './gameplay-insights.js';
import { collectNotices, groupNotices, crossedMilestone, newYearNotice, toastType } from './ui-notices.js';
import { MILESTONES, CHAPTERS, milestoneChapters, metMilestones, progressText } from './milestones.js';
import { contractState, contractSites } from './contracts.js';
import { loanTerms, borrow, repay } from './model.js';
import { routeNeedsAttention } from './gameplay-insights.js';
import { creditToast } from './ui-notices.js';
import { preloadHouses, onHouseAssetsChange } from './raster-houses.js';
import { preloadWorldArt, onWorldArtChange } from './atlas-runtime.js';
import { industryContains, industrySize, industryFootprint } from './industry-sites.js';
import { industryDistance } from './industry-sites.js';
import { outputFill } from './industry-simulation.js';
import { buildingAt, buildingSize, buildingFootprint } from './building-sites.js';
import { terrainObjectAt, terrainObjectSize } from './terrain-objects.js';
import { showLoading, updateLoading, hideLoading, isLoading, paintLoading } from './loading-screen.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const integer = integerText;
const money = value => '$' + integer(Math.abs(value));
const compactMoney = value => value >= 1000 ? '$' + tenthsText(value / 1000) + 'k' : money(value);
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
 pencil:'<path d="m4 20 1-5L16 4l4 4L9 19zM14 6l4 4"/>',
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
let floaters = [], floaterGame = null, chimeAt = 0, incomeSeen = {}, incomePulseAt = -Infinity;
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
let goalChoice = null, goalSignature = '', goalOpen = false, goalSeen = null, goalChanged = false, goalFolded = (() => { try { const stored = localStorage.getItem('transport-next-goal-v2'); return stored ? stored === 'folded' : Boolean(localStorage.getItem('transport-next-goal-v1')); } catch { return false; } })();
let noticeQueue=[],noticeAt=0,pacedNoticeAt=-Infinity,panelPricesStale=false,knownRoutes=new Set(),firstDeliveryPending=new Set(),townPeaks=new Map(),townDay=-1;
let seenMilestones=new Set(),milestoneMonth=-1;
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
 renderGoal();
 renderer.drawMinimap($('#minimap'));minimapAt=performance.now();
 if(saveVisibility(mapLayers))layerStorageNotice=false;
 else if(!layerStorageNotice){layerStorageNotice=true;toast('Layers changed. This browser could not remember the settings.',true);}
}

function beep(type='ok') {
 if (!sounds) return;
 try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume(); const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.type='sine'; oscillator.frequency.setValueAtTime(type==='error'?190:560,audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(type==='error'?120:830,audioContext.currentTime+.09); gain.gain.setValueAtTime(.025,audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.13); oscillator.start(); oscillator.stop(audioContext.currentTime+.14); } catch { sounds=false; }
}
// Deliveries ring two soft rising notes; audio waits for a gesture instead of starting a context itself.
function chime() {
 if (!sounds||audioContext?.state!=='running') return;
 try { for (const [index,frequency] of [660,990].entries()) { const at=audioContext.currentTime+index*.08, oscillator=audioContext.createOscillator(), gain=audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.type='sine'; oscillator.frequency.setValueAtTime(frequency,at); gain.gain.setValueAtTime(.0001,at); gain.gain.exponentialRampToValueAtTime(.018,at+.012); gain.gain.exponentialRampToValueAtTime(.0005,at+.18); oscillator.start(at); oscillator.stop(at+.19); } } catch { sounds=false; }
}
function toast(message, options=false) {
 const {type=options===true?'error':'ok',action=null,key=message,silent=false}=typeof options==='object'&&options?options:{},region=$('#toast-region');
 let el=[...region.children].find(node=>node.toastKey===key),count=1;
 if(el){count=el.toastCount+1;clearTimeout(el.toastTimer);}else{el=document.createElement('div');region.append(el);}
 el.className='toast'+(type==='ok'?'':' '+type);el.toastKey=key;el.toastCount=count;
 const actions=[action].flat().filter(Boolean),buttons=actions.map(item=>`<button type="button" class="toast-action">${escapeHTML(item.label)}</button>`).join('');
 el.innerHTML=icon(type==='ok'||type==='milestone'?'check':'warning')+`<span>${escapeHTML(message)}</span>`+(count>1?`<b class="toast-count">×${count}</b>`:'')+(actions.length>1?`<div class="toast-actions">${buttons}</div>`:buttons);
 el.querySelectorAll('.toast-action').forEach((button,index)=>{button.onclick=()=>{el.remove();actions[index].run();};});
 while(region.children.length>3) region.firstChild.remove();
 el.toastTimer=setTimeout(()=>el.remove(),type==='warning'||type==='error'?8000:5000); $('#status-message').textContent=message; if(!silent&&type!=='ok')beep(type==='milestone'?'ok':'error');
}
function changeSpeed(next) { if(next>0)previousSpeed=next; speed=next; $$('.speed-control button').forEach(el=>{el.classList.toggle('active',Number(el.dataset.speed)===speed);el.setAttribute('aria-pressed',String(Number(el.dataset.speed)===speed));}); syncPausedChip(); }
// A frozen world can look hung, so pausing names itself on the map; CSS hides it under dialogs and loading.
function syncPausedChip() {
 let chip=$('.paused-chip');
 if(!chip){chip=document.createElement('button');chip.type='button';chip.className='paused-chip';chip.innerHTML='Paused<span class="paused-keys"> · Space to resume</span><span class="paused-touch"> · Tap to resume</span>';chip.onclick=()=>{changeSpeed(previousSpeed);$('#world').focus({preventScroll:true});};$('#world').parentElement.append(chip);}
 chip.hidden=speed!==0;
}
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
const recentTools=['road','stop','bulldoze'];
function syncToolControls() {
 const bar=$('#active-tool-bar');if(!bar)return;
 bar.hidden=tool==='inspect'||isRoutePicking();
 const info=TOOL_INFO[tool]||BUILDINGS[tool]||INDUSTRIES[tool],touch=matchMedia('(pointer: coarse)').matches||window.innerWidth<=700,tap=touch?'Tap':'Click',network=preferredMode==='rail'?'railway':'road';
 $('#active-tool-icon').innerHTML=icon(info?.icon||'factory');
 $('#active-tool-name').textContent=info?.name||'Build';
 $('#active-tool-hint').textContent=lineTools.has(tool)?touch?'Drag to build · Two fingers to move':'Drag to build · Done to explore':`${tap} to place · Drag to move`;
 if(tool==='road'||tool==='rail')$('#active-tool-hint').textContent=touch?'Straight grades · flat turns':'Drag · straight grades only · flat turns';
 if(tool==='stop')$('#active-tool-hint').textContent=touch?`Tap a ${network} near customers`:`Click a ${network} within 5 tiles of customers`;
 if(tool==='port')$('#active-tool-hint').textContent=`${tap} water beside land, near customers`;
 if(tool==='bulldoze')$('#active-tool-hint').textContent=`${tap} or drag · Clears whole sites`;
 if(BUILDINGS[tool]||INDUSTRIES[tool]){const size=BUILDINGS[tool]?buildingFootprint(tool):industryFootprint(tool);$('#active-tool-hint').textContent=`${size} × ${size} site · ${tap} to place`;}
 if(terrainTools.has(tool))$('#active-tool-hint').textContent=tool==='level'?'Drag an area · Match the first point':`${tap} or drag · ${tool==='raise'?'+1':'−1'} level per point`;
 if(spanTools.has(tool))$('#active-tool-hint').textContent='Drag straight · Flat ends at the same level';
 if(aimTool(tool)&&touch){const size=BUILDINGS[tool]?buildingFootprint(tool):INDUSTRIES[tool]?industryFootprint(tool):0;$('#active-tool-hint').textContent=size?`${size} × ${size} site · Tap to preview`:'Tap to preview · Tap again to place';}
 syncToolDock(bar,touch);
 $('#map-hint').hidden=tool!=='inspect'||isRoutePicking();
}
// Phones switch between recent tools from the bar itself, so a tool change never covers the map with the drawer.
function syncToolDock(bar,touch) {
 let dock=$('#active-tool-dock');
 if(!dock){dock=document.createElement('div');dock.id='active-tool-dock';dock.setAttribute('role','toolbar');dock.setAttribute('aria-label','Recent tools');dock.onclick=e=>{const key=e.target.closest('[data-dock-tool]')?.dataset.dockTool;if(!key)return;category=INDUSTRIES[key]?'industry':BUILDINGS[key]||['residential','commercial','industrial','city'].includes(key)?'towns':'network';setTool(key);};bar.insertBefore(dock,$('#cancel-tool-button'));}
 const keys=touch?recentTools.filter(key=>key!==tool&&(!INDUSTRIES[key]||INDUSTRIES[key].biomes.includes(game.biome))).slice(0,window.innerWidth<360?2:3):[];
 dock.hidden=!keys.length;if(dock.toolKeys===keys.join())return;dock.toolKeys=keys.join();
 dock.innerHTML=keys.map(key=>{const info=TOOL_INFO[key]||BUILDINGS[key]||INDUSTRIES[key],name=escapeHTML(info?.name||'Build');return `<button type="button" data-dock-tool="${key}" aria-label="${name}" title="${name}">${icon(info?.icon||'factory')}</button>`;}).join('');
}
function setTool(next) {
 cancelGesture();closeMapMenus();cancelRoutePicking();
 if(['road','bridge','tunnel','bus-stop'].includes(next))preferredMode='road';
 if(['rail','railbridge','railtunnel','train-stop'].includes(next))preferredMode='rail';
 if(spanTools.has(next)||terrainTools.has(next)){category='network';engineeringOpen=true;}
 tool=['bus-stop','train-stop'].includes(next)?'stop':next;selected=null;hover=null;
 if(tool!=='inspect')recentTools.splice(0,recentTools.length,tool,...recentTools.filter(key=>key!==tool).slice(0,3));
 $('#inspector').hidden=true;canvas.classList.toggle('build-mode',tool!=='inspect');
 $('#status-message').textContent=toolDescription(tool);renderPanel();syncToolControls();
 closeMobile();canvas.focus({preventScroll:true});
 if(keyOwned()){keyStart=null;showKeyCursor();}
}
function setView(next) {
 const changedView=view!==next;
 cancelGesture();closeMapMenus();if(next!=='routes')cancelRoutePicking();
 if(cargoLens&&(cargoLens.game!==game||cargoLens.origin!=='chains'&&cargoLens.origin!==next))setCargoLens(null);
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
 return `<button class="tool-card ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}" ${info.key?`aria-keyshortcuts="${info.key}" `:''}title="${escapeHTML(info.detail)}">${infrastructureKind(key)?infrastructurePortrait(infrastructureKind(key)):icon(info.icon)}<span class="tool-title">${label||info.name}</span><span class="tool-cost">${automatic?'from ':''}${compactMoney(priceFor(game,base))}${lineTools.has(key)?key==='bulldoze'?' / site':key==='level'?' / step':terrainTools.has(key)?' / point':' / tile':''}</span>${info.key?`<span class="shortcut" aria-hidden="true">${info.key}</span>`:''}</button>`;
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
 return `<details class="project-card"><summary>${escapeHTML(project.title)}</summary><p>${escapeHTML(project.detail)}</p><button class="small-button" data-project-action="${project.action}" ${project.target?`data-project-target="${escapeHTML(project.target)}"`:''}${project.tool?` data-project-tool="${project.tool}"`:''}>${escapeHTML(project.button)} ${icon('arrow')}</button><button type="button" class="project-show" data-goal-show>Show on map</button></details>`;
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
// Folding is a preference, not a title: a folded card only marks a new goal on its chip and reopens from the chip or Show on map.
function storeGoalFolded(folded) { goalFolded=folded;try{localStorage.setItem('transport-next-goal-v2',folded?'folded':'open');localStorage.removeItem('transport-next-goal-v1');}catch{} }
function renderGoal() {
 const project=nextProject(game,{source:goalChoice}),steps=project.steps||[],current=steps.findIndex(step=>!step.done),collapsed=goalFolded,visible=mapLayers.goal!==false;
 if(goalSeen===null||visible&&!collapsed&&(goalOpen||window.innerWidth>700)){goalSeen=project.title;goalChanged=false;}else if(project.title!==goalSeen)goalChanged=true;
 const signature=[project.title,project.detail,steps.map(step=>`${step.done}${step.label}${step.button}`).join(),current,project.progress?.value,project.choice,project.choices?.length,collapsed,goalOpen,goalChanged,visible].join('|');
 if(signature===goalSignature)return;goalSignature=signature;
 const card=$('#objective-card');card.hidden=!visible;card.classList.toggle('collapsed',collapsed);card.classList.toggle('open',goalOpen&&!collapsed);card.classList.toggle('changed',goalChanged);
 $('#objective-chip-title').textContent=project.title;$('#objective-title').textContent=project.title;$('#objective-detail').textContent=project.detail;
 $('#objective-steps').hidden=!steps.length;
 $('#objective-steps').innerHTML=steps.map((step,index)=>`<li class="objective-step${step.done?' done':''}${index===current?' current':''}">${step.done?icon('check'):`<span class="step-circle">${index+1}</span>`}<span>${escapeHTML(step.label)}${step.done?'<span class="sr-only"> · done</span>':''}</span>${index===current&&step.button?`<button type="button" class="small-button" data-goal-step="${index}">${escapeHTML(step.button)}</button>`:''}</li>`).join('');
 $('#objective-progress').hidden=!project.progress;$('#goal-bar').style.width=(project.progress?project.progress.value/project.progress.max*100:0)+'%';
 $('#objective-action').innerHTML=escapeHTML(project.button)+icon('arrow');$('#objective-another').hidden=!(project.choices?.length>1);$('#guide-button').hidden=!steps.length;$('#objective-goals').hidden=steps.length>0;
 $('#objective-plan').hidden=!project.plan;$('#objective-plan').textContent=project.plan==='rail'?'Plan rail':'Plan road';
 if(connectionPlan&&!(project.plan&&project.choices[project.choice].source.id===connectionPlan.source.id))cancelConnectionPlan(); // Another idea or a joined pair ends a waiting plan.
}
function goalClick(e) {
 const button=e.target.closest('button');if(!button||button.id==='guide-button')return;
 const project=nextProject(game,{source:goalChoice}),keyboard=e.detail===0;
 if(button.id==='dismiss-objective'){storeGoalFolded(true);goalOpen=false;}
 else if(button.id==='objective-chip'){storeGoalFolded(false);goalOpen=true;}
 else if(button.id==='objective-another'){const next=project.choices[(project.choice+1)%project.choices.length];goalChoice=next.source?.id??next;if(view==='build')renderPanel();}
 else if(button.id==='objective-action'){goalOpen=false;runProjectAction(project.action,project.target,{tool:project.tool});}
 else if(button.id==='objective-plan'){goalOpen=false;planFirstConnection(project);}
 else if(button.id==='objective-goals')openGoals();
 else if(button.dataset.goalStep){const step=project.steps[Number(button.dataset.goalStep)];goalOpen=false;if(step?.action)runProjectAction(step.action,project.target,{...step,choice:project.choices[project.choice]});}
 renderGoal();
 if(keyboard&&button.id==='dismiss-objective')$('#objective-chip').focus({preventScroll:true});
 if(keyboard&&button.id==='objective-chip')$('#dismiss-objective').focus({preventScroll:true});
 if(keyboard&&button.id==='objective-plan')$('#build-connection-plan')?.focus({preventScroll:true});
}
// Plan road previews the first route's line and new stops like a drag, builds them as one undoable step and
// drafts the route, so only Launch remains. Nothing is spent before Build; a tool, a view, Escape or a pick drops it.
let connectionPlan=null;
const planSummary=plan=>{const n=plan.stops.length,stops=n?`${n} ${plan.mode==='rail'?'station':'stop'}${n===1?'':'s'}`:'';return plan.tiles?`${transportName(plan.mode)} ${integer(plan.tiles)} tile${plan.tiles===1?'':'s'}${stops?' + '+stops:''}`:stops.charAt(0).toUpperCase()+stops.slice(1);};
function planFirstConnection(project) {
 const choice=project.choices?.[project.choice],mode=project.plan,target=choice&&(choice.buyer.kind==='city'?game.cities:game.industries).find(site=>site.id===choice.buyer.id);
 const plan=target&&mode?planConnection(game,choice.source,target,mode):null;
 if(!plan?.ok){toast(`No gentle ${mode||'road'} route found here. Place the stops and ${mode||'road'} yourself.`,{type:'warning'});return;}
 if(!plan.tiles&&!plan.stops.length)return runProjectAction('launch',null,{mode,from:plan.ends[0].id,to:plan.ends[1].id,cargo:choice.cargo});
 setTool('inspect');connectionPlan={game,plan,source:choice.source,target,cargo:choice.cargo};
 const corners=site=>{const size=industrySize(site);return [site,{x:site.x+size-1,y:site.y+size-1}];};
 framePoints([...plan.path,...corners(choice.source),...corners(target)]);showConnectionPlan();
}
// Centre points in the map left free by the goal card and the plan banner, at Town view when they fit.
function framePoints(points) {
 const card=$('#objective-card').getBoundingClientRect(),map=canvas.getBoundingClientRect(),right=card.width&&card.left>map.left+map.width/2?map.right-card.left+12:0,inset={left:40,top:130,right:40+right,bottom:70};
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
 const fits=()=>points.every(p=>{const s=renderer.worldToScreen(p.x+.5,p.y+.5);return s.x>inset.left&&s.y>inset.top&&s.x<canvas.clientWidth-inset.right&&s.y<canvas.clientHeight-inset.bottom;});
 for(const zoom of [1,.5]){renderer.setZoom(zoom);renderer.focus(cx,cy);renderer.pan((inset.left-inset.right)/2,(inset.top-inset.bottom)/2);if(fits())break;}
 updateHud();
}
function showConnectionPlan() {
 const {plan,cargo}=connectionPlan,short=plan.cost>game.money,reused=plan.ends.find(Boolean);
 let banner=$('#connection-plan-banner');if(!banner){banner=document.createElement('div');banner.id='connection-plan-banner';banner.className='route-pick-banner connection-plan-banner';banner.setAttribute('role','status');$('.map-section').append(banner);}
 const next=short?`Need ${money(plan.cost)} · balance ${money(game.money)}`:[plan.tiles?'':`The ${plan.mode} is already there`,`then a ${vehicleNoun(plan.mode,cargo)} ${money(plan.vehicleCost)}`,reused?`uses ${reused.name}`:''].filter(Boolean).join(' · ');
 banner.innerHTML=`<div><strong>${escapeHTML(planSummary(plan))} · ${money(plan.cost)}</strong><span>${escapeHTML(next.charAt(0).toUpperCase()+next.slice(1))}</span></div><button type="button" class="connection-build" id="build-connection-plan">Build</button><button type="button" id="cancel-connection-plan">Cancel</button>`;
 $('#build-connection-plan').onclick=buildConnectionPlan;$('#cancel-connection-plan').onclick=cancelConnectionPlan;
 $('#status-message').textContent=`${planSummary(plan)} planned · ${money(plan.cost)}`;invalidateScene();
}
function cancelConnectionPlan() { if(!connectionPlan)return;connectionPlan=null;$('#connection-plan-banner')?.remove();$('#status-message').textContent=toolDescription(tool);invalidateScene(); }
// The map draws a waiting plan as a road preview with its stops ringed; pointer input stays with Explore.
function connectionView() { const plan=connectionPlan?.game===game?connectionPlan.plan:null;return plan?{tool:plan.mode,hover:null,preview:plan.path,routeStops:[...plan.stops,...plan.ends.filter(Boolean)]}:{}; }
function buildConnectionPlan() {
 if(connectionPlan?.game!==game)return cancelConnectionPlan();
 const {plan,source,target,cargo}=connectionPlan,fresh=planConnection(game,source,target,plan.mode),sites=option=>JSON.stringify([option.path,option.stops.map(({x,y})=>[x,y])]),same=fresh.ok&&sites(fresh)===sites(plan);
 // Growth or another build may have changed the land since the preview; a different plan is shown before anything is spent.
 if(!fresh.ok){cancelConnectionPlan();toast(`The land has changed. Place the stops and ${plan.mode} yourself.`,{type:'warning'});return;}
 if(!same){connectionPlan.plan=fresh;showConnectionPlan();toast('The land has changed. Check the new plan.',{type:'warning'});return;}
 if(fresh.cost>game.money){showConnectionPlan();toast(`Need ${money(fresh.cost)} · balance ${money(game.money)}`,true);return;}
 const journal=captureUndo(game,'connection',[...fresh.path,...fresh.stops]),ids=fresh.ends.map(stop=>stop?.id),line=buildPlan(game,fresh.mode,fresh.path);
 let spent=line.ok?line.cost:0,failure=line.ok?'':line.message;
 for(const stop of fresh.stops){if(failure)break;const result=buildPlan(game,fresh.mode==='rail'?'train-stop':'bus-stop',[stop]);if(result.ok){spent+=result.cost;ids[stop.end]=result.station.id;}else failure=result.message;}
 const undo=finishUndo(journal,game,{ok:true,cost:spent});
 cancelConnectionPlan();
 if(failure){if(undo)undoConstruction(game,undo);refreshRouteConnections(game);updateHud();toast(failure,true);return;}
 if(undo)undoStack=[...undoStack.filter(item=>!undoStale(game,item)).slice(-9),undo];
 refreshRouteConnections(game);updateHud();persistSoon();
 toast(`${planSummary(fresh)} built · ${money(spent)}`,{key:undo||'connection',action:undo&&{label:'Undo',run:()=>undoBuild(undo)}});
 runProjectAction('launch',null,{mode:fresh.mode,from:ids[0],to:ids[1],cargo});
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
 const available=routeCargoList(game).filter(editCargo).map(key=>[key,CARGO[key]]),verdicts=new Map(options.map(option=>[option.cargo,option]));
 const fit=(key,c)=>{const option=verdicts.get(key);return (option?` data-fits="${option.valid}"`:'')+` title="${escapeHTML(option&&!option.valid?option.message:c.name)}"`;};
 return `<fieldset class="cargo-field"><legend>Cargo</legend><select name="cargo" hidden aria-hidden="true" tabindex="-1">${available.map(([key,c])=>`<option value="${key}" ${formDraft.cargo===key?'selected':''}>${c.name}</option>`).join('')}</select><div class="cargo-picker" role="group" aria-label="Choose cargo">${available.map(([key,c])=>`<button type="button" class="cargo-choice" data-cargo-choice="${key}" aria-pressed="${formDraft.cargo===key}"${fit(key,c)}>${cargoIcon(key,{decorative:true})}<span>${c.name}</span>${verdicts.get(key)?.valid?`${icon('check','cargo-fit')}<span class="sr-only"> · fits these stops</span>`:''}</button>`).join('')}</div></fieldset>`;
}
function coverageNote(id,key,interactive=false) {
 const station=game.stations.find(s=>String(s.id)===String(id));if(!station)return '';
 const cargo=stationCoverage(game,station)[key];
 const badge=key=>interactive&&Object.hasOwn(CARGO,key)&&editCargo(key)?`<button type="button" class="coverage-pick" data-cargo-pick="${key}" title="Carry ${escapeHTML(CARGO[key].name.toLowerCase())}">${cargoBadge(key)}</button>`:cargoBadge(key);
 return `<div class="coverage-note"><strong>${key==='produces'?'Loads':'Accepts'}</strong><span class="coverage-cargo">${cargo.length?cargo.map(badge).join(''):'No cargo nearby'}</span></div>`;
}
function routeForm() {
 const editing=editingRoute(),stations=game.stations.filter(s=>s.mode===formDraft.mode),purchase=getVehiclePurchase(game,formDraft.mode);
 // Older saves can hold two stops of one name; their tiles tell them apart.
 const named=new Map();for(const s of stations)named.set(s.name,(named.get(s.name)||0)+1);
 const opts=(current)=>'<option value="">Choose a stop…</option>'+stations.map(s=>`<option value="${s.id}" ${String(s.id)===String(current)?'selected':''}>${escapeHTML(named.get(s.name)>1?`${s.name} · ${s.x}, ${s.y}`:s.name)}</option>`).join('');
 const plan=draftPlan(),options=formDraft.from&&formDraft.to?routeCargoOptions(game,formDraft):[];
 const stopField=(key,label,coverage)=>`<div class="route-stop-field"><div class="route-stop-label"><span>${label}</span><button type="button" data-pick-route="${key}" aria-pressed="${routePicking===key}" aria-label="Select ${key==='from'?'start':'end'} stop on map">${icon('focus')} Pick on map</button></div><label class="form-field"><span class="sr-only">${label} stop</span><select name="${key}" required>${opts(formDraft[key])}</select></label>${coverageNote(formDraft[key],coverage,true)}</div>`;
 const swap=`<div class="route-swap"><button type="button" id="swap-route-stops" aria-label="Swap start and end" title="Swap start and end" ${formDraft.from||formDraft.to?'':'disabled'}>${icon('swap')}</button></div>`;
 return `<details id="route-planner" class="route-planner" ${routePicking||formDraft.open!==false||!game.routes.length?'open':''}><summary>${icon(editing?'pencil':'route')}<h3>${editing?'Edit route':'New route'}</h3></summary><form id="route-form" class="panel-form">${editing?editNote(editing):`<p class="form-note">Pick a start, then an end. We’ll check the connection and suggest cargo.</p><label class="form-field"><span>Name (optional)</span><input name="name" maxlength="36" placeholder="${escapeHTML(defaultRouteName(game,plan,formDraft.cargo)||'Route name')}" value="${escapeHTML(formDraft.name)}"></label>`}<label class="form-field"><span>Transport</span><select name="mode" ${editing?'disabled':''}><option value="road" ${formDraft.mode==='road'?'selected':''}>Road · bus / truck</option><option value="rail" ${formDraft.mode==='rail'?'selected':''}>Rail · train</option><option value="water" ${formDraft.mode==='water'?'selected':''}>Water · ship / ferry</option></select></label>${formDraft.mode==='water'?'<p class="form-note">Ports need connected water. Ships pass beneath bridges.</p>':''}${stopField('from','Start','produces')}${swap}${stopField('to','End','accepts')}${cargoChoices(options)}<div id="route-connection" class="route-connection" role="status" aria-live="polite" data-state="${plan.state}" data-valid="${plan.valid}" data-message="${escapeHTML(routePlanText(plan))}">${routePlanMessage(plan)}</div>${routeForecast(plan)}${editing?'':`<div class="purchase-vehicle"><canvas width="80" height="64" data-vehicle-sprite="purchase" data-mode="${formDraft.mode}" data-cargo="${formDraft.cargo}" data-level="${purchase.level}" aria-hidden="true"></canvas><div class="form-summary"><span id="vehicle-purchase-spec">Gen ${purchase.level+1} · ${purchase.capacity} units</span><strong id="vehicle-purchase-price">${money(purchase.cost)}</strong></div></div>`}<div id="route-launch" class="route-launch" data-existing="${escapeHTML(plan.existingRouteId||'')}">${launchButtons(plan)}</div>${editing?'':'<p class="form-note">Route earnings must cover daily upkeep. Upgrade only when demand needs more capacity.</p>'}</form></details>`;
}
function routesPanel() {
 const options=(entries,current)=>entries.map(([key,label])=>`<option value="${key}" ${key===current?'selected':''}>${escapeHTML(label)}</option>`).join('');
 const routes=filterRoutes(game,routeFilters);
 return `<div class="panel-heading"><h2>Routes</h2><button class="small-button" id="new-route-button">+ New route</button></div>${routeForm()}${fleetControls()}<div class="route-filters"><label class="route-search-field"><span class="sr-only">Search routes</span><input id="route-search" type="search" placeholder="Search routes, stops or cargo" aria-label="Search routes, stops or cargo" value="${escapeHTML(routeFilters.query)}"></label><label><span>Transport</span><select id="route-filter-mode">${options([['all','All transport'],['road','Road'],['rail','Rail'],['water','Water · ships']],routeFilters.mode)}</select></label><label><span>Status</span><select id="route-filter-status">${options([['all','All statuses'],['running','Connected'],['disconnected','Disconnected'],['attention','Needs attention']],routeFilters.status)}</select></label><label class="route-cargo-filter"><span class="sr-only">Filter routes by cargo</span><select id="route-filter-cargo" aria-label="Filter routes by cargo">${options([['all','All cargo'],...Object.entries(CARGO).map(([key,cargo])=>[key,cargo.name])],routeFilters.cargo)}</select></label></div><div class="route-list-heading"><span id="route-results-count" role="status">${routes.length} of ${game.routes.length} routes</span><button class="small-button" id="clear-route-filters">Clear filters</button></div><div id="route-list">${routePageCards(routes)}</div>`;
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
// A card keeps three actions: Show, Edit and Retire. Its vehicle row offers an upgrade while a newer model exists.
function routeCards(routes) {
 const stopsById=new Map(game.stations.map(stop=>[stop.id,stop]));
 return routes.length?routes.map(route=>{
 const from=stopsById.get(route.stops[0]),to=stopsById.get(route.stops[1]),health=routeHealth(game,route,getRouteFleet(game,route.id)),rate=routeRate(route),profit=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0);
 const upgrade=getVehicleUpgrade(game,route.id);
 return `<article class="route-card" data-route-id="${route.id}"><div class="route-header"><span class="route-dot" style="background:${escapeHTML(route.color||'#d9965c')}"></span><strong><span>${escapeHTML(route.name)}</span>${renameButton('route',route.id)}</strong><span data-route-status="${route.id}">${escapeHTML(health.label)}</span></div><div class="route-journey">${escapeHTML(from?.name||'Removed stop')}${icon('arrow')}${escapeHTML(to?.name||'Removed stop')}</div><div class="route-stats"><span class="route-mode-icon" title="${transportName(route.mode)}"><canvas width="80" height="64" data-vehicle-sprite="${route.id}" aria-hidden="true"></canvas><span class="sr-only">${transportName(route.mode)}</span></span>${cargoBadge(route.cargo,{label:true})}<span data-route-stat="${route.id}">${integer(route.delivered)} moved</span></div><div class="route-earnings"><span>Net earned</span><strong data-route-revenue="${route.id}" title="Revenue minus route upkeep; excludes construction.">${profit<0?'−':''}${money(profit)}</strong><span class="route-rate" data-route-rate="${route.id}" title="${escapeHTML(rate.title)}">${rate.text}</span></div><div class="route-condition"><span class="route-waiting" data-route-waiting="${route.id}" data-state="${health.state}">${waitingText(health)}</span><p class="route-health" data-route-health="${route.id}" data-state="${health.state}" title="${escapeHTML(health.detail)}">${escapeHTML(health.detail)}</p></div><div class="route-vehicle-spec">${fleetStepper(route)}${upgrade.available?upgradeButton(route,upgrade):`<span class="route-model" title="${escapeHTML(upgradeTitle(upgrade))}">Latest model</span>`}</div><div class="route-actions"><button class="small-button" data-focus-route="${route.id}">Show</button><button class="small-button" data-edit-route="${route.id}">Edit</button><button class="small-button danger" data-remove-route="${route.id}">Retire</button></div></article>`;}).join(''):`<div class="empty-state">${icon('route')}${game.routes.length?'No routes match these filters.':'Connect two stops to start.'}</div>`;
}
const fleetNoun = (route,count) => { const noun=vehicleNoun(route.mode,route.cargo);return count===1?noun:noun==='bus'?'buses':noun+'s'; };
function vehicleSpec(route) { const fleet=getRouteFleet(game,route.id);return {text:`${fleet.count} ${fleetNoun(route,fleet.count)} · ${integer(fleet.load)} / ${integer(fleet.capacity)} loaded`,title:`${integer(fleet.capacity)} units · Gen ${fleet.minLevel+1}${fleet.maxLevel>fleet.minLevel?'–'+(fleet.maxLevel+1):''}`}; }
// One vehicle more or fewer on the same service; each button explains why it is unavailable.
function fleetOrder(route) {
 const fleet=getRouteFleet(game,route.id),purchase=getVehiclePurchase(game,route.mode),noun=vehicleNoun(route.mode,route.cargo);
 const problem=!route.active?'Repair the connection before adding vehicles.':game.vehicles.length>=MAX_VEHICLES?'Your fleet has reached 10,000 vehicles.':game.money<purchase.cost?`Need ${money(purchase.cost)} to buy another ${noun}.`:'';
 return {noun,add:{label:`+ ${noun[0].toUpperCase()+noun.slice(1)} · ${compactMoney(purchase.cost)}`,planner:`+ Add a ${noun} to it · ${compactMoney(purchase.cost)}`,title:problem||`Buy another ${noun} · Gen ${purchase.level+1} · ${purchase.capacity} units`,disabled:Boolean(problem)},sell:{title:fleet.count>1?`Sell one · +${money(fleet.sellRefund)}`:'Retire the route to sell its last vehicle',disabled:fleet.count<2}};
}
function fleetStepper(route) {
 const order=fleetOrder(route),spec=vehicleSpec(route),id=escapeHTML(route.id);
 return `<span data-vehicle-spec="${id}" title="${escapeHTML(spec.title)}">${escapeHTML(spec.text)}</span><span class="fleet-stepper"><button class="small-button" data-sell-vehicle="${id}" aria-label="Sell one ${order.noun}" title="${escapeHTML(order.sell.title)}" ${order.sell.disabled?'disabled':''}>−</button><button class="small-button" data-add-vehicle="${id}" title="${escapeHTML(order.add.title)}" ${order.add.disabled?'disabled':''}>${escapeHTML(order.add.label)}</button></span>`;
}
const waitingText = health => health.waiting>0?'Waiting '+integer(health.waiting):'';
function routeRate(route) {
 const contract=contractRate(route);if(contract)return contract;
 const net=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0),months=(game.day-(route.accountingStartDay||0))/30.44;
 return {text:months<1?'—':`≈ ${net<0?'−':''}${compactMoney(Math.abs(net)/months)} / month`,title:'Average since '+dayText(route.accountingStartDay||0)};
}
function changeFleet(routeId,add) {
 const attribute=add?'data-add-vehicle':'data-sell-vehicle',restoreFocus=document.activeElement?.matches(`[${attribute}]`);
 const result=add?addRouteVehicle(game,routeId):sellRouteVehicle(game,routeId);
 toast(result.message,!result.ok);
 if(result.ok){refreshRouteList();updateHud();persist();}
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===routeId);
 if(restoreFocus)(card?.querySelector(`[${attribute}]:not(:disabled)`)||card?.querySelector('[data-add-vehicle]:not(:disabled),[data-focus-route]'))?.focus({preventScroll:true});
}
function upgradeTitle(quote) {
 return quote.available?`${quote.capacity} → ${quote.nextCapacity} capacity · ${quote.speedMultiplier.toFixed(1)}× → ${quote.nextSpeedMultiplier.toFixed(1)}× speed${quote.affordable?'':' · More funds needed'}`:`Next vehicle model: January ${1951+quote.targetLevel}`;
}
function upgradeButton(route,quote=getVehicleUpgrade(game,route.id)) {
 return `<button class="small-button route-upgrade-button" data-upgrade-route="${escapeHTML(route.id)}" title="${escapeHTML(upgradeTitle(quote))}" ${quote.available&&quote.affordable?'':'disabled'}>${quote.available?'Upgrade · '+compactMoney(quote.cost):'Latest model'}</button>`;
}
function fleetControls() {
 const quote=getFleetUpgrade(game);
 return `<div class="fleet-upgrades"><div class="fleet-upgrade-heading"><strong>Fleet upgrades</strong><small id="fleet-upgrade-note">${quote.available?quote.count+' vehicles ready':'Next: Jan '+(1951+quote.targetLevel)}</small></div><button id="upgrade-fleet" ${quote.available&&quote.affordable?'':'disabled'} title="Upgrade every eligible route to the latest available vehicle">${quote.available?'Upgrade all · '+money(quote.cost):'Fleet up to date'}</button></div>${contractOffers()}`;
}
function refreshUpgradeControls() {
 const fleetButton=$('#upgrade-fleet');if(!fleetButton)return;
 refreshContracts();
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
 const routesById=new Map(game.routes.map(route=>[String(route.id),route]));
 $$('[data-vehicle-spec]').forEach(el=>{const route=routesById.get(el.dataset.vehicleSpec);if(!route)return;const spec=vehicleSpec(route);if(el.textContent!==spec.text)el.textContent=spec.text;el.title=spec.title;});
 $$('[data-add-vehicle],[data-sell-vehicle]').forEach(button=>{const add=button.hasAttribute('data-add-vehicle'),route=routesById.get(add?button.dataset.addVehicle:button.dataset.sellVehicle);if(!route)return;const order=fleetOrder(route)[add?'add':'sell'];button.disabled=order.disabled;button.title=order.title;if(add&&button.textContent!==order.label)button.textContent=order.label;});
 const purchase=getVehiclePurchase(game,formDraft.mode);
 if($('#vehicle-purchase-price'))$('#vehicle-purchase-price').textContent=money(purchase.cost);
 if($('#vehicle-purchase-spec'))$('#vehicle-purchase-spec').textContent=`Gen ${purchase.level+1} · ${purchase.capacity} units`;
 const portrait=$('[data-vehicle-sprite="purchase"]');if(portrait){Object.assign(portrait.dataset,{mode:formDraft.mode,cargo:formDraft.cargo,level:String(purchase.level)});drawPaletteSprites($('#route-form'));}
}
// Contract offers stay folded below Fleet upgrades. Nothing here is required: offers appear and lapse
// quietly, and only a win and a finished contract are announced.
let contractsOpen=false,contractSeen=null;
const contractNames=new WeakMap();
const monthYear = monthText;
const contractFactor = contract => (1+contract.multiplier).toFixed(1)+'×';
function contractPair(contract) {
 let names=contractNames.get(contract);if(names)return names;
 const sites=contractSites(game,contract);if(!sites)return null;
 const place=(site,point)=>{if(!INDUSTRIES[site.kind])return site.name;const town=game.cities.reduce((best,c)=>!best||Math.hypot(c.x-point.x,c.y-point.y)<Math.hypot(best.x-point.x,best.y-point.y)?c:best,null);return (site.name||INDUSTRIES[site.kind].name)+(town?' near '+town.name:'');};
 names={from:place(sites.source,sites.from),to:place(sites.target,sites.to)};contractNames.set(contract,names);return names;
}
// What the route nets a month without the bonus: its net since launch, less the extra the contract paid.
function normalRate(route,contract) { const net=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0)-contract.earned,months=(game.day-(route.accountingStartDay||0))/30.44;return months<1?'':`≈ ${net<0?'−':''}${compactMoney(Math.abs(net)/months)}`; }
// The card keeps one line: base and bonus side by side, the end date and the pair in its title.
function contractRate(route) {
 const contract=game.contracts?.find(c=>c.routeId===route.id&&contractState(game,c)==='active'),names=contract&&contractPair(contract);if(!names)return null;
 const normal=normalRate(route,contract),bonus=compactMoney(contract.earned/Math.max(1,(game.day-contract.awardedDay)/30.44));
 return {text:normal?`${normal} + ${bonus} bonus`:`+${bonus} bonus`,title:`${normal?`Normal fares ${normal} / month · `:''}Contract bonus ≈ ${bonus} / month until ${monthYear(contract.until)} · ${contractFactor(contract)} fares from ${names.from} to ${names.to} · +${money(contract.earned)} extra so far`};
}
function markContractRoutes(root) {
 const awarded=new Set((game.contracts||[]).filter(c=>c.routeId!==undefined&&contractState(game,c)==='active').map(c=>String(c.routeId)));
 root.querySelectorAll('[data-route-rate]').forEach(el=>el.toggleAttribute('data-contract',awarded.has(el.dataset.routeRate)));
}
function contractRows() {
 const rows=[];let offers=0,active=0;
 for(const contract of game.contracts||[]){
  const state=contractState(game,contract),names=state==='expired'?null:contractPair(contract);if(!names)continue;
  const route=game.routes.find(r=>r.id===contract.routeId),normal=route?normalRate(route,contract):'';
  const detail=state==='offer'?`${contract.distance} tiles · ${contractFactor(contract)} fares for 12 months · open until ${monthYear(contract.expiresDay)}`:state==='active'?`Won by ${route.name} · ${contractFactor(contract)} fares until ${monthYear(contract.until)}${normal?` · normal fares ${normal} / month afterwards`:''}`:`Completed on ${route.name} · earned +${money(contract.earned)} extra`;
  if(state==='offer')offers++;else if(state==='active')active++;
  rows.push(`<li class="contract-row" data-state="${state}">${cargoBadge(contract.cargo)}<div><strong>${escapeHTML(names.from)}</strong><span class="contract-to">${icon('arrow')}${escapeHTML(names.to)}</span><small>${escapeHTML(detail)}</small></div><button class="small-button" data-show-contract="${escapeHTML(contract.id)}">Show</button></li>`);
 }
 return {offers,active,html:rows.join('')};
}
function contractOffers() {
 const {offers,active,html}=contractRows();
 return `<details id="contract-offers" class="contract-offers" ${contractsOpen?'open':''} ${html?'':'hidden'}><summary><strong>Contract offers · <span data-contract-count>${offers}</span></strong><small data-contract-active>${active?active+' active':''}</small></summary><div class="contract-body"><p class="contract-note">Serve a pair with any route for 12 months of bonus fares. Optional; unclaimed offers lapse.</p><ul class="contract-list">${html}</ul></div></details>`;
}
function refreshContracts() {
 const box=$('#contract-offers');if(!box)return;
 const {offers,active,html}=contractRows(),list=box.querySelector('.contract-list');
 box.hidden=!html;box.querySelector('[data-contract-count]').textContent=offers;box.querySelector('[data-contract-active]').textContent=active?active+' active':'';
 if(list.dataset.html!==html){const focused=list.contains(document.activeElement)?document.activeElement.dataset.showContract:null;list.innerHTML=html;list.dataset.html=html;if(focused)list.querySelector(`[data-show-contract="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});}
 markContractRoutes(document);
}
// Show frames the producer and the buyer together in the map the inspector leaves free and selects
// the producer; on a phone, where the inspector would cover both, it only frames them.
function showContract(id) {
 const contract=game.contracts?.find(c=>c.id===id),sites=contract&&contractSites(game,contract);if(!sites)return;
 const {from,to,source}=sites,width=(Math.abs((from.x-from.y)-(to.x-to.y))+6)*TILE,height=(Math.abs((from.x+from.y)-(to.x+to.y))+6)*TILE/2+48;
 setTool('inspect');closeModal();if(window.innerWidth>700)inspect(source.x,source.y,'industry');
 const map=canvas.getBoundingClientRect(),card=$('#inspector').hidden?null:$('#inspector').getBoundingClientRect(),left=card&&card.right<map.left+map.width/2?card.right-map.left:0;
 renderer.setZoom(Math.max(ZOOM_LEVELS[0],...ZOOM_LEVELS.filter(zoom=>width*zoom<=(map.width-left)*.85&&height*zoom<=map.height*.8)));renderer.focus((from.x+to.x)/2,(from.y+to.y)/2);if(left)renderer.pan(left/2,0);
 updateHud();
}
$('#panel-content').addEventListener('click',e=>{const button=e.target.closest?.('[data-show-contract]');if(button)showContract(button.dataset.showContract);});
$('#panel-content').addEventListener('toggle',e=>{if(e.target.id==='contract-offers')contractsOpen=e.target.open;},true);
// A win and a finished contract are the only contract moments.
function watchContracts() {
 const states=new Map((game.contracts||[]).map(contract=>[contract.id,contractState(game,contract)]));
 if(contractSeen?.game===game)for(const contract of game.contracts||[]){
  const was=contractSeen.states.get(contract.id),state=states.get(contract.id),route=state!==was&&game.routes.find(r=>r.id===contract.routeId);if(!route)continue;
  if(state==='active')noticeQueue.push({message:`Contract won · ${contractFactor(contract)} fares on ${route.name} until ${monthYear(contract.until)}`,type:'milestone',targets:[{kind:'route',id:route.id}]});
  else if(state==='complete'&&was==='active')noticeQueue.push({message:`Contract on ${route.name} completed · earned +${money(contract.earned)} extra. Normal fares continue.`,type:'ok',targets:[{kind:'route',id:route.id}]});
 }
 contractSeen={game,states};
}
function performUpgrade(routeId) {
 const restoreFocus=document.activeElement?.matches('[data-upgrade-route],#upgrade-fleet');
 const result=routeId?upgradeRouteVehicle(game,routeId):upgradeFleet(game);
 toast(result.message,!result.ok);
 if(result.ok){refreshRouteList();updateHud();persist();if(restoreFocus){const target=routeId?$$('[data-focus-route]').find(button=>button.dataset.focusRoute===routeId):$('#new-route-button');target?.focus({preventScroll:true});}}
}
// A route on the same stops and cargo takes another vehicle; a separate service stays possible.
function launchButtons(plan) {
 if(editingRoute())return `<button class="button button-primary full" type="submit" ${plan.valid&&editChanges(plan)?'':'disabled'}>Save changes</button><button class="route-edit-cancel" type="button" id="cancel-route-edit">Cancel</button>`;
 const existing=plan.existingRouteId?game.routes.find(route=>route.id===plan.existingRouteId):null;
 if(!existing)return `<button class="button button-primary full" type="submit" ${plan.valid?'':'disabled'}>${icon(transportIcon(formDraft.mode))} Launch route</button>`;
 const order=fleetOrder(existing);
 return `<button class="button button-primary full" type="button" id="add-route-vehicle" data-route="${escapeHTML(existing.id)}" title="${escapeHTML(order.add.title)}" ${order.add.disabled?'disabled':''}>${escapeHTML(order.add.planner)}</button><button class="button button-outline full route-separate" type="submit" ${plan.valid?'':'disabled'}>Launch separate service</button>`;
}
function addFromPlanner(routeId) {
 const result=addRouteVehicle(game,routeId);toast(result.message,!result.ok);
 if(result.ok){cancelRoutePicking();formDraft.name='';formDraft.autoNote='';formDraft.open=false;renderPanel();updateHud();persist();flashRoute(routeId);}
}
// Edit reuses the planner for one route: its transport stays, nothing is bought or sold, and buses never turn into trucks.
const editingRoute = () => formDraft.editing?game.routes.find(route=>route.id===formDraft.editing)||null:null;
const editCargo = cargo => { const route=editingRoute();return !route||(cargo==='passengers')===(route.cargo==='passengers'); };
const draftPlan = () => validateRoutePlan(game,formDraft,{ignoreFunds:Boolean(editingRoute())});
function editChanges(plan) { const route=editingRoute(),[a,b]=plan.reversed?[...plan.stations].reverse():plan.stations;return !route||a?.id!==route.stops[0]||b?.id!==route.stops[1]||formDraft.cargo!==route.cargo; }
function editNote(route) { const count=getRouteFleet(game,route.id).count;return `<p class="form-note route-edit-note"><strong>${escapeHTML(route.name)}</strong> keeps its ${count===1?fleetNoun(route,1):count+' '+fleetNoun(route,count)}. Change the stops${route.cargo==='passengers'?'':' or the freight'}; nothing is bought or sold.</p>`; }
function startRouteEdit(id,keyboard) {
 const route=game.routes.find(r=>r.id===id);if(!route)return;
 cancelRoutePicking();formDraft={editing:route.id,name:'',mode:route.mode,from:String(route.stops[0]),to:String(route.stops[1]),cargo:route.cargo,open:true,autoKey:`${route.stops[0]}|${route.stops[1]}|${route.mode}`};
 setView('routes');$('#route-planner')?.scrollIntoView({block:'start',behavior:'smooth'});if(keyboard)$('#route-form [name=from]')?.focus({preventScroll:true});
}
function leaveRouteEdit(open=false) { formDraft={name:'',mode:'road',from:'',to:'',cargo:'passengers',open}; }
function cancelRouteEdit() {
 const id=formDraft.editing;cancelRoutePicking();leaveRouteEdit();renderPanel();
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===id);if(card)revealInPanel(card,card.querySelector('[data-edit-route]'));
}
// A new freight leaves the old load behind, so a loaded fleet asks first.
function saveRouteEdit(plan) {
 const route=editingRoute(),aboard=formDraft.cargo!==route.cargo?getRouteFleet(game,route.id).load:0;
 if(!aboard)return commitRouteEdit(route,plan);
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><span class="eyebrow">Network</span><h2>Change the freight?</h2><p>${integer(aboard)} ${aboard===1?'unit':'units'} of ${escapeHTML(CARGO[route.cargo].name.toLowerCase())} aboard will be discarded. ${escapeHTML(route.name)} then carries ${escapeHTML(CARGO[formDraft.cargo].name.toLowerCase())}.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="modal-actions"><button class="button button-outline" data-close>Keep editing</button><button class="button button-orange" id="confirm-route-edit">Discard and save</button></div></div>`);
 $('#confirm-route-edit').addEventListener('click',()=>{closeModal();commitRouteEdit(route,plan);});
}
// A route still called by its stops follows them; a name the player chose stays.
function commitRouteEdit(route,plan) {
 const before=validateRoutePlan(game,{mode:route.mode,from:route.stops[0],to:route.stops[1],cargo:route.cargo},{ignoreFunds:true}),named=route.name!==defaultRouteName(game,before,route.cargo),name=defaultRouteName(game,plan,formDraft.cargo);
 const [a,b]=plan.stations,result=editRoute(game,route.id,{stops:[a.id,b.id],cargo:formDraft.cargo});
 if(result.ok&&!named&&name&&name!==route.name)renameRoute(game,route.id,name);
 toast(result.message,!result.ok);
 if(result.ok){cancelRoutePicking();leaveRouteEdit();renderPanel();updateHud();persist();flashRoute(route.id);}
}
function routePlanText(plan) { const existing=plan.existingRouteId&&plan.existingRouteId!==formDraft.editing&&game.routes.find(route=>route.id===plan.existingRouteId),message=existing?`Already served by ${existing.name}`:plan.message;return formDraft.autoNote?`${message.replace(/\.$/,'')} · ${formDraft.autoNote}`:message; }
function routePlanMessage(plan) { return icon(plan.valid?'check':plan.state==='missing'?'route':'warning')+`<span>${escapeHTML(routePlanText(plan))}</span>`; }
// One line of outlook under the status; supply, throughput and hints stay folded in Forecast details.
const forecastDetailsOpen = () => { try { return localStorage.getItem('transport-forecast-details')==='open'; } catch { return false; } };
const perDay = n => (n<9.95?Math.round(n*10)/10:Math.round(n)).toLocaleString('en-US');
function routeOutlook(plan) {
 const f=!editingRoute()&&forecastRoute(game,formDraft,plan);if(!f)return null;
 const noun=vehicleNoun(formDraft.mode,formDraft.cargo),months=Math.max(1,Math.round(f.paybackMonths)),room=f.vehiclesToSaturate-1,rail=f.otherModes.find(other=>other.mode==='rail');
 const summary=f.netMonth>0?`≈ +${compactMoney(f.netMonth)} / month · pays back in about ${months<24?`${months}\u00a0month${months===1?'':'s'}`:`${Math.round(months/12)}\u00a0years`}`:'Likely to earn less than its upkeep';
 const shared=f.madeDay-f.supplyDay>.05,plural=noun==='bus'?'buses':noun+'s';
 const facts=[`${formDraft.cargo==='passengers'?'Towns send':'Source makes'} ≈ ${perDay(f.madeDay)} / day${shared?f.supplyDay>0?` · ≈ ${perDay(f.supplyDay)} spare`:' · all taken':formDraft.cargo==='passengers'?'':' once served'}`,`One ${noun} carries ≈ ${perDay(f.perVehicleDay)} / day`,f.supplyDay<=0?'':room>0?`Room for ≈ ${room} more ${room===1?noun:plural}`:`One ${noun} carries all of it`,`Full load ≈ ${money(f.fullLoad)}`].filter(Boolean);
 if(formDraft.mode==='road'&&room>0&&rail?.ratio>=1.5)facts.push(`A train would carry ≈ ${Math.round(rail.ratio)}× per vehicle`);
 return {outlook:f.netMonth>0?'gain':'loss',summary,facts:facts.map(fact=>`<li>${escapeHTML(fact)}</li>`).join('')};
}
function routeForecast(plan) {
 const outlook=routeOutlook(plan);
 return `<div id="route-forecast" class="route-forecast" data-outlook="${outlook?.outlook||''}" data-shown="${escapeHTML(outlook?outlook.summary+outlook.facts:'')}" ${outlook?'':'hidden'}><p class="forecast-summary">${escapeHTML(outlook?.summary||'')}</p><details class="forecast-details" ${forecastDetailsOpen()?'open':''}><summary>Forecast details</summary><ul class="forecast-facts">${outlook?.facts||''}</ul></details></div>`;
}
function refreshRoutePlan() {
 const status=$('#route-connection'),form=$('#route-form');if(!status||!form)return;
 const plan=draftPlan(),text=routePlanText(plan),name=form.querySelector('[name=name]'),placeholder=defaultRouteName(game,plan,formDraft.cargo)||'Route name';
 if(status.dataset.message!==text){status.innerHTML=routePlanMessage(plan);status.dataset.message=text;}
 if(name&&name.placeholder!==placeholder)name.placeholder=placeholder;
 const launch=$('#route-launch'),existing=plan.existingRouteId||'';
 if(launch&&launch.dataset.existing!==existing){launch.innerHTML=launchButtons(plan);launch.dataset.existing=existing;}
 status.dataset.state=plan.state;status.dataset.valid=String(plan.valid);form.querySelector('[type=submit]').disabled=!plan.valid||!editChanges(plan);
 const forecast=$('#route-forecast'),outlook=routeOutlook(plan),shown=outlook?outlook.summary+outlook.facts:'';
 if(forecast&&forecast.dataset.shown!==shown){forecast.hidden=!outlook;forecast.dataset.outlook=outlook?.outlook||'';forecast.dataset.shown=shown;if(outlook){forecast.querySelector('.forecast-summary').textContent=outlook.summary;forecast.querySelector('.forecast-facts').innerHTML=outlook.facts;}}
 const add=$('#add-route-vehicle'),route=add&&game.routes.find(r=>r.id===add.dataset.route);
 if(route){const order=fleetOrder(route).add;add.disabled=order.disabled;add.title=order.title;if(add.textContent!==order.planner)add.textContent=order.planner;}
}
// Suggest cargo once per change of stops or transport. A cargo that still fits is never replaced.
function autoSelectCargo() {
 const key=`${formDraft.from}|${formDraft.to}|${formDraft.mode}`;if(formDraft.autoKey===key)return;formDraft.autoKey=key;
 const stops=[formDraft.from,formDraft.to].map(id=>id?game.stations.find(s=>String(s.id)===String(id)):null);if(!stops[0]){formDraft.autoNote='';return;}
 const options=stops[1]?routeCargoOptions(game,formDraft).filter(option=>editCargo(option.cargo)):[];let next='';
 if(options.length)next=options[0].valid&&!options.some(option=>option.valid&&option.cargo===formDraft.cargo)?options[0].cargo:'';
 else if(!stops.some(stop=>stop&&stationCoverage(game,stop).produces.includes(formDraft.cargo)))next=stationCoverage(game,stops[0]).produces.find(cargo=>cargo!=='passengers'&&routeCargoList(game).includes(cargo))||'';
 if(next&&next!==formDraft.cargo&&editCargo(next)){formDraft.cargo=next;formDraft.autoNote=`Cargo set to ${CARGO[next].name}`;}
 if(cargoLens?.origin==='routes'&&cargoLens.cargo!==formDraft.cargo)setCargoLens(null);
}
function bindRouteCards(root) {
 markContractRoutes(root);
 root.querySelectorAll('[data-route-page]').forEach(button=>button.addEventListener('click',()=>{
  const direction=button.dataset.routePage;routePage+=direction==='next'?1:-1;refreshRouteList();
  $('#route-list').scrollIntoView({block:'start'});
  $(`#route-list [data-route-page="${direction}"]:not(:disabled)`)?.focus({preventScroll:true});
 }));
 root.querySelectorAll('[data-upgrade-route]').forEach(button=>button.addEventListener('click',()=>performUpgrade(button.dataset.upgradeRoute)));
 root.querySelectorAll('[data-focus-route]').forEach(el=>el.addEventListener('click',()=>showRoute(el.dataset.focusRoute)));
 root.querySelectorAll('[data-remove-route]').forEach(el=>el.addEventListener('click',()=>retireRoute(el.dataset.removeRoute)));
 root.querySelectorAll('[data-edit-route]').forEach(el=>el.addEventListener('click',e=>startRouteEdit(el.dataset.editRoute,e.detail===0)));
 root.querySelectorAll('[data-add-vehicle],[data-sell-vehicle]').forEach(button=>button.addEventListener('click',()=>changeFleet(button.dataset.addVehicle||button.dataset.sellVehicle,button.hasAttribute('data-add-vehicle'))));
}
// Show frames the whole route at the closest zoom that fits its projected extent, then highlights it for a moment.
const routeExtents=new WeakMap();
export function showRoute(id) {
 const route=game.routes.find(r=>String(r.id)===String(id));if(!route?.path?.length)return;
 cancelRoutePicking();setMapLayers({routes:true});
 let extent=routeExtents.get(route.path);
 if(!extent){let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;for(const p of route.path){u0=Math.min(u0,p.x-p.y);u1=Math.max(u1,p.x-p.y);v0=Math.min(v0,p.x+p.y);v1=Math.max(v1,p.x+p.y);}extent={u:(u0+u1)/2,v:(v0+v1)/2,width:(u1-u0)*TILE,height:(v1-v0)*TILE/2+48};routeExtents.set(route.path,extent);}
 renderer.setZoom(Math.max(ZOOM_LEVELS[0],...ZOOM_LEVELS.filter(zoom=>extent.width*zoom<=canvas.clientWidth*.8&&extent.height*zoom<=canvas.clientHeight*.8)));renderer.focus((extent.u+extent.v)/2,(extent.v-extent.u)/2);
 highlight={id:route.id,until:performance.now()+4000};closeMobile();updateHud();
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
 cancelConnectionPlan(); // A planned connection is the other pick on the map; the same tool, view and Escape changes end it.
 const wasPicking=Boolean(routePicking);
 routePicking='';canvas.classList.remove('route-picking');$('#route-pick-banner')?.remove();
 $$('[data-pick-route]').forEach(button=>button.setAttribute('aria-pressed','false'));
 if(wasPicking){cancelGesture();$('#status-message').textContent=toolDescription(tool);syncToolControls();}
}
function showRoutePickHint() {
 let banner=$('#route-pick-banner');if(!banner){banner=document.createElement('div');banner.id='route-pick-banner';banner.className='route-pick-banner';banner.setAttribute('role','status');$('.map-section').append(banner);}
 const label=routePicking==='from'?'start':'end',mode=stopName(formDraft.mode),touch=matchMedia('(pointer: coarse)').matches;
 banner.innerHTML=`<div><strong>${touch?'Tap':'Click'} the ${label} ${mode}</strong><span>${touch?'Drag to explore':'Drag to explore · Esc to cancel'}</span></div><button type="button" id="cancel-route-pick">Cancel</button>`;
 $('#cancel-route-pick').onclick=()=>{cancelRoutePicking();setView('routes');};
 $('#status-message').textContent=`${touch?'Tap':'Click'} the ${label} ${mode}.`;canvas.classList.add('route-picking');
}
function beginRoutePicking(key) {
 setTool('inspect');routePicking=key;renderPanel();syncToolControls();showRoutePickHint();closeMobile();canvas.focus({preventScroll:true});
}
function pickRouteStopAt(x,y) {
 if(!routePicking)return false;
 const station=game.stations.find(s=>s.x===x&&s.y===y);
 if(!station){toast(`Choose a ${stopName(formDraft.mode)}.`,true);return true;}
 if(station.mode!==formDraft.mode){toast(`This is a ${stopName(station.mode)}. Choose a ${stopName(formDraft.mode)}.`,true);return true;}
 if(routePicking==='to'&&String(station.id)===String(formDraft.from)){toast('Choose two different stops.',true);return true;}
 if(routePicking==='from'&&String(station.id)===String(formDraft.to))formDraft.to='';
 formDraft[routePicking]=String(station.id);
 if(routePicking==='from'&&!formDraft.to){routePicking='to';renderPanel();showRoutePickHint();}
 else{cancelRoutePicking();setView('routes');$('#route-form [type=submit]')?.scrollIntoView({block:'nearest',behavior:'smooth'});const plan=draftPlan();$('#status-message').textContent=plan.message;}
 return true;
}
// A cargo lens lights the producers and buyers of one freight cargo on the map, minimap and atlas; it is view state and never saved.
// Routes and Industries keep the lens they set while their view stays open; one from Chains stays until the chip's × or Escape.
let cargoLens=null;
function setCargoLens(cargo,origin='') {
 const next=cargo&&cargo!=='passengers'&&CARGO[cargo]?{cargo,origin,game}:null;if(next?.cargo===cargoLens?.cargo&&next?.origin===cargoLens?.origin)return;
 cargoLens=next;renderer.setLens(next?.cargo||null);renderer.drawMinimap($('#minimap'));minimapAt=performance.now();syncLensChip();
}
function dropCargoLens(...origins) { if(origins.includes(cargoLens?.origin))setCargoLens(null); }
function syncLensChip() {
 let chip=$('#cargo-lens-chip');if(!cargoLens){chip?.remove();return;}
 if(!chip){chip=document.createElement('div');chip.id='cargo-lens-chip';chip.className='cargo-lens-chip';chip.setAttribute('role','status');$('.map-bottomline').prepend(chip);}
 const name=escapeHTML(CARGO[cargoLens.cargo].name.toLowerCase());
 chip.innerHTML=`${cargoIcon(cargoLens.cargo,{decorative:true})}<span class="cargo-lens-name">Showing ${name}</span><span class="cargo-lens-dot" aria-hidden="true">·</span><button type="button" aria-label="Stop showing ${name}" title="Stop showing ${name} (Esc)">×</button>`;
 chip.querySelector('button').onclick=()=>{setCargoLens(null);canvas.focus({preventScroll:true});};
}
function entityMatches(entity, query, extra='') {
 const text=[entity.name,extra].join(' ').toLocaleLowerCase();
 return query.toLocaleLowerCase().trim().split(/\s+/).every(word=>text.includes(word));
}
function entityCards() {
 if(view==='towns')return game.cities.filter(city=>entityMatches(city,entityFilters.towns)).map(city=>`<button class="entity-card" data-city="${city.id}"><h3>${escapeHTML(city.name)}${icon('arrowup')}</h3><p>${cargoBadge('passengers',{count:Math.floor(city.population)})} <span>residents</span>${townGrowth(game,city)?.change>0?'<span class="town-tag">Growing</span>':''}</p><div class="entity-metric"><span>Transport</span><span>${townService(game,city).label}</span></div>${townNeedIcons(city)}</button>`).join('');
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
 if($('#industry-kind'))$('#industry-kind').onchange=e=>{entityFilters.kind=e.target.value;refreshEntities();if(e.target.value==='all')dropCargoLens('industry');else setCargoLens(lensCargo(e.target.value),'industry');};
 panel.querySelectorAll('[data-project-action]').forEach(button=>button.onclick=()=>runProjectAction(button.dataset.projectAction,button.dataset.projectTarget,{tool:button.dataset.projectTool}));
 panel.querySelectorAll('[data-goal-show]').forEach(button=>button.onclick=()=>{storeGoalFolded(false);goalOpen=true;if(!mapLayers.goal)setMapLayers({goal:true});if(window.innerWidth<=1100)closeMobile();renderGoal();});
 bindRouteCards(panel);
 if($('#upgrade-fleet'))$('#upgrade-fleet').onclick=()=>performUpgrade();
 if($('#route-search'))$('#route-search').addEventListener('input',e=>{routeFilters.query=e.target.value;routePage=0;refreshRouteList();});
 for(const key of ['mode','status','cargo'])if($(`#route-filter-${key}`))$(`#route-filter-${key}`).addEventListener('change',e=>{routeFilters[key]=e.target.value;routePage=0;refreshRouteList();});
 if($('#clear-route-filters'))$('#clear-route-filters').onclick=()=>{routePage=0;routeFilters={query:'',mode:'all',status:'all',cargo:'all'};$('#route-search').value='';for(const key of ['mode','status','cargo'])$(`#route-filter-${key}`).value='all';refreshRouteList();};
 if($('#new-route-button'))$('#new-route-button').onclick=()=>{if(formDraft.editing){cancelRoutePicking();leaveRouteEdit(true);renderPanel();}formDraft.open=true;$('#route-planner').open=true;$('#route-planner').scrollIntoView({block:'start',behavior:'smooth'});$('#route-form [name=name]').focus({preventScroll:true});};
 const planner=panel.querySelector('#route-planner');if(planner){planner.querySelector('summary').onclick=()=>{formDraft.open=!planner.open;};planner.addEventListener('toggle',()=>{if(planner.isConnected)formDraft.open=planner.open;});}
 panel.querySelector('.forecast-details')?.addEventListener('toggle',e=>{try{localStorage.setItem('transport-forecast-details',e.currentTarget.open?'open':'closed');}catch{}});
 if(planner){planner.addEventListener('toggle',()=>{if(!planner.open)dropCargoLens('routes');});if(!planner.open)dropCargoLens('routes');}
 if($('#swap-route-stops'))$('#swap-route-stops').onclick=()=>{cancelRoutePicking();[formDraft.from,formDraft.to]=[formDraft.to,formDraft.from];renderPanel();$('#swap-route-stops')?.focus({preventScroll:true});};
 panel.querySelectorAll('[data-pick-route]').forEach(el=>el.addEventListener('click',()=>beginRoutePicking(el.dataset.pickRoute)));
 panel.querySelectorAll('[data-cargo-choice],[data-cargo-pick]').forEach(el=>el.addEventListener('click',()=>{
  formDraft.cargo=el.dataset.cargoChoice||el.dataset.cargoPick;formDraft.autoNote='';$('#route-form select[name=cargo]').value=formDraft.cargo;
  setCargoLens(formDraft.cargo,'routes');
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
   e.preventDefault();const plan=draftPlan();refreshRoutePlan();if(!plan.valid)return toast(plan.message,true);
   if(editingRoute())return saveRouteEdit(plan);
   const [a,b]=plan.stations,result=addRoute(game,{name:formDraft.name.trim()||defaultRouteName(game,plan,formDraft.cargo),mode:formDraft.mode,stops:[a.id,b.id],cargo:formDraft.cargo});
   toast(result.message,!result.ok);if(result.ok){cancelRoutePicking();formDraft.name='';formDraft.autoNote='';formDraft.open=false;renderPanel();updateHud();persist();flashRoute(result.route.id);}
  });
  form.addEventListener('click',e=>{const button=e.target.closest('#add-route-vehicle');if(button)addFromPlanner(button.dataset.route);});
  form.addEventListener('click',e=>{if(e.target.closest('#cancel-route-edit'))cancelRouteEdit();});
 }
}
function retireRoute(routeId) {
 const route=game.routes.find(r=>String(r.id)===routeId);if(!route)return;
 const count=getRouteFleet(game,route.id).count,refund=getRetirementRefund(game,route.id),fleet=count===1?`Its ${fleetNoun(route,1)} sells`:`Its ${count} ${fleetNoun(route,count)} sell`;
 // Retiring the only running service with too little left for a bus would leave the company with nothing to earn from.
 const earning=r=>r.active&&!routeNeedsAttention(game,r),last=earning(route)&&!game.routes.some(r=>r!==route&&earning(r))&&game.money+refund<getVehiclePurchase(game,'road').cost;
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><span class="eyebrow">Network</span><h2>Retire this connection?</h2><p>${escapeHTML(route.name)} will stop carrying ${escapeHTML(CARGO[route.cargo]?.name.toLowerCase())}. ${fleet} for ${money(refund)}; roads, tracks, stops and ports stay in place.</p>${last?'<p class="retire-warning">This is your last earning service. After retiring it you cannot afford a new vehicle without a loan.</p>':''}</div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="modal-actions"><button class="button button-outline" data-close>Keep running</button><button class="button button-orange" id="confirm-retire">Retire · +${money(refund)}</button></div></div>`);
 $('#confirm-retire').addEventListener('click',()=>{const result=removeRoute(game,route.id);closeModal();toast(result.message,!result.ok);renderPanel();updateHud();persist();});
}
// The pencil turns its title into a field. Enter or leaving saves; Escape, an empty field or the same name keeps the old one.
// A focused field holds the inspector's live refresh. The title changes in place, so the click that ended an edit still
// lands; the live refresh redraws the rest, and a stop's new name reaches the Routes panel's selects and journeys at once.
function renameButton(kind,id) { return `<button type="button" class="rename-button" data-rename="${kind}" data-id="${escapeHTML(id)}" aria-label="Rename" title="Rename">${icon('pencil')}</button>`; }
function beginRename(button) {
 const title=button.previousElementSibling,before=title.textContent,{rename:kind,id}=button.dataset,input=document.createElement('input');
 Object.assign(input,{className:'rename-input',maxLength:36,value:before,spellcheck:false});input.setAttribute('aria-label',kind==='route'?'Route name':'Stop name');
 title.replaceChildren(input);button.hidden=true;input.focus();input.select();
 let done=false;
 const finish=(save,keyboard)=>{
  if(done)return;const name=input.value.trim(),result=save&&name!==before&&(name||keyboard)?(kind==='route'?renameRoute:renameStation)(game,id,name):null;
  if(result&&!result.ok&&keyboard){toast(result.message,true);input.select();return;}
  done=true;if(result)toast(result.message,!result.ok);
  title.textContent=result?.ok?name:before;button.hidden=false;if(keyboard)button.focus({preventScroll:true});
  if(!result?.ok)return;
  persist();if(kind==='station'&&view==='routes')renderPanel();
 };
 input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();finish(e.key==='Enter',true);}});
 input.addEventListener('blur',()=>{if(document.hasFocus())finish(true,false);});
}
for(const el of [$('#inspector'),$('#panel-content')])el.addEventListener('click',e=>{const button=e.target.closest('[data-rename]');if(button)beginRename(button);});
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
 const offline=routesNeedingAttention(game),offlineChip=$('#offline-routes');if(offlineChip.dataset.count!==String(offline)){offlineChip.dataset.count=offline;offlineChip.hidden=!offline;offlineChip.innerHTML=icon('warning')+`<b>${offline}</b> <span>${offline===1?'route needs':'routes need'} attention</span>`;offlineChip.setAttribute('aria-label',offlineChip.textContent);offlineChip.title='Show routes that cannot run';}
 const pricing=inflationInfo(game);
 $('#inflation-rate').textContent=pricing.rate?`+${(pricing.rate*100).toFixed(2)}% / year`:'Base prices';
 $('#inflation-rate').title=`Prices are ${((pricing.index-1)*100).toFixed(1)}% above 1950. New inflation rate each January.`;
 if(pricing.year!==pricingYear){if(pricing.year>pricingYear)queueNewYear(pricing);pricingYear=pricing.year;if(view==='routes')refreshRouteList();else if(view==='build'||view==='towns'){if($('#panel-content').contains(document.activeElement)&&document.activeElement.matches('input,select,textarea'))panelPricesStale=true;else renderPanel();}}
 const hudMoney=value=>Math.abs(value)>=(window.innerWidth<=1100?10000:1000000)?'$'+compactText(Math.abs(value)):money(value);
 $('#balance').textContent=(game.money<0?'−':'')+hudMoney(game.money);$('#balance').title=(game.money<0?'−':'')+money(game.money);
 const profit=(game.monthlyIncome||0)-(game.monthlyIncomeAtAccountingStart||0)-(game.monthlyOperatingExpenses||0);$('#profit').textContent=(profit>=0?'+':'−')+hudMoney(profit);$('#profit').title=(profit>=0?'+':'−')+money(profit)+' operating profit this month';$('#profit').className=profit>=0?'positive':'negative';
 const income=game.monthlyIncome||0,rose=incomeSeen.game===game&&income>incomeSeen.income;incomeSeen={game,income};if(rose)incomePulseAt=performance.now();
 $('#profit').classList.toggle('income-pulse',performance.now()-incomePulseAt<600);if(rose)for(const animation of $('#profit').getAnimations?.()||[])animation.currentTime=0;
 $('#balance-exact').textContent=(game.money<0?'−':'')+money(game.money);$('#profit-exact').textContent=(profit>=0?'+':'−')+money(profit);
 $('#income-exact').textContent=money((game.monthlyIncome||0)-(game.monthlyIncomeAtAccountingStart||0));$('#running-exact').textContent=money(game.monthlyOperatingExpenses||0);
 $('#building-exact').textContent=money(Math.max(0,(game.monthlyExpenses||0)-(game.monthlyOperatingExpenses||0)));
 const lastProfit=game.history.at(-1)?.operatingProfit;$('#previous-profit').textContent=Number.isFinite(lastProfit)?(lastProfit>=0?'+':'−')+money(lastProfit):'—';
 const loan=loanTerms(game);$('#loan-row').hidden=$('#interest-row').hidden=!loan.loan;if(loan.loan){$('#loan-exact').textContent=money(loan.loan);$('#interest-exact').textContent=money(loan.monthlyInterest)+' / month';}
 $('#profit-exact').title='Operating figures tracked since '+dayText(game.accountingStartDay||0);
 $('#delivered').innerHTML=integer(game.totalDelivered)+' <small>units</small>';
 const activeStopIds=new Set(game.routes.filter(route=>route.active).flatMap(route=>route.stops));
 const activeStops=game.stations.filter(stop=>activeStopIds.has(stop.id));
 const served=game.cities.filter(city=>townService(game,city,activeStops).connected).length;
 watchTowns(activeStops);
 $('#connected').innerHTML=served+` <small>/ ${game.cities.length}</small>`;$('#route-count').textContent=game.routes.length;
 $('#date').textContent=monthText(game.day);$('#date').title=longDayText(game.day);
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
 const healthByRoute=new Map(),healthOf=r=>{if(!healthByRoute.has(r))healthByRoute.set(r,routeHealth(game,r,loadsByRoute.get(String(r.id))));return healthByRoute.get(r);};
 if(showingRoutes)$$('[data-route-status]').forEach(el=>{const r=routesById?.get(el.dataset.routeStatus);if(r){const health=healthOf(r);el.textContent=health.label;el.classList.toggle('route-offline',health.state==='blocked');el.classList.toggle('route-busy',health.state==='busy');}});
 if(showingRoutes)$$('[data-route-revenue]').forEach(el=>{const r=routesById?.get(el.dataset.routeRevenue);if(r){const net=r.revenue-(r.revenueAtAccountingStart||0)-(r.expenses||0);el.textContent=(net<0?'−':'')+money(net);el.title=`Fares ${money(r.revenue-(r.revenueAtAccountingStart||0))} · Route upkeep ${money(r.expenses||0)} · Tracked since ${dayText(r.accountingStartDay||0)} · Excludes construction`;}});
 if(showingRoutes)$$('[data-route-health]').forEach(el=>{const r=routesById?.get(el.dataset.routeHealth);if(r){const health=healthOf(r);el.textContent=health.detail;el.title=health.detail;el.dataset.state=health.state;}});
 if(showingRoutes)$$('[data-route-stat]').forEach(el=>{const r=routesById?.get(el.dataset.routeStat);if(r)el.textContent=integer(r.delivered)+' moved';});
 if(showingRoutes)$$('[data-route-waiting]').forEach(el=>{const r=routesById?.get(el.dataset.routeWaiting);if(r){const health=healthOf(r),text=waitingText(health);if(el.textContent!==text)el.textContent=text;el.dataset.state=health.state;}});
 if(showingRoutes)$$('[data-route-rate]').forEach(el=>{const r=routesById?.get(el.dataset.routeRate);if(r){const rate=routeRate(r);if(el.textContent!==rate.text)el.textContent=rate.text;el.title=rate.title;}});
 if(showingRoutes){
  refreshRoutePlan();refreshUpgradeControls();
  const filtered=filterRoutes(game,routeFilters),ids=visibleRoutePage(filtered).map(route=>String(route.id));
  $('#route-results-count').textContent=`${filtered.length} of ${game.routes.length} routes`;
  if(ids.join('|')!==$$('#route-list [data-route-id]').map(el=>el.dataset.routeId).join('|'))refreshRouteList();
 }
}
function tileAt(x,y){return x>=0&&y>=0&&x<game.width&&y<game.height?game.tiles[y*game.width+x]:null;}
// Town needs only speed growth up: supplied cargo earns a check, the rest stay plain.
function townNeedsShown() { return game.zones.length>0||game.routes.some(route=>route.cargo!=='passengers'); }
function townNeedList(city) {
 const needs=townNeeds(game,city),fresh=key=>game.day-(city.lastSupply?.[key]??-Infinity)<=NEED_WINDOW;
 return [...new Set(needs.flatMap(need=>need.cargo))].map(key=>({key,met:fresh(key),title:needs.filter(need=>need.cargo.includes(key)).map(need=>need.label).join(' · ')+(fresh(key)?' · delivered recently':'')}));
}
function townNeedsRow(city) {
 if(!townNeedsShown())return '';
 const next=townNeeds(game,city).find(need=>!need.met),names=keys=>keys.map((key,n)=>n?CARGO[key].name.toLowerCase():CARGO[key].name).join(' or ');
 const hint=!next?'Recent deliveries keep its neighborhoods growing quickly.':next.kind==='construction'?`${names(next.cargo)} deliveries speed up construction.`:`${names(next.cargo)} deliveries help ${next.kind==='commercial'?'shops':'homes'} grow into ${next.label.toLowerCase()}.`;
 return `<section class="town-needs" aria-label="Grows faster with"><h4>Grows faster with</h4><div class="need-list">${townNeedList(city).map(need=>`<span class="need-chip" data-met="${need.met}" title="${escapeHTML(need.title)}">${cargoBadge(need.key,{label:true})}${need.met?`${icon('check')}<span class="sr-only">delivered recently</span>`:''}</span>`).join('')}</div><p class="need-hint">${escapeHTML(hint)}</p></section>`;
}
// The list names only what a town has received; its inspector lists the rest.
function townNeedIcons(city) {
 const supplied=city.lastSupply?townNeedList(city).filter(need=>need.met):[];
 return supplied.length?`<div class="entity-metric town-need-metric"><span>Grows faster with</span><span class="need-icons">${supplied.map(need=>`<span class="need-icon" role="img" aria-label="${escapeHTML(CARGO[need.key].name+', delivered recently')}" title="${escapeHTML(CARGO[need.key].name+' · '+need.title)}">${cargoIcon(need.key,{decorative:true})}${icon('check')}</span>`).join('')}</span></div>`:'';
}
// Growth reads the town's monthly counts; room to grow waits in a fold, since towns manage on their own.
let townGrowOpen=false;
function townGrowthLine(outlook) {
 if(outlook.change===null||outlook.days<1)return '';
 return `<p class="town-growth">Growth · ${outlook.change?`${outlook.change>0?'+':'−'}${integer(Math.abs(outlook.change))} residents in ${integer(outlook.days)} ${outlook.days===1?'day':'days'}`:'quiet'}</p>`;
}
function townGrowHelp(outlook) {
 const room=outlook.plots?`${integer(outlook.plots)} free road-side ${outlook.plots===1?'plot':'plots'}`:'no free road-side plots';
 return `<details class="town-grow" ${townGrowOpen?'open':''}><summary>Help it grow</summary><p class="town-room">Room to grow · ${room}</p><p>Served towns extend their own streets over time. Zoning nearby land speeds this up.</p><button class="button button-primary full" id="zone-town">${icon('house')} Add zones</button></details>`;
}
function localConditions(conditions) {
 const positives=conditions.positive.slice(0,3),negatives=conditions.negative.slice(0,2);
 return `<section class="local-conditions" aria-label="Local conditions"><h4>Local conditions</h4><div class="condition-list">${positives.map(text=>`<span class="condition-chip">${icon('check')}${escapeHTML(text)}</span>`).join('')}${(conditions.notes||[]).map(text=>`<span class="condition-chip condition-note">${icon('leaf')}${escapeHTML(text)}</span>`).join('')}${negatives.map(text=>`<span class="condition-chip condition-concern">${icon('warning')}${escapeHTML(text)}</span>`).join('')}</div></section>`;
}
function industryDestinations(industry) {
 const outputs=Object.keys(INDUSTRIES[industry.kind].outputs), targets=findIndustryTargets(game,industry,5);
 const from=servingStops(industry),plans=targets.map(target=>from.length?targetPlan(target,from):'');
 holdContext(industry,targets);
 const uses=outputs.map(cargo=>{
  const consumers=Object.values(INDUSTRIES).filter(d=>d.biomes.includes(game.biome)&&d.inputs[cargo]).map(d=>d.name);
  if(TOWN_CARGO.includes(cargo))consumers.push('Towns');
  return `<div class="industry-use">${cargoBadge(cargo,{label:true})}<span class="cargo-arrow" aria-hidden="true">→</span><span>${escapeHTML(consumers.join(', ')||'No buyers in this region')}</span></div>`;
 }).join('');
 return `<section class="industry-destinations" aria-label="Output destinations"><div class="destination-heading"><h4>Deliver to</h4><button class="small-button" id="industry-chain">${icon('chains')} Full chain</button></div>${uses}<h4>Nearest targets <span>${targets.length}</span></h4><p class="destination-note">Direct distance · transport required</p><div class="industry-target-list">${targets.map((target,index)=>`${plans[index]?'<div class="industry-target-row">':''}<button class="industry-target" data-target-id="${escapeHTML(target.id)}" data-target-kind="${target.kind}" aria-label="Locate ${escapeHTML(target.name)} at ${target.x}, ${target.y}"><span class="target-number">${index+1}</span><span class="target-detail"><strong>${escapeHTML(target.name)}</strong><small>${Math.round(target.distance)} tiles · ${target.x}, ${target.y}</small></span><span class="target-cargo">${target.cargo.map(c=>cargoIcon(c,{decorative:true})).join('')}</span>${icon('focus')}</button>${plans[index]?plans[index]+'</div>':''}`).join('')||'<p class="destination-note">No buyers yet. Open the chain to build one.</p>'}</div></section>`;
}
// An inspected industry keeps its nearest targets for the map, which arcs to each; pointing at or focusing a row picks out its arc.
// The arcs last as long as that selection: another pick, a carrier's card or closing the card hides them.
let selectionContext=null;
function holdContext(industry,targets) {
 const highlight=selectionContext?.industryId===industry.id&&!$('#inspector').hidden?selectionContext.highlight:null;
 selectionContext={selected,industryId:industry.id,targets:targets.map((t,n)=>({x:t.x,y:t.y,kind:t.kind,id:t.id,rank:n+1})),highlight};
}
function pickContext(row) {
 const rank=row&&selectionContext?.targets.find(t=>String(t.id)===row.dataset.targetId&&t.kind===row.dataset.targetKind)?.rank||null;
 if(selectionContext&&selectionContext.highlight!==rank){selectionContext={...selectionContext,highlight:rank};invalidateScene();}
}
// Bubbles of targets out of view stop short of the cards over the map (display pixels), and of the
// management drawer while it is open over the inspector; the drawer repaints them once it has slid.
function contextView() {
 if(!selectionContext||selectionContext.selected!==selected)return null;
 const map=canvas.getBoundingClientRect();
 return {...selectionContext,covers:[$('#inspector'),$('#objective-card'),$('.sidebar.mobile-open')].filter(el=>el&&!el.hidden).map(el=>{const r=el.getBoundingClientRect();return {x:r.left-map.left,y:r.top-map.top,w:r.width,h:r.height};})};
}
$('.sidebar').addEventListener('transitionend',e=>{if(e.target===e.currentTarget&&selectionContext)invalidateScene();});
// The row just pointed at or focused wins; leaving it falls back to the other one.
// A target's Plan button beside its row picks out the same arc.
const targetOf=el=>el?.closest?.('[data-target-id]')||el?.closest?.('.industry-target-row')?.querySelector('[data-target-id]');
const focusedTarget=()=>$('#inspector').contains(document.activeElement)?targetOf(document.activeElement):null,hoveredTarget=()=>targetOf($('#inspector .industry-target-row:hover,#inspector [data-target-id]:hover'));
$('#inspector').addEventListener('mouseover',e=>pickContext(targetOf(e.target)||focusedTarget()));
$('#inspector').addEventListener('mouseleave',()=>pickContext(focusedTarget()));
$('#inspector').addEventListener('focusin',e=>pickContext(targetOf(e.target)||hoveredTarget()));
$('#inspector').addEventListener('focusout',()=>pickContext(hoveredTarget()));
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
// Inspectors name the stops and routes that serve a place; their buttons pre-fill the planner and pick any open end on the map.
const nameList = (names,max=3) => names.length>max?`${names.slice(0,max).join(', ')} and ${names.length-max} more`:names.length>1?`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`:names[0]||'';
const planAttributes = (mode,from,to,cargo,pick='') => `data-plan-mode="${mode}" data-plan-from="${escapeHTML(from)}" data-plan-to="${escapeHTML(to)}" data-plan-cargo="${escapeHTML(cargo)}" data-plan-pick="${pick}"`;
function servingStops(site) {
 const size=INDUSTRIES[site.kind]?industrySize(site):1,reach=stop=>INDUSTRIES[site.kind]?industryDistance(site,stop):Math.hypot(site.x-stop.x,site.y-stop.y);
 return nearbyStations(game,site.x+(size-1)/2,site.y+(size-1)/2,STATION_RADIUS+size).filter(stop=>reach(stop)<=STATION_RADIUS).sort((a,b)=>reach(a)-reach(b));
}
function planRoute(draft,pick='') {
 formDraft={...formDraft,name:'',autoNote:'',open:true,editing:'',...draft};setView('routes');
 if(pick)beginRoutePicking(pick);else $('#route-form')?.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function stationCargoNotes(station) {
 const coverage=stationCoverage(game,station),names=[...coverage.cities.map(city=>city.name),...coverage.industries.map(site=>site.name||INDUSTRIES[site.kind].name)];
 const label=(key,cargo)=>{const name=CARGO[cargo].name.toLowerCase();return key==='produces'?(cargo==='passengers'?'Carry passengers':`Ship ${name}`):cargo==='passengers'?'Bring passengers here':`Deliver ${name} here`;};
 const note=key=>`<div class="coverage-note"><strong>${key==='produces'?'Loads':'Accepts'}</strong><span class="coverage-cargo">${coverage[key].map(cargo=>`<button type="button" class="coverage-pick" ${key==='produces'?planAttributes(station.mode,station.id,'',cargo,'to'):planAttributes(station.mode,'',station.id,cargo,'from')} title="${escapeHTML(label(key,cargo))}" aria-label="${escapeHTML(label(key,cargo))}"><span class="cargo-badge" data-cargo="${cargo}">${cargoIcon(cargo,{decorative:true})}</span></button>`).join('')||'No cargo nearby'}</span></div>`;
 return note('produces')+note('accepts')+(names.length?`<p class="coverage-names">Covers ${escapeHTML(nameList(names,4))}</p>`:'');
}
function stationServices(station) {
 const routes=game.routes.filter(route=>route.stops.includes(station.id));if(!routes.length)return '';
 const rows=routes.slice(0,6).map(route=>{const fleet=getRouteFleet(game,route.id),health=routeHealth(game,route,fleet);return `<button type="button" class="service-row" data-service-route="${escapeHTML(route.id)}" title="Show on the map"><span class="route-dot" style="background:${escapeHTML(route.color||'#d9965c')}"></span><span class="service-detail"><strong>${escapeHTML(route.name)}</strong><small>${fleet.count} ${fleetNoun(route,fleet.count)} · <span data-state="${health.state}">${escapeHTML(health.label)}</span></small></span>${cargoIcon(route.cargo)}${icon('focus')}</button>`;}).join('');
 return `<section class="station-services" aria-label="Services"><h4>Services <span>${routes.length}</span></h4><div class="service-list">${rows}</div>${routes.length>6?`<button type="button" class="service-more" data-service-more="${escapeHTML(station.name)}">and ${routes.length-6} more in Routes</button>`:''}</section>`;
}
// A site's service counts the routes that load its output or bring its inputs at a stop in reach.
function industryService(industry) {
 const d=INDUSTRIES[industry.kind],stops=servingStops(industry),center={x:industry.x+(industrySize(industry)-1)/2,y:industry.y+(industrySize(industry)-1)/2};
 if(!stops.length)return `<section class="industry-service" aria-label="Service"><p class="service-summary">No stop within 5 tiles yet.</p><button type="button" class="button button-outline full" data-place-stop="${center.x},${center.y}">${icon('bus')} Place a stop nearby</button></section>`;
 const ids=new Set(stops.map(stop=>stop.id)),routes=game.routes.filter(route=>(d.outputs[route.cargo]||d.inputs[route.cargo])&&route.stops.some(id=>ids.has(id))).length,start=stops.find(stop=>stop.mode===preferredMode)||stops[0],output=Object.keys(d.outputs)[0];
 return `<section class="industry-service" aria-label="Service"><p class="service-summary">Served by <strong>${escapeHTML(nameList(stops.map(stop=>stop.name),2))}</strong> · ${routes?`${routes} route${routes===1?'':'s'}`:'no route yet'}</p>${output?`<button type="button" class="button button-primary full" ${planAttributes(start.mode,start.id,'',output,'to')}>${icon('route')} Plan route from here</button>`:''}${Object.keys(d.inputs).map(cargo=>`<button type="button" class="small-button industry-supply" ${planAttributes(start.mode,'',start.id,cargo,'from')}>${cargoIcon(cargo,{decorative:true})}Supply ${escapeHTML(CARGO[cargo].name.toLowerCase())}</button>`).join('')}</section>`;
}
// A nearest target offers Plan once stops of one transport already reach both ends.
function targetPlan(target,from) {
 const site=target.kind==='industry'?game.industries.find(i=>i.id===target.id):game.cities.find(city=>city.id===target.id),to=site?servingStops(site):[];
 const pairs=from.flatMap(a=>to.filter(b=>b.mode===a.mode&&b.id!==a.id).map(b=>[a,b])),pair=pairs.find(([a])=>a.mode===preferredMode)||pairs[0];
 return pair?`<button type="button" class="target-plan" ${planAttributes(pair[0].mode,pair[0].id,pair[1].id,target.cargo[0])} aria-label="Plan a route to ${escapeHTML(target.name)}">${icon('route')}Plan</button>`:'';
}
function bindServiceLinks(box) {
 box.querySelectorAll('[data-service-route]').forEach(el=>el.onclick=()=>showRoute(el.dataset.serviceRoute));
 box.querySelectorAll('[data-service-more]').forEach(el=>el.onclick=()=>{routeFilters={query:el.dataset.serviceMore,mode:'all',status:'all',cargo:'all'};routePage=0;setView('routes');});
 box.querySelectorAll('[data-plan-cargo]').forEach(el=>el.onclick=()=>{const plan=el.dataset;planRoute({mode:plan.planMode,from:plan.planFrom,to:plan.planTo,cargo:plan.planCargo},plan.planPick);});
 box.querySelectorAll('[data-place-stop]').forEach(el=>el.onclick=()=>{const [x,y]=el.dataset.placeStop.split(',').map(Number);category='network';setView('build');setTool('stop');renderer.focus(x,y);updateHud();});
}
function networkUse(tile,x,y) {
 const names=routeTileIndex(game).get(y*game.width+x)||[];
 return `<p class="network-use">${names.length?`Used by ${escapeHTML(nameList(names,4))}`:'Not used by any route'}</p><p>${tile.road?tile.publicRoad?'Public road · no upkeep':'Company road':'Company railway'}${tile.road&&tile.rail?' · railway':''}</p>`;
}
// The last generated markup, not box.innerHTML: drawn portraits change their canvas attributes.
let inspectorHTML='', inspectorKey='', panelPress=false, panelReleasedAt=-Infinity;
function inspect(x,y,kind='',origin='') {
 if(selectedVehicle)clearVehicle();
 const site=kind!=='city'?buildingAt(game,x,y):null;if(site){x=site.x;y=site.y;}
 const terrainSite=kind!=='city'&&!site?terrainObjectAt(game,x,y):null,nature=terrainSite?.object.kind==='mountain'?null:terrainSite;if(nature){x=nature.x;y=nature.y;}
 const tile=tileAt(x,y);if(!tile)return;const changed=!selected||selected.x!==x||selected.y!==y||selected.kind!==kind;selected={x,y,kind};
 const station=game.stations.find(s=>s.x===x&&s.y===y),industry=game.industries.find(i=>industryContains(i,x,y)), city=game.cities.find(c=>c.x===x&&c.y===y)||game.cities.find(c=>Math.hypot(c.x-x,c.y-y)<4&&tile.building);
 let title,tag,body;
 if(station&&kind!=='city'&&kind!=='industry'){title=station.name;tag=stopName(station.mode).replace(/^./,c=>c.toUpperCase());body=`${infrastructurePortrait(station.mode==='water'?'port':station.mode==='rail'?'train-stop':'bus-stop','inspector-station-art')}<div class="inspector-grid"><div><small>Network</small><strong>${transportName(station.mode)}</strong></div><div><small>Coverage</small><strong>5 tiles</strong></div></div>${stationCargoNotes(station)}${stationServices(station)}<button class="button button-primary full" id="station-route">${icon('route')} New route</button>`;}
 else if(industry){const d=INDUSTRIES[industry.kind],conditions=industryConditions(game,industry),typical=Object.values(d.outputs).reduce((a,b)=>a+b,0)*(industry.capacity||1)*conditions.productivity;title=industry.name||d.name;tag=`Industry · ${industrySize(industry)} × ${industrySize(industry)} site`;const status=industryStatus(industry,game);body=`<div class="inspector-industry-art">${industryPortrait(industry.kind)}${cargoRecipe(d.inputs,d.outputs)}</div><div class="industry-condition" data-state="${status.state}"><strong>${escapeHTML(status.label)}</strong><p>${escapeHTML(status.detail)}</p></div>${industryService(industry)}${industryDestinations(industry)}<div class="inspector-grid"><div><small>Capacity</small><strong>${Math.round((industry.capacity||1)*100)}%</strong></div><div><small>Storage</small><strong>${Math.round(outputFill(industry)*100)}% full</strong></div><div><small>Potential / day</small><strong>${typical.toLocaleString('en-US',{maximumFractionDigits:1})}</strong></div></div>${localConditions(conditions)}<div class="section-divider"></div><div class="ledger">${Object.entries(industry.inventory||{}).map(([key,n])=>`<div class="ledger-row">${cargoBadge(key,{label:true})}<strong>${integer(n)}</strong></div>`).join('')||'<span class="micro-note">Storage empty</span>'}</div>${industrySize(industry)<industryFootprint(industry.kind)?'<p class="micro-note">Compact legacy site. New construction uses a larger plot.</p>':''}`;}
 else if(kind!=='city'&&tile.building&&BUILDINGS[tile.building.kind]){const b=BUILDINGS[tile.building.kind],span=buildingSize(tile.building);title=b.name;tag=`${span} × ${span} site · ${b.tier?b.tier+' home':BUILDING_GROUPS[b.group].name}`;const nearest=game.cities.reduce((best,c)=>!best||Math.hypot(c.x-x,c.y-y)<Math.hypot(best.x-x,best.y-y)?c:best,null);body=`<div class="inspector-building"><canvas width="96" height="100" data-building-sprite="${tile.building.kind}" aria-hidden="true"></canvas><p>${escapeHTML(b.tier||BUILDING_GROUPS[b.group].name)} · ${nearest&&Math.hypot(nearest.x-x,nearest.y-y)<=10?escapeHTML(nearest.name):'Countryside'}</p></div><div class="inspector-grid"><div><small>Collection</small><strong>${escapeHTML(BUILDING_GROUPS[b.group].name)}</strong></div><div><small>Development</small><strong>Level ${tile.building.level||1}</strong></div></div><p>${escapeHTML(buildingBenefit(tile.building.kind))}</p>${span<buildingFootprint(tile.building.kind)?'<p class="micro-note">Compact legacy site. New construction uses a larger plot.</p>':''}`;}
 else if(kind!=='city'&&tile.building?.kind==='factory'){const span=buildingSize(tile.building);title='Neighborhood workshop';tag=`${span} × ${span} site`;body='<div class="inspector-building"><canvas width="96" height="100" data-building-sprite="factory" aria-hidden="true"></canvas><p>Local industry</p></div><p>Road access and town deliveries drive development. Each level supports local town activity.</p>';}
 else if(city&&(kind==='city'||!tile.zone)){const outlook=townOutlook(game,city);title=city.name;tag='Town';body=`<div class="inspector-grid town-figures"><div><small>Population</small><strong>${integer(city.population)}</strong></div><div><small>Activity</small><strong>${integer(city.activity||0)}</strong></div><div><small>Waiting</small><strong>${integer(city.passengers)}</strong></div></div><p class="site-status">${townService(game,city).label}</p>${townGrowthLine(outlook)}${localConditions(settlementSuitability(game,city))}${townNeedsRow(city)}${townGrowHelp(outlook)}`;}
 else{title=tile.zone?TOOL_INFO[tile.zone].name+' zone':tile.road?'Road':tile.rail?'Railway':{grass:'Open countryside',forest:'Woodland',water:'Water',mountain:'Mountain ridge',rock:'Rocky ground',sand:'Desert sands',snow:'Snowfield'}[tile.terrain]||'Countryside';if(tile.detail&&!tile.road&&!tile.rail&&!tile.zone)title=tile.detail.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());tag=`${nature?terrainObjectSize(nature.object)+' × '+terrainObjectSize(nature.object)+' site · ':''}Level ${[...new Set(tileSurface(game,x,y).corners.map(p=>p.height))].sort((a,b)=>a-b).join('–')} · ${x}, ${y}`;body=tile.road||tile.rail?networkUse(tile,x,y):`<p>${nature&&nature.object.kind!=='mountain'?'A natural '+(nature.object.kind==='forest'?'grove':'outcrop')+' on level ground. Bulldoze any part to clear the whole site.':tile.zone?'Develops gradually with local demand.':tile.terrain==='water'?'Build a port on water beside a bank. Ships follow connected water and pass beneath bridges.':tile.terrain==='mountain'?'Use Terrain & crossings to tunnel through higher ground, or reshape clear land.':'Build on flat ground or a straight slope. Use Terrain & crossings to reshape or level clear land.'}</p>`;}
 if(tile.zone){const zone=game.zones.find(zone=>zone.x===x&&zone.y===y);body+=`<p>Development: ${Math.round((zone?.progress||0)/3*100)}% · Road access and regular town deliveries required.</p>`+localConditions(settlementSuitability(game,{x,y},tile.zone));}
 if(station&&kind!=='city'&&kind!=='industry')body=renameButton('station',station.id)+body;
 const box=$('#inspector'),html=`<div class="inspector-top"><span class="eyebrow">${tag}</span><button class="tiny-button" aria-label="Close inspector">×</button></div><h3 id="inspector-title" tabindex="-1">${escapeHTML(title)}</h3>${body}`,key=`${worldSerial}|${x},${y},${kind}`;
 const focusTitle=()=>{if(origin==='keyboard')$('#inspector-title').focus({preventScroll:true});};
 if(!changed&&!box.hidden&&html===inspectorHTML&&key===inspectorKey){focusTitle();return;}
 box.innerHTML=inspectorHTML=html;inspectorKey=key;box.hidden=false;drawPaletteSprites();box.querySelector('.tiny-button').onclick=()=>{box.hidden=true;selected=null;inspectorHTML='';};
 if($('#station-route'))$('#station-route').onclick=()=>{if(formDraft.editing)leaveRouteEdit(true);if(formDraft.mode!==station.mode||formDraft.to===String(station.id))formDraft.to='';formDraft.mode=station.mode;formDraft.from=String(station.id);setView('routes');$('#route-form')?.scrollIntoView({block:'nearest',behavior:'smooth'});};
 if($('#zone-town'))$('#zone-town').onclick=()=>{category='towns';setView('build');};
 box.querySelector('.town-grow')?.addEventListener('toggle',e=>{townGrowOpen=e.currentTarget.open;});
 if($('#industry-chain'))$('#industry-chain').onclick=()=>openChains({industryKind:industry.kind});
 bindServiceLinks(box);
 box.querySelectorAll('[data-target-id]').forEach(el=>el.onclick=e=>locateDestination(el.dataset.targetId,el.dataset.targetKind,e.detail===0?'keyboard':''));
 if(changed)box.scrollTop=0;
 focusTitle();
}
// A carrier's card names its service and trip; the map rings the carrier instead of a tile.
// Load, trip and Follow update in place, so a live refresh never replaces a pressed control.
let selectedVehicle=null,follow=null;
function clearVehicle() { selectedVehicle=null;follow=null;invalidateScene(); }
function stopFollow() { follow=null;$('#inspector [data-vehicle-action="follow"]')?.setAttribute('aria-pressed','false'); }
// On a phone the card covers the map's centre, so a followed carrier rides in the open map above it (screen pixels).
function followLift() { const card=$('#inspector').getBoundingClientRect(),map=canvas.getBoundingClientRect(),x=map.left+map.width/2,y=map.top+map.height/2;return card.left<x&&card.right>x&&card.top<y+40?Math.max(0,y-(map.top+card.top)/2):0; }
function inspectVehicle(id,refresh=false) {
 const box=$('#inspector'),vehicle=game.vehicles.find(v=>v.id===id),route=vehicle&&game.routes.find(r=>r.id===vehicle.routeId);
 if(!route){if(selectedVehicle===id){clearVehicle();box.hidden=true;inspectorHTML='';}return;}
 if(selectedVehicle!==id){follow=null;selectedVehicle=id;invalidateScene();}selected=null;
 const order=fleetOrder(route),health=routeHealth(game,route,getRouteFleet(game,route.id)),ahead=(vehicle.direction||1)>0,stop=game.stations.find(s=>s.id===route.stops[ahead?1:0]),tiles=Math.max(0,Math.ceil((ahead?route.path.length-1-(vehicle.progress||0):vehicle.progress||0)-1e-6));
 const load=`${integer(vehicle.load)} / ${integer(vehicle.capacity)}`,trip=`Heading to ${stop?.name||'a removed stop'} · ${tiles===1?'1 tile':integer(tiles)+' tiles'}`;
 const html=`<div class="inspector-top"><span class="eyebrow">${escapeHTML(order.noun[0].toUpperCase()+order.noun.slice(1))} · Gen ${(vehicle.level||0)+1}</span><button class="tiny-button" aria-label="Close inspector">×</button></div><h3 id="inspector-title" tabindex="-1">${escapeHTML(route.name)}</h3><div class="vehicle-trip"><canvas width="80" height="64" data-vehicle-sprite="purchase" data-mode="${escapeHTML(route.mode)}" data-cargo="${escapeHTML(route.cargo)}" data-level="${vehicle.level||0}" aria-hidden="true"></canvas><div><span class="vehicle-load">${cargoBadge(route.cargo)}<strong data-vehicle-live="load"></strong></span><p data-vehicle-live="trip"></p></div></div><div class="industry-condition" data-state="${health.state}"><strong>${escapeHTML(health.label)}</strong><p>${escapeHTML(health.detail)}</p></div><div class="vehicle-actions"><button class="small-button" data-vehicle-action="follow" aria-pressed="false">${icon('focus')}Follow</button><button class="small-button" data-vehicle-action="show">${icon('route')}Show route</button><button class="small-button" data-vehicle-action="routes">Open in Routes</button><button class="small-button" data-vehicle-action="add" title="${escapeHTML(order.add.title)}" ${order.add.disabled?'disabled':''}>${escapeHTML(order.add.label)}</button></div>`,key=`${worldSerial}|vehicle:${id}`;
 const same=!box.hidden&&key===inspectorKey,hold=refresh&&(box.contains(document.activeElement)||panelPress||performance.now()-panelReleasedAt<=250);
 if(!same||html!==inspectorHTML&&!hold){
  box.innerHTML=inspectorHTML=html;inspectorKey=key;box.hidden=false;drawPaletteSprites(box);if(!same)box.scrollTop=0;
  box.querySelector('.tiny-button').onclick=()=>{box.hidden=true;inspectorHTML='';clearVehicle();};
  box.querySelectorAll('[data-vehicle-action]').forEach(button=>button.onclick=()=>vehicleAction(button.dataset.vehicleAction,id));
 }
 for(const [live,text] of [['load',load],['trip',trip]]){const el=box.querySelector(`[data-vehicle-live="${live}"]`);if(el&&el.textContent!==text)el.textContent=text;}
 box.querySelector('[data-vehicle-action="follow"]')?.setAttribute('aria-pressed',String(Boolean(follow)));
}
function vehicleAction(action,id) {
 const vehicle=game.vehicles.find(v=>v.id===id),route=vehicle&&game.routes.find(r=>r.id===vehicle.routeId);if(!route)return;
 // Follow never changes the game speed; at 8× it steps Detail out to Town, which keeps up with the carrier.
 if(action==='follow'){if(follow){stopFollow();return;}follow={id,vehicle};$('#inspector [data-vehicle-action="follow"]')?.setAttribute('aria-pressed','true');if(speed>=8&&renderer.getCamera().zoom>1){renderer.setZoom(1);updateHud();}return;}
 if(action==='show'){showRoute(route.id);return;}
 if(action==='routes'){if(!filterRoutes(game,routeFilters).some(r=>r.id===route.id))routeFilters={query:'',mode:'all',status:'all',cargo:'all'};setView('routes');flashRoute(route.id);return;}
 const focused=document.activeElement?.dataset?.vehicleAction==='add';changeFleet(route.id,true);inspectVehicle(id);
 if(focused)$('#inspector [data-vehicle-action="add"]:not(:disabled)')?.focus({preventScroll:true});
}
// Construction saves wait for a pause in building, so a drag never holds vehicles.
let constructionSaveTimer=0,saveHealthy=true;
function persistSoon(delay=3000){clearTimeout(constructionSaveTimer);constructionSaveTimer=setTimeout(()=>{constructionSaveTimer=0;if(!menuOpening)persist();},delay);}
function markSaveFailed(){
 const announce=saveHealthy,button=$('#game-menu-button');saveHealthy=false;saveAt=performance.now()+40000;
 $('#save-status').textContent='Save unavailable';$('#save-status').classList.add('save-failed');
 button?.setAttribute('data-alert','');button?.setAttribute('aria-label','Game menu · autosave failed');
 if(announce)toast(`Autosave failed: browser storage is full or blocked. Delete older saves in ${matchMedia('(pointer: coarse)').matches?'Game menu → Save / load':'Save / load (Ctrl+S)'} to free space.`,{type:'error',key:'autosave-failed'});
 return announce;
}
function saveRecovered(){saveHealthy=true;$('#save-status').classList.remove('save-failed');$('#game-menu-button')?.removeAttribute('data-alert');$('#game-menu-button')?.setAttribute('aria-label','Game menu');[...$('#toast-region').children].find(el=>el.toastKey==='autosave-failed')?.remove();toast('Autosave is working again.');}
function cancelPendingSave(){clearTimeout(constructionSaveTimer);constructionSaveTimer=0;const job=pendingSave;pendingSave=null;capturingSave=false;job?.controller.abort();}
function saveFinished(world,day,revision){savedWorld=world;savedDay=day;savedRevision=revision;saveAt=performance.now();noteAutosaveTime();$('#save-status').textContent='Saved just now';if(!saveHealthy)saveRecovered();}
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
 undoStack=[];
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
// Locating a site from Chains lights its first output, and a town the followed town cargo; the lens outlives the dialog.
function locateFromChains(id) {
 const town=game.cities.some(c=>String(c.id)===String(id)),site=!town&&game.industries.find(i=>String(i.id)===String(id)),lens=site?lensCargo(site.kind):chainSelection.cargo;
 if(site||TOWN_CARGO.includes(lens))setCargoLens(lens,'chains');
 locateDestination(id,town?'city':'industry');
}
function openChains(options={}) {
 chainExplorer?.dispose();
 closeMobile();openModal('');
 chainExplorer=mountChains($('#modal-content'),game,{onLocate:locateFromChains,onBuild:kind=>{closeModal();category='industry';setView('build');setTool(kind);},onClose:closeModal,onChange:selection=>{chainSelection=selection;}},Object.keys(options).length?options:chainSelection);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
$('#modal').addEventListener('close',()=>{saveDialogController?.dispose();saveDialogController=null;chainExplorer?.dispose();chainExplorer=null;if(modalPreviousSpeed!==null){changeSpeed(modalPreviousSpeed);modalPreviousSpeed=null;}});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const b=$('#modal').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeModal();}});
function openWorld() { void openGameMenu(); }
function openAtlas() {
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>World map</h2><p>Click a location to explore.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><canvas id="atlas-map" width="640" height="480" tabindex="0" aria-label="World atlas. Click to center the world map on a location."></canvas><div class="atlas-legend"><span><i class="atlas-town"></i> Towns</span>${cargoLens?`<span><i class="atlas-lens-source"></i> ${escapeHTML(CARGO[cargoLens.cargo].name)} producers</span><span><i class="atlas-lens-buyer"></i> Buyers</span>`:'<span><i class="atlas-industry"></i> Industries</span>'}<span><i class="atlas-route"></i> Your network</span><span>Use H to return home</span></div></div>`);
 const atlas=$('#atlas-map');atlas.style.aspectRatio=game.width+'/'+game.height;atlas.style.setProperty('--atlas-ratio',game.width/game.height);renderer.drawMinimap(atlas);
 atlas.addEventListener('click',e=>{const rect=atlas.getBoundingClientRect(),left=atlas.clientLeft,top=atlas.clientTop;renderer.focus(Math.max(0,Math.min(1,(e.clientX-rect.left-left)/atlas.clientWidth))*game.width,Math.max(0,Math.min(1,(e.clientY-rect.top-top)/atlas.clientHeight))*game.height);closeModal();closeMobile();});
 atlas.addEventListener('keydown',e=>{if(e.key==='Enter'){renderer.focus(game.cities[0].x,game.cities[0].y);closeModal();}});
}
function openHelp(tab='basics') {
 if(tab==='chains'){openChains();return;}
 const basics=`<div class="guide-grid"><div class="guide-item"><span>${icon('road')}Build a network</span><p>Roads and rails climb straight slopes; turns need flat ground. Terrain has eight levels, 0–7. Use Terrain &amp; crossings to raise or lower grid points, or drag an area level. Bridges and tunnels need flat ends at the same level. Choose Road or Rail before building.</p></div><div class="guide-item"><span>${icon('route')}Connect two stops</span><p>Place stops or ports within 5 tiles of customers. Connect them, choose cargo, then launch a bus, train or ship.</p></div><div class="guide-item"><span>${icon('factory')}Supply factories</span><p>Deliver every input in a recipe. Towns buy finished goods. Freight returns empty; passengers travel both ways.</p></div><div class="guide-item"><span>${icon('leaf')}Slow, local growth</span><p>Zone within 10 tiles of a town, beside roads. Regular deliveries drive growth; services and greenery help.</p></div><div class="guide-item"><span>${icon('leaf')}Build at your own pace</span><p>Your starter bus earns money while you plan. Start small, supply every factory input, and expand when demand fills your vehicles. Next projects are optional.</p></div><div class="guide-item"><span>${icon('route')}Understand the money</span><p>Profit shows operations this calendar month. Tap Balance for building spend and last month. Routes show fares minus upkeep since tracking began, excluding construction.</p></div></div><div class="keyboard-help"><span><kbd>R</kbd> Road</span><span><kbd>T</kbd> Rail</span><span><kbd>Shift</kbd> Straight drag</span><span><kbd>S</kbd> Stop on road / rail</span><span><kbd>P</kbd> Port</span><span><kbd>B</kbd> / <kbd>N</kbd> Bridge / tunnel</span><span><kbd>[</kbd> / <kbd>]</kbd> Lower / raise land</span><span><kbd>E</kbd> Level land</span><span><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> Zones</span><span><kbd>X</kbd> Bulldozer</span><span><kbd>Right drag</kbd> Move map</span><span><kbd>Two fingers</kbd> Move / pinch to zoom</span><span><kbd>G</kbd> Grid</span><span><kbd>L</kbd> Layers</span><span><kbd>H</kbd> Home</span><span><kbd>M</kbd> Map</span><span><kbd>C</kbd> Production chains</span><span><kbd>Space</kbd> Pause / hold to pan</span><span><kbd>Esc</kbd> / <kbd>Right-click</kbd> Cancel a drag, then Done</span><span><kbd>Ctrl+S</kbd> Save / load</span></div>`;
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
 // An older save or a new world has no stamps yet; whatever it has already met is backfilled silently.
 seenMilestones=new Set(game.milestones?Object.keys(game.milestones):metMilestones(game));milestoneMonth=Math.max(-1,...Object.values(game.milestones||{}).map(monthOf));goalSeen=null;goalChanged=false;
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
 const review=yearReview(pricing.year-1),upgrade=getFleetUpgrade(game).available?{label:'Review upgrades',run:reviewUpgrades}:null;
 noticeQueue.push({message:newYearNotice(pricing.year,pricing.rate)+review,type:'milestone',action:review?[{label:'Open report',run:openCompany},upgrade]:upgrade});
}
// The year just closed: its operating profit, the change on the year before and its best route.
function yearReview(year) {
 const summary=game.annual?.at(-1);if(summary?.year!==year)return '';
 const change=yearChange(summary,game.annual.at(-2)),best=game.routes.find(route=>route.id===summary.bestRouteId);
 return ` · ${year} operating profit ${signedMoney(summary.operatingProfit)}${change===null?'':` (${change<0?'−':'+'}${integer(Math.abs(change))}%)`}${best?` · best route ${best.name}`:''}`;
}
function signedMoney(value) { return (value<0?'−':'+')+compactMoney(Math.abs(value)); }
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
  if(!(route.delivered>0&&firstDeliveryPending.delete(route.id)))continue;
  // The company's first freight delivery is also its first milestone; one toast says both.
  const first=!seenMilestones.has('first-freight');if(first){seenMilestones.add('first-freight');milestoneMonth=monthOf(game.day);}
  noticeQueue.push({message:`First ${CARGO[route.cargo].name.toLowerCase()} delivered on ${route.name} · +${money(route.revenue)}${first?' · Milestone':''}`,type:'milestone',targets:[{kind:'route',id:route.id}]});
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
// Each milestone celebrates once, with at most one toast a game month; the rest wait in News and Company goals.
function watchMilestones() {
 if(!game.milestones)return;
 for(const milestone of MILESTONES){
  const day=game.milestones[milestone.id];if(day===undefined||seenMilestones.has(milestone.id))continue;seenMilestones.add(milestone.id);
  if(monthOf(day)<=milestoneMonth)continue;milestoneMonth=monthOf(day);
  noticeQueue.push({message:`Milestone · ${milestone.title}`,type:'milestone',action:{label:'Goals',run:openGoals}});
 }
}
function monthOf(day) { const date=new Date(Date.UTC(1950,0,1+Math.floor(day)));return date.getUTCFullYear()*12+date.getUTCMonth(); }
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
 const date=day=>new Date(Date.UTC(1950,0,1+Math.floor(day))).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 // Milestones are company state, not notices: those reached within the log's span join it, one line per day.
 const since=game.notifications.length>=24?Math.floor(game.notifications.at(-1).day):-Infinity,reached=new Map();
 for(const milestone of MILESTONES){const day=game.milestones?.[milestone.id];if(day>=since){if(!reached.has(day))reached.set(day,[]);reached.get(day).push(milestone.title);}}
 const titles=list=>list.length>3?`${list.slice(0,3).join(', ')} and ${list.length-3} more`:list.length>1?`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`:list[0];
 const notices=[...game.notifications,...[...reached].map(([day,list])=>({day,message:list.length>1?`${list.length} milestones reached: ${titles(list)}`:`Milestone · ${list[0]}`,type:'milestone',goals:true}))].sort((a,b)=>b.day-a.day);
 const items=notices.map((notice,index)=>{const type=toastType(notice.type);return `<li class="news-item" data-type="${type}">${icon(type==='ok'||type==='milestone'?'check':'warning')}<div><time>${date(notice.day)}</time><p>${escapeHTML(notice.message)}</p></div>${notice.goals?'<button class="small-button" data-news-goals>Goals</button>':noticeTargetExists(notice.target)?`<button class="small-button" data-news-target="${index}">Show</button>`:''}</li>`;}).join('');
 closeMobile();openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>News</h2><p>Recent company notices, newest first. The log keeps the latest 24.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><ol class="news-list">${items||'<li class="news-empty">No news yet. Notices about your network, towns and industries appear here.</li>'}</ol><div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $$('[data-news-target]').forEach(el=>el.addEventListener('click',()=>showNoticeTarget(notices[Number(el.dataset.newsTarget)].target)));
 $$('[data-news-goals]').forEach(el=>el.addEventListener('click',openGoals));
 $('#modal .close-modal')?.focus({preventScroll:true});
}
// Company goals: every chapter with the dates reached and live progress. Nothing here is required or rewarded.
function openGoals() {
 const date=day=>new Date(Date.UTC(1950,0,1+Math.floor(day))).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}),next=nextProject(game,{source:goalChoice}).milestone;
 const row=({milestone,reached,progress,done})=>{const text=progress&&!done?progressText(milestone,progress):'';return `<li class="goal-row${done?' done':''}">${done?icon('check'):'<span class="goal-dot" aria-hidden="true"></span>'}<div><strong>${escapeHTML(milestone.title)}</strong><small>${reached!==null?`Reached ${date(reached)}`:done?'Reached today':escapeHTML(milestone.detail)}</small>${text?`<span class="goal-meter"><span><span style="width:${Math.min(100,progress.value/progress.target*100)}%"></span></span>${escapeHTML(text)}</span>`:''}</div>${milestone.id===next?'<em>Next goal</em>':''}</li>`;};
 const chapters=milestoneChapters(game).map(chapter=>`<section class="goal-chapter${chapter.complete?' complete':''}"><header><div><span class="eyebrow">Chapter ${chapter.chapter} of ${CHAPTERS.length}</span><h3>${escapeHTML(chapter.title)}</h3></div><span class="goal-count">${chapter.done} / ${chapter.items.length}</span></header><ol class="goal-list">${chapter.items.map(row).join('')}</ol></section>`).join('');
 closeMobile();openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>Company goals</h2><p>Optional milestones, reached in any order. A chapter is complete when all but one of its goals are done.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="goal-chapters">${chapters}</div><div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
// Company: the last 36 closed months as sparklines, yearly summaries, routes by net a month and the optional loan.
function openCompany(section) {
 const history=game.history,terms=loanTerms(game),years=[...(game.annual||[])].reverse(),signed=v=>(v<0?'−':'+')+money(v);
 const chart=(label,values,format)=>{
  const list=values.filter(Number.isFinite);while(list.length<2)list.unshift(list[0]??0);
  const low=Math.min(...list),high=Math.max(...list),y=v=>(high>low?34-(v-low)/(high-low)*30:19).toFixed(1),points=list.map((v,i)=>`${(i/(list.length-1)*120).toFixed(1)},${y(v)}`).join(' ');
  return `<figure class="company-chart"><figcaption><span>${label}</span><strong>${format(list.at(-1))}</strong></figcaption><svg class="sparkline" viewBox="0 0 120 36" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(`${label}, month by month: lowest ${format(low)}, highest ${format(high)}`)}">${low<0&&high>0?`<line class="spark-zero" x1="0" x2="120" y1="${y(0)}" y2="${y(0)}"/>`:''}<polygon class="spark-area" points="0,36 ${points} 120,36"/><polyline class="spark-line" points="${points}"/></svg></figure>`;
 };
 const closed=entry=>monthText(entry.day-1),charts=history.length?`<section class="company-section"><header><h3>Month by month</h3><span>${closed(history[0])} – ${closed(history.at(-1))}</span></header><div class="company-charts">${chart('Operating profit',history.map(h=>h.operatingProfit??h.profit),signed)}${chart('Balance',history.map(h=>h.money),v=>(v<0?'−':'')+money(v))}${chart('Residents',history.map(h=>h.population),integer)}${chart('Delivered a month',history.map((h,i)=>i?h.delivered-history[i-1].delivered:h.month===0?h.delivered:NaN),v=>integer(v)+' units')}</div></section>`:`<section class="company-section"><h3>Month by month</h3><p class="company-empty">Charts begin when ${monthText(game.day)} closes.</p></section>`;
 const yearRows=years.map((a,i)=>{const change=yearChange(a,years[i+1]);return `<tr><th scope="row">${a.year}</th><td>${compactMoney(a.revenue)}</td><td>${signedMoney(a.operatingProfit)}${change===null?'':` <small>${change<0?'−':'+'}${integer(Math.abs(change))}%</small>`}</td><td class="company-optional">${integer(a.delivered)}</td><td class="company-optional">${integer(a.population)}</td><td class="company-optional">${integer(a.routes)}</td><td>${escapeHTML(game.routes.find(route=>route.id===a.bestRouteId)?.name||'—')}</td></tr>`;}).join('');
 const yearly=`<section class="company-section"><h3>Year by year</h3>${years.length?`<div class="company-table"><table><thead><tr><th scope="col">Year</th><th scope="col">Fares</th><th scope="col">Operating profit</th><th scope="col" class="company-optional">Delivered</th><th scope="col" class="company-optional">Residents</th><th scope="col" class="company-optional">Routes</th><th scope="col">Best route</th></tr></thead><tbody>${yearRows}</tbody></table></div>`:`<p class="company-empty">Your first yearly summary arrives on January 1, ${inflationInfo(game).year+1}.</p>`}</section>`;
 // Net a month since each route's accounts began; a route only counts as below its upkeep after 90 days.
 const rated=game.routes.map(route=>{const net=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0),days=game.day-(route.accountingStartDay||0);return {route,net,days,rate:net/Math.max(days,1)*30.44};});
 const top=rated.filter(r=>r.days>=30.44&&r.rate>0).sort((a,b)=>b.rate-a.rate).slice(0,5),below=rated.filter(r=>r.days>=90&&r.net<0).sort((a,b)=>a.rate-b.rate);
 const row=({route,rate},index,flag)=>{const count=getRouteFleet(game,route.id).count,id=escapeHTML(route.id);return `<li class="company-route">${flag?'':`<span class="company-rank">${index+1}</span>`}<div><strong>${escapeHTML(route.name)}</strong><small>${flag?'Earning less than its upkeep':`${escapeHTML(CARGO[route.cargo].name)} · ${count} ${fleetNoun(route,count)}`}</small></div><span class="company-rate">≈ ${signedMoney(rate)} / month</span><span class="company-route-actions"><button class="small-button" data-company-show="${id}">Show</button>${flag?`<button class="small-button" data-company-retire="${id}">Retire</button>`:''}</span></li>`;};
 const routes=`<section class="company-section"><header><h3>Top routes</h3><span>Net a month · fares less route upkeep</span></header>${top.length?`<ol class="company-routes">${top.map((r,i)=>row(r,i,false)).join('')}</ol>`:`<p class="company-empty">${!game.routes.length?'No routes yet.':rated.some(r=>r.days>=30.44)?'No route earns more than its upkeep yet.':'Routes join this list after a month of earnings.'}</p>`}${below.length?`<h4>Earning less than their upkeep</h4><ul class="company-routes below">${below.slice(0,5).map((r,i)=>row(r,i,true)).join('')}</ul>${below.length>5?`<p class="company-empty">And ${below.length-5} more.</p>`:''}`:''}</section>`;
 const loan=`<section class="company-section company-loan"><header><h3>Loan</h3><span>${terms.loan?`${money(terms.loan)} of ${money(terms.limit)}`:`Up to ${money(terms.limit)}`}</span></header>${terms.loan?`<div class="company-meter"><span style="width:${Math.min(100,terms.loan/terms.limit*100)}%"></span></div>`:''}<p>${terms.loan?`Interest is ${money(terms.monthlyInterest)} a month, charged as each month closes.`:'Optional credit for a project you cannot fund yet.'} A flat ${(terms.rate*100).toFixed(1)}% a month on what you owe, with no due date: repay whenever you like.</p><div class="company-loan-actions"><button class="button button-outline" id="company-borrow" ${terms.borrow?'':'disabled'}>${terms.borrow?`Borrow ${money(terms.borrow)} · ${money(terms.borrowInterest)} / month interest`:'Credit line fully used'}</button>${terms.loan?`<button class="button button-outline" id="company-repay" ${game.money>=terms.repay?'':`disabled title="Need ${money(terms.repay)} to repay"`}>Repay ${money(terms.repay)}</button>`:''}</div></section>`;
 closeMobile();openModal(`<div class="modal-inner company-report"><div class="modal-heading"><div><h2>Company</h2><p>Your company in figures. Each month closes on the 1st, and each year on January 1.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div>${charts}${yearly}${routes}${loan}<div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $$('[data-company-show]').forEach(el=>el.addEventListener('click',()=>showNoticeTarget({kind:'route',id:el.dataset.companyShow})));
 $$('[data-company-retire]').forEach(el=>el.addEventListener('click',()=>retireRoute(el.dataset.companyRetire)));
 // Borrowing and repaying redraw the dialog in place, keeping its scroll and the pressed button.
 for(const [id,action] of [['#company-borrow',borrow],['#company-repay',repay]])$(id)?.addEventListener('click',()=>{
  const result=action(game),scroll=$('#modal').scrollTop;toast(result.message,!result.ok);updateHud();if(result.ok)persist();
  openCompany();$('#modal').scrollTop=scroll;($(`${id}:not(:disabled)`)||$('#company-borrow:not(:disabled),#company-repay:not(:disabled)'))?.focus({preventScroll:true});
 });
 $('#modal .close-modal')?.focus({preventScroll:true});
 if(section==='loan')$('.company-loan').scrollIntoView({block:'start'});
}
// The change in operating profit on the year before, when that year made a profit.
function yearChange(summary,previous) { return previous?.year===summary.year-1&&previous.operatingProfit>0?Math.round((summary.operatingProfit-previous.operatingProfit)/previous.operatingProfit*100):null; }
// A January repricing waits while the player types in the panel's search.
$('#panel-content').addEventListener('focusout',()=>setTimeout(()=>{if(panelPricesStale&&!$('#panel-content').contains(document.activeElement)){panelPricesStale=false;if(view==='build'||view==='towns')renderPanel();}}));
// A stop's New route opens the planner even when the draft already holds that stop.
$('#inspector').addEventListener('click',e=>{if(e.target.closest?.('#station-route'))formDraft.open=true;},true);

// Road and Rail follow the terrain only when the plain L would be refused; Shift keeps the L, bent along the first axis dragged.
// Each company keeps its last plan, so a drag searches again only when its end tile or the world changes.
const strokePlans=new WeakMap();
function constructionLine(a,b,key,{shift=false,firstAxis}={}) {
 if(key==='level'){const points=[a];for(let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)for(let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++)if(x!==a.x||y!==a.y)points.push({x,y});return points;}
 if(zoneTools.has(key)?!shift:key==='bulldoze'&&shift)return areaRect(a,b);
 if(spanTools.has(key))b=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y)?{x:b.x,y:a.y}:{x:a.x,y:b.y};
 if(key!=='road'&&key!=='rail')return gridLine(a,b);
 if(shift)return gridLine(a,b,firstAxis);
 const memo=`${key}:${a.x},${a.y}:${b.x},${b.y}:${game.networkRevision}:${game.revision}`;let plan=strokePlans.get(game);
 if(plan?.memo!==memo)strokePlans.set(game,plan={memo,...planNetworkStroke(game,key,a,b)});
 return plan.path;
}
// Zones fill the rectangle between the corners, and so does the Bulldozer with Shift; Shift keeps a zone's line.
// The far corner stops 16 tiles from the start, and the points carry the area for the tip.
const zoneTools=new Set(['residential','commercial','industrial']),AREA_SIDE=16;
function areaRect(a,b) {
 const w=Math.abs(b.x-a.x)+1,h=Math.abs(b.y-a.y)+1,sx=Math.sign(b.x-a.x),sy=Math.sign(b.y-a.y),area={w:Math.min(w,AREA_SIDE),h:Math.min(h,AREA_SIDE),capped:w>AREA_SIDE||h>AREA_SIDE},points=[];
 for(let j=0;j<area.h;j++)for(let i=0;i<area.w;i++)points.push({x:a.x+i*sx,y:a.y+j*sy});
 return Object.assign(points,{area});
}
// The last ten builds of this session can be undone; a route change or another world retires them.
let undoStack=[];
function undoBuild(entry) {
 undoStack=undoStack.filter(item=>!undoStale(game,item));const target=entry||undoStack.at(-1);
 if(!target||!undoStack.includes(target)){toast(entry?'This build can no longer be undone.':'Nothing to undo.',{type:'warning'});return;}
 const result=undoConstruction(game,target);undoStack=undoStack.filter(item=>item!==target);toast(result.message,{type:result.ok?'ok':'warning'});if(!result.ok)return;
 [...$('#toast-region').children].find(el=>el.toastKey===target)?.remove();
 if(!game.notifications.some(notice=>notice.id===lastNoticeId))lastNoticeId=game.notifications[0]?.id;
 preview=[];refreshRouteConnections(game);updateHud();invalidateScene();persistSoon();if(view!=='build')renderPanel();
 if(hover&&updatePlacementTip.at)updatePlacementTip();
}
function paintPath(points) {
 if(spanTools.has(tool)&&points.length<3){toast('Drag a straight span of at least 3 tiles, including both ends.',true);preview=[];return;}
 const journal=captureUndo(game,tool,points),result=buildPlan(game,tool,points,{preferredMode}),undo=finishUndo(journal,game,result);if(undo)undoStack=[...undoStack.filter(item=>!undoStale(game,item)).slice(-9),undo];
 toast(result.message,{type:!result.ok?'error':result.built>0&&result.failed>0?'warning':'ok',key:undo||result.message,action:undo&&{label:'Undo',run:()=>undoBuild(undo)}});preview=[];if(result.ok)refreshRouteConnections(game);updateHud();if(result.ok){persistSoon();if(view!=='build')renderPanel();}
 if(hover&&updatePlacementTip.at)updatePlacementTip(); // Re-quote the tile under the pointer, never the finished stroke.
}
function pickMapTile(clientX,clientY,clamp=false,pointerType='') {
 const touch=pointerType==='touch';
 if(isRoutePicking()) {
  // Station signs stay fourteen screen pixels wide, including at Region zoom,
  // so the nearest sign within a finger's or a pointer's reach picks its stop.
  const station=renderer.stationAtMarker(clientX,clientY,{slop:touch?20:6});
  return station?{x:station.x,y:station.y}:renderer.screenToTile(clientX,clientY);
 }
 if(terrainTools.has(tool))return renderer.screenToVertex(clientX,clientY,{clamp});
 return tool==='inspect'?renderer.screenToInspectTile(clientX,clientY,{slop:touch?12:0}):renderer.screenToTile(clientX,clientY,{clamp});
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
// Keys, zoom buttons and edge scrolling move the map under a still pointer; the tile, stroke and quote beneath it follow.
function refreshStroke() {
 const at=pointer?{clientX:pointer.lastX,clientY:pointer.lastY,pointerType:pointer.type}:updatePlacementTip.at;
 if(!at||!hover||hover.keyboard||liveAim()||pointer?.pan||pointer?.cancelled||touchGesture)return;
 const line=Boolean(pointer)&&lineTools.has(pointer.tool),next=pickMapTile(at.clientX,at.clientY,line);if(hover.x===next.x&&hover.y===next.y)return;
 hover=next;if(line)preview=constructionLine(pointer.start,hover,pointer.tool,pointer);
 $('#tile-coordinates').textContent=`${hover.x}, ${hover.y} · ${BIOMES[game.biome].name}`;updatePlacementTip(at);
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
// On touch the tip quotes a point tool above the finger before it lifts. A site or town of $20,000 or more in 1950 prices, or a
// refused tile, is only aimed by the tap: its tip holds above the tile through pans and pinches, and Place or a second tap builds.
// A cheaper stop, port or building builds on the tap, and a new stop or port shows its reach for 1.5 s. An aim lapses with its tool or world.
let touchAim=null,reachFlash=null;
const placeButton=Object.assign(document.createElement('button'),{type:'button',className:'tip-place',textContent:'Place'});
const aimTool=key=>!lineTools.has(key)&&BUILD_COSTS[key]>=20000;
const liveAim=()=>touchAim&&touchAim.game===game&&touchAim.tool===tool&&!hover?.keyboard?touchAim:null;
function aimPoint(aim) { const box=canvas.getBoundingClientRect(),at=renderer.worldToScreen(aim.x,aim.y);return {clientX:box.left+at.x,clientY:box.top+at.y,pointerType:'touch',shown:at.x>=0&&at.y>=0&&at.x<=box.width&&at.y<=box.height}; }
function touchPlace(at) {
 if(!tileAt(at.x,at.y))return false;
 const aim=liveAim(),again=aim&&aim.x===at.x&&aim.y===at.y;
 if(!again&&(aimTool(tool)||quoteBuildPlan(game,tool,[at],{preferredMode}).ok===false)){touchAim={x:at.x,y:at.y,at,tool,game};preview=[];hover=at;updatePlacementTip();return true;}
 const spent=game.money;touchAim=null;hover=null;preview=[];$('#placement-tip').hidden=true;paintPath([at]);
 // Selecting the new stop draws its service ring, as its inspector would, without a red hover on the tile it now fills.
 if(game.money<spent&&['stop','port'].includes(tool))selected=reachFlash={x:at.x,y:at.y,until:performance.now()+1500};
 return true;
}
placeButton.addEventListener('click',()=>{const aim=liveAim();if(aim)touchPlace(aim.at);});
// A mouse or pen takes the map back from a touch aim, as it does from the keyboard cursor.
for(const type of ['pointerdown','pointermove'])canvas.addEventListener(type,e=>{if(touchAim&&e.pointerType!=='touch'&&(type==='pointerdown'||e.movementX||e.movementY))touchAim=null;},true);
function updatePlacementTip(e=updatePlacementTip.at) {
 const tip=$('#placement-tip'),aim=liveAim();if(aim){hover=aim.at;e=aimPoint(aim);}updatePlacementTip.at={clientX:e.clientX,clientY:e.clientY,pointerType:e.pointerType};
 if(tool==='inspect'||!hover||!tileAt(hover.x,hover.y)||(aim?!e.shown:pointer?.pan||touchGesture)){tip.hidden=true;return;}
 const points=preview.length?preview:[hover],n=points.length,plan=spanTools.has(tool)&&n<3?{ok:false,message:'Drag at least 3 tiles between level ends.',placements:[],cost:0}:quoteBuildPlan(game,tool,points,{preferredMode});
 const effective=n===1&&!spanTools.has(tool)?plan.placements[0]?.tool:tool;
 const name=TOOL_INFO[effective]?.name||BUILDINGS[effective]?.name||INDUSTRIES[effective]?.name||'Build';
 const levels=tool==='level'?`Level ${plan.level??surfaceHeight(game,points[0].x,points[0].y)}`:terrainTools.has(tool)?n===1?`Level ${surfaceHeight(game,hover.x,hover.y)} → ${Math.max(1,Math.min(MAX_HEIGHT,surfaceHeight(game,hover.x,hover.y)+(tool==='raise'?1:-1)))}`:`${tool==='raise'?'+1':'−1'} level / point`:spanTools.has(tool)&&Number.isFinite(plan.height)?`Level ${plan.height}`:'';
 const nature=tool==='bulldoze'&&n===1?terrainObjectAt(game,hover.x,hover.y):null;
 const siteSize=BUILDINGS[effective]?buildingFootprint(effective):INDUSTRIES[effective]?industryFootprint(effective):nature&&nature.object.kind!=='mountain'?terrainObjectSize(nature.object):0;
 const note=plan.ok===false?{text:''}:placementNote(effective,plan);
 const stroke=strokePlans.get(game),route=preview.length&&preview===stroke?.path?stroke.reason:null,terrain=route==='flipped'||route==='routed'?` · follows\u00a0terrain${['touch','keyboard'].includes(e.pointerType)?'':' · Shift:\u00a0straight'}`:'';
 // A zone rectangle reads its size, tiles and how many no road reaches before the price.
 const area=n>1?points.area:null,zoning=zoneTools.has(tool)&&n>1,count=plan.placements.length>1?' · '+plan.placements.length+(tool==='bulldoze'?' sites':terrainTools.has(tool)?' points':' tiles'):'',roads=plan.needRoad?` · ${n>1?plan.needRoad+(plan.needRoad===1?' needs':' need'):'needs'} a road`:'';
 tip.textContent=plan.ok===false?route==='too-far'?'No gentle route — level ground or drag in shorter segments':plan.message+terrain:`${name}${siteSize?' · '+siteSize+' × '+siteSize:area?' · '+area.w+' × '+area.h:''}${levels?' · '+levels:''}${zoning?count+roads:''} · ${money(plan.cost)}${zoning?'':count+roads}${plan.partial?' · '+plan.message:''}${note.text?' · '+note.text:''}${area?.capped?` · max ${AREA_SIDE} × ${AREA_SIDE}`:''}${terrain}`;
 tip.classList.toggle('invalid',plan.ok===false);tip.classList.toggle('partial',plan.ok!==false&&Boolean(plan.partial));tip.classList.toggle('warning',Boolean(note.warning||plan.ok!==false&&plan.needRoad));
 const rect=canvas.getBoundingClientRect();tip.hidden=false;
 if(aim&&aimTool(tool)){placeButton.disabled=plan.ok===false;tip.append(placeButton);}tip.classList.toggle('aim',Boolean(aim));
 // A finger would cover a tip beside it, so touch centres the tip above the contact point, or below it at the top edge.
 const touch=e.pointerType==='touch',above=e.clientY-rect.top-tip.offsetHeight-56;
 tip.style.left=Math.max(4,Math.min(rect.width-tip.offsetWidth-4,touch?e.clientX-rect.left-tip.offsetWidth/2:e.clientX-rect.left+17))+'px';tip.style.top=Math.max(4,Math.min(rect.height-tip.offsetHeight-4,touch?above<4?e.clientY-rect.top+40:above:e.clientY-rect.top+18))+'px';
}
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0&&e.button!==1&&e.button!==2)return;
 if(e.pointerType==='touch'){
  touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);
  if(touchPoints.size>1){pointer=null;preview=[];hover=null;touchGesture={...touchFrame(),zoomed:false};canvas.classList.add('dragging');$('#placement-tip').hidden=true;e.preventDefault();return;}
  if(touchGesture)return;
 }else if(pointer){if(e.button===2)setTool('inspect');return;}
 canvas.focus({preventScroll:true});const tile=pickMapTile(e.clientX,e.clientY,false,e.pointerType);
 pointer={id:e.pointerId,button:e.button,tool,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,start:tile,moved:false,pan:tool==='inspect'||e.button!==0||spaceDown,shift:e.shiftKey};
 canvas.setPointerCapture(e.pointerId);
 if(spaceDown)spaceUsedForPan=true;
 if(pointer.pan)canvas.classList.add('dragging');else preview=[tile];
 pointer.type=e.pointerType;if(pointer.type==='touch'&&!pointer.pan){if(!aimTool(tool))touchAim=null;if(liveAim())preview=[];else hover=tile;}
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
 // A move within the hovered tile keeps its object, so a paused map does not repaint.
 const next=pickMapTile(e.clientX,e.clientY,pointer&&!pointer.pan&&!pointer.cancelled&&lineTools.has(pointer.tool));if(!hover||hover.x!==next.x||hover.y!==next.y)hover=next;$('#tile-coordinates').textContent=`${hover.x}, ${hover.y} · ${BIOMES[game.biome].name}`;
 if(pointer&&pointer.id===e.pointerId){
  // A chorded right press arrives as a move; it abandons the stroke but keeps the tool.
  if(!pointer.cancelled&&e.pointerType==='mouse'&&pointer.button===0&&!pointer.pan&&(e.buttons&2)){pointer.cancelled=true;preview=[];canvas.classList.remove('dragging');}
  if(pointer.cancelled){pointer.lastX=e.clientX;pointer.lastY=e.clientY;$('#placement-tip').hidden=true;return;}
  const dx=e.clientX-pointer.lastX,dy=e.clientY-pointer.lastY;
  if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>5)pointer.moved=true;
  pointer.shift=e.shiftKey;if(pointer.moved&&!pointer.firstAxis&&(hover.x!==pointer.start.x||hover.y!==pointer.start.y))pointer.firstAxis=Math.abs(hover.x-pointer.start.x)>=Math.abs(hover.y-pointer.start.y)?'x':'y';
  if(pointer.moved&&!lineTools.has(pointer.tool)){pointer.pan=true;preview=[];canvas.classList.add('dragging');}
  if(pointer.pan){renderer.pan(dx,dy);if(spaceDown)spaceUsedForPan=true;}
  else if(lineTools.has(pointer.tool))preview=constructionLine(pointer.start,hover,pointer.tool,pointer);
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
 if(p.pan){preview=[];if(!p.moved&&!spaceDown){const vehicle=tool==='inspect'&&renderer.vehicleAt(e.clientX,e.clientY,{slop:e.pointerType==='touch'?12:0});if(vehicle)inspectVehicle(vehicle.id);else inspect(p.start.x,p.start.y);}return;}
 if(p.moved&&!lineTools.has(p.tool)){preview=[];return;}
 if(p.type==='touch'&&!lineTools.has(p.tool)&&touchPlace(p.start))return;
 const points=preview.length?preview:[p.start];
 if(points.every(p=>tileAt(p.x,p.y)))paintPath(points);else{toast('Keep construction within the world boundary.',true);preview=[];}
});
canvas.addEventListener('pointercancel',cancelGesture);
canvas.addEventListener('lostpointercapture',e=>{if(pointer?.id===e.pointerId||touchPoints.has(e.pointerId))cancelGesture();});
canvas.addEventListener('pointerleave',()=>{if(liveAim())return;if(!pointer)hover=null;$('#placement-tip').hidden=true;});
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
// Dragging, pinching or scrolling the map ends Follow; other camera moves are caught in the frame.
canvas.addEventListener('pointermove',()=>{if(follow&&(pointer?.pan&&pointer.moved||touchGesture))stopFollow();});
canvas.addEventListener('wheel',()=>{if(follow)stopFollow();},{passive:true});
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
$('#zoom-in').onclick=()=>{closeMapMenus();renderer.zoomAt(1.2);updateHud();refreshStroke();};$('#zoom-out').onclick=()=>{closeMapMenus();renderer.zoomAt(1/1.2);updateHud();refreshStroke();};$('#home-view').onclick=()=>renderer.focus(game.cities[0].x,game.cities[0].y);
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
$('#open-report').onclick=()=>{$('#company-stats').setAttribute('aria-expanded','false');$('#open-report').blur();openCompany();};
// A remembered sound choice resumes audio on the first tap; browsers keep it silent until a gesture.
$('#audio-button').addEventListener('click',()=>{try{localStorage.setItem('transport-sound-v1',sounds?'on':'off');}catch{}});
try{if(localStorage.getItem('transport-sound-v1')==='on'){sounds=true;$('#audio-button').innerHTML=icon('volume');$('#audio-button').setAttribute('aria-label','Disable sound');document.addEventListener('pointerdown',()=>{if(sounds)try{audioContext||=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();}catch{}},{once:true,capture:true});}}catch{}
// Keyboard play: Enter puts a tile cursor in the middle of the view, arrows step it one tile along the grid and Enter acts under it.
// It rides in hover (marked keyboard), so previews, quotes and the ring follow it; a pointer press or move hands control back.
// A cursor left off screen returns to the middle rather than dragging the camera back, so nothing is built out of sight.
const TERRAIN_NAMES={grass:'Open countryside',forest:'Woodland',water:'Water',mountain:'Mountain ridge',rock:'Rocky ground',sand:'Desert sands',snow:'Snowfield'};
let keyCursor=null,keyStart=null,keyGame=null,keyTimer=0;
const keyScreen=p=>terrainTools.has(tool)?renderer.gridPointToScreen(p.x,p.y):renderer.worldToScreen(p.x,p.y);
const keyVisible=p=>{const at=keyScreen(p);return at.x>=0&&at.y>=0&&at.x<=canvas.clientWidth&&at.y<=canvas.clientHeight;};
// A cursor belongs to its world, and to the map only until the pointer takes hover over.
const keyOwned=()=>Boolean(keyCursor&&keyGame===game&&(!hover||hover===keyCursor));
function setKeyCursor(p) { keyCursor={x:Math.max(0,Math.min(game.width-1,p.x)),y:Math.max(0,Math.min(game.height-1,p.y)),keyboard:true};keyGame=game; }
function centreKeyCursor() { const box=canvas.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;setKeyCursor(terrainTools.has(tool)?renderer.screenToVertex(x,y,{clamp:true}):renderer.screenToTile(x,y,{clamp:true})); }
function dropKeyCursor() { if(!keyCursor)return;keyCursor=keyStart=null;if(hover?.keyboard)hover=null;preview=[];$('#placement-tip').hidden=true;clearTimeout(keyTimer); }
function placeTitle(x,y) {
 const t=tileAt(x,y),site=buildingAt(game,x,y),industry=game.industries.find(i=>industryContains(i,x,y));
 return game.stations.find(s=>s.x===x&&s.y===y)?.name||(industry?industry.name||INDUSTRIES[industry.kind].name:'')||game.cities.find(c=>c.x===x&&c.y===y)?.name||(site?BUILDINGS[site.building.kind]?.name||'Neighborhood workshop':'')||(t.zone?TOOL_INFO[t.zone].name+' zone':t.road?'Road':t.rail?'Railway':TERRAIN_NAMES[t.terrain]||'Countryside');
}
// The live region reads '<x>, <y> · <place> · <tool> · <cost or problem>', taking the quote from the placement tip.
function keyCursorText() {
 const {x,y}=keyCursor,tip=$('#placement-tip'),name=TOOL_INFO[tool]?.name||BUILDINGS[tool]?.name||INDUSTRIES[tool]?.name||'Build',station=game.stations.find(s=>s.x===x&&s.y===y);
 const action=isRoutePicking()?station?.mode===formDraft.mode?`Enter picks it as the ${routePicking==='from'?'start':'end'} stop`:`Choose a ${stopName(formDraft.mode)}`:tool==='inspect'||tip.hidden?name:tip.classList.contains('invalid')?`${name} · ${tip.textContent}`:tip.textContent;
 return `${x}, ${y} · ${placeTitle(x,y)} · ${action}`;
}
function showKeyCursor(announce=true) {
 if(!lineTools.has(tool)||isRoutePicking())keyStart=null;
 hover=keyCursor;preview=keyStart?constructionLine(keyStart,keyCursor,tool):[];
 const box=canvas.getBoundingClientRect(),at=keyScreen(keyCursor),shown=keyVisible(keyCursor);$('#tile-coordinates').textContent=`${keyCursor.x}, ${keyCursor.y} · ${BIOMES[game.biome].name}`;
 if(document.activeElement===canvas&&shown)updatePlacementTip({clientX:box.left+at.x,clientY:box.top+at.y,pointerType:'keyboard'});else $('#placement-tip').hidden=true;
 if(announce&&shown){clearTimeout(keyTimer);keyTimer=setTimeout(()=>{if(keyCursor&&keyGame===game)$('#map-cursor-status').textContent=keyCursorText();},400);}
}
function keyCursorKey(e) {
 if(e.target!==canvas||e.ctrlKey||e.metaKey||e.altKey||pointer||touchGesture)return false;
 if(!keyOwned())keyCursor=keyStart=null;
 const step={ArrowRight:[1,0],ArrowLeft:[-1,0],ArrowDown:[0,1],ArrowUp:[0,-1]}[e.key];
 if(e.key==='Escape'&&keyCursor){if(!e.repeat){if(keyStart){keyStart=null;showKeyCursor();}else dropKeyCursor();}return true;}
 if(step&&keyCursor&&!e.shiftKey){
  if(!keyVisible(keyCursor))centreKeyCursor();
  else{setKeyCursor({x:keyCursor.x+step[0],y:keyCursor.y+step[1]});const at=keyScreen(keyCursor),w=canvas.clientWidth,h=canvas.clientHeight;renderer.pan(Math.max(0,w*.15-at.x)-Math.max(0,at.x-w*.85),Math.max(0,h*.15-at.y)-Math.max(0,at.y-h*.85));}
  showKeyCursor();return true;
 }
 if(e.key!=='Enter')return false;
 if(e.repeat)return true;
 // The first Enter only shows the cursor, except that a line tool starts there: nothing is spent until a later Enter.
 if(!keyCursor||!keyVisible(keyCursor)){centreKeyCursor();if(lineTools.has(tool)&&!isRoutePicking()&&!keyStart)keyStart={x:keyCursor.x,y:keyCursor.y};showKeyCursor();return true;}
 if(hover!==keyCursor){showKeyCursor();return true;}
 const {x,y}=keyCursor;
 // A finished pick hands focus to the route form once the drawer has slid in far enough to take it.
 if(isRoutePicking()){pickRouteStopAt(x,y);if(isRoutePicking()){showKeyCursor();return true;}const next=['#add-route-vehicle','#route-form [type=submit]'].map(s=>$(s+':not(:disabled)')).find(Boolean)||$('#route-form [data-pick-route="to"]');next?.focus({preventScroll:true});if(next&&document.activeElement!==next)$('.sidebar').addEventListener('transitionend',()=>next.focus({preventScroll:true}),{once:true});return true;}
 if(tool==='inspect'){inspect(x,y,'','keyboard');return true;}
 if(lineTools.has(tool)&&!keyStart){keyStart={x,y};showKeyCursor();return true;}
 const points=keyStart?constructionLine(keyStart,keyCursor,tool):[{x,y}];keyStart=null;paintPath(points);showKeyCursor(false);return true;
}
canvas.addEventListener('pointerdown',()=>dropKeyCursor(),true);
canvas.addEventListener('pointermove',e=>{if(e.movementX||e.movementY)dropKeyCursor();},true);
canvas.addEventListener('focus',()=>{if(keyOwned())showKeyCursor();});
canvas.addEventListener('blur',()=>{if(hover?.keyboard)$('#placement-tip').hidden=true;});
// Keys and the wheel can move the camera under the cursor; its tip follows once they are done.
document.addEventListener('keyup',()=>{if(keyCursor&&hover===keyCursor&&document.activeElement===canvas)showKeyCursor(false);});
canvas.addEventListener('wheel',()=>{if(keyCursor&&hover===keyCursor)showKeyCursor(false);},{passive:true});
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
 if(keyCursorKey(e)){e.preventDefault();return;}
 if(e.key==='Escape'&&isRoutePicking()){e.preventDefault();cancelRoutePicking();return;}
 if($('#modal').open||e.target.matches('input,select,textarea')||e.target.closest('#layers-panel, #layers-button'))return;
 if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();if(!pointer)undoBuild();return;}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.code==='Space'){
  const control=e.target.closest('button,a,summary,[role=button]');if(control&&control!==pointerFocus)return;
  e.preventDefault();spaceConsumed=true;if(!e.repeat){spaceDown=true;spaceUsedForPan=false;spaceStarted=performance.now();if(pointer){pointer.pan=true;preview=[];spaceUsedForPan=true;canvas.classList.add('dragging');}}return;
 }
 if(e.repeat)return;const key=e.key.toLowerCase();
 if(key==='escape'){if(pointer&&!pointer.pan&&tool!=='inspect'){cancelGesture();return;}if(tool==='inspect')setCargoLens(null);setTool('inspect');closeMobile();return;}
 // Physical keys keep brackets and digits reachable on QWERTZ and AZERTY layouts; a printed + still zooms.
 const rail=preferredMode==='rail',keys={r:'road',t:'rail',s:'stop',p:'port',b:rail?'railbridge':'bridge',x:'bulldoze','1':'residential','2':'commercial','3':'industrial'},codes={KeyE:'level',BracketLeft:'lower',BracketRight:key==='+'?null:'raise',KeyN:rail?'railtunnel':'tunnel',Digit1:'residential',Digit2:'commercial',Digit3:'industrial'},next=keys[key]||codes[e.code];
 if(next){category=['residential','commercial','industrial'].includes(next)?'towns':'network';view='build';setView('build');setTool(next);return;}
 if(key==='l'){e.preventDefault();closeMapMenus();cancelGesture();layersView?.toggle();}
 if(key==='m')openAtlas();if(key==='c'&&!e.ctrlKey&&!e.metaKey)openChains();if(key==='g')$('#grid-button').click();if(key==='h')$('#home-view').click();if(key==='?')openHelp();
 if(key==='='||key==='+')$('#zoom-in').click();if(key==='-')$('#zoom-out').click();
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();renderer.pan(e.key==='ArrowLeft'?90:e.key==='ArrowRight'?-90:0,e.key==='ArrowUp'?90:e.key==='ArrowDown'?-90:0);refreshStroke();}
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
compactUI=mountCompactPlay({onMenu:openGameMenu,onNews:openNews,onCompany:openCompany,onGoals:openGoals,onView:setView,getView:()=>view,onCancelGesture:cancelGesture,onMinimapOpen:()=>{renderer.drawMinimap($('#minimap'));invalidateScene();}});
// Closing the drawer yourself ends a lens set by Routes or Industries; locating a site or picking a stop closes it and keeps the lens.
for(const el of [$('#close-management'),mobileToggle,...$$('.nav-button[data-view]')])el?.addEventListener('click',()=>{if(!$('.sidebar').classList.contains('mobile-open'))dropCargoLens('routes','industry');});
// Pointing at or focusing a route card lights its route on the map; a timed Show highlight outlives the pointer leaving.
let highlight={id:null,until:0};for(const type of ['pointerover','focusin','pointerout','focusout'])$('#panel-content').addEventListener(type,e=>{const card=e.target.closest?.('[data-route-id]');if(!card||card.contains(e.relatedTarget))return;const id=game.routes.find(route=>String(route.id)===card.dataset.routeId)?.id;if(type==='pointerover'||type==='focusin'){if(highlight.id!==id||highlight.until<=performance.now())highlight={id,until:Infinity,card};}else if(highlight.id===id&&highlight.until===Infinity)highlight={id:null,until:0};});
$('#offline-routes').addEventListener('click',()=>{routeFilters={query:'',mode:'all',status:'attention',cargo:'all'};routePage=0;setView('routes');revealInPanel($('#route-list .route-card'),null);});
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
 // A stroke held near or past the map's edge scrolls it, faster the further out, once the drag has moved.
 if(pointer&&!pointer.pan&&!pointer.cancelled&&pointer.moved&&pointer.tool===tool&&lineTools.has(tool)&&!touchGesture&&!spaceDown){
  const r=canvas.getBoundingClientRect(),band=pointer.type==='touch'?56:40,depth=(near,far)=>Math.max(0,Math.min(1.5,1-near/band))-Math.max(0,Math.min(1.5,1-far/band));
  const ex=depth(r.right-pointer.lastX,pointer.lastX-r.left),ey=depth(r.bottom-pointer.lastY,pointer.lastY-r.top),was=renderer.getCamera();
  if(ex||ey){renderer.pan(-ex*650*elapsed,-ey*650*elapsed);const at=renderer.getCamera();if(at.x!==was.x||at.y!==was.y)refreshStroke();}
 }
 // A capture holds only the next daily step; vehicles keep moving inside the day.
 if(speed>0){if(!capturingSave)tick(game,elapsed*speed,{reserved:preview});else{const room=Math.floor(game.day+1e-8)+1-game.day-1e-6;if(room>0)tick(game,Math.min(elapsed*speed,room));}}
 // Income floats up where cargo was paid for; deliveries at one stop within 300 ms share a figure.
 if(floaterGame!==game){floaters=[];floaterGame=game;}
 for(const event of drainDeliveryEvents(game)){const recent=floaters.find(f=>f.x===event.x&&f.y===event.y&&now-f.born<300);if(recent){recent.revenue+=event.revenue;continue;}floaters.push({x:event.x,y:event.y,revenue:event.revenue,cargo:event.cargo,born:now});if(!sounds||!mapLayers.deliveries||now-chimeAt<=700)continue;const p=renderer.worldToScreen(event.x,event.y);if(p.x>=0&&p.y>=0&&p.x<=canvas.clientWidth&&p.y<=canvas.clientHeight){chimeAt=now;chime();}}
 const floaterPaint=floaters.length>0;if(floaterPaint)floaters=floaters.filter(f=>now-f.born<1600).slice(-24);
 // Follow centres its carrier until the card closes, a tool is chosen or anything else moves the map.
 if(selectedVehicle&&$('#inspector').hidden)clearVehicle();
 if(follow){const at=renderer.getCamera(),v=follow.vehicle;if(follow.id!==selectedVehicle||tool!=='inspect'||follow.cx!==undefined&&Math.hypot(at.x-follow.cx,at.y-follow.cy)>2)stopFollow();else if(!(Math.abs(v.x-follow.x)<=.01&&Math.abs(v.y-follow.y)<=.01)){const lift=followLift();renderer.focus(v.x,v.y);if(lift)renderer.pan(0,-lift);const next=renderer.getCamera();Object.assign(follow,{x:v.x,y:v.y,cx:next.x,cy:next.y});}}
 const camera=renderer.getCamera(),w=canvas.width,h=canvas.height;
 // An aimed tile keeps hover and its tip through pans and pinches; a new stop's reach ring lets go after 1.5 s.
 if(reachFlash&&(reachFlash.until<now||selected!==reachFlash)){if(selected===reachFlash)selected=null;reachFlash=null;}
 const aim=liveAim();if(touchAim&&!aim){if(hover===touchAim.at)hover=null;touchAim=null;}
 else if(aim){hover=aim.at;const key=`${camera.x},${camera.y},${camera.zoom},${camera.height},${w},${h},${game.revision}`;if(!$('.sidebar').classList.contains('mobile-open')&&(aim.key!==key||$('#placement-tip').hidden)){aim.key=key;updatePlacementTip();}}
 if(highlight.card&&!highlight.card.isConnected)highlight={id:null,until:0};const highlightRoute=highlight.until>now?highlight.id:null;
 const changed=!painted||painted.game!==game||painted.day!==game.day||painted.revision!==game.revision||painted.money!==game.money||painted.scene!==sceneRevision||painted.x!==camera.x||painted.y!==camera.y||painted.height!==camera.height||painted.zoom!==camera.zoom||painted.w!==w||painted.h!==h||painted.layers!==mapLayers||painted.tool!==tool||painted.hover!==hover||painted.preview!==preview||painted.selected!==selected||painted.mode!==preferredMode||painted.view!==view||painted.from!==formDraft.from||painted.to!==formDraft.to||painted.highlight!==highlightRoute;
 if(changed||floaterPaint){
  renderer.render(now,{tool,hover,preview,selected,preferredMode,routeStops:routePickStops(),floaters,highlightRoute,selectedVehicleId:selectedVehicle,context:contextView(),...connectionView()});
  painted={game,day:game.day,revision:game.revision,money:game.money,scene:sceneRevision,x:camera.x,y:camera.y,height:camera.height,zoom:camera.zoom,w,h,layers:mapLayers,tool,hover,preview,selected,mode:preferredMode,view,from:formDraft.from,to:formDraft.to,highlight:highlightRoute};
 }
 if(now-hudAt>400&&(!hudState||hudState.game!==game||hudState.day!==game.day||hudState.revision!==game.revision||hudState.money!==game.money||hudState.zoom!==camera.zoom||hudState.w!==w||hudState.view!==view)){
  updateHud();hudAt=now;hudState={game,day:game.day,revision:game.revision,money:game.money,zoom:camera.zoom,w,view};
  const fresh=collectNotices(game.notifications,lastNoticeId);lastNoticeId=game.notifications[0]?.id;for(const entry of groupNotices(fresh))if(entry.topic!=='credit'||creditToast(entry,game.history))noticeQueue.push({...entry,type:toastType(entry.type),...entry.topic==='credit'?{action:{label:'Loan',run:()=>openCompany('loan')}}:{}});watchRoutes();
  watchMilestones();
  watchContracts();
  if(selected&&!$('#inspector').hidden&&!$('#inspector').contains(document.activeElement)&&!panelPress&&now-panelReleasedAt>250)inspect(selected.x,selected.y,selected.kind);
  if(selectedVehicle&&!$('#inspector').hidden)inspectVehicle(selectedVehicle,true);
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
