import { SPRITE_SCALE } from './sprite-art-direction.js';

// Visual identities only: saved terrain and the published world recipes do not
// depend on this collection. Every climate retains its original nine slots.
const original = {
  taiga: ['pine','spruce','fir','birch','oak','aspen','deadwood','bare-birch','sapling'],
  tundra: ['pine','larch','dwarf-birch','dwarf-pine','deadwood','bare-birch','sapling','ice-pine','willow-tree'],
  desert: ['palm','acacia','joshua','tamarisk','deadwood','small-palm','bare-acacia','small-joshua','succulent-tree'],
};
const entries = {
  taiga: [
    ['scots-pine',16,'Open orange upper trunk and an irregular umbrella of dark needle cushions.'],
    ['lodgepole-pine',16,'Slender straight trunk with a narrow uneven column of dark needles.'],
    ['blue-spruce',16,'Broad blue-grey conical crown with softly drooping large branches.'],
    ['silver-fir',16,'Deep green full conical crown with broad level boughs and a pale trunk.'],
    ['western-redcedar',16,'Warm brown trunk and a loose broad pyramid of hanging flat green fans.'],
    ['juniper-tree',10,'Twisted warm grey trunk with compact blue-green irregular cloud crowns.'],
    ['hemlock',16,'Airy dark evergreen with long descending boughs and a gently bent leader.'],
    ['linden',15,'Rounded heart-shaped soft olive crown, clear low fork and warm pale trunk.'],
    ['beech',15,'Wide domed darker green crown with smooth silver-grey trunk and strong low limbs.'],
    ['hornbeam',14,'Upright oval rich green crown, muscular grey forked trunk.'],
    ['elm',16,'Distinctive tall vase-shaped crown spreading from two visible grey limbs.'],
    ['sycamore-maple',15,'Broad irregular green canopy with separated large rounded foliage masses.'],
    ['red-maple',14,'Rounded muted copper-red autumn crown, restrained large leaf masses.'],
    ['horse-chestnut',14,'Heavy wide dark green dome on a stout divided brown trunk.'],
    ['rowan',10,'Slender pale trunk, loose upright green crown with a few broad muted rust fruit patches.'],
    ['alder',13,'Open oval deep green crown and multiple dark warm trunks.'],
    ['willow',14,'Wide softly drooping sage canopy with clearly hanging large foliage curtains.'],
    ['poplar',16,'Very narrow upright silvery green column above a straight pale trunk.'],
  ],
  tundra: [
    ['black-spruce',13,'Narrow irregular dark blue-green spire with separated snowy branch ledges.'],
    ['white-spruce',15,'Full cool sage-green conical crown with restrained ivory snow on upper boughs.'],
    ['mountain-hemlock',13,'Asymmetric drooping blue-green evergreen, crooked leader and light snow.'],
    ['subalpine-fir',15,'Slim dense pointed dark green crown with broad pale snow bands.'],
    ['siberian-larch',14,'Open golden olive conical crown, clear horizontal branches and cool bark.'],
    ['tamarack',13,'Airy narrow muted bronze-green needle crown on a tall exposed brown trunk.'],
    ['northern-lodgepole-pine',14,'Thin upright rugged pine with a small narrow crown and snowy branch forks.'],
    ['limber-pine',12,'Crooked open grey trunk, spreading dark needle cushions and a bent leader.'],
    ['bristlecone-pine',10,'Sculptural twisted pale ancient trunk, sparse separated dark foliage cushions.'],
    ['arctic-birch',7,'Low many-stemmed silver trunk with a spreading rounded sage crown.'],
    ['mountain-birch',10,'Bent pale trunks and a broad windswept yellow-green crown with light snow.'],
    ['silver-birch',14,'Tall white trunk with a loose light silvery green crown and open lower branches.'],
    ['grey-alder',11,'Compact cool green oval crown above several silver-grey trunks.'],
    ['green-alder',8,'Low wide dark green lobed crown on visibly branching warm grey stems.'],
    ['balsam-poplar',14,'Upright broad oval blue-green crown on a straight dark trunk.'],
    ['quaking-aspen',13,'Slender pale trunk and a rounded muted golden crown with large leaf masses.'],
    ['feltleaf-willow',8,'Low spreading silvery sage crown above an open forked cool brown trunk.'],
    ['goat-willow',10,'Broad rounded grey-green crown on a stout branching pale trunk, sparse snow.'],
  ],
  desert: [
    ['date-palm',15,'Tall warm ringed trunk and long arching dark olive palm fronds.'],
    ['fan-palm',13,'Straight trunk with a dense circular crown of broad sage fan-shaped fronds.'],
    ['doum-palm',12,'Distinctive Y-shaped branching palm trunk with two broad muted green fan crowns.'],
    ['dragon-tree',11,'Thick smooth grey trunk branching into umbrella-like blue-green sword-leaf tufts.'],
    ['baobab',14,'Very stout warm grey bottle-shaped trunk, thick high arms and compact green crown.'],
    ['quiver-tree',9,'Pale golden branching succulent trunk with large blue-green star-shaped leaf tufts.'],
    ['umbrella-thorn',13,'Flat wide olive umbrella canopy above a thin warm brown forked trunk.'],
    ['mesquite',10,'Crooked dark trunk and a low airy broad dusty olive crown.'],
    ['palo-verde',10,'Clearly green branching trunk and open yellow-green airy rounded crown.'],
    ['desert-willow',9,'Slender warm grey forked trunk, loose pale green crown with a few broad muted mauve patches.'],
    ['olive-tree',10,'Gnarled thick grey trunk with separated rounded silvery green crown masses.'],
    ['carob',11,'Dense broad dark olive dome above a short stout branching brown trunk.'],
    ['argan',10,'Low wide irregular muted green crown and sculptural split dark trunk.'],
    ['mopane',12,'Upright dense warm olive crown on a clear reddish grey forked trunk.'],
    ['marula',13,'Broad rounded soft sage canopy on a smooth pale grey stout trunk.'],
    ['bottle-tree',12,'Distinctively swollen pale green-grey trunk with a small rounded olive canopy.'],
    ['euphorbia-tree',9,'Sculptural succulent candelabra of thick muted green upright branched stems.'],
    ['desert-cypress',14,'Tall slender blue-green pointed column on a short exposed warm grey trunk.'],
  ],
};
const freezeLists = lists => Object.freeze(Object.fromEntries(Object.entries(lists).map(([biome,list])=>[biome,Object.freeze([...list])])));
export const ORIGINAL_TREE_KINDS = freezeLists(original);
// Woodland sprites are copied 1:1 into world space; only building uprights
// receive the renderer's 1.5x enlargement. Express accepted tree sizes in the
// same world metres as buildings without changing their artwork dimensions.
const woodlandMetres = authoredHeight => authoredHeight / 1.5;
const metreLabel = metres => Number(metres.toFixed(2));
export const EXTRA_TREE_ART = Object.freeze(Object.fromEntries(Object.entries(entries).map(([biome,list])=>[biome,Object.freeze(list.map(([id,height,description])=>Object.freeze({id,heightMetres:woodlandMetres(height),description})))])));
export const HOLLOW_TREE_ART = Object.freeze([
  Object.freeze({id:'hollow-birch',heightMetres:woodlandMetres(11),description:'Standing old white birch with a clearly visible broad dark trunk hollow, broken upper limbs, sparse muted sage foliage and a little snow. Keep the opening a large simple dark shape.'}),
  Object.freeze({id:'hollow-larch',heightMetres:woodlandMetres(12),description:'Weathered standing grey-brown larch with a broad open dark cavity in the lower trunk, broken high fork, sparse large olive needle cushions and restrained snow.'}),
  Object.freeze({id:'hollow-spruce',heightMetres:woodlandMetres(13),description:'Old standing dark spruce with a broad visible split hollow trunk, a broken leader, sparse blue-green boughs and snow on large branch ledges.'}),
]);
export const CACTUS_ART = Object.freeze([
  ['saguaro',6,'Tall ridged green column with two unmistakable raised bent arms.'],
  ['organ-pipe-cactus',5,'Several tall parallel olive-green cylindrical stems rising together from one root clump.'],
  ['cardon',7,'Massive branching blue-green columnar cactus with thick widely spaced upright arms.'],
  ['senita',4,'A small group of slender muted green columns with soft pale caps on their upper ends.'],
  ['candelabra-cactus',5,'Distinctive many-armed sage candelabra of thick vertical columns on a central green stem.'],
  ['tree-cholla',3,'Open woody brown trunk and a loose branching crown of chunky dusty green cylindrical segments.'],
  ['golden-barrel-cactus',1.5,'One broad squat spherical green barrel with large golden rib bands, no individual tiny spines.'],
  ['fishhook-barrel-cactus',2,'Upright oval blue-green barrel with broad pale ribs and a muted rust cap.'],
  ['hedgehog-cactus',1,'Small irregular clump of three broad short ribbed green columns with one large muted magenta flower mass.'],
].map(([id,height,description])=>Object.freeze({id,heightMetres:woodlandMetres(height),description})));
export const TREE_KINDS = freezeLists(Object.fromEntries(Object.keys(original).map(biome=>[biome,[...original[biome],...entries[biome].map(([id])=>id),...(biome==='tundra'?HOLLOW_TREE_ART.map(tree=>tree.id):[])]])));
export const TREE_ART_SCALE = Object.freeze({ nominalSpriteSize:22, cellSizeMultiplier:1.18, masterCellPixels:256, rootAnchor:0.955, nominalReferenceHeightMetres:woodlandMetres(17.6) });
export const CACTUS_ART_SCALE = Object.freeze({nominalSpriteSize:16,masterCellPixels:256,rootAnchor:0.955});
export function treeMasterPixels(metres) {
  return metres*SPRITE_SCALE.worldPixelsPerMetre*TREE_ART_SCALE.masterCellPixels/(TREE_ART_SCALE.nominalSpriteSize*TREE_ART_SCALE.cellSizeMultiplier);
}
export function treeArtSheet(biome,number) {
  if (!EXTRA_TREE_ART[biome] || ![1,2].includes(number)) throw new Error('Tree sheet requires a supported climate and sheet 1 or 2.');
  return EXTRA_TREE_ART[biome].slice((number-1)*9,number*9);
}
export function hollowTreeGenerationPrompt() {
  return treeGenerationPrompt('tundra',1).split('\n').slice(0,-9).join('\n')
    .replace('exactly NINE different isolated individual trees','exactly THREE different isolated individual hollow trees')
    .replace('transparent3x3 equal-cell sprite atlas','transparent3x1 equal-cell sprite atlas')
    + '\n' + HOLLOW_TREE_ART.map((tree,i)=>`Slot ${i+1}: ${tree.id}, ${metreLabel(tree.heightMetres)}m tall, ${treeMasterPixels(tree.heightMetres).toFixed(1)}px vertical tree height in the normalized256px cell. ${tree.description}`).join('\n');
}
export function cactusGenerationPrompt() {
  const pixelsPerMetre=SPRITE_SCALE.worldPixelsPerMetre*CACTUS_ART_SCALE.masterCellPixels/CACTUS_ART_SCALE.nominalSpriteSize;
  return [
    'Production asset: exactly NINE distinct isolated individual desert cactus plants in a square transparent3x3 equal-cell sprite atlas, row-major order. References establish quiet painted style and camera only; do not copy their subjects.',
    'Fixed elevated orthographic2:1 dimetric camera, ground axes at+26.565/-26.565 degrees. See the elliptical TOPS of cactus columns and barrels and radial horizontal rosettes. Never a frontal botanical portrait. Northwest light, warm muted desert palette, blue-green/olive stems, broad sculptural botanical shapes. Entire plants and tiny contact shadows are visible.',
    `Shared game scale: tile${SPRITE_SCALE.tileMetres}m, adult${SPRITE_SCALE.humanHeightMetres}m, personnel door${SPRITE_SCALE.doorHeightMetres}m; do not draw these references. A normalized256px cell uses${pixelsPerMetre.toFixed(2)}px per vertical metre. Short barrel cacti remain much shorter than tall columnar species; never enlarge each silhouette to fill the cell.`,
    'Root anchor at95.5% cell height, horizontally centred. Each cactus has at least12% transparent side gutters and10% transparent top gutter. No cactus, root or tiny soft shadow crosses its cell boundary. Preserve large simple ribs, arm arrangements and trunk shapes; no individually drawn spines, fine scratches, tiny flower petals, stippling, labels or text.',
    'True transparent RGBA background, no sand disc, ground rectangle, backdrop, checkerboard, pots, labels, frame or UI. Exactly one whole individual or its naturally connected root clump per slot.',
    ...CACTUS_ART.map((plant,i)=>`Slot ${i+1}: ${plant.id}, ${metreLabel(plant.heightMetres)}m tall, ${(plant.heightMetres*pixelsPerMetre).toFixed(1)}px vertical plant height in the normalized256px cell. ${plant.description}`),
  ].join('\n');
}
export function treeGenerationPrompt(biome,number) {
  const climate={taiga:'Temperate and northern woodland: subdued olive, sage and deep green, warm grey and brown bark. No snow.',tundra:'Cold northern woodland: cool sage and blue-green, pale bark, restrained ivory snow on upper branches and at roots. Keep tree anatomy visible.',desert:'Dry woodland and oasis species: dusty olive, sage and blue-green, warm grey and ochre trunks. No ground sand disc or scenery.'}[biome];
  const slots=treeArtSheet(biome,number).map((tree,i)=>`Slot ${i+1}: ${tree.id}, ${metreLabel(tree.heightMetres)}m tall, ${treeMasterPixels(tree.heightMetres).toFixed(1)}px vertical tree height in the normalized256px cell. ${tree.description}`);
  return [
    'Production asset: exactly NINE different isolated individual trees in a transparent3x3 equal-cell sprite atlas, row-major order. The supplied game building artwork is STYLE ONLY: match palette, camera, shading and painterly material treatment, but do not copy any reference subjects or ground patches.',
    'Fixed elevated orthographic2:1 dimetric game camera; ground axes at+26.565/-26.565 degrees, no perspective convergence. Look down onto broad crown TOPS; nearer canopy lobes conceal inner trunk forks. Palm fronds and umbrella branches spread radially in the horizontal ground plane. Never a front-view tree portrait. Northwest daylight, restrained warm hand-painted miniature style. Complete crowns and root feet with a tiny soft contact shadow.',
    `Shared physical scale with game buildings: one ground tile is${SPRITE_SCALE.tileMetres}m square, an adult is${SPRITE_SCALE.humanHeightMetres}m and a door is${SPRITE_SCALE.doorHeightMetres}m. Do not draw people, doors or buildings. The normalized256px cell uses${treeMasterPixels(1).toFixed(2)}px per vertical metre. Tree heights vary naturally; do not enlarge shorter species to fill their cells.`,
    'Every exposed trunk ROOT FOOT meets the shared horizontal baseline at95.5% of its cell height, centred horizontally. The baseline is the actual trunk foot, never the bottom of scenery. NO GRASS, SOIL, SNOW DISC, ROCKS, GROUND MOUND OR BASE PLATFORM; only the tree and a tiny contact shadow below its root. Crown and all branches stay inside their own cell with generous transparent gutters. Keep side gutters at least12% of cell width and top gutters at least10%. Tiny contact shadows fade out before the cell bottom. No long baked directional shadow; the game supplies the projected ground shadow.',
    'Broad asymmetrical foliage masses and clear species silhouettes readable at Region and Town zoom. A few large boughs and trunk forks; no individual leaves, fine needle lines, stippling, scratches, tiny bark fissures, tiny fruit dots, lettering or botanical labels. Each requested species has distinct branch architecture and crown proportions.',
    'Genuine transparent RGBA background; no coloured backdrop, checkerboard, ground rectangle, floating plinth, pots, frame, labels or UI. Exactly one whole tree per cell; no forest groups.',
    climate,...slots,
  ].join('\n');
}
