/* Hedgerow — the rain's response belongs to the surface, not the prop.

   A wet sandbag keeps the diffuse, fibrous finish of hessian; painted steel
   sheds the water as a sheen. Baked glTF materials carry one name for an
   entire prop, so these conservative profiles leave their authored maps in
   charge and only limit the extra weather applied by materials.js. */

const MASONRY = /^(stone|plaster|brick|concrete|cobble|rock|barn|house|church|bridge_stone|bunker|wall_|grave|cross|fountain|steps_stone|water_trough|well|ruin|rubble|outcrop|boulder)/;
const FIBRE = /^(cloth|webbing|canvas|sandbag|hay|thatch|camo_net|tent|stretcher|medkit)/;
const WOOD = /^(wood|deadwood|barrel_wood|bench|fence|gate|cart|crate|ammo_box|ammo_stack|duckboard|dugout|trench_wall|sentry_box|watchtower|shed|furniture|pole|signpost|poster_board|cable_reel|log|stump)/;
const PAINT = /^(paint|metal_olive|metal_gray|metal_dark|helmet|dropped_helmet|truck|halftrack|jeep|kubelwagen|motorcycle|jerrycan|barrel|drum_stack|pak40|flak38|mg42_tripod|field_telephone|radio_table)/;
const BARK = /^(bark|oak|pine|beech|birch|fir|tree_dead)/;
const GUN = /^(gun_|m1_garand|thompson|kar98k|mp40|mg42|grenade)/;

export function surfaceResponse(name = '') {
  if (FIBRE.test(name)) return { sheen: 0.28, floor: 0.74, porosity: 1, masonry: false, rivulets: false };
  if (BARK.test(name)) return { sheen: 0.55, floor: 0.6, porosity: 0.9, masonry: false };
  if (WOOD.test(name)) return { sheen: 0.7, floor: 0.5, porosity: 0.9, masonry: false };
  if (MASONRY.test(name)) return { sheen: 0.72, floor: 0.49, porosity: 0.85, masonry: true };
  if (GUN.test(name)) return { sheen: 0.8, floor: 0.24, porosity: 0.25, masonry: false };
  if (PAINT.test(name)) return { sheen: 1, floor: 0.24, porosity: 0.3, masonry: false };
  return { sheen: 1, floor: 0, porosity: 0.75, masonry: false };
}
