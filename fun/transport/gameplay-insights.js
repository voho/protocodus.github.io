import { INDUSTRIES, CARGO, TOWN_CARGO } from './data.js';
import { STATION_RADIUS } from './model.js';
import { findIndustryTargets } from './chains.js';

const nearby = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= STATION_RADIUS;
const joinCargo = keys => keys.map(key => CARGO[key].name.toLowerCase()).join(' + ');

// These explanations use the same catchment and storage rules as the simulation.
export function townService(game, city) {
  const stops = new Set(game.routes.filter(route => route.active).flatMap(route => route.stops));
  const connected = game.stations.some(stop => stops.has(stop.id) && nearby(stop, city));
  const served = connected && Number.isFinite(city.lastServiceDay) && game.day - city.lastServiceDay <= 30;
  return { connected, served, label: served ? 'Served recently' : connected ? 'Awaiting deliveries' : 'No service' };
}

export function industryStatus(industry) {
  const definition = INDUSTRIES[industry.kind], inventory = industry.inventory || {};
  const missing = Object.keys(definition.inputs).filter(key => !(inventory[key] > 0));
  if (missing.length) return { state: 'waiting', label: 'Needs ' + joinCargo(missing), missing, detail: 'Deliver every input to restart production.' };
  if (Object.keys(definition.outputs).some(key => (inventory[key] || 0) >= 900 * (industry.capacity || 1) - .001)) {
    return { state: 'full', label: 'Storage full', missing: [], detail: 'Carry output to a buyer to make room.' };
  }
  return { state: 'producing', label: 'Producing', missing: [], detail: 'Output depends on nearby nature, roads, workers and weather.' };
}

export function routeHealth(game, route) {
  if (!route.active) return { state: 'blocked', label: 'Disconnected', detail: 'Repair the connection between the two stops.' };
  const stops = route.stops.map(id => game.stations.find(stop => stop.id === id));
  if (stops.some(stop => !stop)) return { state: 'blocked', label: 'Missing stop', detail: 'This service needs both stops.' };
  if (route.cargo === 'passengers') {
    const towns = stops.map(stop => game.cities.filter(city => nearby(city, stop)));
    if (!towns[0].some(a => towns[1].some(b => a.id !== b.id))) return { state: 'blocked', label: 'No passengers', detail: 'Each stop must cover a different town.' };
    return { state: 'running', label: 'Running', detail: 'Passengers travel in both directions.' };
  }
  const sources = game.industries.filter(site => nearby(site, stops[0]) && INDUSTRIES[site.kind].outputs[route.cargo]);
  const buyers = game.industries.filter(site => nearby(site, stops[1]) && INDUSTRIES[site.kind].inputs[route.cargo]);
  const townBuyer = TOWN_CARGO.includes(route.cargo) && game.cities.some(city => nearby(city, stops[1]));
  if (!sources.length) return { state: 'blocked', label: 'No producer', detail: `Add a ${CARGO[route.cargo].name.toLowerCase()} producer within 5 tiles of the start.` };
  if (!buyers.length && !townBuyer) return { state: 'blocked', label: 'No buyer', detail: 'Add a buyer within 5 tiles of the end stop.' };
  if (!townBuyer && buyers.every(site => (site.inventory?.[route.cargo] || 0) >= 900 * (site.capacity || 1) - .001)) {
    return { state: 'waiting', label: 'Buyer full', detail: 'Supply its other inputs and carry away its output.' };
  }
  const loaded = game.vehicles.some(vehicle => vehicle.routeId === route.id && vehicle.load > 0);
  if (!loaded && !sources.some(site => (site.inventory?.[route.cargo] || 0) >= 1)) {
    const missing = [...new Set(sources.flatMap(site => industryStatus(site).missing))];
    return { state: 'waiting', label: missing.length ? 'Needs inputs' : 'Waiting for cargo', detail: missing.length ? 'Supply ' + joinCargo(missing) + ' to the producer.' : 'The producer is replenishing its stock. Extra vehicles will not help yet.' };
  }
  return { state: 'running', label: 'Running', detail: 'Freight loads at the start and returns for the next shipment.' };
}

export function nextProject(game) {
  const freight = game.routes.filter(route => route.cargo !== 'passengers');
  if (!freight.length) {
    const home = game.cities[0] || { x: game.width / 2, y: game.height / 2 };
    const choices = game.industries.filter(site => !Object.keys(INDUSTRIES[site.kind].inputs).length).flatMap(source =>
      findIndustryTargets(game, source, 5).map(target => {
        const buyer=target.kind==='industry'?game.industries.find(site=>site.id===target.id):null;
        const extraInputs=buyer?Math.max(0,Object.keys(INDUSTRIES[buyer.kind].inputs).length-1):0;
        return { source, target, score: target.distance + Math.hypot(source.x - home.x, source.y - home.y) * .8 + extraInputs * 40 };
      }));
    choices.sort((a, b) => a.score - b.score);
    const opportunity = choices[0];
    return { title: 'Your first cargo route', detail: opportunity ? `Carry ${joinCargo(opportunity.target.cargo)} from ${opportunity.source.name || INDUSTRIES[opportunity.source.kind].name}. Deliver to ${opportunity.target.name}; use stops within 5 tiles of both.` : 'Use Chains to choose a producer and a buyer.', action: opportunity ? 'source' : 'chains', target: opportunity?.source.id, button: opportunity ? 'Find cargo' : 'Explore chains' };
  }
  const delivered = freight.reduce((total, route) => total + route.delivered, 0);
  if (delivered < 100) return { title: 'First 100 cargo deliveries', detail: `${Math.floor(delivered)} / 100 delivered. Keep inputs supplied and your connections intact.`, action: 'routes', button: 'View services' };
  const processed = freight.some(route => route.delivered > 0 && game.industries.some(site => INDUSTRIES[site.kind].outputs[route.cargo] && Object.keys(INDUSTRIES[site.kind].inputs).length));
  if (!processed) return { title: 'Complete a production chain', detail: 'Your raw materials are moving. Carry factory output to its next buyer.', action: 'chains', button: 'Explore chains' };
  if (!game.zones.length) return { title: 'Grow a neighborhood', detail: 'Zone homes beside roads near a regularly served stop. Add shops and a school to help them flourish.', action: 'towns', button: 'Plan a neighborhood' };
  return { title: 'Build your own story', detail: 'Reach a new town, develop a riverside port, or supply a complex factory. There is no deadline.', action: 'atlas', button: 'Explore the region' };
}
