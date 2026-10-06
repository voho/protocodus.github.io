#!/usr/bin/env node
// A job is {entries:[{id,footprint,name,description}|null,...], columns, rows,
// biome, direction}. All asset families inherit the same shared instructions.
import { readFile, writeFile } from 'node:fs/promises';
import { buildingGenerationPrompt, SPRITE_SCALE } from '../sprite-art-direction.js';
const [manifest, output] = process.argv.slice(2);
if (!manifest) throw new Error('Usage: node tools/generate-building-prompt.mjs job.json [prompt.json]');
const job = JSON.parse(await readFile(manifest, 'utf8'));
const result = { scale:SPRITE_SCALE, job, prompt:buildingGenerationPrompt(job), transparent_background:true };
if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n');
else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
