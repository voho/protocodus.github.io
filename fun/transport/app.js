import { mountCompactPlay } from './compact-play.js';
import { captureGame, encodeCapturedGame } from './background-jobs.js';
import { savePreparedGame, noteAutosaveTime } from './autosave-storage.js';
import { SAVE_KEY } from './model.js';
import { takeStartupGame, openStartMenu } from './start-menu.js';
import { surfaceHeight, tileSurface, MAX_HEIGHT } from './terrain-geometry.js';
import { refreshRouteConnections, getVehiclePurchase, getVehicleUpgrade, getFleetUpgrade, upgradeRouteVehicle, upgradeFleet, priceFor, inflationInfo, addRoute, removeRoute, saveGame, BIOMES, INDUSTRIES, CARGO, BUILD_COSTS, stationCoverage, industryConditions, settlementSuitability, weatherAt } from './model.js';
import { createRenderer } from './renderer.js';
import { TERRAIN_HEIGHT_VIEWS, loadTerrainHeight, saveTerrainHeight } from './terrain-view.js';
import { quoteBuildPlan, buildPlan } from './construction-plan.js';
import { captureUndo, finishUndo, undoConstruction, undoStale } from './construction-undo.js';
import { gridLine, planNetworkStroke, planConnection } from './network-router.js';
import { routeTileIndex } from './route-tiles.js';
import { nearbyStations } from './simulation-spatial.js';
import { routesNeedingAttention } from './gameplay-insights.js';
import { TILE } from './sprites.js';
import { drainDeliveryEvents } from './model.js';
import { renameStation, renameRoute } from './model.js';
import { editRoute } from './model.js';
import { AIRPORT_TOOLS, AIRPORT_REACH, AIRPORT_MIN_TILES, airAvailable, AIR_DEBUT_YEAR, stationAt, stationServes, stationDistance } from './model.js';
import { groundPhase } from './air-flight.js';
import { localToWorld } from './airport-art.js';
import { airDebutHeadline } from './headlines.js';
import { lineFor } from './route-lines.js';
import { vehicleModel, vehicleAge, ageText, fleetModelText, newYearModel, modelHeadline } from './vehicle-models.js';
import { cargoAmount } from './copy.js';
import { drawUIArtwork } from './ui-art.js';
import { integerText, tenthsText, compactText, dayText, monthText, longDayText } from './formatters.js';
import { BUILDINGS, BUILDING_GROUPS } from './buildings.js';
import { ZOOM_LEVELS, ZOOM_VIEWS, zoomIndex } from './zoom.js';
import { cargoIcon, cargoBadge, cargoRecipe } from './cargo-icons.js';
import { filterRoutes, validateRoutePlan, routeCargoList, routeCargoOptions, defaultRouteName } from './route-planner.js';
import { addRouteVehicle, sellRouteVehicle, getRouteFleet, getRetirementRefund, vehicleNoun, MAX_VEHICLES } from './model.js';
import { TOWN_CARGO } from './data.js';
import { isTownTraffic } from './data.js';
import { STATION_RADIUS } from './model.js';
import { townNeeds, NEED_WINDOW, townGrowth, townOutlook } from './settlements.js';
import { townOpinion, townActionQuote, townStopCounts, TOWN_ACTIONS } from './town-authority.js';
import { marketView, demandInputs, demandLabel, familyCargo, townOf, FAMILIES, MARKET, TOWN_RADIUS } from './town-market.js';
import { workshopLevels, workshopRecipes } from './town-market.js';
import { expandWorkshop } from './model.js';
import { WORKSHOP } from './data.js';
import { nearbyZones } from './simulation-spatial.js';
import { buyTownAction } from './model.js';
import { fundedTown } from './town-authority.js';
import { fundForecast } from './settlements.js';
import { propertyAt, propertyValue, companyProperty, townHoldings, drainPropertyEvents, SALE_SHARE } from './town-market.js';
import { returnsTotals } from './town-market.js';
import { forecastNote } from './town-forecast.js';
import { sellProperty } from './model.js';
import { count as countText } from './copy.js';
import { dateLong, escapeHTML, listJoin } from './copy.js';
import { forecastRoute } from './route-planner.js';
import { setRouteFullLoad, waitingForFullLoad } from './model.js';
import { fullFareText } from './route-planner.js';
import { paymentRatesHTML, bindPaymentRates, routeTrip, planTrip, tripText, tripTitle, planText, keepText } from './payment-rates.js';
import { findIndustryTargets, findIndustrySuppliers, lensCargo } from './chains.js';
import { mountChains } from './chains-view.js';
import { mountGallery } from './gallery-view.js';
import { mountSaves } from './saves-view.js';
import { loadVisibility, saveVisibility, normalizeLayers, layerPreset } from './visibility.js';
import { mountVisibility } from './visibility-view.js';
import { townService, industryStatus, routeHealth, nextProject } from './gameplay-insights.js';
import { collectNotices, groupNotices, crossedMilestone, newYearNotice, toastType } from './ui-notices.js';
import { MILESTONES, CHAPTERS, milestoneChapters, metMilestones, progressText } from './milestones.js';
import { contractState, contractSites } from './contracts.js';
import { loanTerms, borrow, repay } from './model.js';
import { CAREER_TITLES, RATING_PARTS, MIN_RATED_FLEET, careerTitle, nextTitle, nextReviewDay, companyValue, partTarget } from './company-rating.js';
import { money as moneyText, dateShort } from './copy.js';
import { routeNeedsAttention } from './gameplay-insights.js';
import { routeCapacity } from './gameplay-insights.js';
import { cargoName } from './copy.js';
import { creditToast } from './ui-notices.js';
import { HEADLINE_PRIORITY, headlineKicker, headlineWatch, detectHeadlines, headlineTier, townHeadline, recordHeadline } from './headlines.js';
import { ACHIEVEMENTS, TIER_NAMES, achievementById, drainAchievementUnlocks, earnedCount } from './achievements.js';
import { renderAchievements, medalIcon } from './achievements-view.js';
import { achievementNotices } from './ui-notices.js';
import { networkTotals } from './model.js';
import { activeCities } from './settlements.js';
import { has as hasIcon } from './ui-icons.js';
import { preloadHouses, onHouseAssetsChange } from './raster-houses.js';
import { preloadWorldArt, onWorldArtChange, startupArtCells } from './atlas-runtime.js';
import { industryContains, industrySize, industryFootprint } from './industry-sites.js';
import { industryDistance } from './industry-sites.js';
import { outputFill } from './industry-simulation.js';
import { calendarYear } from './economy-pricing.js';
import { buildingAt, buildingSize, buildingFootprint } from './building-sites.js';
import { terrainObjectAt, terrainObjectSize } from './terrain-objects.js';
import { showLoading, updateLoading, hideLoading, isLoading, paintLoading } from './loading-screen.js';
import { installReferences, linkFromMap, resolveRef, refKey, refMark, refFor, renderTemplate } from './ui-refs.js';
import { bullet } from './ui-line.js';
import { reducedMotion, cameraDuration, scrollIntoViewSafe } from './ui-motion.js';
import { createFrameScheduler } from './frame-scheduler.js';
import { createWorldClock } from './world-clock.js';
import { tiles as tilesText } from './copy.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const integer = integerText;
const money = value => '$' + integer(Math.abs(value));
const compactMoney = value => value >= 1000 ? '$' + tenthsText(value / 1000) + 'k' : money(value);
import { icon as uiIcon, modeGlyph, ALIASES } from './ui-icons.js';
function icon(name, cls = '') { return uiIcon(ALIASES[name] || name, { cls }); }
const transportName = mode => ({road:'Road',rail:'Rail',water:'Water',air:'Air'})[mode] || 'Transport';
const transportIcon = (mode, cargo = formDraft.cargo) => modeGlyph(mode, cargo);
const stopName = mode => mode==='air'?'airport':mode==='water'?'port':mode==='rail'?'rail station':'road stop';
const aStop = mode => (mode==='air'?'an ':'a ')+stopName(mode);
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = uiIcon(ALIASES[el.dataset.icon] || el.dataset.icon, { size: Number(el.dataset.iconSize) || 20 }); }); }
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
 stop:{name:'Stop',icon:'bus',key:'S',detail:'Click clear land or a road near customers. Missing road is built with the stop; rail stations need a railway.'},
 'bus-stop':{name:'Road stop',icon:'bus',key:'S',detail:'Place on clear land or a road, within 5 tiles of customers. A missing road is included in the price.'},
 'train-stop':{name:'Rail station',icon:'train',detail:'Place on rail, within 5 tiles of customers.'},
 port:{name:'Port',icon:'port',key:'P',detail:'Place on water beside a bank, within 5 tiles of customers. Ships follow connected rivers, lakes and seas.'},
 airport:{name:'Airport',icon:'plane',key:'A',detail:'Place a 6 × 2 airport on clear, level land within 7 tiles of a town. A turns the runway.'},
 'airport-x':{name:'Airport',icon:'plane',key:'A',detail:'Place a 6 × 2 airport on clear, level land within 7 tiles of a town. A turns the runway.'},
 'airport-y':{name:'Airport',icon:'plane',key:'A',detail:'Place a 6 × 2 airport on clear, level land within 7 tiles of a town. A turns the runway.'},
 residential:{name:'Residential',icon:'house',key:'1',detail:'Zone homes by roads. Transport brings residents.'},
 commercial:{name:'Commercial',icon:'shop',key:'2',detail:'Zone shops by roads. Transport drives growth.'},
 industrial:{name:'Industrial',icon:'factory',key:'3',detail:'Zone industry by roads. Each 2 × 2 plot becomes a workshop.'},
 workshop:{name:'Workshop',icon:'workshop',detail:'Place within 10 tiles of a town center. Turns delivered materials into products for other towns.'},
 city:{name:'Found a town',icon:'city',detail:'Place on open land. Add roads, zones and transport.'},
 bulldoze:{name:'Bulldozer',icon:'bulldoze',key:'X',detail:'Click or drag to clear buildings, groves, rocks or individual network tiles. Each whole site is charged once. Retire routes before removing stops.'}
};
updateLoading('Preparing terrain and your company…',1);
await paintLoading();
let game;
game=takeStartupGame()||await openStartMenu();
updateLoading('Loading buildings, vehicles and landscapes…',2);
await paintLoading();
await Promise.all([preloadHouses({biome:game.biome,cells:startupArtCells()}),preloadWorldArt({biome:game.biome,cells:startupArtCells()})]);
const canvas = $('#world');
let sceneRevision=0,frameScheduler=null,interactionUntil=0;
const wakeFrame=()=>{if(!document.hidden)frameScheduler?.wake();};
const invalidateScene=()=>{sceneRevision++;wakeFrame();};
const renderer = createRenderer(canvas, game,{onInvalidate:invalidateScene,heightStep:loadTerrainHeight()});
const simulation=createWorldClock({game,beforeCommit:()=>simulation.motion.setTracked([...renderer.motionVehicles(Math.max(speed*2,simulation.getStats().pendingDays+speed)),...follow?[follow.vehicle]:[],...selectedVehicle?game.vehicles.filter(vehicle=>vehicle.id===selectedVehicle):[]])});
// Camera APIs also serve keyboard controls and diagnostics outside DOM events.
// Their changes wake a paused map instead of waiting for the idle timer.
for(const method of ['setGame','setLayers','setTerrainHeight','setLens','resize','pan','zoomAt','setZoom','focus','glideTo','setBand']){
 const original=renderer[method];renderer[method]=function(...args){const result=original.apply(this,args);wakeFrame();return result;};
}
document.fonts?.ready.then(invalidateScene);
let pricingYear = inflationInfo(game).year;
let mapLayers = loadVisibility(), layersView = null, layerStorageNotice = false;
renderer.setLayers(mapLayers);
let compactUI=null;
let view = 'build', category = 'network', tool = 'inspect', speed = 1, previousSpeed = 1;
let buildingGroup = 'homes';
let buildPanelState=null, constructionNext=null;
let hover = null, selected = null, preview = [];
let pointer = null, spaceDown = false, spaceUsedForPan = false, sounds = false, audioContext;
let floaters = [], floaterGame = null, presentationDeliveries=[],presentationRents=[],chimeAt = 0, incomeSeen = {}, incomePulseAt = -Infinity;
let preferredMode = 'road', engineeringOpen = false;
let airportAxis = 'x'; // The runway's way round for the Airport tool, for this session only.
let lastFrame = performance.now(), hudAt = 0, saveAt = performance.now(), minimapAt = 0, panelAt = 0;
let worldSerial=0,savedWorld=-1,savedDay=-1,savedRevision=-1;
let pendingSave=null, capturingSave=false, menuOpening=false;
let formDraft = { name:'', mode:'road', from:'', to:'', cargo:'passengers', fullLoad:false, optionsOpen:false };
const ROUTES_PER_PAGE = 50;
let routePage = 0, routeScreen = 'list', fleetControlsOpen = false;
const routeDetailsOpen=new Set();
let routeFilters = { query:'', mode:'all', status:'all', cargo:'all' }, routePicking = '';
let entityFilters = { towns:'', industry:'', kind:'all' };
let lastRevision = -1;
let outstandingTowns = new Set();
let lastNoticeId = game.day<1 ? undefined : game.notifications[0]?.id;
let goalChoice = null, goalSignature = '', goalOpen = false, goalSeen = null, goalChanged = false, goalFolded = (() => { try { const stored = localStorage.getItem('transport-next-goal-v2'); return stored ? stored === 'folded' : Boolean(localStorage.getItem('transport-next-goal-v1')); } catch { return false; } })();
let noticeQueue=[],noticeAt=0,pacedNoticeAt=-Infinity,panelPricesStale=false,knownRoutes=new Set(),firstDeliveryPending=new Set(),townPeaks=new Map(),townDay=-1;
let seenMilestones=new Set(),milestoneMonth=-1;
let achievementMonth=-1;
let ratingSeen={titles:1,century:false},ratingRow='',ratingDetailsOpen=false;
let rentSeen=(game.totalProperty||0)>0,sellAsk='';
let headlineWatchState=null,headlineQueue=[],headlineCurrent=null,headlineClosedAt=-Infinity,headlineHeld=false,headlineVisible=true,headlineCheckedAt=0,headlinesOn=(()=>{try{return localStorage.getItem('transport-headlines-v1')!=='off';}catch{return true;}})();
resetMoments();
const spanTools = new Set(['bridge','railbridge','tunnel','railtunnel']);
const terrainTools = new Set(['raise','lower','level']);
const lineTools = new Set(['road','rail',...spanTools,...terrainTools,'residential','commercial','industrial','bulldoze']);
function closeManagement() { compactUI?.closeManagement(); }
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
 // A hidden mini map is resampled when it next opens.
 if(!compactUI||compactUI.isMinimapVisible()){renderer.drawMinimap($('#minimap'));minimapAt=performance.now();}
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
 const {type=options===true?'error':'ok',action=null,key=message,silent=false,tier='',template=''}=typeof options==='object'&&options?options:{},region=$('#toast-region');
 let el=[...region.children].find(node=>node.toastKey===key),count=1;
 if(el){count=el.toastCount+1;clearTimeout(el.toastTimer);}else{el=document.createElement('div');region.append(el);}
 el.className='toast'+(type==='ok'?'':' '+type)+(tier?` achievement tier-${tier}`:'');el.toastKey=key;el.toastCount=count;
 const actions=[action].flat().filter(Boolean),buttons=actions.map(item=>`<button type="button" class="toast-action">${escapeHTML(item.label)}</button>`).join('');
 el.innerHTML=(tier?medalIcon(tier):icon(type==='ok'||type==='milestone'?'check':'warning'))+`<span>${template?renderTemplate(template,game,{onInk:true}):escapeHTML(message)}</span>`+(count>1?`<b class="toast-count">×${count}</b>`:'')+(actions.length>1?`<div class="toast-actions">${buttons}</div>`:buttons);
 el.querySelectorAll('.toast-action').forEach((button,index)=>{button.onclick=()=>{el.remove();actions[index].run();};});
 while(region.children.length>3) region.firstChild.remove();
 el.toastTimer=setTimeout(()=>el.remove(),type==='warning'||type==='error'||tier==='gold'||tier==='platinum'?8000:5000); $('#status-message').textContent=message; if(!silent&&type!=='ok')beep(type==='milestone'?'ok':'error');
}
function changeSpeed(next) { const now=performance.now();simulation.setSpeed(next,now,{blocked:capturingSave,reserved:preview});simulation.setActive(!document.hidden&&!isLoading()&&!$('#start-menu')?.open,now,{blocked:capturingSave,reserved:preview});renderer.setPresentation(simulation.motion,simulation.getPresentationDay());if(next>0)previousSpeed=next;if(speed===0&&next>0)lastFrame=now;speed=next; $$('.speed-control button').forEach(el=>{el.classList.toggle('active',Number(el.dataset.speed)===speed);el.setAttribute('aria-pressed',String(Number(el.dataset.speed)===speed));}); syncPaused();wakeFrame(); }
// A frozen world can look hung, so pausing names itself (DESIGN.md 12.1): "Paused" under the date in orange, where the
// weather word otherwise sits, and a thin orange line along the top of the map. Pausing moves nothing.
function syncPaused() {
 $('#app').classList.toggle('is-paused',speed===0);
 const note=$('#date-note');if(!note)return;
 note.textContent=speed===0?'Paused':$('#weather')?.dataset.condition||'';note.classList.toggle('paused',speed===0);
 $('.date-block').title=speed===0?'Paused. Press Space to resume.':'';
}
function closeMapMenus(restoreFocus=false) {
 for(const [menuId,buttonId] of [['zoom-menu','zoom-level'],['map-options','map-options-button']]){
  const menu=$('#'+menuId),button=$('#'+buttonId);if(!menu||menu.hidden)continue;
  menu.hidden=true;button.setAttribute('aria-expanded','false');if(restoreFocus)button.focus({preventScroll:true});
 }
}
function toggleMapMenu(menuId,buttonId) {
 const menu=$('#'+menuId),opening=menu.hidden;closeMapMenus();layersView?.close();
 if(opening){cancelGesture();compactUI?.hideMinimap();closeManagement();closeInspector();menu.hidden=false;$('#'+buttonId).setAttribute('aria-expanded','true');menu.querySelector('button')?.focus({preventScroll:true});}
}
function syncToolControls() {
 const bar=$('#active-tool-bar');if(!bar)return;
 bar.hidden=tool==='inspect'||isRoutePicking();
 const info=TOOL_INFO[tool]||BUILDINGS[tool]||INDUSTRIES[tool],network=preferredMode==='rail'?'railway':'road';
 $('#active-tool-icon').innerHTML=icon(info?.icon||'factory');
 $('#active-tool-name').textContent=info?.name||'Build';
 $('#active-tool-hint').textContent=lineTools.has(tool)?'Drag to build · Done opens Build':'Click to place · Done opens Build';
 if(tool==='road'||tool==='rail')$('#active-tool-hint').textContent='Drag to build. Go straight up slopes and turn on flat ground.';
 if(tool==='stop')$('#active-tool-hint').textContent=preferredMode==='road'?'Click land or road near customers · Missing road included':'Click a railway within 5 tiles of customers';
 if(tool==='port')$('#active-tool-hint').textContent='Click water beside land, near customers';
 if(['residential','commercial','industrial'].includes(tool))$('#active-tool-hint').textContent='Drag an area · Shift for a line';
 if(tool==='bulldoze')$('#active-tool-hint').textContent='Click or drag · Clears whole sites';
 if(BUILDINGS[tool]||INDUSTRIES[tool]||tool==='workshop'){const size=BUILDINGS[tool]?buildingFootprint(tool):INDUSTRIES[tool]?industryFootprint(tool):WORKSHOP.footprint;$('#active-tool-hint').textContent=`${size} × ${size} site · Click to place`;}
 if(terrainTools.has(tool))$('#active-tool-hint').textContent=tool==='level'?'Drag an area · Match the first point':`Click or drag · ${tool==='raise'?'+1':'−1'} level per point`;
 if(spanTools.has(tool))$('#active-tool-hint').textContent='Drag straight · Flat ends at the same level';
 if(tool==='airport')$('#active-tool-hint').textContent='Click to place. A turns the runway.';
 $('#active-tool-turn').hidden=tool!=='airport';
 $('#map-hint').hidden=tool!=='inspect'||isRoutePicking();
}
function setTool(next) {
 compactUI?.hideMinimap();
 if(next==='airport'&&!airAvailable(game)){toast(`Air travel arrives on 1 January ${AIR_DEBUT_YEAR}.`,{type:'warning',key:'air-debut',silent:true});return;}
 cancelGesture();closeMapMenus();cancelRoutePicking();constructionNext=null;
 if(['road','bridge','tunnel','bus-stop'].includes(next))preferredMode='road';
 if(['rail','railbridge','railtunnel','train-stop'].includes(next))preferredMode='rail';
 if(spanTools.has(next)||terrainTools.has(next)){category='network';engineeringOpen=true;}
 tool=['bus-stop','train-stop'].includes(next)?'stop':next;selected=null;hover=null;
 $('#inspector').hidden=true;canvas.classList.toggle('build-mode',tool!=='inspect');
 $('#status-message').textContent=toolDescription(tool);if(!syncBuildToolSelection())renderPanel();syncToolControls();
 closeManagement();canvas.focus({preventScroll:true});
 if(keyOwned()){keyStart=null;showKeyCursor();}
 wakeFrame();
}
function setView(next, options = {}) {
 if(next==='routes')routeScreen=options.routeScreen||((view==='routes'&&isRoutePicking())?routeScreen:'list');
 layersView?.close();
 const changedView=view!==next;
 cancelGesture();closeMapMenus();if(next!=='routes')cancelRoutePicking();
 if(cargoLens&&(cargoLens.game!==game||cargoLens.origin!=='chains'&&cargoLens.origin!==next))setCargoLens(null);
 if(next!=='build'&&tool!=='inspect'){tool='inspect';canvas.classList.remove('build-mode');}
 if(next==='towns'||next==='industry')anchorEntities();
 view=next;closeInspector();
 $$('.nav-button[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
 renderPanel({resetScroll:changedView});syncToolControls();if(compactUI){compactUI.openManagement();updateHud();}
 wakeFrame();
}
function infrastructureKind(key) {
 return ({stop:preferredMode==='rail'?'train-stop':'bus-stop',bridge:'road-bridge',railbridge:'rail-bridge',tunnel:'road-tunnel',railtunnel:'rail-tunnel'})[key]||(['road','rail','port','bus-stop','train-stop','airport'].includes(key)?key:'');
}
function infrastructurePortrait(kind,cls='tool-art') { return `<canvas class="${cls}" width="72" height="56" data-infrastructure-sprite="${kind}" aria-hidden="true"></canvas>`; }
function industryPortrait(kind,cls='entity-art',site=null) { const footprint=site?industrySize(site):industryFootprint(kind),variant=site&&kind==='farm'?(site.variant??(Math.imul(site.x,31)+site.y+(game.seed||0)))&1:0;return `<canvas class="${cls}" width="112" height="112" data-industry-sprite="${kind}" data-industry-footprint="${footprint}" data-industry-variant="${variant}" aria-hidden="true"></canvas>`; }
function toolCard(key, label) {
 // Before air travel arrives the Airport card waits, greyed, with its year.
 const info=TOOL_INFO[key],base=key==='stop'?Math.min(BUILD_COSTS['bus-stop'],BUILD_COSTS['train-stop']):BUILD_COSTS[key==='airport'?'airport-x':key],automatic=['road','rail','stop'].includes(key),locked=key==='airport'&&!airAvailable(game);
 return `<button class="tool-card ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}" ${locked?'aria-disabled="true" ':''}${info.key?`aria-keyshortcuts="${info.key}" `:''}title="${escapeHTML(locked?`Air travel arrives on 1 January ${AIR_DEBUT_YEAR}.`:info.key?`${info.detail} (${info.key})`:info.detail)}">${infrastructureKind(key)?infrastructurePortrait(infrastructureKind(key)):key==='workshop'?'<canvas class="tool-art" width="96" height="100" data-building-sprite="factory" aria-hidden="true"></canvas>':icon(info.icon)}<span class="tool-title">${label||info.name}</span><span class="tool-cost">${locked?`From ${AIR_DEBUT_YEAR}`:`${automatic?'from ':''}${compactMoney(priceFor(game,base))}`}${lineTools.has(key)?key==='bulldoze'?' / site':key==='level'?' / step':terrainTools.has(key)?' / point':' / tile':''}</span>${info.key?`<span class="shortcut" aria-hidden="true">${info.key}</span>`:''}</button>`;
}
function toolDescription(key) {
 if (key==='workshop') return workshopDescription();
 if (TOOL_INFO[key]) return TOOL_INFO[key].detail;
 if (BUILDINGS[key]) { const b=BUILDINGS[key];return `${b.name} · ${buildingFootprint(key)} × ${buildingFootprint(key)} clear tiles near roads.`; }
 if (INDUSTRIES[key]) {const d=INDUSTRIES[key];return `${d.name} · ${industryFootprint(key)} × ${industryFootprint(key)} clear tiles. Add a stop within 5 tiles.`;}
 return 'Choose a tool.';
}
// This environment's recipes, and what one level works in a month.
function workshopDescription() {
 const month=WORKSHOP.rate*30;
 return `Workshop, 2 × 2. Turns ${listJoin(workshopRecipes(game).map(r=>`${CARGO[r.input].name.toLowerCase()} into ${CARGO[r.output].name.toLowerCase()}`))}. Each level turns ${integer(month)} materials a month into about ${integer(Math.floor(month/WORKSHOP.ratio))} products.`;
}
function buildingBenefit(kind) {
 const definition=BUILDINGS[kind];
 if(definition.residents)return `${definition.residents} residents per level when placed within 10 tiles of a town. Nearby services and greenery help homes flourish.`;
 const effects={school:'Helps nearby neighborhoods develop and supports local factory productivity.',hospital:'Improves neighborhood appeal and supports local factory productivity.','police-station':'Supports local traffic and lowers nearby vehicle upkeep.','fire-station':'Lowers nearby factory upkeep and improves neighborhood appeal.','park-village':'A neighborhood green with paths and seating. Adds greenery and improves nearby development.','park-formal':'Flower beds and a fountain create public green space and improve nearby development.','park-woodland':'A larger wooded park adds natural cover and improves nearby development.','mall-neighborhood':'A small shopping court with food and household shops. Adds city demand and earns property rent.','mall-shopping':'A shopping center with food and household shops. Adds city demand for their deliveries.','mall-modern':'A large modern mall with food and household shops. Adds city demand and earns property rent.'};
 return effects[kind]||(definition.group==='shops'?'Attracts nearby development and supports local passenger demand.':definition.group==='services'?'Attracts nearby development and supports local transport and industry. Near a town centre it adds mail.':'Improves neighborhood appeal and supports local passenger demand.');
}
function buildingPalette() {
 return `<div class="section-divider"></div><div class="panel-heading"><h2>Buildings</h2><span>${Object.keys(BUILDINGS).length} types</span></div><label class="building-filter"><span class="sr-only">Building collection</span><select id="building-group" aria-label="Building collection">${Object.entries(BUILDING_GROUPS).map(([key,g])=>`<option value="${key}" ${buildingGroup===key?'selected':''}>${g.name} · ${Object.values(BUILDINGS).filter(b=>b.group===key).length}</option>`).join('')}</select></label><div class="building-grid">${Object.entries(BUILDINGS).filter(([,b])=>b.group===buildingGroup).map(([key,b])=>`<button class="building-card ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}" title="${escapeHTML(b.name)} · ${buildingFootprint(key)} × ${buildingFootprint(key)} site · ${money(priceFor(game,b.cost))} · ${escapeHTML(buildingBenefit(key))}"><canvas width="96" height="100" data-building-sprite="${key}" aria-hidden="true"></canvas><span class="building-tier">${b.tier||BUILDING_GROUPS[b.group].name}</span><strong>${escapeHTML(b.name)}</strong><span class="building-price">${money(priceFor(game,b.cost))}<small>${buildingFootprint(key)} × ${buildingFootprint(key)}</small></span></button>`).join('')}</div>`;
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
   // Both centres at least 40 px inside the visible band at Town view, else Region.
   const a=center(extra.choice.source),b=center(extra.choice.buyer),band=syncBand(),fits=zoom=>Math.abs((a.x-a.y)-(b.x-b.y))*TILE*zoom/2<band.width/2-40&&Math.abs((a.x+a.y)-(b.x+b.y))*TILE*zoom/4<band.height/2-40;
   glideCamera({x0:Math.min(a.x,b.x),y0:Math.min(a.y,b.y),x1:Math.max(a.x,b.x),y1:Math.max(a.y,b.y)},{zoom:Math.hypot(a.x-b.x,a.y-b.y)>20||!fits(1)?.5:1});updateHud();
  }
 }
 else if(action==='launch'){formDraft={name:'',mode:extra.mode,from:String(extra.from??''),to:String(extra.to??''),cargo:extra.cargo,fullLoad:false,optionsOpen:false};setView('routes',{routeScreen:'new'});scrollIntoViewSafe($('#route-form'),{block:'nearest'});}
 else if(action==='chains')openChains();
 else if(action==='routes')setView('routes');
 else if(action==='towns'){category='towns';setView('build');$('#panel-content').scrollTop=0;}
 else openAtlas();
}
// The next goal card repaints only when its text, checklist or progress changes.
// Folding is a preference, not a title: a folded card only marks a new goal on its chip and reopens from the chip or Show on map.
function storeGoalFolded(folded) { goalFolded=folded;try{localStorage.setItem('transport-next-goal-v2',folded?'folded':'open');localStorage.removeItem('transport-next-goal-v1');}catch{} }
function renderGoal() {
 // DESIGN.md 11.4: the ladder is open by itself only during onboarding; after the first route the goal is one line, a flag,
 // its title and its figure, that opens on demand and folds again once its action is taken.
 const project=nextProject(game,{source:goalChoice}),steps=project.steps||[],current=steps.findIndex(step=>!step.done),collapsed=goalFolded||(!steps.length&&!goalOpen),visible=mapLayers.goal!==false;
 if(goalSeen===null||visible&&!collapsed){goalSeen=project.title;goalChanged=false;}else if(project.title!==goalSeen)goalChanged=true;
 const signature=[project.title,project.detail,steps.map(step=>`${step.done}${step.label}${step.button}`).join(),current,project.progress?.value,project.choice,project.choices?.length,collapsed,goalOpen,goalChanged,visible].join('|');
 if(signature===goalSignature)return;goalSignature=signature;
 const card=$('#objective-card');card.hidden=!visible;card.classList.toggle('collapsed',collapsed);card.classList.toggle('open',goalOpen&&!collapsed);card.classList.toggle('changed',goalChanged);
 $('#objective-chip-title').textContent=project.title;$('#objective-title').textContent=project.title;$('#objective-detail').textContent=project.detail;$('#objective-detail').hidden=steps.length>0;$('#objective-title').title=steps.length?project.detail:'';
 const figure=project.figure||'';$('#objective-chip-figure').textContent=figure;$('#objective-chip-figure').hidden=!figure;
 $('#objective-chip-progress').hidden=!project.progress;$('#objective-chip-progress').style.width=(project.progress?Math.min(1,project.progress.value/project.progress.max)*100:0)+'%';
 $('#objective-steps').hidden=!steps.length;
 // One step, one action: the open step's own label runs it (its action names it in the title); the card's single button
 // is Plan road when the game can plan the line, else that step's action, else the goal's own.
 $('#objective-steps').innerHTML=steps.map((step,index)=>{const mark=step.done?icon('check'):`<span class="step-circle">${index+1}</span>`,label=`${escapeHTML(step.label)}${step.done?'<span class="sr-only"> · done</span>':''}`;return `<li class="objective-step${step.done?' done':''}${index===current?' current':''}">${mark}${index===current&&step.button?`<button type="button" class="objective-step-link" data-goal-step="${index}" title="${escapeHTML(step.button)}">${label}${icon('chevronRight')}</button>`:`<span>${label}</span>`}</li>`;}).join('');
 $('#objective-progress').hidden=!project.progress;$('#goal-bar').style.width=(project.progress?project.progress.value/project.progress.max*100:0)+'%';
 const primary=project.plan?'':steps.length?steps[current]?.button||'':project.button;
 $('#objective-action').hidden=!primary;$('#objective-action').innerHTML=escapeHTML(primary)+icon('arrow');$('#objective-another').hidden=!(project.choices?.length>1);$('#guide-button').hidden=true;$('#objective-goals').hidden=steps.length>0;
 $('#objective-plan').hidden=!project.plan;$('#objective-plan').textContent=project.plan==='rail'?'Plan rail':'Plan road';
 $('#app').classList.toggle('goal-layer-off',!visible);
 if(connectionPlan&&!(project.plan&&project.choices[project.choice].source.id===connectionPlan.source.id))cancelConnectionPlan(); // Another idea or a joined pair ends a waiting plan.
}
function goalClick(e) {
 const button=e.target.closest('button');if(!button||button.id==='guide-button')return;
 const project=nextProject(game,{source:goalChoice}),keyboard=e.detail===0;
 if(button.id==='dismiss-objective'){storeGoalFolded(true);goalOpen=false;}
 else if(button.id==='objective-chip'){storeGoalFolded(false);goalOpen=true;}
 else if(button.id==='objective-another'){const next=project.choices[(project.choice+1)%project.choices.length];goalChoice=next.source?.id??next;if(view==='build')renderPanel();}
 else if(button.id==='objective-action'){
  goalOpen=false;const steps=project.steps||[],step=steps.find(step=>!step.done);
  if(steps.length&&step?.action)runProjectAction(step.action,project.target,{...step,choice:project.choices[project.choice]});else runProjectAction(project.action,project.target,{tool:project.tool});
 }
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
 // Where each point's far corner would land with the view centred on them and shifted by the insets, terrain aside.
 const shift={x:(inset.left-inset.right)/2,y:(inset.top-inset.bottom)/2},fits=zoom=>points.every(p=>{const x=canvas.clientWidth/2+shift.x+((p.x-cx)-(p.y-cy))*TILE*zoom,y=canvas.clientHeight/2+shift.y+((p.x-cx)+(p.y-cy)+1)*TILE/2*zoom;return x>inset.left&&y>inset.top&&x<canvas.clientWidth-inset.right&&y<canvas.clientHeight-inset.bottom;});
 glideCamera({x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)},{zoom:fits(1)?1:.5,offset:shift});
 updateHud();
}
function showConnectionPlan() {
 const {plan,cargo}=connectionPlan,short=plan.cost>game.money,reused=plan.ends.find(Boolean);
 let banner=$('#connection-plan-banner');if(!banner){banner=document.createElement('div');banner.id='connection-plan-banner';banner.className='route-pick-banner connection-plan-banner';banner.setAttribute('role','status');banner.dataset.band='';$('.map-section').append(banner);}
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
 const groups={network:['road','rail','stop','port','airport','bulldoze'],towns:['residential','commercial','industrial','workshop','city']};
 const tabs=`<div class="build-tabs" role="tablist" aria-label="Construction categories">${[['network','Network'],['towns','Town'],['industry','Industry']].map(([key,label])=>`<button role="tab" aria-selected="${category===key}" data-category="${key}" class="${category===key?'active':''}">${label}</button>`).join('')}</div>`;
 const industries=`<div class="tool-list">${Object.entries(INDUSTRIES).filter(([,d])=>d.biomes.includes(game.biome)).map(([key,d])=>`<button class="industry-tool ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}"><canvas class="industry-art" width="112" height="112" data-industry-sprite="${key}" aria-hidden="true"></canvas><span class="industry-tool-summary"><strong>${d.name}</strong>${cargoRecipe(d.inputs,d.outputs,{counts:false})}</span><span class="tool-cost">${compactMoney(priceFor(game,d.cost))}<small>${industryFootprint(key)} × ${industryFootprint(key)}</small></span></button>`).join('')}</div>`;
 return `<div class="panel-heading"><h2>Build</h2></div>${constructionNext?`<section class="construction-next" aria-label="Next construction step"><strong>${escapeHTML(constructionNext.message)}</strong><div>${constructionNext.kind==='network'?'<button type="button" class="button button-primary" data-construction-next="stop">Add stops</button>':'<button type="button" class="button button-primary" data-construction-next="route">Create a route</button><button type="button" class="small-button" data-construction-next="stop">Add another stop</button>'}</div></section>`:''}${tabs}${category==='industry'?industries:`<div class="tool-grid">${groups[category].map(key=>toolCard(key)).join('')}</div>`}<div class="stop-mode-picker" data-build-stop-mode role="group" aria-label="Stop type at road and rail crossings"${tool==='stop'?'':' hidden'}><span>At crossings</span>${['road','rail'].map(mode=>`<button data-stop-mode="${mode}" aria-pressed="${preferredMode===mode}">${icon(mode)} ${mode==='road'?'Road':'Rail'}</button>`).join('')}</div>${category==='network'?engineeringTools():''}${category!=='network'?`<div class="build-bottom-tools"><button class="compact-tool danger ${tool==='bulldoze'?'active':''}" data-tool="bulldoze" aria-keyshortcuts="X" title="Bulldozer (X)">${icon('bulldoze')} Bulldozer <span>X</span></button></div>`:''}${category==='towns'?buildingPalette():projectCard()}`;
}
// The picker's tiles are icons; the legend names the cargo chosen.
function syncCargoChoice(panel) {
 panel.querySelectorAll('[data-cargo-choice]').forEach(choice=>choice.setAttribute('aria-pressed',String(choice.dataset.cargoChoice===formDraft.cargo)));
 const chosen=panel.querySelector('.cargo-chosen');if(chosen)chosen.textContent=CARGO[formDraft.cargo]?.name||'';
}
function cargoChoices(options=[]) {
 const available=routeCargoList(game).filter(editCargo).map(key=>[key,CARGO[key]]),verdicts=new Map(options.map(option=>[option.cargo,option]));
 const fit=(key,c)=>{const option=verdicts.get(key);return (option?` data-fits="${option.valid}"`:'')+` title="${escapeHTML(option&&!option.valid?option.message:c.name)}"`;};
 return `<fieldset class="cargo-field"><legend>Cargo <span class="cargo-chosen">${escapeHTML(CARGO[formDraft.cargo]?.name||'')}</span></legend><select name="cargo" hidden aria-hidden="true" tabindex="-1">${available.map(([key,c])=>`<option value="${key}" ${formDraft.cargo===key?'selected':''}>${c.name}</option>`).join('')}</select><div class="cargo-picker" role="group" aria-label="Choose cargo">${available.map(([key,c])=>`<button type="button" class="cargo-choice" data-cargo-choice="${key}" aria-pressed="${formDraft.cargo===key}"${fit(key,c)}>${cargoIcon(key,{decorative:true})}<span class="sr-only">${c.name}</span>${verdicts.get(key)?.valid?`${icon('check','cargo-fit')}<span class="sr-only"> · fits these stops</span>`:''}</button>`).join('')}</div></fieldset>`;
}
function coverageNote(id,key,interactive=false) {
 const station=game.stations.find(s=>String(s.id)===String(id));if(!station)return '';
 const cargo=stationCoverage(game,station)[key];
 const badge=key=>interactive&&Object.hasOwn(CARGO,key)&&editCargo(key)?`<button type="button" class="coverage-pick" data-cargo-pick="${key}" title="Carry ${escapeHTML(CARGO[key].name.toLowerCase())}">${cargoBadge(key)}</button>`:cargoBadge(key);
 return `<div class="coverage-note"><strong>${key==='produces'?'Loads':'Accepts'}</strong><span class="coverage-cargo">${cargo.length?cargo.map(badge).join(''):'No cargo nearby'}</span></div>`;
}
// Air joins the route form and filters once air travel has arrived, or where a company already has an airport.
const airOffered=()=>airAvailable(game)||game.stations.some(s=>s.mode==='air');
function routeForm() {
 const editing=editingRoute(),stations=game.stations.filter(s=>s.mode===formDraft.mode),purchase=getVehiclePurchase(game,formDraft.mode);
 // Older saves can hold two stops of one name; their tiles tell them apart.
 const named=new Map();for(const s of stations)named.set(s.name,(named.get(s.name)||0)+1);
 const opts=(current)=>'<option value="">Choose a stop…</option>'+stations.map(s=>`<option value="${s.id}" ${String(s.id)===String(current)?'selected':''}>${escapeHTML(named.get(s.name)>1?`${s.name} · ${s.x}, ${s.y}`:s.name)}</option>`).join('');
 const plan=draftPlan(),options=formDraft.from&&formDraft.to?routeCargoOptions(game,formDraft):[];
 const stopField=(key,label,coverage)=>`<div class="route-stop-field"><div class="route-stop-label"><span>${label}</span><button type="button" data-pick-route="${key}" aria-pressed="${routePicking===key}" aria-label="Select ${key==='from'?'start':'end'} stop on map" title="Pick on map">${icon('focus')}</button></div><label class="form-field"><span class="sr-only">${label} stop</span><select name="${key}" required>${opts(formDraft[key])}</select></label>${coverageNote(formDraft[key],coverage,true)}</div>`;
 const swap=`<div class="route-swap"><button type="button" id="swap-route-stops" aria-label="Swap start and end" title="Swap start and end" ${formDraft.from||formDraft.to?'':'disabled'}>${icon('swap')}</button></div>`;
 return `<details id="route-planner" class="route-planner route-planner-focused" open><summary title="${editing?'Change its stops or freight; the same vehicles carry on.':'Pick a start, then an end. The connection is checked and a cargo suggested.'}">${icon(editing?'pencil':'route')}<h3>${editing?'Edit route':'New route'}</h3></summary><form id="route-form" class="panel-form">${editing?editNote(editing):`<label class="form-field form-field--bare"><span class="sr-only">Route name (optional)</span><input name="name" maxlength="36" placeholder="${escapeHTML(defaultRouteName(game,plan,formDraft.cargo)||'Route name')}" value="${escapeHTML(formDraft.name)}" title="Route name. Leave it empty to use the one shown."></label>`}<label class="form-field"><span>Transport</span><select name="mode" ${editing?'disabled':''} title="${escapeHTML(formDraft.mode==='water'?'Ships and ferries. Ports need connected water; ships pass beneath bridges.':formDraft.mode==='air'?`Planes fly straight between two airports at least ${AIRPORT_MIN_TILES} tiles apart. No track needed.`:formDraft.mode==='rail'?'Trains':'Buses and trucks')}"><option value="road" ${formDraft.mode==='road'?'selected':''}>Road</option><option value="rail" ${formDraft.mode==='rail'?'selected':''}>Rail</option><option value="water" ${formDraft.mode==='water'?'selected':''}>Water</option>${airOffered()?`<option value="air" ${formDraft.mode==='air'?'selected':''}>Air</option>`:''}</select></label>${stopField('from','Start','produces')}${swap}${stopField('to','End','accepts')}${cargoChoices(options)}<div id="route-connection" class="route-connection" role="status" aria-live="polite" data-state="${plan.state}" data-valid="${plan.valid}" data-message="${escapeHTML(routePlanText(plan))}">${routePlanMessage(plan)}</div>${routeForecast(plan)}${editing?'':`<div class="purchase-vehicle"><canvas width="80" height="64" data-vehicle-sprite="purchase" data-mode="${formDraft.mode}" data-cargo="${formDraft.cargo}" data-level="${purchase.level}" aria-hidden="true"></canvas><div class="form-summary"><span id="vehicle-purchase-spec" title="${escapeHTML(purchaseSpec(purchase).title)}">${escapeHTML(purchaseSpec(purchase).text)}</span><strong id="vehicle-purchase-price">${money(purchase.cost)}</strong></div></div>`}${routeOptions()}<div id="route-launch" class="route-launch" data-existing="${escapeHTML(plan.existingRouteId||'')}">${launchButtons(plan)}</div></form></details>`;
}
function openNewRoute() {
 cancelRoutePicking();if(formDraft.editing)leaveRouteEdit(true);
 formDraft.open=true;setView('routes',{routeScreen:'new'});$('#route-form [name=mode]')?.focus({preventScroll:true});
}
function routesPanel() {
 if(routeScreen!=='list')return `<button class="panel-back" type="button" id="route-back">${icon('chevronLeft')} Back to routes</button><div class="panel-heading"><h2>${routeScreen==='edit'?'Edit route':'New route'}</h2></div><p class="panel-description">${routeScreen==='edit'?'Change this service’s stops or cargo. Its vehicles keep running.':'Choose two stops, check their connection, then launch a vehicle.'}</p>${routeForm()}`;
 const options=(entries,current)=>entries.map(([key,label])=>`<option value="${key}" ${key===current?'selected':''}>${escapeHTML(label)}</option>`).join('');
 const routes=filterRoutes(game,routeFilters);
 return `<div class="panel-heading"><h2>Routes</h2><button class="small-button" id="new-route-button">+ New route</button></div><div class="route-filters"><label class="route-search-field"><span class="sr-only">Search routes</span><input id="route-search" type="search" placeholder="Search routes, stops or cargo" aria-label="Search routes, stops or cargo" value="${escapeHTML(routeFilters.query)}"></label><details class="route-filter-details" ${['mode','status','cargo'].some(key=>routeFilters[key]!=='all')?'open':''}><summary>Filter routes</summary><div class="route-filter-options"><label><span>Transport</span><select id="route-filter-mode">${options([['all','All transport'],['road','Road'],['rail','Rail'],['water','Water'],...airOffered()?[['air','Air']]:[]],routeFilters.mode)}</select></label><label><span>Status</span><select id="route-filter-status">${options([['all','All statuses'],['running','Connected'],['disconnected','Disconnected'],['attention','Needs attention']],routeFilters.status)}</select></label><label class="route-cargo-filter"><span class="sr-only">Filter routes by cargo</span><select id="route-filter-cargo" aria-label="Filter routes by cargo">${options([['all','All cargo'],...Object.entries(CARGO).map(([key,cargo])=>[key,cargo.name])],routeFilters.cargo)}</select></label></div></details></div><div class="route-list-heading"${filtering()?'':' hidden'}><span id="route-results-count" role="status">${routes.length} of ${game.routes.length} routes</span><button class="small-button" id="clear-route-filters">Clear filters</button></div><div id="route-list">${routePageCards(routes)}</div>${fleetControls()}`;
}
function visibleRoutePage(routes) {
 routePage=Math.min(routePage,Math.max(0,Math.ceil(routes.length/ROUTES_PER_PAGE)-1));
 return routes.slice(routePage*ROUTES_PER_PAGE,(routePage+1)*ROUTES_PER_PAGE);
}
const pageControls = (label,key,page,pages) => pages>1?`<nav class="route-pagination" aria-label="${label}"><button class="small-button" data-${key}="previous" ${page===0?'disabled':''}>Previous</button><span>Page ${page+1} of ${pages}</span><button class="small-button" data-${key}="next" ${page===pages-1?'disabled':''}>Next</button></nav>`:'';
function routePageCards(routes) {
 const visible=visibleRoutePage(routes),pages=Math.ceil(routes.length/ROUTES_PER_PAGE);
 const controls=pageControls('Route pages','route-page',routePage,pages);
 return controls+routeCards(visible)+controls;
}
// A card keeps three actions: Show, Edit and Retire. Its vehicle row offers an upgrade while a newer model exists.
// A running route's reason only explains ("Passengers travel both ways."), so it stays a tooltip; any other state keeps its line.
const quietHealth=health=>health.tone==='ok'&&health.label==='Running'||health.label==='First trip';
function routeCards(routes) {
 const stopsById=new Map(game.stations.map(stop=>[stop.id,stop]));
 return routes.length?routes.map(route=>{
 const from=stopsById.get(route.stops[0]),to=stopsById.get(route.stops[1]),health=routeHealth(game,route,getRouteFleet(game,route.id)),rate=routeYearNote(route),year=routeYearHeadline(route);
 const upgrade=getVehicleUpgrade(game,route.id);
 return `<article class="route-card" data-route-id="${route.id}"><div class="route-header">${bullet(route)}<strong><span>${escapeHTML(route.name)}</span>${renameButton('route',route.id)}</strong><span data-route-status="${route.id}">${escapeHTML(health.label)}</span></div><div class="route-journey">${from?refFor(game,`stop:${from.id}`):'<span class="ref--gone">Removed stop</span>'}${icon('arrow')}${to?refFor(game,`stop:${to.id}`):'<span class="ref--gone">Removed stop</span>'}</div><details class="route-card-details" ${routeDetailsOpen.has(String(route.id))?'open':''}><summary>${cargoBadge(route.cargo)}<span>Fleet and earnings</span></summary><div class="route-stats"><span class="route-mode-icon" title="${transportName(route.mode)}"><canvas width="80" height="64" data-vehicle-sprite="${route.id}" aria-hidden="true"></canvas><span class="sr-only">${transportName(route.mode)}</span></span><span data-route-stat="${route.id}">${integer(route.delivered)} moved</span></div><div class="route-earnings"><span>This year</span><strong data-route-revenue="${route.id}" title="${escapeHTML(year.title)}">${year.text}</strong><span class="route-rate" data-route-rate="${route.id}" title="${escapeHTML(rate.title)}">${escapeHTML(rate.text)}</span></div><div class="route-condition"><span class="route-waiting" data-route-waiting="${route.id}" data-state="${health.state}" title="${escapeHTML(health.detail)}">${waitingText(health)}</span><p class="route-health" data-route-health="${route.id}" data-state="${health.state}" title="${escapeHTML(health.detail)}"${quietHealth(health)?' hidden':''}>${escapeHTML(health.detail)}</p></div><div class="route-trip" data-route-trip="${route.id}">${routeTripHTML(route)}</div><div class="route-vehicle-spec">${fleetStepper(route)}${vehicleModelTag(route)}${upgrade.available?upgradeButton(route,upgrade):''}${roomHTML(route,health)}</div></details><div class="route-actions"><button class="small-button icon-only" data-focus-route="${route.id}" aria-label="Show on map" title="Show on map">${icon('locate')}</button><button class="small-button icon-only" data-edit-route="${route.id}" aria-label="Edit route" title="Edit route">${icon('edit')}</button><button class="small-button danger" data-remove-route="${route.id}">Retire</button></div></article>`;}).join(''):`<div class="empty-state">${icon('route')}${game.routes.length?'No routes match these filters.':'Connect two stops to start.'}${!game.routes.length?'<button type="button" class="button button-primary" data-route-next="new">Create a route</button><button type="button" class="small-button" data-route-next="stop">Build stops first</button>':''}</div>`;
}
const fleetNoun = (route,count) => { const noun=vehicleNoun(route.mode,route.cargo);return count===1?noun:noun==='bus'?'buses':noun+'s'; };
function vehicleSpec(route) { const fleet=getRouteFleet(game,route.id);return {text:`${fleet.count} ${fleetNoun(route,fleet.count)} · ${integer(fleet.load)} / ${integer(fleet.capacity)} loaded`,title:`Carries up to ${cargoAmount(fleet.capacity,route.cargo)}`}; }
// The row names its models (vehicle-models.js) where it said Latest model; an up-to-date fleet's title says when newer ones arrive.
// A refresh writes only when that text changes.
const shownModels=new WeakMap();
function vehicleModelInfo(route,fleet) { const model=fleetModelText(route.mode,route.cargo,fleet.levels),year=calendarYear(game);return !fleet.levels.length||fleet.minLevel<year-1950?model:{text:model.text,title:`${model.title}. Newer ${vehicleModel(route.mode,route.cargo).plural} arrive in ${year+1}.`}; }
function vehicleModelTag(route) { const model=vehicleModelInfo(route,getRouteFleet(game,route.id));return `<span class="vehicle-model" data-vehicle-model="${escapeHTML(route.id)}" title="${escapeHTML(model.title)}">${escapeHTML(model.text)}</span>`; }
function purchaseSpec(purchase) { const model=vehicleModel(formDraft.mode,formDraft.cargo,purchase.level);return {text:`${model.name} ${model.noun}, carries ${integer(purchase.capacity)}`,title:`${model.year} model`}; }
// One vehicle more or fewer on the same service; each button explains why it is unavailable.
function fleetOrder(route) {
 const fleet=getRouteFleet(game,route.id),purchase=getVehiclePurchase(game,route.mode),noun=vehicleNoun(route.mode,route.cargo),model=vehicleModel(route.mode,route.cargo,purchase.level);
 const problem=!route.active?'Repair the connection before adding vehicles.':game.vehicles.length>=MAX_VEHICLES?'Your fleet has reached 10,000 vehicles.':game.money<purchase.cost?`Need ${money(purchase.cost)} to buy another ${noun}.`:'';
 return {noun,add:{label:`+ ${noun[0].toUpperCase()+noun.slice(1)} · ${compactMoney(purchase.cost)}`,planner:`+ Add a ${noun} to it · ${compactMoney(purchase.cost)}`,title:problem||`Add a ${model.name} ${model.noun} for ${money(purchase.cost)}. It carries ${integer(purchase.capacity)}.`,disabled:Boolean(problem)},sell:{title:fleet.count>1?`Sell one · +${money(fleet.sellRefund)}`:'Retire the route to sell its last vehicle',disabled:fleet.count<2}};
}
function fleetStepper(route) {
 const order=fleetOrder(route),spec=vehicleSpec(route),id=escapeHTML(route.id);
 return `<span data-vehicle-spec="${id}" title="${escapeHTML(spec.title)}">${escapeHTML(spec.text)}</span><span class="fleet-stepper"><button class="small-button" data-sell-vehicle="${id}" aria-label="Sell one ${order.noun}" title="${escapeHTML(order.sell.title)}" ${order.sell.disabled?'disabled':''}>−</button><button class="small-button" data-add-vehicle="${id}" title="${escapeHTML(order.add.title)}" ${order.add.disabled?'disabled':''}>${escapeHTML(order.add.label)}</button></span>`;
}
const waitingText = health => health.waiting>0?'Waiting '+integer(health.waiting):'';
// Spare demand is a quiet line beside the stepper, never a state or a call to action: routeCapacity waits a month and a real surplus.
function roomHint(route,health,stats) { const room=routeCapacity(game,route,stats,health),noun=vehicleNoun(route.mode,route.cargo);return room.room?{text:'Room for more',title:room.perMonth>0?`Another ${noun} would carry about ${integer(room.perMonth)} more ${cargoName(route.cargo,room.perMonth)} a month.`:`Another ${noun} would carry more.`}:null; }
const roomHTML = (route,health) => { const hint=roomHint(route,health);return `<span class="route-room" data-route-room="${escapeHTML(route.id)}"${hint?` title="${escapeHTML(hint.title)}"`:' hidden'}>${hint?escapeHTML(hint.text):''}</span>`; };
function routeRate(route) {
 const contract=contractRate(route);if(contract)return contract;
 const net=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0),months=(game.day-(route.accountingStartDay||0))/30.44;
 return {text:months<1?'—':`≈ ${net<0?'−':''}${compactMoney(Math.abs(net)/months)} / month`,title:'Average since '+dayText(route.accountingStartDay||0)};
}
// A card leads with this year's profit; once a year has closed, last year takes the average's place beside it.
const netMoney=value=>(value<0?'−':'')+money(value),netCompact=value=>(value<0?'−':'')+compactMoney(Math.abs(value));
function routeYearHeadline(route) {
 const net=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0),months=(game.day-(route.accountingStartDay||0))/30.44;
 const average=route.profitLastYear!==undefined&&months>=1&&!contractRate(route)?`, about ${netCompact(net/months)} a month`:'';
 return {text:netMoney(route.profitThisYear??0),title:`Profit in ${calendarYear(game)} so far: fares minus route upkeep. Net ${netMoney(net)} since ${dayText(route.accountingStartDay||0)}${average}. Excludes construction and vehicle purchases.`};
}
function routeYearNote(route) { return route.profitLastYear===undefined||contractRate(route)?routeRate(route):{text:`Last year ${netCompact(route.profitLastYear)}`,title:`Profit in ${calendarYear(game)-1}: fares minus route upkeep`}; }
// Length and days on the way, then what one unit earns; the title explains the payment rule.
function routeTripHTML(route) { const trip=routeTrip(game,route,getRouteFleet(game,route.id).minLevel),title=escapeHTML(tripTitle(trip,route.cargo));return tripText(trip).map(text=>`<span title="${title}">${escapeHTML(text)}</span>`).join(''); }
function changeFleet(routeId,add) {
 const attribute=add?'data-add-vehicle':'data-sell-vehicle',restoreFocus=document.activeElement?.matches(`[${attribute}]`);
 const result=add?addRouteVehicle(game,routeId):sellRouteVehicle(game,routeId);
 toast(result.message,!result.ok);
 if(result.ok){refreshRouteList();updateHud();persist();}
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===routeId);
 if(restoreFocus)(card?.querySelector(`[${attribute}]:not(:disabled)`)||card?.querySelector('[data-add-vehicle]:not(:disabled),[data-focus-route]'))?.focus({preventScroll:true});
}
function upgradeTitle(quote,route) {
 const model=level=>vehicleModel(route.mode,route.cargo,level).name;
 return quote.available?`From ${fleetModelText(route.mode,route.cargo,quote.levels.filter(level=>level<quote.targetLevel)).text} to ${model(quote.targetLevel)}: capacity ${integer(quote.capacity)} to ${integer(quote.nextCapacity)}, speed ${quote.speedMultiplier.toFixed(1)}× to ${quote.nextSpeedMultiplier.toFixed(1)}×${quote.affordable?'':`. Need ${money(quote.cost)}.`}`:`Next model: ${model(quote.targetLevel+1)} in January ${1951+quote.targetLevel}`;
}
function upgradeButton(route,quote=getVehicleUpgrade(game,route.id)) {
 return `<button class="small-button route-upgrade-button" data-upgrade-route="${escapeHTML(route.id)}" title="${escapeHTML(upgradeTitle(quote,route))}" ${quote.available&&quote.affordable?'':'disabled'}>${quote.available?'Upgrade · '+compactMoney(quote.cost):'Latest model'}</button>`;
}
function fleetControls() {
 const quote=getFleetUpgrade(game);
 return `<details class="fleet-upgrades" ${fleetControlsOpen?'open':''}><summary>Fleet upgrades</summary><div class="fleet-upgrade-heading"><strong>Fleet upgrades</strong><small id="fleet-upgrade-note">${quote.available?quote.count+' vehicles ready':'Next: Jan '+(1951+quote.targetLevel)}</small></div><button id="upgrade-fleet" ${quote.available&&quote.affordable?'':'disabled'} title="Upgrade every eligible route to the latest available vehicle">${quote.available?'Upgrade all · '+money(quote.cost):'Fleet up to date'}</button></details>${contractOffers()}`;
}
function refreshUpgradeControls() {
 const fleetButton=$('#upgrade-fleet');
 if(fleetButton){
  refreshContracts();
  const fleet=getFleetUpgrade(game);
  fleetButton.disabled=!fleet.available||!fleet.affordable;
  fleetButton.textContent=fleet.available?'Upgrade all · '+money(fleet.cost):'Fleet up to date';
  fleetButton.title=fleet.available?`Upgrade ${fleet.count} vehicles to the ${1950+fleet.targetLevel} models${fleet.affordable?'':`. Need ${money(fleet.cost)}.`}`:`New models arrive in January ${1951+fleet.targetLevel}`;
  $('#fleet-upgrade-note').textContent=fleet.available?fleet.count+' vehicles ready':'Next: Jan '+(1951+fleet.targetLevel);
 }
 const routesById=new Map(game.routes.map(route=>[String(route.id),route]));
 $$('[data-upgrade-route]').forEach(button=>{
  const quote=getVehicleUpgrade(game,button.dataset.upgradeRoute),route=routesById.get(button.dataset.upgradeRoute);if(!route)return;
  button.disabled=!quote.available||!quote.affordable;button.title=upgradeTitle(quote,route);
  button.textContent=quote.available?'Upgrade · '+compactMoney(quote.cost):'Latest model';
 });
 $$('[data-vehicle-spec]').forEach(el=>{const route=routesById.get(el.dataset.vehicleSpec);if(!route)return;const spec=vehicleSpec(route);if(el.textContent!==spec.text)el.textContent=spec.text;el.title=spec.title;});
 $$('[data-vehicle-model]').forEach(el=>{const route=routesById.get(el.dataset.vehicleModel);if(!route)return;const model=vehicleModelInfo(route,getRouteFleet(game,route.id)),shown=model.text+'\n'+model.title;if(shownModels.get(el)===shown)return;shownModels.set(el,shown);el.textContent=model.text;el.title=model.title;});
 $$('[data-add-vehicle],[data-sell-vehicle]').forEach(button=>{const add=button.hasAttribute('data-add-vehicle'),route=routesById.get(add?button.dataset.addVehicle:button.dataset.sellVehicle);if(!route)return;const order=fleetOrder(route)[add?'add':'sell'];button.disabled=order.disabled;button.title=order.title;if(add&&button.textContent!==order.label)button.textContent=order.label;});
 const purchase=getVehiclePurchase(game,formDraft.mode);
 if($('#vehicle-purchase-price'))$('#vehicle-purchase-price').textContent=money(purchase.cost);
 const purchaseEl=$('#vehicle-purchase-spec');if(purchaseEl){const spec=purchaseSpec(purchase);if(purchaseEl.textContent!==spec.text)purchaseEl.textContent=spec.text;purchaseEl.title=spec.title;}
 const form=$('#route-form'),portrait=form?.querySelector('[data-vehicle-sprite="purchase"]');if(portrait){Object.assign(portrait.dataset,{mode:formDraft.mode,cargo:formDraft.cargo,level:String(purchase.level)});drawPaletteSprites(form);}
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
// Show frames the producer and buyer in the map the inspector leaves free, and selects the producer.
function showContract(id) {
 const contract=game.contracts?.find(c=>c.id===id),sites=contract&&contractSites(game,contract);if(!sites)return;
 const {from,to,source}=sites,width=(Math.abs((from.x-from.y)-(to.x-to.y))+6)*TILE,height=(Math.abs((from.x+from.y)-(to.x+to.y))+6)*TILE/2+48;
 setTool('inspect');leaveModal();inspect(source.x,source.y,'industry');
 const map=canvas.getBoundingClientRect(),card=$('#inspector').hidden?null:$('#inspector').getBoundingClientRect(),left=card&&card.right<map.left+map.width/2?card.right-map.left:0;
 glideCamera({x0:Math.min(from.x,to.x),y0:Math.min(from.y,to.y),x1:Math.max(from.x,to.x),y1:Math.max(from.y,to.y),cx:(from.x+to.x)/2,cy:(from.y+to.y)/2},{zoom:Math.max(ZOOM_LEVELS[0],...ZOOM_LEVELS.filter(zoom=>width*zoom<=(map.width-left)*.85&&height*zoom<=map.height*.8)),offset:{x:left/2,y:0}});
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
// Full load is the one optional order: folded under More options, for freight only, and off until ticked.
const fullLoadState = () => formDraft.fullLoad?'Full load':'';
function routeOptions() { return `<details class="route-options" ${formDraft.optionsOpen?'open':''} ${isTownTraffic(formDraft.cargo)?'hidden':''}><summary><span>More options</span><span class="route-options-state">${fullLoadState()}</span>${uiIcon('chevronDown',{size:16,cls:'route-options-chevron'})}</summary><label class="route-option"><input type="checkbox" data-route-option="full-load" ${formDraft.fullLoad?'checked':''}> Wait for a full load</label><p class="form-note">Vehicles wait where they load until they are full, for a month at most. Waiting vehicles cost 45% to run. Waiting counts toward delivery time.</p></details>`; }
function addFromPlanner(routeId) {
 const result=addRouteVehicle(game,routeId);toast(result.message,!result.ok);
 if(result.ok){routeScreen='list';cancelRoutePicking();formDraft.name='';formDraft.autoNote='';formDraft.open=false;renderPanel();updateHud();persist();flashRoute(routeId);}
}
// Edit reuses the planner for one route: its transport stays, nothing is bought or sold, and buses never turn into trucks.
const editingRoute = () => formDraft.editing?game.routes.find(route=>route.id===formDraft.editing)||null:null;
const editCargo = cargo => { const route=editingRoute();return !route||(isTownTraffic(route.cargo)?cargo===route.cargo:!isTownTraffic(cargo)); };
const draftPlan = () => validateRoutePlan(game,formDraft,{ignoreFunds:Boolean(editingRoute())});
function editChanges(plan,order=true) { const route=editingRoute(),[a,b]=plan.reversed?[...plan.stations].reverse():plan.stations;return !route||a?.id!==route.stops[0]||b?.id!==route.stops[1]||formDraft.cargo!==route.cargo||order&&fullLoadEdit(route); }
const fullLoadEdit = route => !isTownTraffic(formDraft.cargo)&&(route.fullLoad===true)!==(formDraft.fullLoad===true);
function editNote(route) { const count=getRouteFleet(game,route.id).count;return `<p class="form-note route-edit-note"><strong>${escapeHTML(route.name)}</strong> keeps its ${count===1?fleetNoun(route,1):count+' '+fleetNoun(route,count)}. Change the stops${isTownTraffic(route.cargo)?'':' or the freight'}; nothing is bought or sold.</p>`; }
function startRouteEdit(id,keyboard) {
 const route=game.routes.find(r=>r.id===id);if(!route)return;
 cancelRoutePicking();formDraft={editing:route.id,name:'',mode:route.mode,from:String(route.stops[0]),to:String(route.stops[1]),cargo:route.cargo,fullLoad:route.fullLoad===true,optionsOpen:route.fullLoad===true,open:true,autoKey:`${route.stops[0]}|${route.stops[1]}|${route.mode}`};
 setView('routes',{routeScreen:'edit'});scrollIntoViewSafe($('#route-planner'),{block:'start'});if(keyboard)$('#route-form [name=from]')?.focus({preventScroll:true});
}
function leaveRouteEdit(open=false) { formDraft={name:'',mode:'road',from:'',to:'',cargo:'passengers',fullLoad:false,optionsOpen:false,open}; }
function cancelRouteEdit() {
 routeScreen='list';const id=formDraft.editing;cancelRoutePicking();leaveRouteEdit();renderPanel();
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
 const before=validateRoutePlan(game,{mode:route.mode,from:route.stops[0],to:route.stops[1],cargo:route.cargo},{ignoreFunds:true}),named=route.name!==defaultRouteName(game,before,route.cargo,route),name=defaultRouteName(game,plan,formDraft.cargo,route);
 const [a,b]=plan.stations,moved=editChanges(plan,false),result=moved?editRoute(game,route.id,{stops:[a.id,b.id],cargo:formDraft.cargo}):null;
 if(result?.ok&&!named&&name&&name!==route.name)renameRoute(game,route.id,name);
 // Full load is its own order: set after a move succeeds, or alone. A move's message says what changed most.
 const order=(!result||result.ok)&&fullLoadEdit(route)?setRouteFullLoad(game,route.id,formDraft.fullLoad===true):null,shown=result||order||{ok:false,message:'Nothing to change.'};
 toast(shown.message,!shown.ok);
 if(shown.ok){routeScreen='list';cancelRoutePicking();leaveRouteEdit();renderPanel();compactUI?.openManagement();updateHud();persist();flashRoute(route.id);}
}
function routePlanText(plan) { const existing=plan.existingRouteId&&plan.existingRouteId!==formDraft.editing&&game.routes.find(route=>route.id===plan.existingRouteId),message=existing?`Already served by ${existing.name}`:plan.message;return formDraft.autoNote?`${message.replace(/\.$/,'')} · ${formDraft.autoNote}`:message; }
function routePlanMessage(plan) { return icon(plan.valid?'check':plan.state==='missing'?'route':'warning')+`<span>${escapeHTML(routePlanText(plan))}</span>`; }
// One line of outlook under the status; supply, throughput and hints stay folded in Forecast details.
const forecastDetailsOpen = () => { try { return localStorage.getItem('transport-forecast-details')==='open'; } catch { return false; } };
const perDay = n => (n<9.95?Math.round(n*10)/10:Math.round(n)).toLocaleString('en-US');
function routeOutlook(plan) {
 // A vehicle added to a served route follows that route's full-load order, not the checkbox.
 const served=plan.existingRouteId&&game.routes.find(route=>route.id===plan.existingRouteId),f=!editingRoute()&&forecastRoute(game,served?{...formDraft,fullLoad:served.fullLoad===true}:formDraft,plan);if(!f)return null;
 const noun=vehicleNoun(formDraft.mode,formDraft.cargo),months=Math.max(1,Math.round(f.paybackMonths)),room=f.vehiclesToSaturate-1,rail=f.otherModes.find(other=>other.mode==='rail');
 const summary=f.netMonth>0?`≈ +${compactMoney(f.netMonth)} / month · pays back in about ${months<24?`${months}\u00a0month${months===1?'':'s'}`:`${Math.round(months/12)}\u00a0years`}`:'Likely to earn less than its upkeep';
 const shared=f.madeDay-f.supplyDay>.05,plural=noun==='bus'?'buses':noun+'s';
 const facts=[`${isTownTraffic(formDraft.cargo)?'Towns send':'Source makes'} ≈ ${perDay(f.madeDay)} / day${shared?f.supplyDay>0?` · ≈ ${perDay(f.supplyDay)} spare`:' · all taken':isTownTraffic(formDraft.cargo)?'':' once served'}`,`One ${noun} carries ≈ ${perDay(f.perVehicleDay)} / day`,f.supplyDay<=0?'':room>0?`Room for ≈ ${room} more ${room===1?noun:plural}`:`One ${noun} carries all of it`,fullFareText(formDraft.mode,formDraft.cargo,f.fullFare)].filter(Boolean);
 if(formDraft.mode==='road'&&room>0&&rail?.ratio>=1.5)facts.push(`A train would carry ≈ ${Math.round(rail.ratio)}× per vehicle${keepText(rail.share,f.share)}`);
 const plane=f.otherModes.find(other=>other.mode==='air');if(room>0&&plane?.ratio>=1.5)facts.push(`A plane would carry ≈ ${Math.round(plane.ratio)}× per vehicle${keepText(plane.share,f.share)}`);
 if(f.marketBonus>=1)facts.push(`Includes ≈ ${money(f.marketBonus)} a month of market bonus`);
 if(f.workshopsPending)facts.push('Town workshops’ output counts from the end of this month');
 const trip=planText(planTrip(game,formDraft.mode,formDraft.cargo,plan.path,getVehiclePurchase(game,formDraft.mode).level,f.wait));
 return {outlook:f.netMonth>0?'gain':'loss',summary,trip,facts:facts.map(fact=>`<li>${escapeHTML(fact)}</li>`).join('')};
}
function routeForecast(plan) {
 const outlook=routeOutlook(plan);
 return `<div id="route-forecast" class="route-forecast" data-outlook="${outlook?.outlook||''}" data-shown="${escapeHTML(outlook?outlook.summary+outlook.trip+outlook.facts:'')}" ${outlook?'':'hidden'}><p class="forecast-summary">${escapeHTML(outlook?.summary||'')}</p><p class="route-forecast-trip">${escapeHTML(outlook?.trip||'')}</p><details class="forecast-details" ${forecastDetailsOpen()?'open':''}><summary>Forecast details</summary><ul class="forecast-facts">${outlook?.facts||''}</ul></details></div>`;
}
function refreshRoutePlan() {
 const status=$('#route-connection'),form=$('#route-form');if(!status||!form)return;
 const plan=draftPlan(),text=routePlanText(plan),name=form.querySelector('[name=name]'),placeholder=defaultRouteName(game,plan,formDraft.cargo)||'Route name';
 if(status.dataset.message!==text){status.innerHTML=routePlanMessage(plan);status.dataset.message=text;}
 if(name&&name.placeholder!==placeholder)name.placeholder=placeholder;
 const options=form.querySelector('.route-options'),town=isTownTraffic(formDraft.cargo);if(options&&options.hidden!==town)options.hidden=town;
 const launch=$('#route-launch'),existing=plan.existingRouteId||'';
 if(launch&&launch.dataset.existing!==existing){launch.innerHTML=launchButtons(plan);launch.dataset.existing=existing;}
 status.dataset.state=plan.state;status.dataset.valid=String(plan.valid);form.querySelector('[type=submit]').disabled=!plan.valid||!editChanges(plan);
 const forecast=$('#route-forecast'),outlook=routeOutlook(plan),shown=outlook?outlook.summary+outlook.trip+outlook.facts:'';
 if(forecast&&forecast.dataset.shown!==shown){forecast.hidden=!outlook;forecast.dataset.outlook=outlook?.outlook||'';forecast.dataset.shown=shown;if(outlook){forecast.querySelector('.forecast-summary').textContent=outlook.summary;forecast.querySelector('.route-forecast-trip').textContent=outlook.trip;forecast.querySelector('.forecast-facts').innerHTML=outlook.facts;}}
 const add=$('#add-route-vehicle'),route=add&&game.routes.find(r=>r.id===add.dataset.route);
 if(route){const order=fleetOrder(route).add;add.disabled=order.disabled;add.title=order.title;if(add.textContent!==order.planner)add.textContent=order.planner;}
}
// Suggest cargo once per change of stops or transport. A cargo that still fits is never replaced.
function autoSelectCargo() {
 const key=`${formDraft.from}|${formDraft.to}|${formDraft.mode}`;if(formDraft.autoKey===key)return;formDraft.autoKey=key;
 const stops=[formDraft.from,formDraft.to].map(id=>id?game.stations.find(s=>String(s.id)===String(id)):null);if(!stops[0]){formDraft.autoNote='';return;}
 const options=stops[1]?routeCargoOptions(game,formDraft).filter(option=>editCargo(option.cargo)):[];let next='';
 if(options.length)next=options[0].valid&&!options.some(option=>option.valid&&option.cargo===formDraft.cargo)?options[0].cargo:'';
 else if(!stops.some(stop=>stop&&stationCoverage(game,stop).produces.includes(formDraft.cargo)))next=stationCoverage(game,stops[0]).produces.find(cargo=>!isTownTraffic(cargo)&&routeCargoList(game).includes(cargo))||'';
 if(next&&next!==formDraft.cargo&&editCargo(next)){formDraft.cargo=next;formDraft.autoNote=`Cargo set to ${CARGO[next].name}`;}
 if(cargoLens?.origin==='routes'&&cargoLens.cargo!==formDraft.cargo)setCargoLens(null);
}
function bindRouteCards(root) {
 root.querySelectorAll('.route-card-details').forEach(details=>details.addEventListener('toggle',()=>{if(!details.isConnected)return;const id=details.closest('[data-route-id]').dataset.routeId;if(details.open)routeDetailsOpen.add(id);else routeDetailsOpen.delete(id);}));
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
// Show frames the whole route at the closest zoom that fits its projected extent in the visible band, then highlights it for a moment.
const routeExtents=new WeakMap();
export function showRoute(id,{hold=4000}={}) {
 const route=game.routes.find(r=>String(r.id)===String(id));if(!route?.path?.length)return;
 cancelRoutePicking();setMapLayers({routes:true});closeManagement();
 let extent=routeExtents.get(route.path);
 if(!extent){let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;for(const p of route.path){u0=Math.min(u0,p.x-p.y);u1=Math.max(u1,p.x-p.y);v0=Math.min(v0,p.x+p.y);v1=Math.max(v1,p.x+p.y);}extent={u:(u0+u1)/2,v:(v0+v1)/2,width:(u1-u0)*TILE,height:(v1-v0)*TILE/2+48};routeExtents.set(route.path,extent);}
 const band=syncBand(),x=(extent.u+extent.v)/2,y=(extent.v-extent.u)/2;
 glideCamera({x0:x,y0:y,x1:x,y1:y},{zoom:Math.max(ZOOM_LEVELS[0],...ZOOM_LEVELS.filter(zoom=>extent.width*zoom<=band.width*.8&&extent.height*zoom<=band.height*.8))});
 highlight={id:route.id,until:performance.now()+hold};updateHud();
}
// References and the camera (DESIGN.md 7 and 10). refView.hoverRef is the reference the pointer, keyboard or a long press is on;
// refShown rings a target for a while (Show on map, and 1.2 s after a cut). The inspector keeps the places it was reached from
// (inspectorTrail) for its Back line, and inspectorSource, the reference that opened it, takes focus back when it closes.
const refView={hoverRef:null},mapSection=$('.map-section'),overlays=$('#map-overlays');
let refShown={ref:null,until:0},inspectorTrail=[],inspectorSource=null,overlayKey='',backTimer=0,bandQueued=false,bandBox={left:0,top:0,right:0,bottom:0,width:0,height:0};
// A reference opens its target and frames it in the visible band, keeping the panel it came from; data-ref-action="show" (hold)
// only frames it and rings it for a while. Routes open their row in Routes. A reference inside the inspector gives the next
// inspector a Back line. The camera glides, or past 3 screens (and under reduced motion) cuts and rings the target for 1.2 s.
export function revealRef(ref,{source=null,open=true,hold=0,keyboard=false}={}) {
 const key=refKey(ref),target=resolveRef(game,key,{vehiclePoint:renderer.vehicleWorldPoint}),entity=target.entity;if(!target.exists)return false;
 if(target.kind==='cargo'){setCargoLens(target.id,'chains');return true;}
 const box=$('#inspector'),from=open&&source&&!box.hidden&&box.contains(source)?inspectorPlace():null;
 if(source?.closest?.('#modal'))closeModal();
 if(target.kind==='route'){if(open)showNoticeTarget({kind:'route',id:target.id});else showRoute(target.id,{hold:Math.max(hold,1200)});return true;}
 if(open){
  if(tool!=='inspect')setTool('inspect');
  const options={from,source:source?.closest?.('#map-overlays')?inspectorSource:source};
  if(target.kind==='vehicle')inspectVehicle(target.id,false,options);
  else inspect(entity.x,entity.y,target.kind==='town'?'city':target.kind==='industry'?'industry':'',keyboard?'keyboard':'',options);
  if(underDrawer($('#inspector')))closeManagement(); // the drawer keeps its place unless it would hide the inspector
 }
 const cut=glideCamera(target.frame,{zoom:target.kind==='vehicle'?undefined:1,ref:key});
 if(hold)refShown={ref:key,until:performance.now()+Math.max(hold,cut?1200:0)};
 updateHud();return true;
}
// Whether the open drawer covers most of an element, by layout boxes (a drawer mid-slide counts where it will rest).
function underDrawer(el) {
 const drawer=$('.sidebar');if(!drawer.classList.contains('drawer-open')||el.hidden||!el.getClientRects().length)return false;
 const a=layoutAt(drawer),b=layoutAt(el),w=Math.min(a.x+drawer.offsetWidth,b.x+el.offsetWidth)-Math.max(a.x,b.x),h=Math.min(a.y+drawer.offsetHeight,b.y+el.offsetHeight)-Math.max(a.y,b.y);
 return w>0&&h>0&&w*h>el.offsetWidth*el.offsetHeight/2;
}
// Moves the camera the 10.2 way, framed in the visible band (or at offset px from the canvas centre): a 280–480 ms glide, or a
// cut past 3 screens and under reduced motion, after which ref, if given, is ringed for 1.2 s. A jump past 3 screens offers
// "Back to where you were" for 8 s. Returns whether it cut.
function glideCamera(frame,{zoom,offset,ref=null,back=true}={}) {
 if(!frame)return false;syncBand();
 const before=renderer.getCamera(),screens=renderer.screensTo(frame,{zoom,offset}),cut=screens>3||reducedMotion();
 renderer.glideTo(frame,{zoom,offset,duration:cut?0:cameraDuration(screens)});
 if(cut&&ref)refShown={ref,until:performance.now()+1200};
 if(back&&screens>3)offerBack(before);
 return cut;
}
function offerBack(camera) {
 clearTimeout(backTimer);let chip=overlays.querySelector('.back-chip');const serial=worldSerial,x=camera.x/TILE-.5,y=camera.y/TILE-.5;
 if(!chip){chip=document.createElement('button');chip.type='button';chip.className='back-chip';chip.tabIndex=-1;chip.innerHTML=`${uiIcon('chevronLeft',{size:16})}<span>Back to where you were</span>`;overlays.append(chip);}
 chip.onclick=()=>{hideBack();if(serial!==worldSerial)return;glideCamera({x0:x,y0:y,x1:x,y1:y,height:camera.height},{zoom:camera.zoom,offset:{x:0,y:0},back:false});updateHud();};
 backTimer=setTimeout(hideBack,8000);
}
function hideBack() { clearTimeout(backTimer);overlays.querySelector('.back-chip')?.remove(); }
// The visible band (10.2): the map less the panels over it, the drawer, the inspector and anything marked
// data-band. Each panel gives up the side of the map that keeps the most of it; one that would leave under a third of the map is
// left out. Layout boxes, not transformed ones, so a drawer mid-slide counts where it will rest. Kept as --band-l/-r/-t/-b on
// .map-section and in the renderer, which frames every glide in it.
const layoutAt=el=>{let x=0,y=0;for(let node=el;node;node=node.offsetParent){x+=node.offsetLeft;y+=node.offsetTop;}return{x,y};};
function syncBand() {
 const W=mapSection.clientWidth,H=mapSection.clientHeight,at=layoutAt(mapSection),box={left:0,top:0,right:W,bottom:H};
 for(const panel of [$('.sidebar'),$('#inspector'),...$$('[data-band]')]){
  if(!panel||panel.hidden||!panel.getClientRects().length||getComputedStyle(panel).visibility==='hidden'||panel.classList.contains('sidebar')&&!panel.classList.contains('drawer-open'))continue;
  const p=layoutAt(panel),left=p.x-at.x,top=p.y-at.y,right=left+panel.offsetWidth,bottom=top+panel.offsetHeight;
  if(right<=box.left||left>=box.right||bottom<=box.top||top>=box.bottom)continue;
  const keep=[{...box,left:right},{...box,right:left},{...box,top:bottom},{...box,bottom:top}].map(next=>({next,area:Math.max(0,next.right-next.left)*Math.max(0,next.bottom-next.top)})).reduce((a,b)=>b.area>a.area?b:a);
  if(keep.area>=W*H/3)Object.assign(box,keep.next);
 }
 const next={left:Math.round(box.left),top:Math.round(box.top),right:Math.round(box.right),bottom:Math.round(box.bottom)};
 if(['left','top','right','bottom'].some(side=>next[side]!==bandBox[side])){for(const [name,value] of [['l',next.left],['t',next.top],['r',W-next.right],['b',H-next.bottom]])mapSection.style.setProperty(`--band-${name}`,`${Math.round(value)}px`);renderer.setBand(next);}
 return bandBox={...next,width:next.right-next.left,height:next.bottom-next.top};
}
function queueBand() { if(bandQueued)return;bandQueued=true;requestAnimationFrame(()=>{bandQueued=false;syncBand();}); }
// Map overlays (DESIGN.md 9) in #map-overlays, placed with worldToScreen and recomputed only when the camera, the band or the
// target changes: the edge pointer toward a hovered target outside the band, and the selection tag.
function syncOverlays(hoverRef) {
 const camera=renderer.getCamera(),vehicle=selectedVehicle?game.vehicles.find(v=>v.id===selectedVehicle):null,hovered=hoverRef?.startsWith('vehicle:')?game.vehicles.find(v=>`vehicle:${v.id}`===hoverRef):null;
 const key=[worldSerial,game.revision,camera.x,camera.y,camera.zoom,camera.height,canvas.clientWidth,canvas.clientHeight,bandBox.left,bandBox.top,bandBox.right,bandBox.bottom,hoverRef,selected?.x,selected?.y,selected?.kind,$('#inspector').hidden,vehicle?.x,vehicle?.y,hovered?.x,hovered?.y,mapLayers.names,mapLayers.stations].join();
 if(key===overlayKey)return;overlayKey=key;
 placeEdgePointer(hoverRef);placeSelectionTag(selectionTag(vehicle));
}
// One ink pointer at the band's edge on the line from its centre toward a hovered target outside it: the kind's mark, the name,
// the distance in tiles from the tile at the band's centre and a signal chevron turned toward it. It is a Show on map reference.
function placeEdgePointer(hoverRef) {
 const target=hoverRef?resolveRef(game,hoverRef,{vehiclePoint:renderer.vehicleWorldPoint}):null,f=target?.frame,corners=f?[[f.x0,f.y0],[f.x1,f.y0],[f.x0,f.y1],[f.x1,f.y1]].map(([x,y])=>renderer.worldToScreen(x,y)):[];
 const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),shown=f&&Math.max(...xs)>=bandBox.left&&Math.min(...xs)<=bandBox.right&&Math.max(...ys)>=bandBox.top&&Math.min(...ys)<=bandBox.bottom;
 let el=overlays.querySelector('.edge-pointer');if(!f||shown){el?.remove();return;}
 if(!el){el=document.createElement('button');el.type='button';el.className='edge-pointer';el.tabIndex=-1;el.dataset.refAction='show';overlays.append(el);}
 const centre={x:(bandBox.left+bandBox.right)/2,y:(bandBox.top+bandBox.bottom)/2},x=f.cx??(f.x0+f.x1)/2,y=f.cy??(f.y0+f.y1)/2,p=renderer.worldToScreen(x,y),dx=p.x-centre.x,dy=p.y-centre.y;
 const rect=canvas.getBoundingClientRect(),from=renderer.screenToTile(rect.left+centre.x,rect.top+centre.y,{clamp:true}),key=refKey(hoverRef);
 const html=`<span class="edge-pointer__mark">${refMark(game,key)}</span><span class="edge-pointer__name">${escapeHTML(target.label)}</span><span class="edge-pointer__distance" data-num>${tilesText(Math.round(Math.hypot(x-from.x,y-from.y)))}</span><span class="edge-pointer__chevron" style="transform:rotate(${Math.atan2(dy,dx).toFixed(3)}rad)">${uiIcon('chevronRight',{size:16})}</span>`;
 if(el.dataset.ref!==key)el.dataset.ref=key;if(el.shownHTML!==html)el.innerHTML=el.shownHTML=html;
 const w=el.offsetWidth,h=el.offsetHeight,reach=Math.min(dx?Math.max(0,bandBox.width/2-w/2-12)/Math.abs(dx):Infinity,dy?Math.max(0,bandBox.height/2-h/2-12)/Math.abs(dy):Infinity);
 el.style.transform=`translate(${Math.round(centre.x+dx*reach-w/2)}px,${Math.round(centre.y+dy*reach-h/2)}px)`;
}
// The selected thing's name in an ink tag above it, when the map does not name it already: a town's nameplate, and a stop's or
// a site's label while names are shown. Vehicles, buildings and workshops always carry it.
const layerOn=name=>mapLayers[name]!==false;
function selectionTag(vehicle) {
 const zoom=renderer.getCamera().zoom;
 if(vehicle){const q=renderer.vehicleWorldPoint(vehicle),p=renderer.worldToScreen(q.x,q.y);return {text:resolveRef(game,`vehicle:${vehicle.id}`).label,x:p.x,y:p.y-34*zoom-10};} // clear of its load badge
 if(!selected||$('#inspector').hidden)return null;
 const {x,y,kind}=selected,names=layerOn('names'),station=kind!=='city'&&kind!=='industry'?stationAt(game,x,y):null,industry=!station&&kind!=='city'?game.industries.find(i=>industryContains(i,x,y)):null,city=!station&&!industry?game.cities.find(c=>c.x===x&&c.y===y):null,site=!station&&!industry&&!city?buildingAt(game,x,y):null;
 if(station){if(names&&layerOn('stations'))return null;const m=renderer.stationMarker(station);return {text:station.name,x:m.x+m.size/2,y:m.y-4};}
 if(industry){if(names)return null;const m=renderer.industryMarker(industry);return {text:industry.name||INDUSTRIES[industry.kind].name,x:m.x,y:m.y-m.size/2-4};}
 if(city){if(renderer.cityLabels().some(label=>label.id===city.id))return null;const p=renderer.worldToScreen(city.x,city.y);return {text:city.name,x:p.x,y:p.y-24*zoom};}
 if(site){const top=renderer.gridPointToScreen(site.x,site.y);return {text:BUILDINGS[site.building.kind]?.name||'Workshop',x:top.x,y:top.y-40*zoom};}
 return null;
}
function placeSelectionTag(tag) {
 let el=overlays.querySelector('.map-tag');
 if(!tag||tag.x<bandBox.left||tag.x>bandBox.right||tag.y<bandBox.top||tag.y>bandBox.bottom){el?.remove();return;}
 if(!el){el=document.createElement('span');el.className='map-tag';overlays.append(el);}
 if(el.textContent!==tag.text)el.textContent=tag.text;
 el.style.transform=`translate(${Math.round(tag.x-el.offsetWidth/2)}px,${Math.round(tag.y-el.offsetHeight)}px)`;
}
// The inspector's Back line (12.5) and its focus return: Esc or × gives focus back to the reference that opened it, or to the
// map when focus was inside it.
const inspectorPlace=()=>({x:selected?.x,y:selected?.y,kind:selected?.kind||'',vehicle:selectedVehicle,scroll:$('#inspector').scrollTop,name:selectedVehicle?resolveRef(game,`vehicle:${selectedVehicle}`).label:$('#inspector-title')?.textContent||'',source:inspectorSource});
function inspectorBackLine() { const back=inspectorTrail.at(-1);return back?`<button type="button" class="inspector-back" data-inspector-back>${uiIcon('chevronLeft',{size:16})}<span>Back to ${escapeHTML(back.name)}</span></button>`:''; }
// A new place in the inspector: from a reference inside it, the place it showed joins the trail; Back keeps the trail; anything else starts afresh.
function trackInspector({from=null,source=null,back=null}={}) { if(back){inspectorSource=back.source;return;}inspectorTrail=from?[...inspectorTrail,from].slice(-8):[];inspectorSource=source; }
function inspectorBack() {
 const back=inspectorTrail.pop(),box=$('#inspector');if(!back)return false;
 if(back.vehicle&&game.vehicles.some(v=>v.id===back.vehicle))inspectVehicle(back.vehicle,false,{back});else if(back.x!==undefined&&!back.vehicle)inspect(back.x,back.y,back.kind,'',{back});else return inspectorBack();
 box.scrollTop=back.scroll;($('#inspector [data-inspector-back]')||$('#inspector-title'))?.focus({preventScroll:true});
 return true;
}
function inspectorClosed(inside) {
 const source=inspectorSource;inspectorTrail=[];inspectorSource=null;
 if(source?.isConnected&&!source.closest('[inert],[hidden],#map-overlays')&&source.getClientRects().length)source.focus({preventScroll:true});else if(inside)canvas.focus({preventScroll:true});
}
function closeInspector() { const box=$('#inspector'),inside=box.contains(document.activeElement);box.hidden=true;selected=null;inspectorHTML='';if(selectedVehicle)clearVehicle();inspectorClosed(inside); }
// The stop, industry or town centre on a map tile, for linkFromMap.
function mapRefAt({x,y}) {
 const station=stationAt(game,x,y),industry=station?null:game.industries.find(i=>industryContains(i,x,y)),city=station||industry?null:game.cities.find(c=>c.x===x&&c.y===y);
 return station?`stop:${station.id}`:industry?`industry:${industry.id}`:city?`town:${city.id}`:null;
}
let linkedTile=null,references=null;
function initReferences() {
 references=installReferences({getGame:()=>game,view:refView,onOpen:revealRef,onCargo:cargo=>setCargoLens(cargo,'chains')});
 const resize=new ResizeObserver(queueBand),attributes=new MutationObserver(queueBand);
 for(const el of [mapSection,$('.sidebar'),$('#inspector')]){resize.observe(el);if(el!==mapSection)attributes.observe(el,{attributes:true,attributeFilter:['class','hidden']});}
 $('.sidebar').addEventListener('transitionend',queueBand);
 $('#inspector').addEventListener('click',e=>{if(e.target.closest('[data-inspector-back]'))inspectorBack();else if(e.target.closest('.tiny-button')&&$('#inspector').hidden)inspectorClosed(true);});
 overlays.addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();}); // overlay buttons act without taking focus
 // Map hover lights the hovered place's rows and references in open panels (7.4), once for each tile the pointer handler
 // picks (it keeps one hover object per tile); nothing scrolls.
 canvas.addEventListener('pointermove',e=>{const at=e.pointerType!=='touch'&&!pointer&&tool==='inspect'?hover:null;if(at===linkedTile)return;linkedTile=at;linkFromMap(at&&mapRefAt(at));});
 canvas.addEventListener('pointerleave',()=>{linkedTile=null;linkFromMap(null);});
 syncBand();
}
// The count and Clear filters only matter while a filter narrows the list (DESIGN.md 11.3).
const filtering=()=>Boolean(routeFilters.query)||['mode','status','cargo'].some(key=>routeFilters[key]!=='all');
function refreshRouteList() {
 const list=$('#route-list');if(!list)return;const routes=filterRoutes(game,routeFilters);
 list.innerHTML=routePageCards(routes);$('#route-results-count').textContent=`${routes.length} of ${game.routes.length} routes`;$('.route-list-heading')?.toggleAttribute('hidden',!filtering());bindRouteCards(list);drawPaletteSprites(list);references?.relink();
}
function flashRoute(routeId) {
 const index=filterRoutes(game,routeFilters).findIndex(route=>route.id===routeId);if(index<0)return;
 if(routePage!==Math.floor(index/ROUTES_PER_PAGE)){routePage=Math.floor(index/ROUTES_PER_PAGE);refreshRouteList();}
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===routeId);if(!card)return;
 revealInPanel(card,card.querySelector('[data-focus-route]'));card.classList.add('route-flash');setTimeout(()=>card.classList.remove('route-flash'),1200);
}
function isRoutePicking() { return Boolean(routePicking); }
function routePickStops() { return view==='routes'&&routeScreen!=='list'?[formDraft.from,formDraft.to].map(id=>game.stations.find(s=>String(s.id)===String(id))).filter(Boolean):[]; }
function cancelRoutePicking() {
 cancelConnectionPlan(); // A planned connection is the other pick on the map; the same tool, view and Escape changes end it.
 const wasPicking=Boolean(routePicking);
 routePicking='';canvas.classList.remove('route-picking');$('#route-pick-banner')?.remove();
 $$('[data-pick-route]').forEach(button=>button.setAttribute('aria-pressed','false'));
 if(wasPicking){cancelGesture();$('#status-message').textContent=toolDescription(tool);syncToolControls();}
}
function returnFromRoutePicking(){
 const key=routePicking;cancelRoutePicking();setView('routes',{routeScreen:formDraft.editing?'edit':'new'});
 $(`[data-pick-route="${key}"]`)?.focus({preventScroll:true});
}
function showRoutePickHint() {
 let banner=$('#route-pick-banner');if(!banner){banner=document.createElement('div');banner.id='route-pick-banner';banner.className='route-pick-banner';banner.setAttribute('role','status');banner.dataset.band='';$('.map-section').append(banner);}
 const label=routePicking==='from'?'start':'end',mode=stopName(formDraft.mode),count=game.stations.filter(stop=>stop.mode===formDraft.mode).length;
 banner.innerHTML=`<div><strong>Click the ${label} ${mode}</strong><span>${count?`${count} matching ${count===1?'stop':'stops'} highlighted`:'No matching stops yet'} · Drag to explore · Esc to cancel</span></div><button type="button" id="cancel-route-pick">Cancel</button>`;
 $('#cancel-route-pick').onclick=returnFromRoutePicking;
 $('#status-message').textContent=`Click the ${label} ${mode}.`;canvas.classList.add('route-picking');
}
function beginRoutePicking(key) {
 setTool('inspect');routePicking=key;renderPanel();syncToolControls();showRoutePickHint();closeManagement();canvas.focus({preventScroll:true});
}
function pickRouteStopAt(x,y) {
 if(!routePicking)return false;
 const station=stationAt(game,x,y);
 if(!station){toast(`Choose ${aStop(formDraft.mode)}.`,true);return true;}
 if(station.mode!==formDraft.mode){toast(`This is ${aStop(station.mode)}. Choose ${aStop(formDraft.mode)}.`,true);return true;}
 if(routePicking==='to'&&String(station.id)===String(formDraft.from)){toast('Choose two different stops.',true);return true;}
 if(routePicking==='from'&&String(station.id)===String(formDraft.to))formDraft.to='';
 formDraft[routePicking]=String(station.id);
 if(routePicking==='from'&&!formDraft.to){routePicking='to';renderPanel();showRoutePickHint();}
 else{cancelRoutePicking();setView('routes',{routeScreen:formDraft.editing?'edit':'new'});scrollIntoViewSafe($('#route-form [type=submit]'),{block:'nearest'});const plan=draftPlan();$('#status-message').textContent=plan.message;}
 return true;
}
// A cargo lens lights the producers and buyers of one freight cargo on the map, minimap and atlas; it is view state and never saved.
// Routes and Industries keep the lens they set while their view stays open; one from Chains stays until the chip's × or Escape.
let cargoLens=null;
function setCargoLens(cargo,origin='') {
 const next=cargo&&!isTownTraffic(cargo)&&CARGO[cargo]?{cargo,origin,game}:null;if(next?.cargo===cargoLens?.cargo&&next?.origin===cargoLens?.origin)return;
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
// Town and industry lists sort around the tile at the centre of the view, taken when the list opens or its
// filter or sort changes, so the periodic refresh never reshuffles them. Only the visible page is built.
const ENTITIES_PER_PAGE = 40, STATUS_RANK = {full:0,backlog:1,waiting:2,producing:3}, byName = new Intl.Collator('en-US').compare, nearTowns = new WeakMap();
let entityPage = 0, entityAnchor = null, entityCardMarkup = '';
function anchorEntities() { const camera=renderer.getCamera();entityAnchor={x:camera.x/TILE-.5,y:camera.y/TILE-.5,ranks:new WeakMap()};entityPage=0; }
const entitySort = () => entityFilters.sort?.[view]||'nearby';
const siteCentre = site => ({x:site.x+(industrySize(site)-1)/2,y:site.y+(industrySize(site)-1)/2});
const tilesAway = distance => { const n=Math.round(distance);return `<span>${n<1?'Right here':`${integer(n)} ${n===1?'tile':'tiles'} away`}</span>`; };
// A site's nearest town holds until a town is founded or undone.
function nearTown(site) {
 let near=nearTowns.get(site);if(near?.cities===game.cities&&near.count===game.cities.length)return near.city;
 const at=siteCentre(site);let best=Infinity;near={cities:game.cities,count:game.cities.length,city:null};
 for(const city of game.cities){const d=(city.x-at.x)**2+(city.y-at.y)**2;if(d<best){best=d;near.city=city;}}
 nearTowns.set(site,near);return near.city;
}
function entityRows() {
 if(!entityAnchor)anchorEntities();
 const towns=view==='towns',sort=entitySort(),{x,y,ranks}=entityAnchor,name=entity=>entity.name||INDUSTRIES[entity.kind]?.name||'';
 const list=towns?game.cities.filter(city=>entityMatches(city,entityFilters.towns)):game.industries.filter(site=>(entityFilters.kind==='all'||site.kind===entityFilters.kind)&&entityMatches(site,entityFilters.industry,[INDUSTRIES[site.kind].name,...Object.keys(INDUSTRIES[site.kind].inputs),...Object.keys(INDUSTRIES[site.kind].outputs)].join(' ')));
 // Status, population and property ranks are read once per anchor, so a card keeps its place while its figures update.
 const rank=entity=>{if(!ranks.has(entity))ranks.set(entity,sort==='attention'?STATUS_RANK[industryStatus(entity).state]??4:sort==='population'?-entity.population:sort==='property'?[entity.market?.rent||0,returnsTotals(entity.market).reduce((a,b)=>a+b,0)]:0);return ranks.get(entity);};
 const rows=list.map(entity=>{const at=towns?entity:siteCentre(entity);return {entity,d:(at.x-x)**2+(at.y-y)**2,rank:rank(entity)};});
 // Your property: rent, then the past year's returns, then name; towns without rent follow, nearest first.
 if(sort==='property')return rows.sort((a,b)=>b.rank[0]-a.rank[0]||(a.rank[0]?b.rank[1]-a.rank[1]||byName(name(a.entity),name(b.entity)):0)||a.d-b.d);
 return rows.sort(sort==='name'?(a,b)=>byName(name(a.entity),name(b.entity))||a.d-b.d:(a,b)=>a.rank-b.rank||a.d-b.d);
}
function entityCards() { return entityCardMarkup=entityCardsHTML(); }
function entityCardsHTML() {
 // One row per place: its name and key figure, where it is and one status line. Page controls follow the list.
 const rows=entityRows(),pages=Math.ceil(rows.length/ENTITIES_PER_PAGE);entityPage=Math.min(entityPage,Math.max(0,pages-1));
 const visible=rows.slice(entityPage*ENTITIES_PER_PAGE,(entityPage+1)*ENTITIES_PER_PAGE),controls=pageControls(view==='towns'?'Town pages':'Industry pages','entity-page',entityPage,pages);
 if(!visible.length)return '';
 if(view==='towns'){const active=new Set(game.routes.filter(route=>route.active).flatMap(route=>route.stops)),activeStops=game.stations.filter(stop=>active.has(stop.id));return visible.map(({entity:city,d})=>{const population=Math.floor(city.population),rent=city.market?.rent>0?city.market.rent:0;return `<button class="entity-card" data-city="${city.id}" data-ref="town:${escapeHTML(city.id)}"><h3><span class="entity-name">${escapeHTML(city.name)}</span><span class="entity-figure" title="${integer(population)} residents">${cargoIcon('passengers',{decorative:true})}<span data-num>${integer(population)}</span></span>${icon('chevronRight')}</h3><p class="entity-meta"><span class="entity-place">${tilesAway(Math.sqrt(d))}</span><span>${townService(game,city,activeStops).label}</span>${townGrowth(game,city)?.change>0?'<span class="town-tag">Growing</span>':''}${rent?`<span class="property-metric">Your property <span data-num>${money(rent)} a month</span></span>`:''}</p>${townNeedIcons(city)}</button>`;}).join('')+controls;}
 return visible.map(({entity:site,d})=>{const def=INDUSTRIES[site.kind],status=industryStatus(site),town=nearTown(site),stored=Object.values(site.inventory||{}).reduce((a,b)=>a+b,0);return `<button class="entity-card entity-site" data-industry="${site.id}" data-ref="industry:${escapeHTML(site.id)}" title="${integer(stored)} stored · ${Math.round((site.capacity||1)*100)}% capacity">${industryPortrait(site.kind,'entity-art',site)}<span class="entity-title"><h3><span class="entity-name">${escapeHTML(site.name||def.name)}</span>${icon('chevronRight')}</h3><p class="entity-place">${town?`Near ${escapeHTML(town.name)} · `:''}${tilesAway(Math.sqrt(d))}</p><span class="entity-meta">${cargoRecipe(def.inputs,def.outputs)}<span class="site-status" data-state="${status.state}">${escapeHTML(status.label)}</span></span></span></button>`;}).join('')+controls;
}
function entitySearch(label) {
 return `<label class="entity-search"><span class="sr-only">${label}</span><input id="entity-search" type="search" aria-label="${label}" placeholder="${label}" value="${escapeHTML(entityFilters[view])}"></label>`;
}
function entitySorter() {
 const noun=view==='towns'?'towns':'industries',sorts=view==='towns'?[['nearby','Nearest'],['population','Population'],...game.cities.some(city=>city.market?.rent>0)?[['property','Your property']]:[],['name','Name']]:[['nearby','Nearest'],['attention','Status'],['name','Name']];
 return `<label class="entity-search entity-sort"><span class="sr-only">Sort ${noun}</span><select id="entity-sort" aria-label="Sort ${noun}" title="Sort ${noun}">${sorts.map(([key,name])=>`<option value="${key}" ${entitySort()===key?'selected':''}>${name}</option>`).join('')}</select></label>`;
}
function townsPanel() { return `<div class="panel-heading"><h2>Towns</h2><span>${game.cities.length}</span></div><div class="entity-filters">${entitySearch('Find a town')}${entitySorter()}</div><div id="entity-list">${entityCards()}</div><div class="section-divider"></div><button class="button button-primary full" data-tool="city">${icon('city')} Found town · ${compactMoney(priceFor(game,BUILD_COSTS.city))}</button><button class="text-button" data-action="development">Zone a neighborhood <span>↗</span></button>`; }
function industryPanel() { return `<div class="panel-heading"><h2>Industries</h2><span>${game.industries.length} sites</span></div><div class="entity-filters">${entitySearch('Find a site or cargo')}${entitySorter()}</div><label class="entity-search"><span class="sr-only">Industry type</span><select id="industry-kind" aria-label="Industry type"><option value="all">All industries</option>${Object.entries(INDUSTRIES).filter(([,def])=>def.biomes.includes(game.biome)).map(([key,def])=>`<option value="${key}" ${entityFilters.kind===key?'selected':''}>${escapeHTML(def.name)}</option>`).join('')}</select></label><div id="entity-list">${entityCards()}</div><div class="section-divider"></div><button class="button button-primary full" data-action="industry-build">${icon('factory')} Build industry</button><button class="text-button" data-action="chains">Production chains <span>↗</span></button>`; }
function bindEntityCards(root) {
 // A pointer page turn lets focus go with the old buttons, so the periodic refresh keeps running; a keyboard one keeps its place.
 root.querySelectorAll('[data-entity-page]').forEach(button=>button.addEventListener('click',e=>{
  const direction=button.dataset.entityPage;entityPage+=direction==='next'?1:-1;refreshEntities();
  $('#entity-list').scrollIntoView({block:'start'});
  if(e.detail===0)($(`#entity-list [data-entity-page="${direction}"]:not(:disabled)`)||$('#entity-list [data-entity-page]:not(:disabled)'))?.focus({preventScroll:true});
 }));
}
function refreshEntities() {
 const list=$('#entity-list');if(!list)return;
 const markup=entityCards()||'<p class="empty-state">No matches. Try another name or cargo.</p>';
 // An unchanged refresh preserves the cards, listeners, focus and already drawn portraits.
 if(list.cardMarkup===markup)return;
 const panel=$('#panel-content'),scroll=panel.scrollTop,drawn=new Map();
 // Drawn portraits move into the new cards of the same industry, so a refresh repaints only the ones it lacks.
 const portraitKey=art=>`${art.dataset.industrySprite}:${art.dataset.industryFootprint||''}:${art.dataset.industryVariant||0}`;
 for(const art of list.querySelectorAll('[data-industry-sprite]')){const key=portraitKey(art);drawn.set(key,[...drawn.get(key)||[],art]);}
 list.innerHTML=markup;list.cardMarkup=markup;
 for(const art of list.querySelectorAll('[data-industry-sprite]')){const old=drawn.get(portraitKey(art))?.pop();if(old)art.replaceWith(old);}
 bindEntityCards(list);drawPaletteSprites(list);references?.relink();panel.scrollTop=scroll;
}
const buildPanelValues=()=>[game,game.day,game.revision,game.money,category,preferredMode,buildingGroup,engineeringOpen,pricingYear,goalChoice];
function syncBuildToolSelection(){
 if(view!=='build'||!buildPanelState)return false;
 const values=buildPanelValues();if(values.some((value,index)=>value!==buildPanelState[index]))return false;
 const panel=$('#panel-content');
 for(const el of panel.querySelectorAll('[data-tool]')){const active=el.dataset.tool===tool;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));}
 panel.querySelector('[data-build-stop-mode]').hidden=tool!=='stop';
 return true;
}
function renderPanel({resetScroll=false}={}) {
 const panel=$('#panel-content'),scroll=resetScroll?0:panel.scrollTop;
 if(view==='routes')autoSelectCargo();
 panel.innerHTML=view==='build'?buildPanel():view==='routes'?routesPanel():view==='towns'?townsPanel():industryPanel();
 buildPanelState=view==='build'?buildPanelValues():null;
 const entityList=panel.querySelector('#entity-list');if(entityList)entityList.cardMarkup=entityCardMarkup;
 drawPaletteSprites();references?.relink();
 panel.querySelectorAll('[data-stop-mode]').forEach(el=>el.addEventListener('click',()=>{preferredMode=el.dataset.stopMode;renderPanel();canvas.focus({preventScroll:true});}));
 panel.querySelector('.engineering-tools')?.addEventListener('toggle',e=>{engineeringOpen=e.currentTarget.open;});
 panel.querySelectorAll('[data-crossing-mode]').forEach(el=>el.addEventListener('click',()=>{
  preferredMode=el.dataset.crossingMode;
  if(spanTools.has(tool))setTool((preferredMode==='rail'?'rail':'')+(tool.includes('bridge')?'bridge':'tunnel'));
  else{renderPanel();canvas.focus({preventScroll:true});}
 }));
 if($('#building-group'))$('#building-group').addEventListener('change',e=>{buildingGroup=e.target.value;renderPanel();});
 panel.querySelectorAll('[data-construction-next]').forEach(button=>button.onclick=()=>{if(button.dataset.constructionNext==='route'){const station=constructionNext?.station;constructionNext=null;planRoute({mode:station?.mode||preferredMode,from:station?.id?String(station.id):'',to:'',cargo:'passengers'});}else{const mode=constructionNext?.kind==='network'?constructionNext.mode:constructionNext?.station?.mode||preferredMode;setTool(({road:'bus-stop',rail:'train-stop',water:'port',air:'airport'})[mode]||'stop');}});
 panel.querySelectorAll('[data-tool]').forEach(el=>el.addEventListener('click',()=>setTool(el.dataset.tool)));
 panel.querySelectorAll('[data-category]').forEach(el=>el.addEventListener('click',()=>{category=el.dataset.category;renderPanel();$('#panel-content').scrollTop=0;}));
 panel.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>{const a=el.dataset.action;if(a==='help')openHelp();if(a==='chains')openChains();if(a==='development'||a==='industry-build'){category=a==='development'?'towns':'industry';setView('build');}}));
 bindEntityCards(panel);
 if($('#entity-search'))$('#entity-search').oninput=e=>{entityFilters[view]=e.target.value;anchorEntities();refreshEntities();};
 if($('#entity-sort'))$('#entity-sort').onchange=e=>{entityFilters.sort={...entityFilters.sort,[view]:e.target.value};anchorEntities();refreshEntities();};
 if($('#industry-kind'))$('#industry-kind').onchange=e=>{entityFilters.kind=e.target.value;anchorEntities();refreshEntities();if(e.target.value==='all')dropCargoLens('industry');else setCargoLens(lensCargo(e.target.value),'industry');};
 panel.querySelectorAll('[data-project-action]').forEach(button=>button.onclick=()=>runProjectAction(button.dataset.projectAction,button.dataset.projectTarget,{tool:button.dataset.projectTool}));
 panel.querySelectorAll('[data-goal-show]').forEach(button=>button.onclick=()=>{storeGoalFolded(false);goalOpen=true;if(!mapLayers.goal)setMapLayers({goal:true});if(window.innerWidth<=1100)closeManagement();renderGoal();});
 bindRouteCards(panel);
 panel.querySelector('.fleet-upgrades')?.addEventListener('toggle',e=>{if(e.target.isConnected)fleetControlsOpen=e.target.open;});
 if($('#upgrade-fleet'))$('#upgrade-fleet').onclick=()=>performUpgrade();
 if($('#route-search'))$('#route-search').addEventListener('input',e=>{routeFilters.query=e.target.value;routePage=0;refreshRouteList();});
 for(const key of ['mode','status','cargo'])if($(`#route-filter-${key}`))$(`#route-filter-${key}`).addEventListener('change',e=>{routeFilters[key]=e.target.value;routePage=0;refreshRouteList();});
 if($('#clear-route-filters'))$('#clear-route-filters').onclick=()=>{routePage=0;routeFilters={query:'',mode:'all',status:'all',cargo:'all'};$('#route-search').value='';for(const key of ['mode','status','cargo'])$(`#route-filter-${key}`).value='all';refreshRouteList();$('#route-search').focus({preventScroll:true});};
 if($('#new-route-button'))$('#new-route-button').onclick=()=>openNewRoute();
 if($('#route-back'))$('#route-back').onclick=()=>{if(formDraft.editing)cancelRouteEdit();else{cancelRoutePicking();routeScreen='list';dropCargoLens('routes');renderPanel();$('#new-route-button')?.focus({preventScroll:true});}};
 panel.querySelectorAll('[data-route-next]').forEach(button=>button.onclick=()=>{if(button.dataset.routeNext==='new')openNewRoute();else{category='network';setView('build');setTool('stop');}});
 const planner=panel.querySelector('#route-planner');if(planner)planner.querySelector('summary').onclick=e=>e.preventDefault();
 panel.querySelector('.forecast-details')?.addEventListener('toggle',e=>{try{localStorage.setItem('transport-forecast-details',e.currentTarget.open?'open':'closed');}catch{}});
 // The checkbox has no name, so the form's own listeners pass it by; the draft keeps it after a launch, like the stops.
 const options=panel.querySelector('.route-options');
 if(options){options.addEventListener('toggle',()=>{if(options.isConnected)formDraft.optionsOpen=options.open;});options.querySelector('[data-route-option="full-load"]').addEventListener('change',e=>{formDraft.fullLoad=e.target.checked;options.querySelector('.route-options-state').textContent=fullLoadState();refreshRoutePlan();});}
 if(planner){planner.addEventListener('toggle',()=>{if(!planner.open)dropCargoLens('routes');});if(!planner.open)dropCargoLens('routes');}
 if($('#swap-route-stops'))$('#swap-route-stops').onclick=()=>{cancelRoutePicking();[formDraft.from,formDraft.to]=[formDraft.to,formDraft.from];renderPanel();$('#swap-route-stops')?.focus({preventScroll:true});};
 panel.querySelectorAll('[data-pick-route]').forEach(el=>el.addEventListener('click',()=>beginRoutePicking(el.dataset.pickRoute)));
 panel.querySelectorAll('[data-cargo-choice],[data-cargo-pick]').forEach(el=>el.addEventListener('click',()=>{
  formDraft.cargo=el.dataset.cargoChoice||el.dataset.cargoPick;formDraft.autoNote='';$('#route-form select[name=cargo]').value=formDraft.cargo;
  setCargoLens(formDraft.cargo,'routes');
  syncCargoChoice(panel);refreshRoutePlan();refreshUpgradeControls();
 }));
 const form=$('#route-form');
 if(form){
  form.addEventListener('input',e=>{if(e.target.name)formDraft[e.target.name]=e.target.value;});
  form.addEventListener('change',e=>{
   const key=e.target.name;if(!key)return;formDraft[key]=e.target.value;
   if(key==='cargo'){syncCargoChoice(panel);refreshRoutePlan();refreshUpgradeControls();}
   else if(key==='mode'){cancelRoutePicking();formDraft.from='';formDraft.to='';renderPanel();$('#route-form [name=mode]')?.focus({preventScroll:true});}
   else if(key==='from'||key==='to'){cancelRoutePicking();const s=game.stations.find(s=>String(s.id)===e.target.value);if(s)renderer.focus(s.x,s.y);renderPanel();$(`#route-form [name=${key}]`)?.focus({preventScroll:true});}
  });
  form.addEventListener('submit',e=>{
   e.preventDefault();const plan=draftPlan();refreshRoutePlan();if(!plan.valid)return toast(plan.message,true);
   if(editingRoute())return saveRouteEdit(plan);
   const [a,b]=plan.stations,result=addRoute(game,{name:formDraft.name.trim()||defaultRouteName(game,plan,formDraft.cargo),mode:formDraft.mode,stops:[a.id,b.id],cargo:formDraft.cargo,fullLoad:formDraft.fullLoad===true&&!isTownTraffic(formDraft.cargo)});
   toast(result.message,!result.ok);if(result.ok){routeScreen='list';cancelRoutePicking();formDraft.name='';formDraft.autoNote='';formDraft.open=false;renderPanel();updateHud();persist();flashRoute(result.route.id);}
  });
  form.addEventListener('click',e=>{const button=e.target.closest('#add-route-vehicle');if(button)addFromPlanner(button.dataset.route);});
  form.addEventListener('click',e=>{if(e.target.closest('#cancel-route-edit'))cancelRouteEdit();});
 }
 // Finish DOM, portraits and bindings before the single scroll/layout update.
 panel.scrollTop=scroll;
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
 const el=$('#weather');if(el.dataset.condition!==label){el.innerHTML=icon(symbol)+`<span>${label}</span>`;el.dataset.condition=label;syncPaused();}
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
 const marketBonus=game.history.at(-1)?.marketBonus||0;$('#market-bonus-row').hidden=!(marketBonus>0);$('#market-bonus-exact').textContent=money(marketBonus);
 // Rent from your property: last month's in the finances card, and the first ever as one toast; a saved total keeps a reload from replaying it.
 const rent=game.history.at(-1)?.property||0;$('#rent-row').hidden=!(rent>0);$('#rent-exact').textContent=money(rent);if(!rentSeen&&(game.totalProperty||0)>0){rentSeen=true;toast(`First rent from your property: +${money(rent)}.`,{action:{label:'Open report',run:()=>openCompany('property')}});}
 const loan=loanTerms(game);$('#loan-row').hidden=$('#interest-row').hidden=!loan.loan;if(loan.loan){$('#loan-exact').textContent=money(loan.loan);$('#interest-exact').textContent=money(loan.monthlyInterest)+' / month';}
 $('#profit-exact').title='Operating figures tracked since '+dayText(game.accountingStartDay||0);
 $('#delivered').innerHTML=integer(game.totalDelivered)+' <small>units</small>';
 const activeStopIds=new Set(game.routes.filter(route=>route.active).flatMap(route=>route.stops));
 const activeStops=game.stations.filter(stop=>activeStopIds.has(stop.id));
 const served=game.cities.filter(city=>townService(game,city,activeStops).connected).length;
 watchTowns(activeStops);
 $('#connected').innerHTML=served+` <small>/ ${game.cities.length}</small>`;$('#route-count').textContent=game.routes.length;
 updateRatingRow();
 $('#date').textContent=monthText(game.day);$('#date').title=longDayText(game.day);
 renderGoal();
 const zoom=renderer.getCamera().zoom, currentZoom=zoomIndex(zoom);
 const zoomLabel=ZOOM_VIEWS[currentZoom].name+' · '+Math.round(zoom*100)+'%';
 $('#zoom-label').textContent=ZOOM_VIEWS[currentZoom].name;
 $('#zoom-level').setAttribute('aria-label',zoomLabel+' · Choose zoom');$('#zoom-level').title=zoomLabel;
 $$('[data-zoom-level]').forEach(el=>el.setAttribute('aria-pressed',String(Number(el.dataset.zoomLevel)===zoom)));
 $('#zoom-out').disabled=currentZoom===0;$('#zoom-in').disabled=currentZoom===ZOOM_LEVELS.length-1;
 const showingRoutes=view==='routes'&&!$('.sidebar').inert;
 const routesById=showingRoutes?new Map(game.routes.map(route=>[String(route.id),route])):null;
 const loadsByRoute=new Map();
 // A route's line of vehicles waiting for a full load comes from the same pass: its length and its head, the earliest arrival.
 if(showingRoutes)for(const vehicle of game.vehicles){const key=String(vehicle.routeId),load=loadsByRoute.get(key)||{load:0,capacity:0,queue:{count:0,head:null}};load.load+=vehicle.load;load.capacity+=vehicle.capacity;if(waitingForFullLoad(vehicle)){const queue=load.queue;queue.count++;if(!queue.head||vehicle.fullLoadSince<queue.head.fullLoadSince)queue.head=vehicle;}loadsByRoute.set(key,load);}
 const healthByRoute=new Map(),healthOf=r=>{if(!healthByRoute.has(r))healthByRoute.set(r,routeHealth(game,r,loadsByRoute.get(String(r.id))));return healthByRoute.get(r);};
 if(showingRoutes)$$('[data-route-status]').forEach(el=>{const r=routesById?.get(el.dataset.routeStatus);if(r){const health=healthOf(r);el.textContent=health.label;el.classList.toggle('route-offline',health.state==='blocked');}});
 if(showingRoutes)$$('[data-route-revenue]').forEach(el=>{const r=routesById?.get(el.dataset.routeRevenue);if(r){const year=routeYearHeadline(r);if(el.textContent!==year.text)el.textContent=year.text;el.title=year.title;}});
 if(showingRoutes)$$('[data-route-health]').forEach(el=>{const r=routesById?.get(el.dataset.routeHealth);if(r){const health=healthOf(r);el.textContent=health.detail;el.title=health.detail;el.dataset.state=health.state;el.hidden=quietHealth(health);}});
 if(showingRoutes)$$('[data-route-stat]').forEach(el=>{const r=routesById?.get(el.dataset.routeStat);if(r)el.textContent=integer(r.delivered)+' moved';});
 if(showingRoutes)$$('[data-route-waiting]').forEach(el=>{const r=routesById?.get(el.dataset.routeWaiting);if(r){const health=healthOf(r),text=waitingText(health);if(el.textContent!==text)el.textContent=text;el.dataset.state=health.state;el.title=health.detail;}});
 if(showingRoutes)$$('[data-route-room]').forEach(el=>{const r=routesById?.get(el.dataset.routeRoom);if(r){const hint=roomHint(r,healthOf(r),loadsByRoute.get(String(r.id))),text=hint?.text||'';if(el.textContent!==text)el.textContent=text;el.hidden=!hint;if(hint&&el.title!==hint.title)el.title=hint.title;}});
 if(showingRoutes)$$('[data-route-rate]').forEach(el=>{const r=routesById?.get(el.dataset.routeRate);if(r){const rate=routeYearNote(r);if(el.textContent!==rate.text)el.textContent=rate.text;el.title=rate.title;}});
 if(showingRoutes)$$('[data-route-trip]').forEach(el=>{const r=routesById?.get(el.dataset.routeTrip);if(r){const html=routeTripHTML(r);if(el.dataset.shown!==html){el.innerHTML=html;el.dataset.shown=html;}}});
 if(showingRoutes){
  refreshRoutePlan();refreshUpgradeControls();
  if($('#route-list')){const filtered=filterRoutes(game,routeFilters),ids=visibleRoutePage(filtered).map(route=>String(route.id));
   $('#route-results-count').textContent=`${filtered.length} of ${game.routes.length} routes`;
   if(ids.join('|')!==$$('#route-list [data-route-id]').map(el=>el.dataset.routeId).join('|'))refreshRouteList();
  }
 }
}
function tileAt(x,y){return x>=0&&y>=0&&x<game.width&&y<game.height?game.tiles[y*game.width+x]:null;}
// Town needs only speed growth up: supplied cargo earns a check, the rest stay plain.
function townNeedList(city) {
 const needs=townNeeds(game,city),fresh=key=>game.day-(city.lastSupply?.[key]??-Infinity)<=NEED_WINDOW;
 return [...new Set(needs.flatMap(need=>need.cargo))].map(key=>({key,met:fresh(key),title:needs.filter(need=>need.cargo.includes(key)).map(need=>need.label).join(' · ')+(fresh(key)?' · delivered recently':'')}));
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
// A workshop's card: its recipes, its town's stock of each material and product, and Expand on one you placed.
function workshopBody(building,town) {
 const levels=town?workshopLevels(game,town):0,level=building.level||1,cost=priceFor(game,WORKSHOP.cost),month=WORKSHOP.rate*30,recipes=workshopRecipes(game),stock=town?.workshop;
 const cargo=[...new Set(recipes.flatMap(r=>[r.input,r.output]))],held=key=>(recipes.some(r=>r.input===key)?stock?.input[key]:stock?.output[key])||0;
 const expand=building.owner==='player'&&level<WORKSHOP.maxLevel?`<button class="button button-primary full" id="expand-workshop"${game.money<cost?` disabled title="Need ${money(cost)}"`:` title="Level ${level+1}, ${integer(month)} more materials a month"`}>${icon('plus')} Expand <span class="price" data-num>${money(cost)}</span></button>`:'';
 return `<div class="inspector-building"><canvas width="96" height="100" data-building-sprite="factory" aria-hidden="true"></canvas><div class="workshop-recipes">${recipes.map(r=>cargoRecipe({[r.input]:WORKSHOP.ratio},{[r.output]:1})).join('')}</div></div><div class="inspector-grid"><div><small>Town</small><strong>${town?refFor(game,`town:${town.id}`):'Countryside'}</strong></div><div><small>Town workshops</small><strong data-num>${integer(levels)} ${levels===1?'level':'levels'}</strong></div></div>${town?`<div class="section-divider"></div><div class="ledger workshop-ledger">${cargo.map(key=>`<div class="ledger-row">${cargoBadge(key)}<strong data-num>${integer(held(key))}</strong></div>`).join('')}</div><p class="micro-note">Deliveries to a stop within 5 tiles of the town center always pay. This town’s workshops turn up to ${integer(levels*month)} materials a month into products. Carry them to another town.</p>`:'<p class="micro-note">Workshops work for a town within 10 tiles of its center.</p>'}${expand}`;
}
// A town's workshops in its economy: what they make, and what waits for them or is ready to carry.
function townWorkshops(city) {
 const levels=workshopLevels(game,city),recipes=workshopRecipes(game),stock=city.workshop;if(!levels)return '';
 const list=(keys,side)=>listJoin([...new Set(keys)].filter(key=>(stock?.[side][key]||0)>=1).map(key=>cargoAmount(Math.floor(stock[side][key]),key)));
 const waiting=list(recipes.map(r=>r.input),'input'),ready=list(recipes.map(r=>r.output),'output');
 const foot=waiting||ready?`${[waiting&&`${waiting} waiting`,ready&&`${ready} ready`].filter(Boolean).join(', ')}.`:`Nothing waiting yet. Deliver ${listJoin([...new Set(recipes.map(r=>CARGO[r.input].name.toLowerCase()))],'or')} to a stop near the town center.`;
 return `<h4>Workshops, ${integer(levels)} ${levels===1?'level':'levels'}</h4><div class="workshop-lines">${recipes.map(r=>`<div class="workshop-line"><span class="cargo-tile">${cargoIcon(r.input,{decorative:true})}</span><span>${CARGO[r.input].name}</span><span class="workshop-to">to</span><span class="cargo-tile">${cargoIcon(r.output,{decorative:true})}</span><span>${CARGO[r.output].name}</span></div>`).join('')}</div><p class="economy-foot">${escapeHTML(foot)}</p>`;
}
// Your property in a building's inspector: its rent share and occupancy from the last close, what it is worth, the transport
// lever that fills it and, for a building you placed, Sell, confirmed in place. A plot names the ground rent developers pay.
const PROPERTY_HINTS={homes:'Regular passenger service fills homes.',shops:'Busy with shoppers when the town has visitors.',works:'Deliver materials and carry its products to another town to keep it busy.'};
function propertyHTML(x,y) {
 const p=propertyAt(game,x,y);if(!p)return '';
 const figures=label=>`<div class="inspector-grid"><div><small>${label}</small><strong data-num>${money(p.rent)} a month</strong></div><div><small>Occupancy</small><strong data-num>${Math.round(p.occupancy*100)}%</strong></div></div>`;
 if(p.kind==='plot')return `<div class="property" data-property="plot">${p.town?figures('Ground rent'):''}<p class="micro-note">Your plot. Developers built this; you collect ground rent.</p></div>`;
 const refund=Math.round(SALE_SHARE*p.value),cargo=p.family&&familyCargo(game,p.family)[0],hint=!p.town?'Earns rent once a town centre is within 10 tiles.':cargo?`Deliver ${CARGO[cargo].name.toLowerCase()} to keep its shelves full.`:PROPERTY_HINTS[p.sector];
 const sell=sellAsk===`${worldSerial}|${x},${y}`?`<div class="property-sell" role="group" aria-labelledby="sell-question"><p id="sell-question">Sell it${p.town?` to ${escapeHTML(p.town.name)}`:''} for ${money(refund)}? The town takes it over and its rent stops. The building stays.</p><div class="property-sell-actions"><button type="button" class="button button-outline" id="sell-keep">Keep it</button><button type="button" class="button button-primary" id="sell-confirm">Sell</button></div></div>`:`<button type="button" class="button button-outline full" id="sell-property">Sell for <span class="price" data-num>${money(refund)}</span></button>`;
 return `<div class="property" data-property="owned">${p.town?figures('Rent'):''}<p class="property-worth">Worth <b data-num>${money(p.value)}</b>${p.paid?`. You paid <b data-num>${money(p.paid)}</b>`:''}.</p><p class="micro-note">${hint}</p>${sell}</div>`;
}
// Town economy waits in a closed fold: three demand bars, what the shops want this month and what wanted cargo pays.
// It reads marketView only, so opening it never changes the town.
let townEconomyOpen=false;
const DEMAND_ROWS=['Homes','Shops','Workshops'];
const familyName=(family,cargo)=>family==='materials'?'Building materials':CARGO[cargo]?.name||'Household goods';
// The tier a town need is holding back right now, in one of this town's zones.
function slowedNeed(city) {
 const needs=townNeeds(game,city).filter(need=>need.tier&&!need.met&&need.cargo.length),zones=nearbyZones(game,city.x,city.y,TOWN_RADIUS);
 return needs.find(need=>zones.some(zone=>zone.kind===need.kind&&Math.floor(zone.progress)+1===need.tier&&tileAt(zone.x,zone.y)?.zone===zone.kind&&townOf(game,zone.x,zone.y)===city));
}
function economyNote(view,inputs) {
 const bars=view.demand,top=bars.indexOf(Math.max(...bars)),shoppers=integer(inputs.shoppers);
 if(bars.every(bar=>bar<.25))return 'Demand is quiet. Regular service and deliveries raise it.';
 if(top===0)return inputs.served?`People want to move here: your service is regular${inputs.amenity>=.3?' and the town has good local services':''}.`:'Regular service would bring new residents.';
 if(top===1)return view.shops?`About ${shoppers} shoppers for ${integer(view.shops)} ${view.shops===1?'shop':'shops'}. Commercial zones would fill quickly.`:`About ${shoppers} shoppers and no shops yet. Commercial zones would fill quickly.`;
 return 'People here are looking for work. Industrial zones would fill quickly.';
}
// The company's property in a town, inside its economy: last month's rent and what it holds there today.
function townPropertyHTML(city,view) {
 const {plots,owned}=townHoldings(game,city);if(!plots.length&&!owned.length)return '';
 return `<h4>Your property</h4><div class="inspector-grid town-property"><div><small>Rent last month</small><strong data-num>${money(view.rent||0)}</strong></div><div><small>Plots and buildings</small><strong data-num>${integer(plots.length)} and ${integer(owned.length)}</strong></div></div>`;
}
// What the company earned here over the ledger's months (market.returns, up to 12): rent, market bonus and workshop freight, with
// a small line of the months once there are two. It changes only as a month closes.
const monthDay=month=>(Date.UTC(1950,month,1)-Date.UTC(1950,0,1))/864e5;
function townReturnsHTML(city) {
 const returns=city.market?.returns;if(!returns?.some(entry=>entry.some(value=>value>0)))return '';
 const n=returns.length,parts=returnsTotals(city.market).map((sum,i)=>sum>0?`${moneyText(sum,{compact:true})} ${['rent','market bonus','workshop freight'][i]}`:'').filter(Boolean);
 const spark=n>1?`<span class="town-returns-spark" title="${escapeHTML(`Monthly returns, ${dateShort(monthDay(game.lastMonth-n))} – ${dateShort(monthDay(game.lastMonth-1))}`)}">${miniSpark(returns.map(entry=>entry[0]+entry[1]+entry[2]),'town-returns-line')}</span>`:'';
 return `<div class="town-returns"><p class="economy-foot">${n===1?'Last month':`Past ${n} months`} here: ${listJoin(parts)}.</p>${spark}</div>`;
}
function townEconomySection(city) {
 const view=marketView(game,city),cargoOf=family=>familyCargo(game,family)[0],wanted=FAMILIES.filter(family=>view.wants[family]>0),short=wanted.find(family=>Math.floor(view.supplied[family])<view.wants[family]);
 const rows=view.demand.map((bar,i)=>{const word=demandLabel(bar);return `<div class="demand-row" aria-label="${DEMAND_ROWS[i]} demand ${word.toLowerCase()}"><span>${DEMAND_ROWS[i]}</span><span class="demand-meter" aria-hidden="true"><i style="width:${Math.round(bar*100)}%"></i></span><b>${word}</b></div>`;}).join('');
 const chips=wanted.map(family=>{const cargo=cargoOf(family),name=familyName(family,cargo),got=Math.floor(view.supplied[family]),want=view.wants[family],met=got>=want;return `<span class="want${met?' met':''}" title="${integer(got)} of ${integer(want)} ${escapeHTML(name.toLowerCase())} delivered this month"><span class="cargo-tile">${cargoIcon(cargo,{decorative:true})}</span><span class="want-name">${escapeHTML(name)}</span><span class="want-figure" data-num><b>${integer(got)}</b> of ${integer(want)}</span>${met?`${uiIcon('check',{size:16,cls:'want-check'})}<span class="sr-only">, all delivered</span>`:''}</span>`;}).join('');
 const need=slowedNeed(city),needNames=need?.cargo.map((key,n)=>n?CARGO[key].name.toLowerCase():CARGO[key].name).join(' or ');
 const hint=need?`<p class="economy-note">${escapeHTML(`${needNames} deliveries help ${need.kind==='commercial'?'shops':'homes'} grow into ${need.label.toLowerCase()}.`)}</p>`:'';
 const lead=view.rent>0?`${money(view.rent)} a month`:short?`Wants ${familyName(short,cargoOf(short)).toLowerCase()}`:'';
 return `<details class="town-economy" ${townEconomyOpen?'open':''}><summary><span class="economy-title">Town economy</span><span class="economy-mini" aria-hidden="true">${view.demand.map(bar=>`<i style="height:${Math.round(3+9*bar)}px"></i>`).join('')}</span><strong class="economy-lead">${lead}</strong>${uiIcon('chevronDown',{size:16,cls:'economy-chevron'})}</summary><div class="demand-rows">${rows}</div><p class="economy-note">${escapeHTML(economyNote(view,demandInputs(game,city,view)))}</p>${townWorkshops(city)}<h4>Shops want each month</h4>${chips?`<div class="wants">${chips}</div>`:'<p class="economy-foot">No shop wants yet. Food and household shops appear as commercial zones develop.</p>'}${hint}${chips?`<p class="economy-foot">Wanted cargo pays ${Math.round(MARKET.bonus*100)}% more, up to these amounts each month.</p>`:''}${townPropertyHTML(city,view)}${townReturnsHTML(city)}</details>`;
}
// Opinion of your company waits in a closed fold: why the town feels as it does. The town hall follows in its own fold.
let townOpinionOpen=false,townHallOpen=false;
const opinionNames=cargo=>{const names=cargo.slice(0,3).map((key,n)=>n?CARGO[key].name.toLowerCase():CARGO[key].name);return cargo.length>3?`${names.join(', ')} and more`:listJoin(names);};
const OPINION_REASONS={service:r=>`Regular service for ${r.months} ${r.months===1?'month':'months'}`,stops:r=>r.count===1?'A stop in town':`${r.count} stops in town`,supplies:r=>`${opinionNames(r.cargo)} delivered recently`,demolition:r=>`Homes or woodland cleared, fades in ${r.months} ${r.months===1?'month':'months'}`};
function townOpinionSection(city) {
 const opinion=townOpinion(game,city),tone=opinion.score>=50?'good':opinion.score>=40?'fair':'low';
 const reasons=opinion.reasons.length?`<ul class="opinion-reasons">${opinion.reasons.map(reason=>{const points=Math.round(reason.points);return `<li class="${points<0?'down':'up'}"><span>${escapeHTML(OPINION_REASONS[reason.key](reason))}</span><b data-num>${points<0?'−':'+'}${Math.abs(points)}</b></li>`;}).join('')}</ul>`:'<p class="micro-note">No service here yet.</p>';
 const effect=opinion.growth>1?`${opinion.label}: the town builds its own homes ${Math.round((opinion.growth-1)*100)}% faster.`:`${opinion.label}: no effect on growth.`;
 return `<details class="town-opinion" data-tone="${tone}" ${townOpinionOpen?'open':''}><summary><span class="opinion-title">Opinion of your company</span>${uiIcon('chevronDown',{size:16,cls:'opinion-chevron'})}<span class="opinion-state"><strong>${opinion.label}</strong><span class="opinion-meter" aria-hidden="true"><i style="width:${opinion.score}%"></i></span></span></summary>${reasons}<p class="opinion-effect">${effect}</p><p class="micro-note">Regular service lifts a town’s opinion. Clearing homes or woodland lowers it for a while. Opinion never blocks building, slows growth or changes fares.</p></details>${townHallHTML(city)}`;
}
// Town hall: a closed fold with two optional purchases, the price on the button. Hints state facts; nothing recommends buying.
function townHallHTML(city) {
 const near=new Set(nearbyStations(game,city.x,city.y,STATION_RADIUS+AIRPORT_REACH+1).filter(stop=>stationServes(stop,city)).map(stop=>stop.id));
 const riders=game.routes.some(route=>route.active&&route.cargo==='passengers'&&route.stops.some(id=>near.has(id))),outlook=townOutlook(game,city);
 const action=(key,label,running,description,hint)=>{
  const quote=townActionQuote(game,city,key),blocked=!quote.active&&!quote.affordable;
  return `<div class="town-action"${quote.active?' data-active':''}><button type="button" class="small-button" data-town-action="${key}"${quote.active||blocked?' disabled':''}${blocked?` title="Need ${money(quote.cost)}"`:''}>${quote.active?`<span>${running} until ${dateLong(quote.until)}</span>`:`<span>${label}</span><span class="price" data-num>${money(quote.cost)}</span>`}</button><p>${description}</p>${hint&&!quote.active?`<p class="micro-note">${hint}</p>`:''}</div>`;
 };
 return `<details class="town-hall" ${townHallOpen?'open':''}><summary><span class="town-hall-title">Town hall</span>${uiIcon('chevronDown',{size:16,cls:'town-hall-chevron'})}</summary>${action('advertise','Advertise','Advertising',`About ${Math.round((TOWN_ACTIONS.advertise.passengers-1)*100)}% more passengers at your stops here for six months. It pays off when your vehicles leave with empty seats.`,!riders?'Pays off once a passenger route stops here.':city.passengers>=.25*city.population?'Plenty of passengers already wait here, so a campaign may add little.':'')}${action('fund','Fund development','Funded','For a year the town builds its own homes and develops your zones here about twice as fast, even without your service.',fundHint(city,outlook))}</details>`;
}
// What a funded year would do here, from fundForecast: your zoned tiles first, then the town's free plots.
function fundHint(city,outlook) {
 const f=fundForecast(game,city);
 if(f.zones)return `Your ${countText(f.zones,'zoned tile')} here would develop ${f.served?'twice as fast':'even without service'}.`;
 if(f.plots)return f.served?`Its ${countText(f.plots,'free plot')} nearby would fill about twice as fast.`:`About ${integer(f.residents)} new residents in a year, on free plots nearby.`;
 return `No free plots within ${integer(outlook.reach)} tiles, so the town extends its streets first and growth starts slowly.`;
}
function runTownAction(city,action,keyboard=false) {
 const result=buyTownAction(game,city.id,action);toast(result.message,!result.ok);if(!result.ok)return;
 updateHud();persist();inspect(city.x,city.y,'city');
 if(keyboard)$('#inspector .town-hall summary')?.focus({preventScroll:true});
}
// Each known condition reads as its icon, the phrase in its tooltip; green helps, amber holds back.
const CONDITION_ICONS={'Road access':'road','Poor access':'road','Needs a road':'road','Rail access':'rail','Development funded':'coin','Recent deliveries':'truck','Needs deliveries':'truck','Served by a route':'route','Nearby industry':'industry','Nearby partners':'chains','Nearby customers':'shop','Local services':'shop','Neighbors':'house','Nearby workers':'house','Few workers':'house','Green surroundings':'leaf','Cold weather':'snow','Dry weather':'sun','Industrial pollution':'industry','Pollution':'industry'};
function conditionChip(text,cls,fallback) {
 const glyph=CONDITION_ICONS[text];
 return glyph?`<span class="condition-chip condition-icon ${cls}" role="img" aria-label="${escapeHTML(text)}" title="${escapeHTML(text)}">${icon(glyph)}</span>`:`<span class="condition-chip ${cls}">${icon(fallback)}${escapeHTML(text)}</span>`;
}
function localConditions(conditions) {
 const positives=conditions.positive.slice(0,3),negatives=conditions.negative.slice(0,2);
 return `<section class="local-conditions" aria-label="Local conditions"><h4>Local conditions</h4><div class="condition-list">${positives.map(text=>conditionChip(text,'condition-good','check')).join('')}${(conditions.notes||[]).map(text=>conditionChip(text,'condition-note','leaf')).join('')}${negatives.map(text=>conditionChip(text,'condition-concern','warning')).join('')}</div></section>`;
}
// A factory's nearest producers of each input, as references; straight-line distance like Nearest targets.
function industrySuppliers(industry) {
 const supply=findIndustrySuppliers(game,industry,2).filter(entry=>entry.sites.length);if(!supply.length)return '';
 return `<section class="industry-suppliers" aria-label="Supplied by"><h4 title="Straight-line distance. A route still needs a connected network.">Supplied by</h4>${supply.map(({cargo,sites})=>`<div class="supplier-row">${cargoBadge(cargo)}<span class="supplier-list">${sites.map(site=>`<span>${refFor(game,`industry:${site.id}`)} <small data-num>${tilesText(Math.round(site.distance))}</small></span>`).join('')}</span></div>`).join('')}</section>`;
}
// The stops that reach a town and the routes that call there, as references.
function townLinks(city) {
 const stops=nearbyStations(game,city.x,city.y,STATION_RADIUS+AIRPORT_REACH+1).filter(stop=>stationServes(stop,city));if(!stops.length)return '';
 const routes=routesServing(new Set(stops.map(stop=>stop.id)));
 return `<p class="service-summary town-links">Served by ${refList(stops.map(stop=>`stop:${stop.id}`),3)}</p>${routes.length?`<p class="service-routes">${routes.map(route=>refFor(game,`route:${route.id}`,{variant:'compact'})).join('')}</p>`:''}`;
}
function industryDestinations(industry) {
 const outputs=Object.keys(INDUSTRIES[industry.kind].outputs), targets=findIndustryTargets(game,industry,5,{workshops:true});
 const from=servingStops(industry),plans=targets.map(target=>from.length?targetPlan(target,from):'');
 holdContext(industry,targets);
 const uses=outputs.map(cargo=>{
  const consumers=Object.values(INDUSTRIES).filter(d=>d.biomes.includes(game.biome)&&d.inputs[cargo]).map(d=>d.name);
  if(TOWN_CARGO.includes(cargo))consumers.push('Towns');
  if(workshopRecipes(game).some(r=>r.input===cargo))consumers.push('Town workshops');
  return `<div class="industry-use">${cargoBadge(cargo)}<span class="cargo-arrow" aria-hidden="true">→</span><span>${escapeHTML(consumers.join(', ')||'No buyers in this region')}</span></div>`;
 }).join('');
 return `<section class="industry-destinations" aria-label="Output destinations"><div class="destination-heading"><h4>Deliver to</h4><button class="small-button icon-only" id="industry-chain" aria-label="Full chain" title="Full chain">${icon('chains')}</button></div>${uses}<h4 title="Straight-line distance. A route still needs a connected network.">Nearest targets <span>${targets.length}</span></h4><div class="industry-target-list">${targets.map((target,index)=>`${plans[index]?'<div class="industry-target-row">':''}<button class="industry-target" data-target-id="${escapeHTML(target.id)}" data-target-kind="${target.kind}" data-ref="${target.kind==='city'?'town':'industry'}:${escapeHTML(target.id)}" aria-label="Locate ${escapeHTML(target.name)}, ${Math.round(target.distance)} tiles away"><span class="target-number">${index+1}</span><span class="target-detail"><strong>${escapeHTML(target.name)}</strong><small>${Math.round(target.distance)} tiles</small></span><span class="target-cargo">${target.cargo.map(c=>cargoIcon(c,{decorative:true})).join('')}</span>${icon('focus')}</button>${plans[index]?plans[index]+'</div>':''}`).join('')||'<p class="destination-note">No buyers yet. Open the chain to build one.</p>'}</div></section>`;
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
 return {...selectionContext,covers:[$('#inspector'),$('#objective-card'),$('.sidebar.drawer-open')].filter(el=>el&&!el.hidden).map(el=>{const r=el.getBoundingClientRect();return {x:r.left-map.left,y:r.top-map.top,w:r.width,h:r.height};})};
}
$('.sidebar').addEventListener('transitionend',e=>{if(e.target===e.currentTarget&&selectionContext)invalidateScene();});
// Your property is outlined on the map only while you build in towns (Build › Town open, or one of its tools in hand), or while
// the inspector shows a town, a building on your zone or a building you own.
function propertyOutlines() {
 if(view==='build'&&category==='towns'&&(tool!=='inspect'||$('.sidebar').classList.contains('drawer-open')))return true;
 if(!selected||$('#inspector').hidden)return false;
 const site=buildingAt(game,selected.x,selected.y);
 return site?Boolean(tileAt(site.x,site.y)?.zone||site.building.owner==='player'):selected.kind==='city'||game.cities.some(city=>city.x===selected.x&&city.y===selected.y);
}
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
 setTool('inspect');leaveModal();closeManagement();inspect(industry.x,industry.y,'industry',origin);glideCamera(resolveRef(game,`industry:${industry.id}`).frame,{zoom:1,ref:`industry:${industry.id}`});updateHud();
}
function locateDestination(id,kind,origin='') {
 if(kind==='industry'){locateIndustry(id,origin);return;}
 const city=game.cities.find(c=>String(c.id)===String(id));if(!city)return;
 setTool('inspect');leaveModal();closeManagement();inspect(city.x,city.y,'city',origin);glideCamera(resolveRef(game,`town:${city.id}`).frame,{zoom:1,ref:`town:${city.id}`});updateHud();
}
// Inspectors name the stops and routes that serve a place; their buttons pre-fill the planner and pick any open end on the map.
const nameList = (names,max=3) => names.length>max?`${names.slice(0,max).join(', ')} and ${names.length-max} more`:names.length>1?`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`:names[0]||'';
// The same list of references (DESIGN.md 7): each named place or route finds itself on the map.
const refList = (values,max=3) => nameList(values.map(value=>refFor(game,value)),max);
const routesServing = ids => game.routes.filter(route=>route.stops.some(id=>ids.has(id)));
const planAttributes = (mode,from,to,cargo,pick='') => `data-plan-mode="${mode}" data-plan-from="${escapeHTML(from)}" data-plan-to="${escapeHTML(to)}" data-plan-cargo="${escapeHTML(cargo)}" data-plan-pick="${pick}"`;
function servingStops(site) {
 // An airport serves towns only, within 7 tiles of any of its tiles; its anchor may lie further off than a stop's.
 const size=INDUSTRIES[site.kind]?industrySize(site):1,reach=stop=>INDUSTRIES[site.kind]?industryDistance(site,stop):stationDistance(stop,site),serves=stop=>INDUSTRIES[site.kind]?stop.mode!=='air'&&reach(stop)<=STATION_RADIUS:stationServes(stop,site);
 return nearbyStations(game,site.x+(size-1)/2,site.y+(size-1)/2,STATION_RADIUS+size+(INDUSTRIES[site.kind]?0:AIRPORT_REACH)).filter(serves).sort((a,b)=>reach(a)-reach(b));
}
// DESIGN.md 7.4: selecting a stop, an industry or a town emphasises the routes that serve it on the map.
let servedKey='',servedRoutes=null;
function selectedServices() {
 const key=selected?`${worldSerial}|${selected.x},${selected.y},${selected.kind}|${game.revision}`:'';if(key===servedKey)return servedRoutes;
 servedKey=key;servedRoutes=null;if(!selected)return null;
 const {x,y,kind}=selected,station=kind!=='city'&&kind!=='industry'?stationAt(game,x,y):null,industry=!station&&kind!=='city'?game.industries.find(i=>industryContains(i,x,y)):null,city=!station&&!industry?game.cities.find(c=>c.x===x&&c.y===y):null;
 const stops=station?[station]:industry||city?servingStops(industry||city):[],def=industry&&INDUSTRIES[industry.kind];
 const routes=stops.length?routesServing(new Set(stops.map(stop=>stop.id))).filter(route=>!def||def.outputs[route.cargo]||def.inputs[route.cargo]):[];
 return servedRoutes=routes.length?routes.map(route=>route.id):null;
}
function planRoute(draft,pick='') {
 formDraft={...formDraft,name:'',autoNote:'',open:true,editing:'',...formDraft.editing&&{fullLoad:false,optionsOpen:false},...draft};setView('routes',{routeScreen:'new'});
 if(pick)beginRoutePicking(pick);else scrollIntoViewSafe($('#route-form'),{block:'nearest'});
}
function stationCargoNotes(station) {
 const coverage=stationCoverage(game,station),places=[...coverage.cities.map(city=>`town:${city.id}`),...coverage.industries.map(site=>`industry:${site.id}`)];
 const label=(key,cargo)=>{const name=CARGO[cargo].name.toLowerCase();return key==='produces'?(cargo==='passengers'?'Carry passengers':`Ship ${name}`):cargo==='passengers'?'Bring passengers here':`Deliver ${name} here`;};
 const note=key=>`<div class="coverage-note"><strong>${key==='produces'?'Loads':'Accepts'}</strong><span class="coverage-cargo">${coverage[key].map(cargo=>`<button type="button" class="coverage-pick" ${key==='produces'?planAttributes(station.mode,station.id,'',cargo,'to'):planAttributes(station.mode,'',station.id,cargo,'from')} title="${escapeHTML(label(key,cargo))}" aria-label="${escapeHTML(label(key,cargo))}"><span class="cargo-badge" data-cargo="${cargo}">${cargoIcon(cargo,{decorative:true})}</span></button>`).join('')||'No cargo nearby'}</span></div>`;
 return note('produces')+note('accepts')+(places.length?`<p class="coverage-names">Covers ${refList(places,4)}</p>`:'');
}
function stationServices(station) {
 const routes=game.routes.filter(route=>route.stops.includes(station.id));if(!routes.length)return '';
 const rows=routes.slice(0,6).map(route=>{const fleet=getRouteFleet(game,route.id),health=routeHealth(game,route,fleet);return refFor(game,`route:${route.id}`,{variant:'row',after:`<small class="service-detail">${fleet.count} ${fleetNoun(route,fleet.count)} · <span data-state="${health.state}">${escapeHTML(health.label)}</span></small>${cargoIcon(route.cargo)}`});}).join('');
 return `<section class="station-services" aria-label="Routes here"><h4>Routes here <span>${routes.length}</span></h4><div class="service-list">${rows}</div>${routes.length>6?`<button type="button" class="service-more" data-service-more="${escapeHTML(station.name)}">and ${routes.length-6} more in Routes</button>`:''}</section>`;
}
// A site's service counts the routes that load its output or bring its inputs at a stop in reach.
function industryService(industry) {
 const d=INDUSTRIES[industry.kind],stops=servingStops(industry),center={x:industry.x+(industrySize(industry)-1)/2,y:industry.y+(industrySize(industry)-1)/2};
 if(!stops.length)return `<section class="industry-service" aria-label="Service"><button type="button" class="button button-outline full" data-place-stop="${center.x},${center.y}" title="No stop within 5 tiles yet">${icon('bus')} Place a stop nearby</button></section>`;
 const ids=new Set(stops.map(stop=>stop.id)),routes=routesServing(ids).filter(route=>d.outputs[route.cargo]||d.inputs[route.cargo]),start=stops.find(stop=>stop.mode===preferredMode)||stops[0],output=Object.keys(d.outputs)[0];
 return `<section class="industry-service" aria-label="Service"><p class="service-summary">Served by ${refList(stops.map(stop=>`stop:${stop.id}`),2)} · ${routes.length?`${routes.length} route${routes.length===1?'':'s'}`:'no route yet'}</p>${routes.length?`<p class="service-routes">${routes.map(route=>refFor(game,`route:${route.id}`,{variant:'compact'})).join('')}</p>`:''}${output?`<button type="button" class="button button-primary full" ${planAttributes(start.mode,start.id,'',output,'to')}>${icon('route')} Plan route from here</button>`:''}${Object.keys(d.inputs).map(cargo=>`<button type="button" class="small-button industry-supply" ${planAttributes(start.mode,'',start.id,cargo,'from')}>${cargoIcon(cargo,{decorative:true})}Supply ${escapeHTML(CARGO[cargo].name.toLowerCase())}</button>`).join('')}</section>`;
}
// A nearest target offers Plan once stops of one transport already reach both ends.
function targetPlan(target,from) {
 const site=target.kind==='industry'?game.industries.find(i=>i.id===target.id):game.cities.find(city=>city.id===target.id),to=site?servingStops(site):[];
 const pairs=from.flatMap(a=>to.filter(b=>b.mode===a.mode&&b.id!==a.id).map(b=>[a,b])),pair=pairs.find(([a])=>a.mode===preferredMode)||pairs[0];
 return pair?`<button type="button" class="target-plan" ${planAttributes(pair[0].mode,pair[0].id,pair[1].id,target.cargo[0])} aria-label="Plan a route to ${escapeHTML(target.name)}">${icon('route')}Plan</button>`:'';
}
function bindServiceLinks(box) {
 box.querySelectorAll('[data-service-more]').forEach(el=>el.onclick=()=>{routeFilters={query:el.dataset.serviceMore,mode:'all',status:'all',cargo:'all'};routePage=0;setView('routes');});
 box.querySelectorAll('[data-plan-cargo]').forEach(el=>el.onclick=()=>{const plan=el.dataset;planRoute({mode:plan.planMode,from:plan.planFrom,to:plan.planTo,cargo:plan.planCargo},plan.planPick);});
 box.querySelectorAll('[data-place-stop]').forEach(el=>el.onclick=()=>{const [x,y]=el.dataset.placeStop.split(',').map(Number);category='network';setView('build');setTool('stop');renderer.focus(x,y);updateHud();});
}
function networkUse(tile,x,y) {
 const routes=game.routes.filter(route=>route.active&&(route.mode==='road'||route.mode==='rail')&&route.path?.some(p=>p.x===x&&p.y===y));
 return `<p class="network-use">${routes.length?`Used by ${refList(routes.map(route=>`route:${route.id}`),4)}`:'Not used by any route'}</p><p>${tile.road?tile.publicRoad?'Public road · no upkeep':'Company road':'Company railway'}${tile.road&&tile.rail?' · railway':''}</p>`;
}
// The last generated markup, not box.innerHTML: drawn portraits change their canvas attributes.
let inspectorHTML='', inspectorKey='', panelPress=false, panelReleasedAt=-Infinity;
function inspect(x,y,kind='',origin='',{from=null,source=null,back=null}={}) {
 if(selectedVehicle)clearVehicle();
 const site=kind!=='city'?buildingAt(game,x,y):null;if(site){x=site.x;y=site.y;}
 const airport=kind!=='city'&&!site?stationAt(game,x,y):null;if(airport?.mode==='air'){x=airport.x;y=airport.y;}
 const terrainSite=kind!=='city'&&!site?terrainObjectAt(game,x,y):null,nature=terrainSite?.object.kind==='mountain'?null:terrainSite;if(nature){x=nature.x;y=nature.y;}
 const tile=tileAt(x,y);if(!tile)return;const changed=!selected||selected.x!==x||selected.y!==y||selected.kind!==kind;selected={x,y,kind};
 if(changed||back)trackInspector({from,source,back});
 const station=stationAt(game,x,y),industry=game.industries.find(i=>industryContains(i,x,y)), city=game.cities.find(c=>c.x===x&&c.y===y)||game.cities.find(c=>Math.hypot(c.x-x,c.y-y)<4&&tile.building);
 let title,tag,body;
 if(station&&kind!=='city'&&kind!=='industry'){const air=station.mode==='air';title=station.name;tag=air?'Airport, 6 × 2 site':stopName(station.mode).replace(/^./,c=>c.toUpperCase());body=`${infrastructurePortrait(air?'airport':station.mode==='water'?'port':station.mode==='rail'?'train-stop':'bus-stop','inspector-station-art')}<div class="inspector-grid">${air?`<div><small>Runway</small><strong>${station.axis==='y'?'North–south':'East–west'}</strong></div><div><small>Coverage</small><strong>${AIRPORT_REACH} tiles</strong></div>`:`<div><small>Network</small><strong>${transportName(station.mode)}</strong></div><div><small>Coverage</small><strong>5 tiles</strong></div>`}</div>${stationCargoNotes(station)}${air?`<p class="micro-note">Planes fly straight to any airport at least ${AIRPORT_MIN_TILES} tiles away. No track needed.</p>`:''}${stationServices(station)}<button class="button button-primary full" id="station-route">${icon('route')} New route</button>`;}
 else if(industry){const d=INDUSTRIES[industry.kind],conditions=industryConditions(game,industry),typical=Object.values(d.outputs).reduce((a,b)=>a+b,0)*(industry.capacity||1)*conditions.productivity;title=industry.name||d.name;tag=`Industry · ${industrySize(industry)} × ${industrySize(industry)} site`;const status=industryStatus(industry,game);body=`${industry.openedDay!==undefined?`<p class="micro-note">Opened in ${calendarYear(game,industry.openedDay)}</p>`:''}<div class="inspector-industry-art">${industryPortrait(industry.kind,'entity-art',industry)}${cargoRecipe(d.inputs,d.outputs)}</div><div class="industry-condition" data-state="${status.state}" title="${escapeHTML(status.detail)}"><strong>${escapeHTML(status.label)}</strong>${status.tone==='ok'?'':`<p>${escapeHTML(status.detail)}</p>`}</div>${industryService(industry)}${industrySuppliers(industry)}${industryDestinations(industry)}<div class="inspector-grid"><div><small>Capacity</small><strong>${Math.round((industry.capacity||1)*100)}%</strong></div><div><small>Storage</small><strong>${Math.round(outputFill(industry)*100)}% full</strong></div><div><small>Potential / day</small><strong>${typical.toLocaleString('en-US',{maximumFractionDigits:1})}</strong></div></div>${localConditions(conditions)}<div class="section-divider"></div><div class="ledger">${Object.entries(industry.inventory||{}).map(([key,n])=>`<div class="ledger-row">${cargoBadge(key,{label:true})}<strong>${integer(n)}</strong></div>`).join('')||'<span class="micro-note">Storage empty</span>'}</div>${industrySize(industry)<industryFootprint(industry.kind)?'<p class="micro-note">Compact legacy site. New construction uses a larger plot.</p>':''}`;}
 else if(kind!=='city'&&tile.building&&BUILDINGS[tile.building.kind]){const b=BUILDINGS[tile.building.kind],span=buildingSize(tile.building);title=b.name;tag=`${span} × ${span} site · ${b.group==='homes'?b.tier+' home':b.tier||BUILDING_GROUPS[b.group].name}`;const nearest=game.cities.reduce((best,c)=>!best||Math.hypot(c.x-x,c.y-y)<Math.hypot(best.x-x,best.y-y)?c:best,null);body=`<div class="inspector-building"><canvas width="96" height="100" data-building-sprite="${tile.building.kind}" data-building-variant="${tile.variant??x*13+y}" aria-hidden="true"></canvas><p>${escapeHTML(b.tier||BUILDING_GROUPS[b.group].name)} · ${nearest&&Math.hypot(nearest.x-x,nearest.y-y)<=10?refFor(game,`town:${nearest.id}`):'Countryside'}</p></div><div class="inspector-grid"><div><small>Collection</small><strong>${escapeHTML(BUILDING_GROUPS[b.group].name)}</strong></div><div><small>Development</small><strong>Level ${tile.building.level||1}</strong></div></div><p>${escapeHTML(buildingBenefit(tile.building.kind))}</p>${propertyHTML(x,y)}${span<buildingFootprint(tile.building.kind)?'<p class="micro-note">Compact legacy site. New construction uses a larger plot.</p>':''}`;}
 else if(kind!=='city'&&tile.building?.kind==='factory'){const span=buildingSize(tile.building);title='Workshop';tag=`${span} × ${span} site, level ${tile.building.level||1}`;body=workshopBody(tile.building,townOf(game,x,y))+propertyHTML(x,y);}
 else if(city&&(kind==='city'||!tile.zone)){const outlook=townOutlook(game,city);title=city.name;tag='Town';body=`<div class="inspector-grid town-figures"><div><small>Population</small><strong>${integer(city.population)}</strong></div><div><small>Waiting</small><strong>${integer(city.passengers)}</strong></div></div><p class="site-status">${townService(game,city).label}</p>${townLinks(city)}${townGrowthLine(outlook)}${localConditions(settlementSuitability(game,city))}${townGrowHelp(outlook)}${townEconomySection(city)}${townOpinionSection(city)}`;}
 else{title=tile.zone?TOOL_INFO[tile.zone].name+' zone':tile.road?'Road':tile.rail?'Railway':{grass:'Open countryside',forest:'Woodland',water:'Water',mountain:'Mountain ridge',rock:'Rocky ground',sand:'Desert sands',snow:'Snowfield'}[tile.terrain]||'Countryside';if(tile.detail&&!tile.road&&!tile.rail&&!tile.zone)title=tile.detail.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());tag=`${nature?terrainObjectSize(nature.object)+' × '+terrainObjectSize(nature.object)+' site · ':''}Level ${[...new Set(tileSurface(game,x,y).corners.map(p=>p.height))].sort((a,b)=>a-b).join('–')} · ${x}, ${y}`;body=tile.road||tile.rail?networkUse(tile,x,y):`<p>${nature&&nature.object.kind!=='mountain'?'A natural '+(nature.object.kind==='forest'?'grove':'outcrop')+' on level ground. Bulldoze any part to clear the whole site.':tile.zone?'Develops gradually with local demand.':tile.terrain==='water'?'Build a port on water beside a bank. Ships follow connected water and pass beneath bridges.':tile.terrain==='mountain'?'Use Terrain & crossings to tunnel through higher ground, or reshape clear land.':'Build on flat ground or a straight slope. Use Terrain & crossings to reshape or level clear land.'}</p>`;}
 if(tile.zone){const zone=game.zones.find(zone=>zone.x===x&&zone.y===y),town=townOf(game,x,y),share=`Development ${Math.round((zone?.progress||0)/3*100)}%.`;body+=`<p>${fundedTown(town,game.day)?`${share} Funded until ${dateLong(town.fundedUntil)}. Road access required.`:`${share} Road access and regular town deliveries required.`}${town&&!tile.building?' Your plot: it earns ground rent once built up.':''}</p>`+localConditions(settlementSuitability(game,{x,y},tile.zone));}
 if(station&&kind!=='city'&&kind!=='industry')body=renameButton('station',station.id)+body;
 const box=$('#inspector'),html=`${inspectorBackLine()}<div class="inspector-top"><span class="eyebrow">${tag}</span><button class="tiny-button" aria-label="Close inspector">×</button></div><h3 id="inspector-title" tabindex="-1">${escapeHTML(title)}</h3>${body}`,key=`${worldSerial}|${x},${y},${kind}`;
 const focusTitle=()=>{if(origin==='keyboard')$('#inspector-title').focus({preventScroll:true});};
 if(!changed&&!box.hidden&&html===inspectorHTML&&key===inspectorKey){focusTitle();return;}
 compactUI?.hideMinimap();closeManagement();closeMapMenus();layersView?.close();box.innerHTML=inspectorHTML=html;inspectorKey=key;box.hidden=false;drawPaletteSprites();references?.relink();box.querySelector('.tiny-button').onclick=()=>{box.hidden=true;selected=null;inspectorHTML='';};
 if($('#station-route'))$('#station-route').onclick=()=>{if(formDraft.editing)leaveRouteEdit(true);if(formDraft.mode!==station.mode||formDraft.to===String(station.id))formDraft.to='';formDraft.mode=station.mode;formDraft.from=String(station.id);setView('routes',{routeScreen:'new'});scrollIntoViewSafe($('#route-form'),{block:'nearest'});};
 if($('#expand-workshop'))$('#expand-workshop').onclick=()=>{const result=expandWorkshop(game,x,y);toast(result.message,!result.ok);if(!result.ok)return;updateHud();persist();invalidateScene();inspect(x,y,kind,'keyboard');};
 if($('#zone-town'))$('#zone-town').onclick=()=>{category='towns';setView('build');};
 const opinionFold=box.querySelector('.town-opinion');if(opinionFold)opinionFold.ontoggle=()=>{townOpinionOpen=opinionFold.open;};
 const hallFold=box.querySelector('.town-hall');if(hallFold)hallFold.ontoggle=()=>{townHallOpen=hallFold.open;};
 const economyFold=box.querySelector('.town-economy');if(economyFold)economyFold.ontoggle=()=>{townEconomyOpen=economyFold.open;};
 box.querySelectorAll('[data-town-action]').forEach(el=>el.onclick=e=>runTownAction(city,el.dataset.townAction,e.detail===0));
 box.querySelector('.town-grow')?.addEventListener('toggle',e=>{townGrowOpen=e.currentTarget.open;});
 if($('#industry-chain'))$('#industry-chain').onclick=()=>openChains({industryKind:industry.kind});
 const asking=`${worldSerial}|${x},${y}`;if(!box.querySelector('.property-sell'))sellAsk='';box.querySelector('#sell-property')?.addEventListener('click',()=>{sellAsk=asking;inspect(x,y,kind);$('#sell-keep')?.focus({preventScroll:true});});box.querySelector('#sell-keep')?.addEventListener('click',()=>{sellAsk='';inspect(x,y,kind);$('#sell-property')?.focus({preventScroll:true});});box.querySelector('#sell-confirm')?.addEventListener('click',()=>{sellAsk='';const result=sellProperty(game,x,y);toast(result.message,!result.ok);if(result.ok){renderPanel();updateHud();persist();invalidateScene();}inspect(x,y,kind,'keyboard');});
 bindServiceLinks(box);
 if(changed)box.scrollTop=0;
 focusTitle();
}
// A carrier's card names its service and trip; the map rings the carrier instead of a tile.
// Load, trip and Follow update in place, so a live refresh never replaces a pressed control.
let selectedVehicle=null,follow=null;
// Follow opens with a glide to its carrier (vehicleAction); ending Follow before it lands stops the camera where it is.
function clearVehicle() { if(follow&&follow.cx===undefined)renderer.glideTo(null);selectedVehicle=null;follow=null;invalidateScene(); }
function stopFollow() { if(follow&&follow.cx===undefined)renderer.glideTo(null);follow=null;$('#inspector [data-vehicle-action="follow"]')?.setAttribute('aria-pressed','false'); }
// A plane flies the straight chord of its saved staircase, and on the ground says where it is on its visit.
const chordShare=route=>{if(route.mode!=='air')return 1;const max=route.path.length-1,a=route.path[0],b=route.path[max];return max?Math.hypot(b.x-a.x,b.y-a.y)/max:1;};
const PLANE_VISIT={rollout:'Landing at',taxiIn:'Taxiing at',parked:'Boarding at',taxiOut:'Taxiing at',roll:'Taking off from'};
// A trip names its stop as a reference (where); the figures that change as it moves follow as plain text (tail).
const stopRef=stop=>stop?refFor(game,`stop:${stop.id}`):'a removed stop';
function planeVisit(route,vehicle) {
 const max=route.path.length-1,progress=vehicle.progress||0;if(route.mode!=='air'||!(vehicle.dwellRemaining>0)||progress>1e-9&&progress<max-1e-9)return null;
 const here=game.stations.find(s=>s.id===route.stops[vehicle.direction===-1?1:0]);return {where:`${PLANE_VISIT[groundPhase(vehicle.dwellRemaining)]} ${stopRef(here)}`,tail:''};
}
// A vehicle in a full-load line stands at the stop where it loads.
function fullLoadWait(route,vehicle) { if(!waitingForFullLoad(vehicle))return null;const here=game.stations.find(s=>s.id===route.stops[0]);return {where:`Waiting for a full load at ${stopRef(here)}`,tail:`, ${integer(vehicle.load)} of ${integer(vehicle.capacity)}`}; }
function inspectVehicle(id,refresh=false,{from=null,source=null,back=null}={}) {
 const box=$('#inspector'),vehicle=game.vehicles.find(v=>v.id===id),route=vehicle&&game.routes.find(r=>r.id===vehicle.routeId);
 if(!route){if(selectedVehicle===id){clearVehicle();box.hidden=true;inspectorHTML='';}return;}
 if(box.hidden||inspectorKey!==`${worldSerial}|vehicle:${id}`||back)trackInspector({from,source,back});
 if(selectedVehicle!==id){follow=null;selectedVehicle=id;invalidateScene();}selected=null;
 const order=fleetOrder(route),model=vehicleModel(route.mode,route.cargo,vehicle.level),health=routeHealth(game,route,getRouteFleet(game,route.id)),ahead=(vehicle.direction||1)>0,stop=game.stations.find(s=>s.id===route.stops[ahead?1:0]),tiles=Math.max(0,Math.ceil((ahead?route.path.length-1-(vehicle.progress||0):vehicle.progress||0)*chordShare(route)-1e-6));
 const load=`${integer(vehicle.load)} / ${integer(vehicle.capacity)}`,trip=planeVisit(route,vehicle)||fullLoadWait(route,vehicle)||{where:`Heading to ${stopRef(stop)}`,tail:` · ${tiles===1?'1 tile':integer(tiles)+' tiles'}`};
 const html=`${inspectorBackLine()}<div class="inspector-top"><span class="eyebrow">${escapeHTML(`${model.name} ${model.noun}`)}</span><button class="tiny-button" aria-label="Close inspector">×</button></div><h3 id="inspector-title" tabindex="-1">${bullet(route,{named:true})}<span class="vehicle-route">${escapeHTML(route.name)}</span></h3><div class="vehicle-trip"><canvas width="80" height="64" data-vehicle-sprite="purchase" data-mode="${escapeHTML(route.mode)}" data-cargo="${escapeHTML(route.cargo)}" data-level="${vehicle.level||0}" aria-hidden="true"></canvas><div><span class="vehicle-load">${cargoBadge(route.cargo)}<strong data-vehicle-live="load"></strong><small data-vehicle-live="aboard"></small></span><p class="vehicle-age">${model.year} model, ${ageText(vehicleAge(calendarYear(game),vehicle.level))}</p><p data-vehicle-live="trip"><span data-vehicle-live="where"></span><span data-vehicle-live="tail"></span></p></div></div><div class="industry-condition" data-state="${health.state}" title="${escapeHTML(health.detail)}"><strong>${escapeHTML(health.label)}</strong></div><div class="vehicle-actions"><button class="small-button icon-only" data-vehicle-action="follow" aria-pressed="false" aria-label="Follow" title="Follow">${icon('focus')}</button><button class="small-button icon-only" data-vehicle-action="show" aria-label="Show route" title="Show route">${icon('locate')}</button><button class="small-button icon-only" data-vehicle-action="routes" aria-label="Open in Routes" title="Open in Routes">${icon('routes')}</button><button class="small-button" data-vehicle-action="add" title="${escapeHTML(order.add.title)}" ${order.add.disabled?'disabled':''}>${escapeHTML(order.add.label)}</button></div>`,key=`${worldSerial}|vehicle:${id}`;
 const same=!box.hidden&&key===inspectorKey,hold=refresh&&(box.contains(document.activeElement)||panelPress||performance.now()-panelReleasedAt<=250);
 if(!same||html!==inspectorHTML&&!hold){
  compactUI?.hideMinimap();closeManagement();closeMapMenus();layersView?.close();box.innerHTML=inspectorHTML=html;inspectorKey=key;box.hidden=false;drawPaletteSprites(box);references?.relink();if(!same)box.scrollTop=0;
  box.querySelector('.tiny-button').onclick=()=>{box.hidden=true;inspectorHTML='';clearVehicle();};
  box.querySelectorAll('[data-vehicle-action]').forEach(button=>button.onclick=()=>vehicleAction(button.dataset.vehicleAction,id));
 }
 // Days since the cargo aboard boarded, which set its share of the fare.
 const days=vehicle.load>0&&vehicle.loadedDay!==undefined?Math.floor(game.day)-Math.floor(vehicle.loadedDay):null,aboard=days===null?'':days<1?'Boarded today':`${days===1?'1 day':integer(days)+' days'} on board`;
 for(const [live,text] of [['load',load],['tail',trip.tail],['aboard',aboard]]){const el=box.querySelector(`[data-vehicle-live="${live}"]`);if(el&&el.textContent!==text)el.textContent=text;}
 const where=box.querySelector('[data-vehicle-live="where"]');if(where&&where.shownHTML!==trip.where){where.innerHTML=where.shownHTML=trip.where;references?.relink();}
 box.querySelector('[data-vehicle-action="follow"]')?.setAttribute('aria-pressed',String(Boolean(follow)));
}
function vehicleAction(action,id) {
 const vehicle=game.vehicles.find(v=>v.id===id),route=vehicle&&game.routes.find(r=>r.id===vehicle.routeId);if(!route)return;
 // Follow never changes the game speed; at 8× it steps Detail out to Town, which keeps up with the carrier.
 if(action==='follow'){if(follow){stopFollow();return;}const q=renderer.vehicleWorldPoint(vehicle);follow={id,vehicle,frame:{x0:q.x,y0:q.y,x1:q.x,y1:q.y,cx:q.x,cy:q.y}};$('#inspector [data-vehicle-action="follow"]')?.setAttribute('aria-pressed','true');glideCamera(follow.frame,{zoom:speed>=8&&renderer.getCamera().zoom>1?1:undefined});updateHud();return;}
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
 if(announce)toast(`Autosave failed: browser storage is full or blocked. Delete older saves in Save / load (Ctrl+S) to free space.`,{type:'error',key:'autosave-failed'});
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
    // A queued retry may be the first work after a capture held a pause/menu
    // flush. Commit that retained fraction before choosing the next snapshot.
    job.again=false;simulation.flush(performance.now(),{reserved:preview});const day=game.day,revision=game.revision;
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
 simulation.flush(performance.now(),{reserved:preview});
 if(savedWorld===worldSerial&&savedDay===game.day&&savedRevision===game.revision)return;
 const result=saveGame(game);
 if(result?.ok)saveFinished(worldSerial,game.day,game.revision);
 else markSaveFailed();
}

let modalPreviousSpeed = null, modalReturnPanel = null;
let chainSelection = {}, chainExplorer = null, galleryExplorer = null, gallerySelection = {};
let paymentRates = null;
let saveDialogController = null;
function openModal(html) {
 if(!$('#modal').open)modalReturnPanel=$('.sidebar').classList.contains('drawer-open')?{view,routeScreen,focus:document.activeElement}:null;
 layersView?.close();compactUI?.hideMinimap();closeMapMenus();cancelRoutePicking();cancelGesture();closeManagement();closeInspector();spaceDown=false;
 saveDialogController?.dispose();saveDialogController=null;chainExplorer?.dispose();chainExplorer=null;galleryExplorer?.dispose();galleryExplorer=null;
 if(!$('#modal').open){modalPreviousSpeed??=speed;changeSpeed(0);}
 $('#modal-content').innerHTML=html;if(!$('#modal').open)$('#modal').showModal();
 $$('#modal .close-modal, #modal [data-close]').forEach(el=>el.addEventListener('click',closeModal));
}
function closeModal(){if($('#modal').open)$('#modal').close();}
function leaveModal(){modalReturnPanel=null;closeModal();}
function activateGame(next) {
 cancelPendingSave();
 undoStack=[];
 cancelRoutePicking();cancelGesture();closeMapMenus();
 constructionNext=null;routeScreen='list';fleetControlsOpen=false;routeDetailsOpen.clear();game=next;simulation.reset(game,performance.now());worldSerial++;spaceDown=false;selected=null;inspectorHTML='';hover=null;tool='inspect';preferredMode='road';
 hideBack();references?.clear();refShown={ref:null,until:0};inspectorTrail=[];inspectorSource=null; // rings, the back chip and the Back line belong to the old world
 view='build';category='network';buildingGroup='homes';chainSelection={};gallerySelection={};
 formDraft={name:'',mode:'road',from:'',to:'',cargo:'passengers',fullLoad:false,optionsOpen:false};
 routePage=0;routeFilters={query:'',mode:'all',status:'all',cargo:'all'};entityFilters={towns:'',industry:'',kind:'all'};
 goalChoice=null;goalOpen=false;goalSignature='';lastNoticeId=game.day<1?undefined:game.notifications[0]?.id;lastRevision=-1;minimapAt=0;panelAt=0;lastFrame=performance.now();
 resetMoments();
 drainAchievementUnlocks(game);
 canvas.classList.remove('build-mode','dragging','route-picking');$('#placement-tip').hidden=true;
 $('#inspector').hidden=true;$('#inspector').replaceChildren();$('#toast-region').replaceChildren();
 rentSeen=(game.totalProperty||0)>0;sellAsk='';
 renderer.setGame(game);renderer.setZoom(1);
 const center=game.cities[0]||{x:game.width/2,y:game.height/2};
 const framing=9/2;
 renderer.focus(center.x+framing,center.y-framing);
 updateRegion();setView('build');updateHud();closeManagement();
 $('#panel-content').scrollTop=0;$('#status-message').textContent=toolDescription(tool);
}
async function drawLoadedWorld() {
 updateLoading('Drawing your world…',3);await paintLoading();
 renderer.render(performance.now(),{tool,hover,preview,selected,preferredMode,airportAxis,routeStops:routePickStops()});
 if(!compactUI||compactUI.isMinimapVisible()){renderer.drawMinimap($('#minimap'));minimapAt=performance.now();}lastRevision=game.revision;
 await paintLoading();
}
async function openGameMenu() {
 if(menuOpening||$('#start-menu')?.open||isLoading())return;
 menuOpening=true;
 const resumeSpeed=speed;changeSpeed(0);
 let saveFailed=false;
 if(pendingSave||savedWorld!==worldSerial||savedDay!==game.day||savedRevision!==game.revision){showLoading({title:'Saving your company',status:'Keeping your latest progress…'});saveFailed=!await persist();}
 cancelGesture();cancelRoutePicking();closeMapMenus();closeManagement();
 const next=await openStartMenu({canResume:true,biome:game.biome,notice:saveFailed?'Your latest changes could not be saved. Resume your company or free some browser storage.':''});
 if(next){
  activateGame(next);
  await Promise.all([preloadHouses({biome:game.biome,cells:startupArtCells()}),preloadWorldArt({biome:game.biome,cells:startupArtCells()})]);
  await drawLoadedWorld();hideLoading();
  savedWorld=worldSerial;savedDay=game.day;savedRevision=game.revision;saveAt=performance.now();
 }
 menuOpening=false;lastFrame=performance.now();changeSpeed(next?1:resumeSpeed);canvas.focus({preventScroll:true});
}
function openSaves() {
 cancelPendingSave();
 closeManagement();openModal('');
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
 modalReturnPanel=null;
 const town=game.cities.some(c=>String(c.id)===String(id)),site=!town&&game.industries.find(i=>String(i.id)===String(id)),lens=site?lensCargo(site.kind):chainSelection.cargo;
 if(site||TOWN_CARGO.includes(lens))setCargoLens(lens,'chains');
 locateDestination(id,town?'city':'industry');
}
function openGallery(options={}) {
 openModal('');
 galleryExplorer=mountGallery($('#modal-content'),game,{onClose:closeModal,onBuild:kind=>{leaveModal();category=INDUSTRIES[kind]?'industry':BUILDINGS[kind]||kind==='workshop'?'towns':'network';if(AIRPORT_TOOLS.has(kind)){airportAxis=kind==='airport-y'?'y':'x';kind='airport';}setView('build');setTool(kind);},onOpenChains:openChains,onChange:selection=>{gallerySelection=selection;}},Object.keys(options).length?options:gallerySelection);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
function openChains(options={}) {
 chainExplorer?.dispose();
 closeManagement();openModal('');
 chainExplorer=mountChains($('#modal-content'),game,{onLocate:locateFromChains,onBuild:kind=>{leaveModal();category='industry';setView('build');setTool(kind);},onClose:closeModal,onChange:selection=>{chainSelection=selection;}},Object.keys(options).length?options:chainSelection);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
$('#modal').addEventListener('close',()=>{if($('#modal').open)return;const back=modalReturnPanel;modalReturnPanel=null;if(back&&back.view===view&&back.routeScreen===routeScreen){compactUI?.openManagement();if(back.focus?.isConnected&&!back.focus.disabled)back.focus.focus({preventScroll:true});}paymentRates?.dispose();paymentRates=null;saveDialogController?.dispose();saveDialogController=null;chainExplorer?.dispose();chainExplorer=null;galleryExplorer?.dispose();galleryExplorer=null;if(modalPreviousSpeed!==null){changeSpeed(modalPreviousSpeed);modalPreviousSpeed=null;}});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const b=$('#modal').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeModal();}});
function openWorld() { void openGameMenu(); }
function openAtlas() {
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>World map</h2><p>Click a location to explore.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><canvas id="atlas-map" width="640" height="480" tabindex="0" aria-label="World atlas. Click to center the world map on a location."></canvas><div class="atlas-legend"><span><i class="atlas-town"></i> Towns</span>${cargoLens?`<span><i class="atlas-lens-source"></i> ${escapeHTML(CARGO[cargoLens.cargo].name)} producers</span><span><i class="atlas-lens-buyer"></i> Buyers</span>`:'<span><i class="atlas-industry"></i> Industries</span>'}<span><i class="atlas-route"></i> Your network</span><span>Use H to return home</span></div></div>`);
 const atlas=$('#atlas-map');atlas.style.aspectRatio=game.width+'/'+game.height;atlas.style.setProperty('--atlas-ratio',game.width/game.height);renderer.drawMinimap(atlas);
 atlas.addEventListener('click',e=>{const rect=atlas.getBoundingClientRect(),left=atlas.clientLeft,top=atlas.clientTop;renderer.focus(Math.max(0,Math.min(1,(e.clientX-rect.left-left)/atlas.clientWidth))*game.width,Math.max(0,Math.min(1,(e.clientY-rect.top-top)/atlas.clientHeight))*game.height);closeModal();closeManagement();});
 atlas.addEventListener('keydown',e=>{if(e.key==='Enter'){renderer.focus(game.cities[0].x,game.cities[0].y);closeModal();}});
}
function openHelp(tab='basics') {
 if(tab==='chains'){openChains();return;}
 const basics=`<div class="guide-grid"><div class="guide-item"><span>${icon('road')}Build a network</span><p>Roads and rails climb straight slopes; turns need flat ground. Terrain has eight levels, 0–7. Use Terrain &amp; crossings to raise or lower grid points, or drag an area level. Bridges and tunnels need flat ends at the same level. Choose Road or Rail before building.</p></div><div class="guide-item"><span>${icon('route')}Connect two stops</span><p>Place stops or ports within 5 tiles of customers. Connect them, choose cargo, then launch a bus, train or ship. Freight routes can wait for a full load under More options.</p></div><div class="guide-item"><span>${icon('plane')}Fly between towns</span><p>From ${AIR_DEBUT_YEAR}, build airports on clear, level land near towns (A). Planes fly straight between two airports at least ${AIRPORT_MIN_TILES} tiles apart and carry passengers and mail. They cost more to buy and run, and shine on long routes.</p></div><div class="guide-item"><span>${icon('factory')}Supply factories</span><p>Deliver every input in a recipe. Towns buy finished goods. Freight returns empty; passengers and mail travel both ways.</p></div><div class="guide-item"><span>${icon('leaf')}Slow, local growth</span><p>Zone within 10 tiles of a town, beside roads. Regular deliveries drive growth; services and greenery help.</p></div><div class="guide-item"><span>${icon('leaf')}Build at your own pace</span><p>Your starter bus earns money while you plan. Start small, supply every factory input, and expand when demand fills your vehicles. Next projects are optional.</p></div><div class="guide-item"><span>${icon('route')}Understand the money</span><p>Profit shows operations this calendar month. Click Balance for building spend and last month. Routes show fares minus upkeep since tracking began, excluding construction. Deliveries pay more the further they go; slow ones keep less. Resources shows the rates.</p></div></div><div class="keyboard-help"><span><kbd>R</kbd> Road</span><span><kbd>T</kbd> Rail</span><span><kbd>Shift</kbd> Straight drag</span><span><kbd>S</kbd> Stop on road / rail</span><span><kbd>P</kbd> Port</span><span><kbd>B</kbd> / <kbd>N</kbd> Bridge / tunnel</span><span><kbd>[</kbd> / <kbd>]</kbd> Lower / raise land</span><span><kbd>E</kbd> Level land</span><span><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> Zones</span><span><kbd>X</kbd> Bulldozer</span><span><kbd>Right drag</kbd> Move map</span><span><kbd>Ctrl+scroll</kbd> Zoom</span><span><kbd>G</kbd> Grid</span><span><kbd>L</kbd> Layers</span><span><kbd>H</kbd> Home</span><span><kbd>M</kbd> Map</span><span><kbd>C</kbd> Production chains</span><span><kbd>Space</kbd> Pause / hold to pan</span><span><kbd>Esc</kbd> / <kbd>Right-click</kbd> Cancel a drag, then Done</span><span><kbd>Ctrl+S</kbd> Save / load</span></div>`;
 const resources=`<div class="resource-legend">${Object.entries(CARGO).map(([key,c])=>`<div class="resource-entry">${cargoIcon(key,{decorative:true})}<span>${c.name}</span></div>`).join('')}</div>`+'<p class="payment-note resource-town-traffic">Passengers and mail travel between two towns, both ways. Mail pays more, in full on trips of up to 14 days.</p>'+paymentRatesHTML(game);
 openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>Guide</h2></div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="modal-tabbar"><button data-help-tab="basics" class="${tab==='basics'?'active':''}">Basics</button><button data-help-tab="chains" class="${tab==='chains'?'active':''}">Production</button><button data-help-tab="resources" class="${tab==='resources'?'active':''}">Resources</button></div>${tab==='basics'?basics:resources}<div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $$('[data-help-tab]').forEach(el=>el.addEventListener('click',()=>openHelp(el.dataset.helpTab)));
 paymentRates?.dispose();paymentRates=tab==='resources'?bindPaymentRates($('#modal'),game):null;
}

// Notices reach the HUD through one queue: model notices, grouped by topic, and
// moments derived here so the simulation never spends ids on presentation.
function resetMoments() {
 noticeQueue=[];pricingYear=inflationInfo(game).year;panelPricesStale=false;townDay=-1;
 const stopCounts=townStopCounts(game);outstandingTowns=new Set(game.cities.filter(city=>townOpinion(game,city,stopCounts).label==='Outstanding').map(city=>city.id));
 knownRoutes=new Set(game.routes.map(route=>route.id));firstDeliveryPending=new Set(game.routes.filter(route=>!isTownTraffic(route.cargo)&&route.delivered===0).map(route=>route.id));
 townPeaks=new Map(game.cities.map(city=>[city.id,city.population]));
 // An older save or a new world has no stamps yet; whatever it has already met is backfilled silently.
 seenMilestones=new Set(game.milestones?Object.keys(game.milestones):metMilestones(game));milestoneMonth=Math.max(-1,...Object.values(game.milestones||{}).map(monthOf));goalSeen=null;goalChanged=false;
 achievementMonth=Math.max(-1,...Object.values(game.achievements?.unlocked||{}).map(monthOf));
 headlineWatchState=headlineWatch(game);headlineQueue=[];dismissHeadline(true);headlineClosedAt=-Infinity;
 ratingSeen={titles:game.performance?.reached.length??1,century:Boolean(game.performance?.century)};
}
// Headlines: a rare paper card for big moments. Each is kept in game.headlines (News) even when the card is off; the
// card waits for the plain map, shows one at a time for 10 s of visible time, and leaves 15 s before the next.
function announceHeadline(entry) {
 if(!recordHeadline(game,entry))return false;if(!headlinesOn)return false;
 if(entry.routeId){knownRoutes.add(entry.routeId);firstDeliveryPending.delete(entry.routeId);}
 headlineQueue.push({...game.headlines[0],queuedAt:performance.now()});
 const rank=item=>HEADLINE_PRIORITY[item.kind]??3;headlineQueue.sort((a,b)=>rank(a)-rank(b)||a.queuedAt-b.queuedAt);headlineQueue.length=Math.min(3,headlineQueue.length);
 return true;
}
function watchHeadlines() { for(const entry of detectHeadlines(game,headlineWatchState))announceHeadline(entry); }
function stepHeadlines(now,dt) {
 if(headlineCurrent){
  const el=headlineCurrent.el;if(now-headlineCheckedAt>=250){headlineCheckedAt=now;headlineVisible=el.checkVisibility?.({visibilityProperty:true})??el.offsetParent!==null;}
  if(!headlineHeld&&headlineVisible)headlineCurrent.remaining-=dt;
  if(headlineCurrent.remaining<=0)dismissHeadline();
  return;
 }
 headlineQueue=headlineQueue.filter(entry=>now-entry.queuedAt<120000);
 if(headlineQueue.length&&headlinesOn&&!$('#modal').open&&tool==='inspect'&&!isRoutePicking()&&now-headlineClosedAt>=15000)showHeadline(headlineQueue.shift());
}
function showHeadline(entry) {
 const action=entry.kind==='achievement'?{label:'Open achievements',run:openAchievements}:entry.key==='debut:air'?{label:'Build an airport',run:openAirportTool}:entry.kind==='rating'?(entry.key==='rating:century'?{label:'See evaluation',run:openCenturyCard}:{label:'Open report',run:openCompany}):entry.kind==='models'&&getFleetUpgrade(game).available?{label:'Review upgrades',run:reviewUpgrades}:noticeTargetExists(entry.target)?{label:'Show',run:()=>showNoticeTarget(entry.target)}:null;
 const el=document.createElement('article');el.className='headline-card';el.dataset.kind=entry.kind;el.setAttribute('aria-labelledby','headline-title');
 el.innerHTML=`<span class="headline-art" aria-hidden="true">${icon(headlineArt(entry.art))}</span><div class="headline-body"><p class="headline-kicker"><span>${escapeHTML(headlineKicker(entry.kind))}</span><time>${dateLong(entry.day)}</time></p><h2 id="headline-title" class="prose">${escapeHTML(entry.title)}</h2>${entry.detail?`<p class="headline-detail prose">${escapeHTML(entry.detail)}</p>`:''}${action?`<div class="headline-actions"><button type="button" class="headline-action">${escapeHTML(action.label)}</button></div>`:''}</div><button type="button" class="headline-close" aria-label="Dismiss headline" title="Dismiss">${icon('close')}</button>`;
 // Pointing at the card or focusing inside it holds its countdown; it never takes focus itself.
 el.addEventListener('pointerenter',()=>{headlineHeld=true;});el.addEventListener('pointerleave',()=>{headlineHeld=false;});
 el.addEventListener('focusin',()=>{headlineHeld=true;});el.addEventListener('focusout',e=>{if(!el.contains(e.relatedTarget))headlineHeld=false;});
 el.addEventListener('keydown',e=>{if(e.key!=='Escape')return;e.preventDefault();e.stopPropagation();dismissHeadline();});
 el.querySelector('.headline-close').onclick=()=>dismissHeadline();
 if(action)el.querySelector('.headline-action').onclick=()=>{dismissHeadline(false,false);action.run();};
 $('#headline-slot').replaceChildren(el);headlineCurrent={entry,el,remaining:10000};headlineHeld=false;headlineVisible=true;headlineCheckedAt=0;
 $('#status-message').textContent=entry.title;fanfare();
}
// Focus inside a closing card returns to the map, or is let go when the card's action moves it on.
function dismissHeadline(immediate=false,refocus=true) {
 const el=headlineCurrent?.el;headlineCurrent=null;headlineHeld=false;headlineClosedAt=performance.now();if(!el)return;
 if(el.contains(document.activeElement)){if(refocus)$('#world').focus({preventScroll:true});else document.activeElement.blur();}
 if(immediate||matchMedia('(prefers-reduced-motion: reduce)').matches)el.remove();else{el.classList.add('leaving');setTimeout(()=>el.remove(),180);}
}
function headlineArt(art) { return hasIcon(art)||hasIcon(ALIASES[art])?art:'town'; }
// A headline rings three rising notes, softer than a toast; like deliveries it waits for audio a gesture started.
function fanfare() {
 if (!sounds||audioContext?.state!=='running') return;
 try { for (const [index,frequency] of [523.25,659.25,783.99].entries()) { const at=audioContext.currentTime+index*.09, oscillator=audioContext.createOscillator(), gain=audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.type='sine'; oscillator.frequency.setValueAtTime(frequency,at); gain.gain.setValueAtTime(.0001,at); gain.gain.exponentialRampToValueAtTime(.016,at+.012); gain.gain.exponentialRampToValueAtTime(.0005,at+.22); oscillator.start(at); oscillator.stop(at+.23); } } catch { sounds=false; }
}
function showQueuedNotices(now) {
 const urgent=entry=>entry.type==='warning'||entry.type==='error'?1:0;noticeQueue.sort((a,b)=>urgent(b)-urgent(a));
 let shown=0,beeped=false;
 for(let i=0;i<noticeQueue.length&&shown<2;){
  const entry=noticeQueue[i];if(entry.paced&&now-pacedNoticeAt<2000){i++;continue;}
  noticeQueue.splice(i,1);if(entry.paced)pacedNoticeAt=now;
  const target=entry.targets?.find(noticeTargetExists);
  toast(entry.message,{type:entry.type,action:entry.action||(target?{label:'Show',run:()=>showNoticeTarget(target)}:null),silent:beeped,tier:entry.tier,template:entry.template});beeped||=entry.type!=='ok';shown++;
 }
}
function queueNewYear(pricing) {
 if(pricing.year===AIR_DEBUT_YEAR)announceAirDebut();
 // The toast names one of the year's models. A model that begins a new series makes a headline instead, and the toast then keeps only the price rise and the year's review.
 const model=newYearModel(game.routes,game.vehicles,pricing.year-1950),headline=modelHeadline(model),carded=Boolean(headline)&&announceHeadline(headline);
 const review=yearReview(pricing.year-1),upgrade=!carded&&getFleetUpgrade(game).available?{label:'Review upgrades',run:reviewUpgrades}:null;
 noticeQueue.push({message:newYearNotice(pricing.year,pricing.rate,{generation:!carded,model})+review,type:'milestone',action:review?[{label:'Open report',run:openCompany},upgrade]:upgrade});
}
// January 1952 during play brings air travel once: a headline, or a toast when headline cards are off. A load never announces it.
function announceAirDebut() {
 const entry=airDebutHeadline(game);if(game.headlines?.some(item=>item.key===entry.key))return;
 if(!announceHeadline(entry))noticeQueue.push({message:'Air travel arrives. Airports open in Build, Network.',type:'milestone',action:{label:'Build an airport',run:openAirportTool}});
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
 for(let parent=el;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
 const panel=$('#panel-content');if(!el||!panel.contains(el))return;
 const box=el.getBoundingClientRect(),area=panel.getBoundingClientRect();panel.scrollTop+=box.top-area.top-Math.max(0,(area.height-box.height)/2);
 // Focus moved for a mouse click keeps Space as pause, so a press never activates the revealed control.
 const owned=pointerFocus!==null,focus=()=>{focusTarget.focus({preventScroll:true});if(owned&&document.activeElement===focusTarget)pointerFocus=focusTarget;};
 if(focusTarget)focus();if(focusTarget&&document.activeElement!==focusTarget)setTimeout(()=>{if(!document.activeElement||document.activeElement===document.body)focus();},200);
}
// Every freight route launched this session is watched; loaded routes only if they have not delivered yet.
function watchRoutes() {
 for(const route of game.routes){
  if(!knownRoutes.has(route.id)){knownRoutes.add(route.id);if(!isTownTraffic(route.cargo))firstDeliveryPending.add(route.id);}
  if(!(route.delivered>0&&firstDeliveryPending.delete(route.id)))continue;
  // The company's first freight delivery is also its first milestone; one toast says both.
  const first=!seenMilestones.has('first-freight');if(first){seenMilestones.add('first-freight');milestoneMonth=monthOf(game.day);}
  noticeQueue.push({message:`First ${CARGO[route.cargo].name.toLowerCase()} delivered on ${route.name} · +${money(route.revenue)}${first?' · Milestone':''}`,type:'milestone',targets:[{kind:'route',id:route.id}]});
 }
}
function watchTowns(activeStops) {
 const day=Math.floor(game.day);if(day===townDay)return;townDay=day;
 // A town's first Outstanding opinion is celebrated once a session; a loaded save never replays it.
 const stopCounts=townStopCounts(game);
 for(const city of game.cities)if(!outstandingTowns.has(city.id)&&townOpinion(game,city,stopCounts).label==='Outstanding'){outstandingTowns.add(city.id);noticeQueue.push({message:`${city.name} now rates your company Outstanding`,type:'milestone',targets:[{kind:'city',id:city.id}],paced:true});}
 for(const city of game.cities){
  const peak=townPeaks.get(city.id);if(peak!==undefined&&city.population<=peak)continue;townPeaks.set(city.id,city.population);if(peak===undefined)continue;
  const reached=crossedMilestone(peak,city.population);
  if(reached&&townService(game,city,activeStops).connected){const tier=headlineTier(peak,city.population);if(!(tier&&announceHeadline(townHeadline(game,city,tier))))noticeQueue.push({message:`${city.name} reached ${integer(reached)} residents`,type:'milestone',targets:[{kind:'city',id:city.id}],paced:true});}
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
 closeModal();showRoute(target.id);
 if(!filterRoutes(game,routeFilters).some(route=>String(route.id)===target.id))routeFilters={query:'',mode:'all',status:'all',cargo:'all'};
 routePage=Math.max(0,Math.floor(filterRoutes(game,routeFilters).findIndex(route=>String(route.id)===target.id)/ROUTES_PER_PAGE));setView('routes');
 const card=$$('#route-list [data-route-id]').find(el=>el.dataset.routeId===target.id);revealInPanel(card,card?.querySelector('[data-focus-route]'));
}
function openNews() {
 const date=dateLong;
 // Milestones are company state, not notices: those reached within the log's span join it, one line per day.
 const since=game.notifications.length>=24?Math.floor(game.notifications.at(-1).day):-Infinity,reached=new Map();
 for(const milestone of MILESTONES){const day=game.milestones?.[milestone.id];if(day>=since){if(!reached.has(day))reached.set(day,[]);reached.get(day).push(milestone.title);}}
 const titles=list=>list.length>3?`${list.slice(0,3).join(', ')} and ${list.length-3} more`:list.length>1?`${list.slice(0,-1).join(', ')} and ${list.at(-1)}`:list[0];
 const notices=[...game.notifications,...[...reached].map(([day,list])=>({day,message:list.length>1?`${list.length} milestones reached: ${titles(list)}`:`Milestone · ${list[0]}`,type:'milestone',goals:true})),...(game.headlines||[]).map(entry=>({...entry,headline:true}))].sort((a,b)=>Math.floor(b.day)-Math.floor(a.day)||(b.headline?1:0)-(a.headline?1:0));
 // Headlines read as small paper cuttings among the notices; on the same day they come first.
 const headlineItem=(notice,index)=>`<li class="news-item news-headline" data-kind="${escapeHTML(notice.kind)}"><span class="headline-art" aria-hidden="true">${icon(headlineArt(notice.art))}</span><div><p class="headline-kicker"><span>${escapeHTML(headlineKicker(notice.kind))}</span><time>${date(notice.day)}</time></p><h3 class="prose">${escapeHTML(notice.title)}</h3>${notice.detail?`<p class="prose">${escapeHTML(notice.detail)}</p>`:''}</div>${noticeTargetExists(notice.target)?`<button class="small-button" data-news-target="${index}">Show</button>`:''}</li>`;
 const items=notices.map((notice,index)=>{if(notice.headline)return headlineItem(notice,index);const type=toastType(notice.type);return `<li class="news-item" data-type="${type}">${icon(type==='ok'||type==='milestone'?'check':'warning')}<div><time>${date(notice.day)}</time><p>${notice.template?renderTemplate(notice.template,game):escapeHTML(notice.message)}</p></div>${notice.goals?'<button class="small-button" data-news-goals>Goals</button>':noticeTargetExists(notice.target)?`<button class="small-button" data-news-target="${index}">Show</button>`:''}</li>`;}).join('');
 closeManagement();openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>News</h2><p>Recent company notices and headlines, newest first. The log keeps the latest 24 of each.</p><label class="news-pref"><input type="checkbox" id="headline-pref"${headlinesOn?' checked':''}> Show headlines on the map</label></div><button class="close-modal" aria-label="Close dialog">×</button></div><ol class="news-list">${items||'<li class="news-empty">No news yet. Notices about your network, towns and industries appear here.</li>'}</ol><div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $$('[data-news-target]').forEach(el=>el.addEventListener('click',()=>showNoticeTarget(notices[Number(el.dataset.newsTarget)].target)));
 $$('[data-news-goals]').forEach(el=>el.addEventListener('click',openGoals));
 $('#headline-pref').addEventListener('change',e=>{headlinesOn=e.target.checked;try{if(headlinesOn)localStorage.removeItem('transport-headlines-v1');else localStorage.setItem('transport-headlines-v1','off');}catch{}if(!headlinesOn){headlineQueue=[];dismissHeadline(true);}});
 $('#modal .close-modal')?.focus({preventScroll:true});
}
// Company goals: every chapter with the dates reached and live progress. Nothing here is required or rewarded.
function openGoals() {
 const date=day=>new Date(Date.UTC(1950,0,1+Math.floor(day))).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}),next=nextProject(game,{source:goalChoice}).milestone;
 const row=({milestone,reached,progress,done})=>{const text=progress&&!done?progressText(milestone,progress):'';return `<li class="goal-row${done?' done':''}">${done?icon('check'):'<span class="goal-dot" aria-hidden="true"></span>'}<div><strong>${escapeHTML(milestone.title)}</strong><small>${reached!==null?`Reached ${date(reached)}`:done?'Reached today':escapeHTML(milestone.detail)}</small>${text?`<span class="goal-meter"><span><span style="width:${Math.min(100,progress.value/progress.target*100)}%"></span></span>${escapeHTML(text)}</span>`:''}</div>${milestone.id===next?'<em>Next goal</em>':''}</li>`;};
 const chapters=milestoneChapters(game).map(chapter=>`<section class="goal-chapter${chapter.complete?' complete':''}"><header><div><span class="eyebrow">Chapter ${chapter.chapter} of ${CHAPTERS.length}</span><h3>${escapeHTML(chapter.title)}</h3></div><span class="goal-count">${chapter.done} / ${chapter.items.length}</span></header><ol class="goal-list">${chapter.items.map(row).join('')}</ol></section>`).join('');
 closeManagement();openModal(`<div class="modal-inner"><div class="modal-heading"><div><h2>Company goals</h2><p>Optional milestones, reached in any order. A chapter is complete when all but one of its goals are done.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div><div class="goal-chapters">${chapters}</div><div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
// Achievements (achievements.js): long-term records that change nothing. The dialog only reads, and like every dialog it pauses.
function openAchievements() {
 closeManagement();openModal(`<div class="modal-inner achievements-dialog"><div class="modal-heading"><div><h2>Achievements</h2><p>Long-term records of your company. They are just for fun and never change how the game plays.</p></div><button class="close-modal" aria-label="Close dialog">${icon('close')}</button></div>${renderAchievements(game,{served:activeCities(game),network:networkTotals(game)})}<div class="modal-actions"><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 $('#modal .close-modal')?.focus({preventScroll:true});
}
$('#modal').addEventListener('click',e=>{if(e.target.closest?.('[data-open-achievements]'))openAchievements();});
// Each record celebrates once, as the day it was earned closes; a load or an older save's credit never replays one. Gold and platinum make
// a headline (a toast when headlines are off), two or more at once share one toast, at most one toast a game month (later ones that month
// wait in the dialog), and the century's badge waits on its evaluation card.
function queueAchievements(ids) {
 const toasts=[];
 for(const id of ids){
  const a=achievementById(id);if(!a||id==='years-100'&&game.performance?.century)continue;
  if((a.tier==='gold'||a.tier==='platinum')&&announceHeadline({key:`achievement:${id}:${a.tier}`,kind:'achievement',art:'achievements',day:game.achievements.unlocked[id],title:`${TIER_NAMES[a.tier]} achievement: ${a.title}`,detail:a.detail}))continue;
  toasts.push(id);
 }
 const month=toasts.length?monthOf(game.achievements.unlocked[toasts[0]]??game.day):-1;if(month<=achievementMonth)return;achievementMonth=month;
 for(const entry of achievementNotices(toasts))noticeQueue.push({...entry,type:'milestone',paced:true,action:{label:'Open achievements',run:openAchievements}});
}
function achievementsLineHTML() { return `<p class="rating-achievements"><span>Achievements</span><strong data-num>${earnedCount(game)} of ${ACHIEVEMENTS.length}</strong><button type="button" class="small-button" data-open-achievements>Open ${icon('chevronRight')}</button></p>`; }
// Company: the last 36 closed months as sparklines, yearly summaries, routes by net a month and the optional loan.
function openCompany(section) {
 const history=game.history,terms=loanTerms(game),years=[...(game.annual||[])].reverse(),signed=v=>(v<0?'−':'+')+money(v);
 const chart=(label,values,format)=>{
  const list=values.filter(Number.isFinite);while(list.length<2)list.unshift(list[0]??0);
  const low=Math.min(...list),high=Math.max(...list),y=v=>(high>low?34-(v-low)/(high-low)*30:19).toFixed(1),points=list.map((v,i)=>`${(i/(list.length-1)*120).toFixed(1)},${y(v)}`).join(' ');
  return `<figure class="company-chart"><figcaption><span>${label}</span><strong>${format(list.at(-1))}</strong></figcaption><svg class="sparkline" viewBox="0 0 120 36" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(`${label}, month by month: lowest ${format(low)}, highest ${format(high)}`)}">${low<0&&high>0?`<line class="spark-zero" x1="0" x2="120" y1="${y(0)}" y2="${y(0)}"/>`:''}<polygon class="spark-area" points="0,36 ${points} 120,36"/><polyline class="spark-line" points="${points}"/></svg></figure>`;
 };
 const closed=entry=>monthText(entry.day-1),charts=history.length?`<section class="company-section"><header><h3>Month by month</h3><span>${closed(history[0])} – ${closed(history.at(-1))}</span></header><div class="company-charts">${chart('Operating profit',history.map(h=>h.operatingProfit??h.profit),signed)}${chart('Balance',history.map(h=>h.money),v=>(v<0?'−':'')+money(v))}${chart('Residents',history.map(h=>h.population),integer)}${chart('Delivered a month',history.map((h,i)=>i?h.delivered-history[i-1].delivered:h.month===0?h.delivered:NaN),v=>integer(v)+' units')}</div></section>`:`<section class="company-section"><h3>Month by month</h3><p class="company-empty">Charts begin when ${monthText(game.day)} closes.</p></section>`;
 const yearRows=years.map((a,i)=>{const change=yearChange(a,years[i+1]);return `<tr><th scope="row">${a.year}</th><td>${compactMoney(a.revenue)}</td><td>${signedMoney(a.operatingProfit)}${change===null?'':` <small>${change<0?'−':'+'}${integer(Math.abs(change))}%</small>`}</td><td class="company-optional">${integer(a.delivered)}</td><td class="company-optional">${integer(a.population)}</td><td class="company-optional">${integer(a.routes)}</td><td class="company-optional">${a.performance??'—'}</td><td>${escapeHTML(game.routes.find(route=>route.id===a.bestRouteId)?.name||'—')}</td></tr>`;}).join('');
 const yearly=`<section class="company-section"><h3>Year by year</h3>${years.length?`<div class="company-table"><table><thead><tr><th scope="col">Year</th><th scope="col">Fares</th><th scope="col">Operating profit</th><th scope="col" class="company-optional">Delivered</th><th scope="col" class="company-optional">Residents</th><th scope="col" class="company-optional">Routes</th><th scope="col" class="company-optional">Rating</th><th scope="col">Best route</th></tr></thead><tbody>${yearRows}</tbody></table></div>`:`<p class="company-empty">Your first yearly summary arrives on January 1, ${inflationInfo(game).year+1}.</p>`}</section>`;
 // Net a month since each route's accounts began; a route only counts as below its upkeep after 90 days.
 const rated=game.routes.map(route=>{const net=route.revenue-(route.revenueAtAccountingStart||0)-(route.expenses||0),days=game.day-(route.accountingStartDay||0);return {route,net,days,rate:net/Math.max(days,1)*30.44};});
 const top=rated.filter(r=>r.days>=30.44&&r.rate>0).sort((a,b)=>b.rate-a.rate).slice(0,5),below=rated.filter(r=>r.days>=90&&r.net<0).sort((a,b)=>a.rate-b.rate);
 const row=({route,rate},index,flag)=>{const count=getRouteFleet(game,route.id).count,id=escapeHTML(route.id);return `<li class="company-route">${flag?'':`<span class="company-rank">${index+1}</span>`}<div><strong>${escapeHTML(route.name)}</strong><small>${flag?'Earning less than its upkeep':`${escapeHTML(CARGO[route.cargo].name)} · ${count} ${fleetNoun(route,count)}`}</small></div><span class="company-rate">≈ ${signedMoney(rate)} / month</span><span class="company-route-actions"><button class="small-button" data-company-show="${id}">Show</button>${flag?`<button class="small-button" data-company-retire="${id}">Retire</button>`:''}</span></li>`;};
 const routes=`<section class="company-section"><header><h3>Top routes</h3><span>Net a month · fares less route upkeep</span></header>${top.length?`<ol class="company-routes">${top.map((r,i)=>row(r,i,false)).join('')}</ol>`:`<p class="company-empty">${!game.routes.length?'No routes yet.':rated.some(r=>r.days>=30.44)?'No route earns more than its upkeep yet.':'Routes join this list after a month of earnings.'}</p>`}${below.length?`<h4>Earning less than their upkeep</h4><ul class="company-routes below">${below.slice(0,5).map((r,i)=>row(r,i,true)).join('')}</ul>${below.length>5?`<p class="company-empty">And ${below.length-5} more.</p>`:''}`:''}</section>`;
 const loan=`<section class="company-section company-loan"><header><h3>Loan</h3><span>${terms.loan?`${money(terms.loan)} of ${money(terms.limit)}`:`Up to ${money(terms.limit)}`}</span></header>${terms.loan?`<div class="company-meter"><span style="width:${Math.min(100,terms.loan/terms.limit*100)}%"></span></div>`:''}<p>${terms.loan?`Interest is ${money(terms.monthlyInterest)} a month, charged as each month closes.`:'Optional credit for a project you cannot fund yet.'} A flat ${(terms.rate*100).toFixed(1)}% a month on what you owe, with no due date: repay whenever you like.</p><div class="company-loan-actions"><button class="button button-outline" id="company-borrow" ${terms.borrow?'':'disabled'}>${terms.borrow?`Borrow ${money(terms.borrow)} · ${money(terms.borrowInterest)} / month interest`:'Credit line fully used'}</button>${terms.loan?`<button class="button button-outline" id="company-repay" ${game.money>=terms.repay?'':`disabled title="Need ${money(terms.repay)} to repay"`}>Repay ${money(terms.repay)}</button>`:''}</div></section>`;
 closeManagement();openModal(`<div class="modal-inner company-report"><div class="modal-heading"><div><h2>Company</h2><p>Your company in figures. Each month closes on the 1st, and each year on January 1.</p></div><button class="close-modal" aria-label="Close dialog">×</button></div>${performanceSectionHTML()}${charts}${yearly}${routes}${loan}<div class="modal-actions"><button class="button button-outline" id="company-payment-rates">Cargo payment rates</button><button class="button button-primary" data-close>Back to game ${icon('arrow')}</button></div></div>`);
 // Property follows the route ranking, only once the company owns some.
 const property=propertySectionHTML();if(property){$('#modal .company-loan').insertAdjacentHTML('beforebegin',property);$$('[data-property-show]').forEach(el=>el.addEventListener('click',()=>locateDestination(el.dataset.propertyShow,'city')));}
 $$('[data-company-show]').forEach(el=>el.addEventListener('click',()=>showNoticeTarget({kind:'route',id:el.dataset.companyShow})));
 $$('[data-rating-show]').forEach(el=>el.addEventListener('click',()=>showNoticeTarget({kind:'route',id:el.dataset.ratingShow})));$('#rating-century')?.addEventListener('click',openCenturyCard);$('.rating-details')?.addEventListener('toggle',e=>{ratingDetailsOpen=e.target.open;});
 $('#company-payment-rates').addEventListener('click',()=>{openHelp('resources');$('#payment-rates-title')?.scrollIntoView({block:'start'});});
 $$('[data-company-retire]').forEach(el=>el.addEventListener('click',()=>retireRoute(el.dataset.companyRetire)));
 // Borrowing and repaying redraw the dialog in place, keeping its scroll and the pressed button.
 for(const [id,action] of [['#company-borrow',borrow],['#company-repay',repay]])$(id)?.addEventListener('click',()=>{
  const result=action(game),scroll=$('#modal').scrollTop;toast(result.message,!result.ok);updateHud();if(result.ok)persist();
  openCompany();$('#modal').scrollTop=scroll;($(`${id}:not(:disabled)`)||$('#company-borrow:not(:disabled),#company-repay:not(:disabled)'))?.focus({preventScroll:true});
 });
 $('#modal .close-modal')?.focus({preventScroll:true});
 if(section==='loan')$('.company-loan').scrollIntoView({block:'start'});
 if(section==='property')$('.company-property')?.scrollIntoView({block:'start'});
}
// The change in operating profit on the year before, when that year made a profit.
function yearChange(summary,previous) { return previous?.year===summary.year-1&&previous.operatingProfit>0?Math.round((summary.operatingProfit-previous.operatingProfit)/previous.operatingProfit*100):null; }
// The company rating (company-rating.js) is recognition only: the finances card names the title, a new title or the
// century arrives once as company news, and the report explains the score. A falling score is never announced.
function updateRatingRow() {
 const p=game.performance,title=careerTitle(game),key=`${worldSerial}:${p?.day}:${p?.score}:${title}`;if(key===ratingRow)return;ratingRow=key;
 const next=nextTitle(game);
 $('#company-title').innerHTML=escapeHTML(CAREER_TITLES[title])+(p?` <small>${integer(p.score)} of 1,000</small>`:'');
 $('#rating-row').title=p?`Performance rating ${integer(p.score)} of 1,000 at the review on ${dateLong(p.day)}. ${next?`${next.name} at ${integer(next.score)}.`:'The top title.'} Titles are kept once earned.`:`First review on ${dateLong(nextReviewDay(game))}.`;
}
// A jump of several titles makes one moment, naming the highest. Headlines carry both moments; with them off, a toast does.
function watchPerformance() {
 const p=game.performance;if(!p)return;
 if(p.reached.length>ratingSeen.titles){
  ratingSeen.titles=p.reached.length;const index=p.reached.length-1,name=CAREER_TITLES[index],score=integer(p.score);
  if(!announceHeadline({key:`rating:${index}`,kind:'rating',art:'trendUp',day:p.day,title:`New title: ${name}`,detail:`Your company scored ${score} of 1,000 at its quarterly review. A title, once earned, is yours to keep.`}))noticeQueue.push({message:`New title: ${name}. Performance ${score} of 1,000.`,type:'milestone',action:{label:'Open report',run:openCompany},paced:true});
 }
 if(p.century&&!ratingSeen.century){
  ratingSeen.century=true;const c=p.century,name=CAREER_TITLES[c.title],score=integer(c.score);
  if(!announceHeadline({key:'rating:century',kind:'rating',art:'company',day:c.day,title:'A century of transport',detail:`Your company has run for one hundred years: ${name}, performance ${score} of 1,000.`}))noticeQueue.push({message:`A century of transport: ${name}, performance ${score} of 1,000.`,type:'milestone',action:{label:'See evaluation',run:openCenturyCard},paced:true});
 }
}
// Titles earned, with the days that shared a review joined: 'Engineer, then Traffic manager'.
function careerHTML(reached) {
 const groups=[];reached.forEach((day,index)=>{const last=groups.at(-1);if(last?.day===day)last.names.push(CAREER_TITLES[index]);else groups.push({day,names:[CAREER_TITLES[index]]});});
 return `<ol class="rating-career">${groups.map(group=>`<li><span>${escapeHTML(group.names.join(', then '))}</span><time>${dateShort(group.day)}</time></li>`).join('')}</ol>`;
}
function companyValueHTML() {
 const value=companyValue(game),parts=`Cash ${moneyText(value.cash)}, vehicles ${moneyText(value.vehicles)}${value.property?`, property ${moneyText(value.property)}`:''} and infrastructure ${moneyText(value.infrastructure)}${value.loan?`, less a loan of ${moneyText(value.loan)}`:''}.`;
 return `<p class="rating-value" title="${escapeHTML(parts)}"><span>Company value</span><strong data-num>${moneyText(value.total)}</strong><small>Cash, vehicles and property at resale value and half of today’s infrastructure cost, less any loan.</small></p>`;
}
// The report's Property section: rent a month, worth, this year's rent and its yield, a small chart and the top towns.
function propertySectionHTML() {
 const towns=companyProperty(game);if(!towns.length)return '';
 const history=game.history,rents=history.map(h=>h.property||0),last=rents.at(-1)||0,recent=rents.slice(-3),year=calendarYear(game);
 const worth=towns.reduce((sum,town)=>sum+[...town.plots,...town.owned].reduce((total,p)=>total+propertyValue(game,p),0),0),thisYear=history.filter(h=>1950+Math.floor(h.month/12)===year).reduce((sum,h)=>sum+(h.property||0),0);
 const average=recent.length?recent.reduce((a,b)=>a+b,0)/recent.length:0,yearly=average&&worth?`${Math.round(12*average/worth*100)}% a year`:'—';
 const spark=rents.length>1?miniSpark(rents,'property-spark','Rent, month by month'):'';
 // Towns with property or a year of returns (rent, market bonus and workshop freight), the best past twelve months first.
 const held=new Set(towns.map(town=>town.city)),listed=[...towns,...game.cities.filter(city=>city.market?.returns&&!held.has(city)).map(city=>({city,plots:[],owned:[],rent:city.market.rent||0}))].map(town=>{const split=returnsTotals(town.city.market);return {...town,split,year:split[0]+split[1]+split[2]};});
 const rows=listed.sort((a,b)=>b.year-a.year||b.rent-a.rent||b.plots.length+b.owned.length-a.plots.length-a.owned.length).slice(0,8).map(town=>`<tr><th scope="row">${escapeHTML(town.city.name)}</th><td class="company-optional" data-num>${integer(town.plots.length)}</td><td class="company-optional" data-num>${integer(town.owned.length)}</td><td data-num>${money(town.rent)}</td><td data-num title="${escapeHTML(`${money(town.split[0])} rent, ${money(town.split[1])} market bonus and ${money(town.split[2])} workshop freight`)}">${money(town.year)}</td><td><button type="button" class="small-button" data-property-show="${escapeHTML(town.city.id)}">Show</button></td></tr>`).join('');
 return `<section class="company-section company-property"><header><h3>Property</h3><span data-num>${money(last)} a month</span></header><div class="property-figures"><dl><div><dt>Worth</dt><dd data-num>${money(worth)}</dd></div><div><dt>Rent this year</dt><dd data-num>${money(thisYear)}</dd></div><div><dt>Yield</dt><dd data-num>${yearly}</dd></div></dl>${spark}</div><div class="company-table property-towns"><table><thead><tr><th scope="col">Town</th><th scope="col" class="company-optional">Plots</th><th scope="col" class="company-optional">Buildings</th><th scope="col">Rent a month</th><th scope="col">Past 12 months</th><th scope="col"><span class="sr-only">Show on map</span></th></tr></thead><tbody>${rows}</tbody></table></div><p class="property-note">Zones you paint are your land: you collect ground rent from what developers build on them. Buildings you place are yours outright. Property has no upkeep.</p></section>`;
}
// A small line of monthly values, 72 × 18: the report's rent and a town's returns. Decorative; the figures beside it say the same.
function miniSpark(values,cls,title='') {
 const high=Math.max(1,...values),points=values.map((v,i)=>`${(values.length>1?i/(values.length-1)*72:36).toFixed(1)},${(17-v/high*16).toFixed(1)}`).join(' ');
 return `<svg class="${cls}" viewBox="0 0 72 18" width="72" height="18" preserveAspectRatio="none" aria-hidden="true">${title?`<title>${title}</title>`:''}<polyline points="${points}"/></svg>`;
}
// The Company report's first block: title, score, the way to the next title, company value and, folded, what counts.
function performanceSectionHTML() {
 const p=game.performance,title=CAREER_TITLES[careerTitle(game)];
 if(!p)return `<section class="company-section rating-summary"><div class="rating-head"><h3>${title}</h3></div><p class="rating-meta">The first review is on ${dateLong(nextReviewDay(game))}.</p>${achievementsLineHTML()}</section>`;
 const next=nextTitle(game),signed=v=>`<span class="${v>0?'gain':v<0?'loss':'even'}">${moneyText(v,{signed:true})}</span>`,full=part=>part.money?moneyText(partTarget(game,part,p.day)):integer(part.target);
 const weakest=game.routes.find(route=>route.id===p.weakest);
 const cells=[integer(p.values[0]),integer(p.values[1]),p.values[2]===null?`Counts from ${MIN_RATED_FLEET} vehicles with a full year`:`${signed(p.values[2])} per vehicle last year${weakest?`<span class="rating-route"><span>${escapeHTML(weakest.name)}</span><button type="button" class="small-button" data-rating-show="${escapeHTML(weakest.id)}">Show</button></span>`:''}`,signed(p.values[3]),signed(p.values[4]),`${integer(p.values[5])} in 12 months`,integer(p.values[6]),signed(p.values[7]),p.values[8]>0?`${moneyText(p.values[8])} borrowed`:'No loan'];
 const marks=RATING_PARTS.map(part=>part.id==='weakest'?`${full(part)} per vehicle`:part.id==='loan'?'No loan':full(part));
 const rows=RATING_PARTS.map((part,i)=>`<tr title="Full marks: ${escapeHTML(marks[i])}"><th scope="row">${part.label}</th><td>${cells[i]}</td><td>${marks[i]}</td><td>${p.points[i]} of ${part.max}</td></tr>`).join('');
 const century=p.century?`<p class="rating-century"><span>A century of transport: ${CAREER_TITLES[p.century.title]}, ${integer(p.century.score)} of 1,000</span><button type="button" class="small-button" id="rating-century">See evaluation</button></p>`:'';
 return `<section class="company-section rating-summary" aria-labelledby="rating-title"><div class="rating-head"><h3 id="rating-title">${title}</h3><p class="rating-score"><strong data-num>${integer(p.score)}</strong> <span>of 1,000</span></p></div><div class="rating-track" aria-hidden="true"><span style="width:${next?Math.min(100,p.score/next.score*100):100}%"></span></div><p class="rating-meta"><span>${next?`${next.name} at ${integer(next.score)}`:'The top title'}</span><span>Reviewed ${dateLong(p.day)}, next review ${dateLong(nextReviewDay(game))}</span></p>${companyValueHTML()}${century}${achievementsLineHTML()}<details class="rating-details"${ratingDetailsOpen?' open':''}><summary>What counts ${icon('chevronDown')}</summary><div class="rating-table"><table><thead><tr><th scope="col">Measure</th><th scope="col">At review</th><th scope="col">Full marks</th><th scope="col">Points</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th><td></td><td></td><td>${integer(p.score)} of 1,000</td></tr></tfoot></table></div><p class="rating-note">Points rise fastest at first: half of a target earns about 70% of its points. The rating is recognition only and never changes prices, towns or vehicles. A title, once earned, is yours to keep.</p>${p.reached.length>1?`<h4>Titles earned</h4>${careerHTML(p.reached)}`:''}</details></section>`;
}
// The century evaluation opens only when asked for, from its news or the report; like every dialog it pauses.
function openCenturyCard() {
 const p=game.performance,c=p?.century;if(!c)return;
 const reached=p.reached.filter(day=>day<=c.day);
 closeManagement();openModal(`<div class="modal-inner century-card"><div class="modal-heading"><div><h2>A century of transport</h2><p>${dateLong(c.day)}. Your company has run for one hundred years.</p></div><button class="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="century-title"><strong>${CAREER_TITLES[c.title]}</strong><span>Performance ${integer(c.score)} of 1,000, career best ${integer(p.best)}</span></div><dl class="century-facts"><div><dt>Company value</dt><dd data-num>${moneyText(c.value)}</dd></div><div><dt>Titles earned</dt><dd data-num>${reached.length} of ${CAREER_TITLES.length}</dd></div></dl>${careerHTML(reached)}<p class="century-achievements">${game.achievements?.unlocked['years-100']!==undefined?medalIcon('platinum',{label:'Platinum: A century'}):''}<span><strong data-num>${earnedCount(game)}</strong> of ${ACHIEVEMENTS.length} achievements earned</span><button type="button" class="small-button" data-open-achievements>Open ${icon('chevronRight')}</button></p><p class="century-note">Play continues. There is no end date, and every title you have earned stays yours.</p><div class="modal-actions"><button class="button button-outline" id="century-report">Company report</button><button class="button button-primary" data-close>Keep playing</button></div></div>`);
 $('#century-report').addEventListener('click',()=>{closeModal();openCompany();});
 $('#modal .close-modal')?.focus({preventScroll:true});
}
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
 const completedTool=tool;
 if(spanTools.has(tool)&&points.length<3){toast('Drag a straight span of at least 3 tiles, including both ends.',true);preview=[];return;}
 const journal=captureUndo(game,tool,points),result=buildPlan(game,tool,points,{preferredMode,airportAxis}),undo=finishUndo(journal,game,result);if(undo)undoStack=[...undoStack.filter(item=>!undoStale(game,item)).slice(-9),undo];
 toast(result.message,{type:!result.ok?'error':result.built>0&&result.failed>0?'warning':'ok',key:undo||result.message,action:undo&&{label:'Undo',run:()=>undoBuild(undo)}});preview=[];if(result.ok)refreshRouteConnections(game);updateHud();if(result.ok){persistSoon();if(view!=='build')renderPanel();}
 if(result.ok&&result.built>0&&['road','rail',...spanTools,'stop','bus-stop','train-stop','port','airport'].includes(completedTool)){
  setTool('inspect');constructionNext={kind:['road','rail',...spanTools].includes(completedTool)?'network':'stop',message:['road','rail',...spanTools].includes(completedTool)?`${preferredMode==='rail'?'Railway':'Road'} built. Add stops near your customers.`:'Stop opened. Add another stop or connect a route.',station:['road','rail',...spanTools].includes(completedTool)?null:result.station||game.stations.at(-1),mode:preferredMode};
  category='network';setView('build');
 }
 if(hover&&updatePlacementTip.at)updatePlacementTip(); // Re-quote the tile under the pointer, never the finished stroke.
}
function pickMapTile(clientX,clientY,clamp=false) {
 if(isRoutePicking()) {
  // Station signs stay 16–18 screen pixels wide, including at Region zoom,
  // so the nearest sign within the pointer’s reach picks its stop.
  const station=renderer.stationAtMarker(clientX,clientY,{slop:8,mode:formDraft.mode});
  return station?{x:station.x,y:station.y}:renderer.screenToTile(clientX,clientY);
 }
 if(terrainTools.has(tool))return renderer.screenToVertex(clientX,clientY,{clamp});
 return tool==='inspect'?renderer.screenToInspectTile(clientX,clientY):renderer.screenToTile(clientX,clientY,{clamp});
}
function cancelGesture() {
 const id=pointer?.id;pointer=null;preview=[];
 if(id!==undefined&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
 canvas.classList.remove('dragging');$('#placement-tip').hidden=true;
}
// Keys, zoom buttons and edge scrolling move the map under a still pointer; the tile, stroke and quote beneath it follow.
function refreshStroke() {
 const at=pointer?{clientX:pointer.lastX,clientY:pointer.lastY,pointerType:pointer.type}:updatePlacementTip.at;
 if(!at||!hover||hover.keyboard||pointer?.pan||pointer?.cancelled)return;
 const line=Boolean(pointer)&&lineTools.has(pointer.tool),next=pickMapTile(at.clientX,at.clientY,line);if(hover.x===next.x&&hover.y===next.y)return;
 hover=next;if(line)preview=constructionLine(pointer.start,hover,pointer.tool,pointer);
 $('#tile-coordinates').textContent=`${hover.x}, ${hover.y} · ${BIOMES[game.biome].name}`;updatePlacementTip(at);
}
// A valid stop names what it will serve; a bulldozer names the services it would cut.
const coverageTips=new WeakMap();
function placementNote(effective,plan) {
 // An airport names the towns within 7 tiles of any of its tiles.
 if(AIRPORT_TOOLS.has(effective)&&plan.placements.length===1){
  const {x,y}=plan.placements[0],axis=effective==='airport-y'?'y':'x',key=`${x},${y},${axis}:${game.revision}`;let cache=coverageTips.get(game);if(!cache)coverageTips.set(game,cache=new Map());
  if(!cache.has(key)){const names=stationCoverage(game,{x,y,mode:'air',axis}).cities.map(city=>city.name);if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,names.length?{text:'Serves '+nameList(names,3)}:{text:`No town centre within ${AIRPORT_REACH} tiles`,warning:true});}
  return cache.get(key);
 }
 if(['bus-stop','train-stop','port'].includes(effective)&&plan.placements.length===1){
  const {x,y}=plan.placements[0],key=`${x},${y}:${game.revision}`;let cache=coverageTips.get(game);if(!cache)coverageTips.set(game,cache=new Map());
  if(!cache.has(key)){
   const c=stationCoverage(game,{x,y}),list=items=>items.slice(0,3).join(', ')+(items.length>3?` +${items.length-3}`:''),cargo=keys=>keys.filter(k=>!isTownTraffic(k)).map(k=>CARGO[k].name.toLowerCase());
   const parts=[[cargo(c.produces),'Loads'],[cargo(c.accepts),'Accepts'],[c.cities.map(city=>city.name),'serves']].filter(([items])=>items.length).map(([items,label])=>`${label} ${list(items)}`);
   if(cache.size>=64)cache.delete(cache.keys().next().value);
   cache.set(key,parts.length?{text:parts.join(' · ')}:{text:'No customers within 5 tiles',warning:true});
  }
  return cache.get(key);
 }
 // Zones, and the homes, shops, services and workshops you place, say what they would bring: a second line under the quote.
 if(zoneTools.has(effective)||effective==='workshop'||BUILDINGS[effective]){const note=forecastNote(game,effective,plan.placements);return note?{text:'',...note}:{text:''};}
 if(tool!=='bulldoze')return {text:''};
 const index=routeTileIndex(game),names=new Set(plan.placements.flatMap(p=>index.get(p.y*game.width+p.x)||[]));
 return names.size?{text:`breaks ${names.size===1?`the ${[...names][0]} route`:names.size+' routes'}`,warning:true}:{text:''};
}
function updatePlacementTip(e=updatePlacementTip.at) {
 const tip=$('#placement-tip');if(!e)return;updatePlacementTip.at={clientX:e.clientX,clientY:e.clientY,pointerType:e.pointerType};
 if(tool==='inspect'||!hover||!tileAt(hover.x,hover.y)||pointer?.pan){tip.hidden=true;return;}
 const points=preview.length?preview:[hover],n=points.length,plan=spanTools.has(tool)&&n<3?{ok:false,message:'Drag at least 3 tiles between level ends.',placements:[],cost:0}:quoteBuildPlan(game,tool,points,{preferredMode,airportAxis});
 const effective=n===1&&!spanTools.has(tool)?plan.placements[0]?.tool:tool;
 const name=TOOL_INFO[effective]?.name||BUILDINGS[effective]?.name||INDUSTRIES[effective]?.name||'Build';
 const levels=tool==='level'?`Level ${plan.level??surfaceHeight(game,points[0].x,points[0].y)}`:terrainTools.has(tool)?n===1?`Level ${surfaceHeight(game,hover.x,hover.y)} → ${Math.max(1,Math.min(MAX_HEIGHT,surfaceHeight(game,hover.x,hover.y)+(tool==='raise'?1:-1)))}`:`${tool==='raise'?'+1':'−1'} level / point`:spanTools.has(tool)&&Number.isFinite(plan.height)?`Level ${plan.height}`:'';
 const nature=tool==='bulldoze'&&n===1?terrainObjectAt(game,hover.x,hover.y):null;
 const siteSize=BUILDINGS[effective]?buildingFootprint(effective):INDUSTRIES[effective]?industryFootprint(effective):nature&&nature.object.kind!=='mountain'?terrainObjectSize(nature.object):0;
 const note=plan.ok===false?{text:''}:placementNote(effective,plan);
 const stroke=strokePlans.get(game),route=preview.length&&preview===stroke?.path?stroke.reason:null,terrain=route==='flipped'||route==='routed'?` · follows\u00a0terrain${e.pointerType==='keyboard'?'':' · Shift:\u00a0straight'}`:'';
 // A zone rectangle reads its size, tiles and how many no road reaches before the price.
 const area=n>1?points.area:null,zoning=zoneTools.has(tool)&&n>1,count=plan.placements.length>1?' · '+plan.placements.length+(tool==='bulldoze'?' sites':terrainTools.has(tool)?' points':' tiles'):'',roads=plan.needRoad?` · ${n>1?plan.needRoad+(plan.needRoad===1?' needs':' need'):'needs'} a road`:'';
 tip.textContent=plan.ok===false?route==='too-far'?'No gentle route — level ground or drag in shorter segments':plan.message+terrain:`${name}${siteSize?' · '+siteSize+' × '+siteSize:area?' · '+area.w+' × '+area.h:''}${levels?' · '+levels:''}${zoning?count+roads:''} · ${money(plan.cost)}${zoning?'':count+roads}${plan.partial?' · '+plan.message:''}${effective==='bus-stop'&&plan.message==='Road underneath included in the price.'?' · road included':''}${note.text?' · '+note.text:''}${area?.capped?` · max ${AREA_SIDE} × ${AREA_SIDE}`:''}${terrain}`;
 if(note.forecast)tip.append(Object.assign(document.createElement('span'),{className:'tip-forecast',textContent:note.forecast}));
 tip.classList.toggle('invalid',plan.ok===false);tip.classList.toggle('partial',plan.ok!==false&&Boolean(plan.partial));tip.classList.toggle('warning',Boolean(note.warning||plan.ok!==false&&plan.needRoad));
 const rect=canvas.getBoundingClientRect();tip.hidden=false;
 tip.style.left=Math.max(4,Math.min(rect.width-tip.offsetWidth-4,e.clientX-rect.left+17))+'px';tip.style.top=Math.max(4,Math.min(rect.height-tip.offsetHeight-4,e.clientY-rect.top+18))+'px';
}
canvas.addEventListener('pointerdown',e=>{
 if(e.pointerType==='touch'||e.button!==0&&e.button!==1&&e.button!==2)return;
 if(pointer){if(e.button===2)setTool('inspect');return;}
 canvas.focus({preventScroll:true});const tile=pickMapTile(e.clientX,e.clientY);
 pointer={id:e.pointerId,button:e.button,tool,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,start:tile,moved:false,pan:tool==='inspect'||e.button!==0||spaceDown,shift:e.shiftKey};
 canvas.setPointerCapture(e.pointerId);
 if(spaceDown)spaceUsedForPan=true;
 if(pointer.pan)canvas.classList.add('dragging');else preview=[tile];
 pointer.type=e.pointerType;
 updatePlacementTip(e);
});
canvas.addEventListener('pointermove',e=>{
 if(e.pointerType==='touch')return;
 // Chrome replays a resting mouse as a move without movement when the layout shifts under it; that is not the player
 // taking the map back from the keyboard cursor; a real move drops the cursor first (the capturing listener below).
 if(!pointer&&!e.movementX&&!e.movementY&&keyOwned())return;
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
 if(!pointer||pointer.id!==e.pointerId)return;
 const p=pointer;pointer=null;canvas.classList.remove('dragging');if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
 if(p.cancelled){preview=[];$('#placement-tip').hidden=true;return;}
 if(p.button!==0){preview=[];if(p.button===2&&!p.moved)setTool('inspect');return;}
 if(p.tool!==tool){preview=[];return;}
 if(!p.moved&&!spaceDown&&pickRouteStopAt(p.start.x,p.start.y))return;
 if(p.pan){preview=[];if(!p.moved&&!spaceDown){const vehicle=tool==='inspect'&&renderer.vehicleAt(e.clientX,e.clientY);if(vehicle)inspectVehicle(vehicle.id);else inspect(p.start.x,p.start.y);}return;}
 if(p.moved&&!lineTools.has(p.tool)){preview=[];return;}
 const points=preview.length?preview:[p.start];
 if(points.every(p=>tileAt(p.x,p.y)))paintPath(points);else{toast('Keep construction within the world boundary.',true);preview=[];}
});
canvas.addEventListener('pointercancel',cancelGesture);
canvas.addEventListener('lostpointercapture',e=>{if(pointer?.id===e.pointerId)cancelGesture();});
// The keyboard cursor stays when the mouse leaves, or when a panel opens under a resting mouse.
canvas.addEventListener('pointerleave',()=>{if(hover?.keyboard)return;if(!pointer)hover=null;$('#placement-tip').hidden=true;});
canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(pointer&&!pointer.pan&&(e.pointerType||'mouse')==='mouse'){pointer.cancelled=true;preview=[];$('#placement-tip').hidden=true;}});
// Live panel refreshes wait for the pointer press to finish.
$('#inspector').setAttribute('role','region');$('#inspector').setAttribute('aria-labelledby','inspector-title');
for(const el of [$('#inspector'),$('#panel-content')])el.addEventListener('pointerdown',()=>{panelPress=true;},true);
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{if(panelPress){panelPress=false;panelReleasedAt=performance.now();}},true);
let wheelAt=-Infinity, wheelDelta=0, wheelConsumed=false;
// Sideways scrolling always pans; Scroll to pan (Map options) pans with every scroll. A pinch arrives with ctrlKey and always zooms.
let scrollPan=(()=>{try{return localStorage.getItem('transport-scroll-mode')==='pan';}catch{return false;}})();
function setScrollPan(on) { scrollPan=on;$('#scroll-mode').setAttribute('aria-pressed',String(on));try{localStorage.setItem('transport-scroll-mode',on?'pan':'zoom');}catch{} }
$('#scroll-mode').setAttribute('aria-pressed',String(scrollPan));
$('#scroll-mode').onclick=()=>{setScrollPan(!scrollPan);toast(scrollPan?'Scrolling now moves the map. Pinch or Ctrl+scroll to zoom.':'Scrolling now zooms the map.');};
canvas.addEventListener('wheel',e=>{
 e.preventDefault();
 const scale=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1,dx=e.deltaX*scale,dy=e.deltaY*scale;
 if(!e.ctrlKey&&(scrollPan||Math.abs(dx)>Math.abs(dy))){renderer.pan(-dx,scrollPan?-dy:0);refreshStroke();return;}
 if(!dy)return;
 const now=performance.now();
 if(now-wheelAt>180){wheelDelta=0;wheelConsumed=false;}
 wheelAt=now;if(wheelConsumed)return;
 wheelDelta+=dy;
 if(Math.abs(wheelDelta)<12)return;
 // One step per gesture keeps trackpad momentum from skipping a view.
 wheelConsumed=true;renderer.zoomAt(wheelDelta<0?2:.5,e.clientX,e.clientY);updateHud();
},{passive:false});
// Dragging, pinching or scrolling the map ends Follow; other camera moves are caught in the frame.
canvas.addEventListener('pointermove',()=>{if(follow&&(pointer?.pan&&pointer.moved))stopFollow();});
canvas.addEventListener('wheel',()=>{if(follow)stopFollow();},{passive:true});
$('#minimap').addEventListener('click',e=>{const box=e.currentTarget.getBoundingClientRect();renderer.focus((e.clientX-box.left)/box.width*game.width,(e.clientY-box.top)/box.height*game.height);});
$('#minimap').addEventListener('keydown',e=>{if(e.key==='Enter'){renderer.focus(game.cities[0].x,game.cities[0].y);}});
$$('.nav-button[data-view]').forEach(el=>el.addEventListener('click',()=>compactUI?compactUI.toggleManagement(el.dataset.view):setView(el.dataset.view)));
$$('[data-open-gallery]').forEach(button=>button.addEventListener('click',()=>openGallery()));
$$('[data-open-chains]').forEach(el=>el.addEventListener('click',()=>openChains()));
$$('[data-speed]').forEach(el=>el.addEventListener('click',()=>changeSpeed(Number(el.dataset.speed))));
$('#panel-help').onclick=()=>openHelp();$('#panel-save').onclick=openSaves;
$('#atlas-button').onclick=openAtlas;
$('#world-button').onclick=openWorld;$('#help-button').onclick=()=>openHelp();$('#guide-button').onclick=()=>openHelp();$('#save-button').onclick=openSaves;
$('#objective-card').addEventListener('click',goalClick);
$('#grid-button').onclick=()=>setMapLayers({grid:!mapLayers.grid});
$('#routes-toggle').onclick=()=>setMapLayers({routes:!mapLayers.routes});
const terrainHeightControl=$('#terrain-height');
terrainHeightControl.replaceChildren(...TERRAIN_HEIGHT_VIEWS.map(({value,label})=>new Option(label,String(value))));
terrainHeightControl.value=String(renderer.getTerrainHeight());
terrainHeightControl.onchange=()=>{
 cancelGesture();renderer.setTerrainHeight(Number(terrainHeightControl.value));refreshStroke();invalidateScene();
 if(!saveTerrainHeight(renderer.getTerrainHeight()))toast('Terrain view changed. This browser could not remember it.',true);
};
$('#zoom-in').onclick=()=>{closeMapMenus();renderer.zoomAt(1.2);updateHud();refreshStroke();};$('#zoom-out').onclick=()=>{closeMapMenus();renderer.zoomAt(1/1.2);updateHud();refreshStroke();};$('#home-view').onclick=()=>renderer.focus(game.cities[0].x,game.cities[0].y);
$$('[data-zoom-level]').forEach(el=>el.addEventListener('click',()=>{renderer.setZoom(Number(el.dataset.zoomLevel));closeMapMenus(true);updateHud();}));
$('#zoom-level').onclick=()=>toggleMapMenu('zoom-menu','zoom-level');
$('#zoom-home').onclick=()=>{closeMapMenus(true);$('#home-view').click();updateHud();};
$('#map-options-button').onclick=()=>toggleMapMenu('map-options','map-options-button');
$('#cancel-tool-button').onclick=()=>{setTool('inspect');setView('build');};
$('#active-tool-turn').onclick=()=>turnRunway();
// The Airport tool turns its runway with A or Turn; the tip and preview re-quote the new site at once.
function turnRunway() {
 airportAxis=airportAxis==='x'?'y':'x';$('#status-message').textContent=airportAxis==='y'?'Runway north–south':'Runway east–west';
 if(hover&&updatePlacementTip.at)updatePlacementTip();invalidateScene();
}
function openAirportTool() { closeModal();category='network';setView('build');setTool('airport'); }
// An airport's income rises over its terminal hall, beneath its sign, never over the control tower.
function floaterPoint(event) { const st=stationAt(game,event.x,event.y);if(st?.mode!=='air')return event;const t=localToWorld(st.axis,1.1,.46);return {x:st.x+t.x-.5,y:st.y+t.y-.5,air:true}; }
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
// A remembered sound choice resumes audio on the first click; browsers keep it silent until a gesture.
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
 return stationAt(game,x,y)?.name||(industry?industry.name||INDUSTRIES[industry.kind].name:'')||game.cities.find(c=>c.x===x&&c.y===y)?.name||(site?BUILDINGS[site.building.kind]?.name||'Workshop':'')||(t.zone?TOOL_INFO[t.zone].name+' zone':t.road?'Road':t.rail?'Railway':TERRAIN_NAMES[t.terrain]||'Countryside');
}
// The live region reads '<x>, <y> · <place> · <tool> · <cost or problem>', taking the quote from the placement tip.
function keyCursorText() {
 const {x,y}=keyCursor,tip=$('#placement-tip'),name=TOOL_INFO[tool]?.name||BUILDINGS[tool]?.name||INDUSTRIES[tool]?.name||'Build',station=stationAt(game,x,y);
 const action=isRoutePicking()?station?.mode===formDraft.mode?`Enter picks it as the ${routePicking==='from'?'start':'end'} stop`:`Choose ${aStop(formDraft.mode)}`:tool==='inspect'||tip.hidden?name:tip.classList.contains('invalid')?`${name} · ${tip.textContent}`:tip.textContent;
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
 if(e.target!==canvas||e.ctrlKey||e.metaKey||e.altKey||pointer)return false;
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
const SPEEDS=[0,1,3,8];
function stepSpeed(direction) { const at=Math.max(0,SPEEDS.indexOf(speed)),next=SPEEDS[Math.max(0,Math.min(SPEEDS.length-1,at+direction))];if(next!==speed)changeSpeed(next); }
// Shift+B, R, T and I press their drawer tab, so closing the drawer also clears a Routes or Industries lens;
// Shift+N, C and G open News, Company and Goals. Letters are the printed ones, as for the tool keys.
const SHIFT_KEYS={b:'build',r:'routes',t:'towns',i:'industry'};
function shiftShortcut(key) {
 const panel=SHIFT_KEYS[key];
 if(panel){const tab=$(`.nav-button[data-view="${panel}"]`);if(tab)tab.click();else setView(panel);return true;}
 const open={n:openNews,c:openCompany,g:openGoals}[key];if(open){open();return true;}
 return false;
}
// F frames what the inspector shows: a vehicle starts or stops Follow, anything else glides back into view.
function frameSelection() {
 if(selectedVehicle&&!$('#inspector').hidden){vehicleAction('follow',selectedVehicle);return;}
 if(!selected||$('#inspector').hidden)return;
 const industry=selected.kind==='industry'&&game.industries.find(site=>site.x===selected.x&&site.y===selected.y),size=industry?industrySize(industry):1;
 glideCamera({x0:selected.x,y0:selected.y,x1:selected.x+size-1,y1:selected.y+size-1});updateHud();
}
// The keyboard shortcuts sheet (?): every key in one place, grouped by what it does. The Guide keeps the rules.
const SHORTCUT_GROUPS=[
 ['Time',[['Space','Pause or resume'],['.','Faster'],[',','Slower, then pause']]],
 ['Map',[['Arrows','Move the map'],['+ −','Zoom in or out'],['H','Back to home town'],['F','Show the selection, or follow a vehicle'],['M','Overview map'],['L','Map layers'],['G','Grid'],['Enter','Tile cursor for the keyboard']]],
 ['Build',[['R','Road'],['T','Rail'],['S','Stop'],['P','Port'],['A','Airport, again to turn it'],['B','Bridge'],['N','Tunnel'],['[ ] E','Lower, raise, level land'],['X','Bulldozer'],['1 2 3','Residential, commercial, industrial zones'],['Shift','Hold while dragging for a straight line or a rectangle'],['Ctrl+Z','Undo the last build'],['Esc','Cancel the drag, then finish the tool']]],
 ['Panels',[['Shift+B','Build'],['Shift+R','Routes'],['Shift+T','Towns'],['Shift+I','Industries'],['C','Production chains'],['Shift+N','News'],['Shift+C','Company'],['Shift+G','Company goals'],['Ctrl+S','Saved games'],['?','This sheet'],['Esc','Close what is open, one step at a time']]],
];
function openShortcuts() {
 closeManagement();
 const keys=combo=>combo.split(' ').map(part=>`<kbd>${escapeHTML(part)}</kbd>`).join(' ');
 openModal(`<div class="modal-inner shortcuts-dialog"><div class="modal-heading"><div><h2>Keyboard shortcuts</h2><p>A letter picks a tool. Shift with a letter opens a panel.</p></div><button class="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="shortcut-groups">${SHORTCUT_GROUPS.map(([title,rows])=>`<section class="shortcut-group"><h3>${title}</h3><dl>${rows.map(([combo,label])=>`<div><dt>${keys(combo)}</dt><dd>${escapeHTML(label)}</dd></div>`).join('')}</dl></section>`).join('')}</div><div class="shortcut-foot"><button type="button" class="button button--secondary" data-open-guide>${icon('guide')} Open the guide</button></div></div>`);
 $('#modal [data-open-guide]')?.addEventListener('click',()=>openHelp());
 $('#modal .close-modal')?.focus({preventScroll:true});
}
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
 if(e.key==='Escape'&&isRoutePicking()){e.preventDefault();returnFromRoutePicking();return;}
 if($('#modal').open||e.target.matches('input,select,textarea')||e.target.closest('#layers-panel, #layers-button'))return;
 if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();if(!pointer)undoBuild();return;}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.code==='Space'){
  const control=e.target.closest('button,a,summary,[role=button]');if(control&&control!==pointerFocus)return;
  e.preventDefault();spaceConsumed=true;if(!e.repeat){spaceDown=true;spaceUsedForPan=false;spaceStarted=performance.now();if(pointer){pointer.pan=true;preview=[];spaceUsedForPan=true;canvas.classList.add('dragging');}}return;
 }
 if(e.repeat)return;const key=e.key.toLowerCase();
 // Esc steps back one level at a time (DESIGN.md 10.5): an open popover or menu (the zoom menu, map options and layers close
 // above), a stroke, the tool or a planned connection, the inspector (to its Back target first), the drawer; with nothing left
 // open it clears the cargo lens.
 if(key==='escape'){
  if($('#game-menu')&&!$('#game-menu').hidden){compactUI?.closeMenu(true);return;}
  if(pointer&&!pointer.pan&&tool!=='inspect'){cancelGesture();return;}
  if(tool!=='inspect'||connectionPlan){setTool('inspect');return;}
  if(!$('#inspector').hidden){if(!inspectorBack())closeInspector();return;}
  if($('.sidebar').classList.contains('drawer-open')){const inside=$('.sidebar').contains(document.activeElement);if(compactUI)compactUI.closeManagement(inside);else closeManagement();dropCargoLens('routes','industry');return;}
  setCargoLens(null);return;
 }
 // Shift with a letter opens the panel or dialog it names, while the letter alone picks a tool (see the shortcuts sheet).
 if(e.shiftKey&&!pointer&&shiftShortcut(key)){e.preventDefault();return;}
 // Comma and full stop step the speed down and up, pause included; F shows the selection, or follows the selected vehicle.
 // All three are the printed characters: on AZERTY a full stop is Shift+; and on Czech QWERTZ ? sits on the comma key.
 if(key===','||key==='.'){e.preventDefault();stepSpeed(key==='.'?1:-1);return;}
 if(key==='f'&&!e.shiftKey){e.preventDefault();frameSelection();return;}
 // Inside the drawer, the inspector or the game menu these keys keep scrolling the panel.
 if((e.key==='Home'||e.key==='PageUp'||e.key==='PageDown')&&!e.target.closest('.sidebar,#inspector,#game-menu')){e.preventDefault();$(e.key==='Home'?'#home-view':e.key==='PageUp'?'#zoom-in':'#zoom-out').click();return;}
 // Physical keys keep brackets and digits reachable on QWERTZ and AZERTY layouts; a printed + still zooms.
 const rail=preferredMode==='rail',keys={r:'road',t:'rail',s:'stop',p:'port',a:'airport',b:rail?'railbridge':'bridge',x:'bulldoze','1':'residential','2':'commercial','3':'industrial'},codes={KeyE:'level',BracketLeft:'lower',BracketRight:key==='+'?null:'raise',KeyN:rail?'railtunnel':'tunnel',Digit1:'residential',Digit2:'commercial',Digit3:'industrial'},next=keys[key]||codes[e.code];
 // A again turns the runway; before 1952 it only says when air travel arrives.
 if(next==='airport'&&(tool==='airport'||!airAvailable(game))){if(tool==='airport')turnRunway();else setTool(next);return;}
 if(next){category=['residential','commercial','industrial'].includes(next)?'towns':'network';view='build';setView('build');setTool(next);return;}
 if(key==='l'){e.preventDefault();closeMapMenus();cancelGesture();layersView?.toggle();}
 if(key==='m')openAtlas();if(key==='c'&&!e.ctrlKey&&!e.metaKey)openChains();if(key==='g')$('#grid-button').click();if(key==='h')$('#home-view').click();if(key==='?')openShortcuts();
 if(key==='='||key==='+')$('#zoom-in').click();if(key==='-')$('#zoom-out').click();
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();renderer.pan(e.key==='ArrowLeft'?90:e.key==='ArrowRight'?-90:0,e.key==='ArrowUp'?90:e.key==='ArrowDown'?-90:0);refreshStroke();}
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){if(spaceConsumed){e.preventDefault();spaceConsumed=false;}if(!isLoading()&&spaceDown&&!spaceUsedForPan&&!pointer&&performance.now()-spaceStarted<260)changeSpeed(speed===0?previousSpeed:0);spaceDown=false;}});
window.addEventListener('blur',()=>{spaceDown=false;spaceUsedForPan=false;cancelGesture();});
window.addEventListener('resize',()=>{renderer.resize();syncToolControls();refreshArtwork();});
window.addEventListener('pagehide',()=>{simulation.setActive(false,performance.now(),{blocked:capturingSave,reserved:preview});frameScheduler?.cancel();if((!isLoading()||menuOpening)&&!$('#start-menu')?.open)flushSave();});
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();simulation.setActive(!document.hidden&&!isLoading()&&!$('#start-menu')?.open,lastFrame,{blocked:capturingSave,reserved:preview});if(document.hidden){frameScheduler?.cancel();if((!isLoading()||menuOpening)&&!$('#start-menu')?.open)flushSave();}else wakeFrame();});
window.addEventListener('pageshow',()=>{lastFrame=performance.now();simulation.setActive(!document.hidden&&!isLoading()&&!$('#start-menu')?.open,lastFrame,{blocked:capturingSave,reserved:preview});wakeFrame();});

layersView=mountVisibility($('#layers-panel'),$('#layers-button'),{getLayers:()=>({...mapLayers}),onChange:(key,visible)=>setMapLayers({[key]:visible}),onPreset:name=>setMapLayers(layerPreset(name)),onOpen:()=>{cancelGesture();compactUI?.hideMinimap();closeManagement();closeInspector();closeMapMenus();}});
compactUI=mountCompactPlay({onMenu:openGameMenu,onNews:openNews,onCompany:openCompany,onGoals:openGoals,onAchievements:openAchievements,onShortcuts:openShortcuts,shortcuts:{news:'Shift+N',company:'Shift+C',goals:'Shift+G'},onView:setView,getView:()=>view,onCancelGesture:()=>{cancelGesture();closeManagement();closeInspector();},onMinimapOpen:()=>{closeManagement();closeInspector();closeMapMenus();layersView?.close();renderer.drawMinimap($('#minimap'));invalidateScene();}});
initReferences();
// Closing the drawer yourself ends a lens set by Routes or Industries; locating a site or picking a stop closes it and keeps the lens.
for(const el of [$('#close-management'),...$$('.nav-button[data-view]')])el?.addEventListener('click',()=>{if(!$('.sidebar').classList.contains('drawer-open'))dropCargoLens('routes','industry');});
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
window.addEventListener('online',()=>{void preloadHouses({retry:true,biome:game.biome,cells:startupArtCells()});void preloadWorldArt({retry:true,biome:game.biome,cells:startupArtCells()});});
syncLayerControls();
updateRegion();renderPanel();syncToolControls();updateHud();changeSpeed(1);renderer.resize();
// The start menu has already saved a new world or loaded its checkpoint.
savedWorld=worldSerial;savedDay=game.day;savedRevision=game.revision;saveAt=performance.now();
await drawLoadedWorld();hideLoading();lastFrame=performance.now();simulation.setActive(!document.hidden,lastFrame);
let painted=null,hudState=null,minimapState=null,panelDay=-1,panelRevision=-1;
function frame(now){
 const elapsed=Math.min((now-lastFrame)/1000,.15);lastFrame=now;
 if(document.hidden){frameScheduler.cancel();return;}
 if(isLoading()||$('#start-menu')?.open){simulation.setActive(false,now,{blocked:capturingSave,reserved:preview});frameScheduler.schedule(1000,now);return;}
 // A load can finish after its dialog's speed handler. Starting activity here
 // excludes the loading interval regardless of close-event ordering.
 if(!simulation.getStats().active)simulation.setActive(true,now,{blocked:capturingSave,reserved:preview});
 // A stroke held near or past the map's edge scrolls it, faster the further out, once the drag has moved.
 if(pointer&&!pointer.pan&&!pointer.cancelled&&pointer.moved&&pointer.tool===tool&&lineTools.has(tool)&&!spaceDown){
  const r=canvas.getBoundingClientRect(),band=40,depth=(near,far)=>Math.max(0,Math.min(1.5,1-near/band))-Math.max(0,Math.min(1.5,1-far/band));
  const ex=depth(r.right-pointer.lastX,pointer.lastX-r.left),ey=depth(r.bottom-pointer.lastY,pointer.lastY-r.top),was=renderer.getCamera();
  if(ex||ey){renderer.pan(-ex*650*elapsed,-ey*650*elapsed);const at=renderer.getCamera();if(at.x!==was.x||at.y!==was.y)refreshStroke();}
 }
 // World/economy commits run once per active second. Saved state remains
 // untouched between commits; vehicles replay recorded motion independently.
 const presentationDay=simulation.advance(now,{blocked:capturingSave,reserved:preview});
 renderer.setPresentation(simulation.motion,presentationDay);
 if(floaterGame!==game){floaters=[];presentationDeliveries=[];presentationRents=[];floaterGame=game;}
 presentationDeliveries.push(...drainDeliveryEvents(game));presentationRents.push(...drainPropertyEvents(game));
 // Rent floats up above each town whose name is on screen as a month closes, at most eight at once, without a chime.
 const rents=presentationRents.filter(event=>event.day<=presentationDay+1e-8);presentationRents=presentationRents.filter(event=>event.day>presentationDay+1e-8);if(rents.length){const labelled=new Set(renderer.cityLabels().map(label=>label.id));for(const event of rents.filter(event=>labelled.has(event.cityId)).slice(0,8))floaters.push({x:event.x,y:event.y,revenue:event.rent,cargo:'property',born:now});}
 // Income floats up where cargo was paid for; deliveries at one stop within 300 ms share a figure.
 const deliveries=presentationDeliveries.filter(event=>event.day<=presentationDay+1e-8);presentationDeliveries=presentationDeliveries.filter(event=>event.day>presentationDay+1e-8);
 for(const event of deliveries){const at=floaterPoint(event),recent=floaters.find(f=>f.x===at.x&&f.y===at.y&&now-f.born<300);if(recent){recent.revenue+=event.revenue;continue;}floaters.push({x:at.x,y:at.y,revenue:event.revenue,cargo:event.cargo,born:now,air:at.air});if(!sounds||!mapLayers.deliveries||now-chimeAt<=700)continue;const p=renderer.worldToScreen(event.x,event.y);if(p.x>=0&&p.y>=0&&p.x<=canvas.clientWidth&&p.y<=canvas.clientHeight){chimeAt=now;chime();}}
 const floaterPaint=floaters.length>0;if(floaterPaint)floaters=floaters.filter(f=>now-f.born<1600).slice(-24);
 // Follow centres its carrier until the card closes, a tool is chosen or anything else moves the map.
 if(selectedVehicle&&$('#inspector').hidden)clearVehicle();
 // A glide moves the camera first (stepCamera): Follow's own glide chases its carrier, and any other ends Follow once it lands.
 if(follow?.frame&&follow.cx===undefined){const q=renderer.vehicleWorldPoint(follow.vehicle);follow.frame.cx=q.x;follow.frame.cy=q.y;}const moving=renderer.stepCamera(now);
 if(follow&&!moving){const at=renderer.getCamera(),v=follow.vehicle;if(follow.id!==selectedVehicle||tool!=='inspect'||follow.cx!==undefined&&Math.hypot(at.x-follow.cx,at.y-follow.cy)>2)stopFollow();else{const q=renderer.vehicleWorldPoint(v);if(!(Math.abs(q.x-follow.x)<=.01&&Math.abs(q.y-follow.y)<=.01)){renderer.focus(q.x,q.y);const next=renderer.getCamera();Object.assign(follow,{x:q.x,y:q.y,cx:next.x,cy:next.y});}}}
 const camera=renderer.getCamera(),w=canvas.width,h=canvas.height;
 if(highlight.card&&!highlight.card.isConnected)highlight={id:null,until:0};const highlightRoute=highlight.until>now?highlight.id:null;
 const outlines=propertyOutlines(),hoverRef=refView.hoverRef||(refShown.until>now?refShown.ref:null);
 const changed=isRoutePicking()&&!reducedMotion()||painted?.picking!==routePicking||moving||painted?.hoverRef!==hoverRef||!painted||painted.game!==game||painted.day!==game.day||painted.presentationDay!==presentationDay||painted.revision!==game.revision||painted.money!==game.money||painted.scene!==sceneRevision||painted.x!==camera.x||painted.y!==camera.y||painted.height!==camera.height||painted.zoom!==camera.zoom||painted.w!==w||painted.h!==h||painted.layers!==mapLayers||painted.tool!==tool||painted.hover!==hover||painted.preview!==preview||painted.selected!==selected||painted.mode!==preferredMode||painted.view!==view||painted.from!==formDraft.from||painted.to!==formDraft.to||painted.highlight!==highlightRoute||painted.outlines!==outlines;
 if(changed||floaterPaint){
  renderer.render(now,{tool,hover,preview,selected,preferredMode,airportAxis,routeStops:routePickStops(),stopPicking:isRoutePicking()?{mode:formDraft.mode,selectedId:routePicking==='to'?formDraft.from:formDraft.to,reducedMotion:reducedMotion()}:null,floaters,highlightRoute,servingRoutes:selectedServices(),hoverRef,selectedVehicleId:selectedVehicle,context:contextView(),propertyOutlines:outlines,settle:speed===0,...connectionView()});
  painted={game,day:game.day,presentationDay,revision:game.revision,money:game.money,scene:sceneRevision,x:camera.x,y:camera.y,height:camera.height,zoom:camera.zoom,w,h,layers:mapLayers,tool,hover,preview,selected,mode:preferredMode,view,from:formDraft.from,to:formDraft.to,highlight:highlightRoute,outlines,hoverRef,picking:routePicking};
 }
 syncOverlays(hoverRef);
 if(now-hudAt>400&&(!hudState||hudState.game!==game||hudState.day!==game.day||hudState.revision!==game.revision||hudState.money!==game.money||hudState.zoom!==camera.zoom||hudState.w!==w||hudState.view!==view)){
  updateHud();hudAt=now;hudState={game,day:game.day,revision:game.revision,money:game.money,zoom:camera.zoom,w,view};
  const fresh=collectNotices(game.notifications,lastNoticeId);lastNoticeId=game.notifications[0]?.id;for(const entry of groupNotices(fresh))if(entry.topic!=='credit'||creditToast(entry,game.history))noticeQueue.push({...entry,type:toastType(entry.type),...entry.topic==='credit'?{action:{label:'Loan',run:()=>openCompany('loan')}}:{}});watchHeadlines();watchRoutes();
  watchPerformance();
  watchMilestones();
  watchContracts();
  if(selected&&!$('#inspector').hidden&&!$('#inspector').contains(document.activeElement)&&!panelPress&&now-panelReleasedAt>250)inspect(selected.x,selected.y,selected.kind);
  if(selectedVehicle&&!$('#inspector').hidden)inspectVehicle(selectedVehicle,true);
 }
 // Records wait for the HUD pass that has just queued the day's other news, so the century and new titles lead.
 if(hudAt===now){const earned=drainAchievementUnlocks(game);if(earned.length)queueAchievements(earned);}
 if(noticeQueue.length&&now-noticeAt>400){noticeAt=now;showQueuedNotices(now);}
 if(headlineCurrent||headlineQueue.length)stepHeadlines(now,elapsed*1000);
 if((!compactUI||compactUI.isMinimapVisible())&&(!minimapState||minimapState.game!==game||minimapState.revision!==game.revision||minimapState.layers!==mapLayers||minimapState.x!==camera.x||minimapState.y!==camera.y||minimapState.height!==camera.height||minimapState.zoom!==camera.zoom||minimapState.w!==w||minimapState.h!==h)){
  renderer.drawMinimap($('#minimap'));minimapAt=now;lastRevision=game.revision;
  minimapState={game,revision:game.revision,layers:mapLayers,x:camera.x,y:camera.y,height:camera.height,zoom:camera.zoom,w,h};
 }
 // No world state changes while paused: avoid rescanning millions of tiles to
 // rewrite the same autosave. Explicit saves and page-leave saves still run.
 // Captures block whole world commits, so every committed day phase is safe.
 if(now-saveAt>20000&&!saveDialogController){if(savedWorld!==worldSerial||savedDay!==game.day||savedRevision!==game.revision)persist();else saveAt=now;}
 if(now-panelAt>7000&&!$('.sidebar').inert&&(view==='industry'||view==='towns')&&(panelDay!==game.day||panelRevision!==game.revision)){
  if(!$('#entity-list')?.contains(document.activeElement)&&!panelPress&&now-panelReleasedAt>250)refreshEntities();panelAt=now;panelDay=game.day;panelRevision=game.revision;
 }
 // Vehicle presentation advances at 30 Hz; world state commits at 1 Hz. Map input,
 // camera glides, Follow and floating income retain the display's full cadence.
 // Idle housekeeping still services autosaves, notices and timed highlights.
 const animated=moving||floaters.length||pointer||follow&&speed>0||now<interactionUntil;
 const delay=animated?0:isRoutePicking()&&!reducedMotion()?1000/20:speed>0?1000/30:headlineCurrent&&!headlineHeld&&headlineVisible?100:250;
 const expires=[highlight.until,refShown.until].filter(time=>Number.isFinite(time)&&time>now);
 frameScheduler.schedule(Math.min(delay,...expires.map(time=>time-now+1)),now);
}
frameScheduler=createFrameScheduler(frame);
// The scheduled callback runs after the event's handlers have updated the view.
const wakeFromInput=()=>{interactionUntil=performance.now()+180;wakeFrame();};
for(const type of ['pointerdown','pointermove','pointerup','pointercancel','pointerover','pointerout','keydown','keyup','focusin','focusout','input','change','click','close','toggle'])document.addEventListener(type,wakeFromInput,{capture:true,passive:true});
frameScheduler.wake();
// Explicit diagnostic surface for deterministic browser regression checks; no internal state duplicated.
window.transport={get game(){return game;},get renderer(){return renderer;},get speed(){return speed;},simulation,setSpeed:changeSpeed,setTool,setView,inspect,persist};
Object.defineProperty(window.transport,'headline',{get(){return headlineCurrent?.entry.key||null;},enumerable:true});
