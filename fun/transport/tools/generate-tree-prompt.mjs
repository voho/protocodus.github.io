import { writeFile } from 'node:fs/promises';
import { SPRITE_SCALE } from '../sprite-art-direction.js';
import { TREE_ART_SCALE, CACTUS_ART_SCALE, HOLLOW_TREE_ART, CACTUS_ART, treeArtSheet, treeGenerationPrompt, hollowTreeGenerationPrompt, cactusGenerationPrompt } from '../tree-art-catalog.js';

const [biome, sheetValue, destination] = process.argv.slice(2);
const sheet = ['hollow','cacti'].includes(sheetValue) ? sheetValue : Number(sheetValue);
if (!destination) throw new Error('Usage: node tools/generate-tree-prompt.mjs <taiga|tundra|desert> <1|2|hollow|cacti> <output.json>');
if (sheet==='hollow'&&biome!=='tundra'||sheet==='cacti'&&biome!=='desert') throw new Error('Hollow trees belong to tundra; cacti belong to desert.');
const job = {
  biome, sheet, columns:3, rows:sheet==='hollow'?1:3,
  entries:sheet==='hollow'?HOLLOW_TREE_ART:sheet==='cacti'?CACTUS_ART:treeArtSheet(biome,sheet),
  scale:SPRITE_SCALE, artScale:sheet==='cacti'?CACTUS_ART_SCALE:TREE_ART_SCALE,
  prompt:sheet==='hollow'?hollowTreeGenerationPrompt():sheet==='cacti'?cactusGenerationPrompt():treeGenerationPrompt(biome,sheet), transparent_background:true,
};
await writeFile(destination,JSON.stringify(job,null,2)+'\n');
