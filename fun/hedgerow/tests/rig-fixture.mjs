// Real shipped geometry/animation without browser image decoding.
import './three-hooks.mjs';
import { readFileSync } from 'node:fs';
const { GLTFLoader } = await import('../assets/vendor/GLTFLoader.js');

const assets = new Map();
export function parseUntexturedGLB(name) {
  if (assets.has(name)) return assets.get(name);
  const buffer = readFileSync(new URL(`../assets/models/${name}.glb`, import.meta.url));
  const length = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + length).toString());
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials || []) {
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    json[key] = (json[key] || []).filter(extension => extension !== 'EXT_texture_webp');
    if (!json[key].length) delete json[key];
  }
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 0x20)]);
  const binary = buffer.subarray(20 + length), header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + encoded.length + binary.length, 8);
  header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const data = Buffer.concat([header, encoded, binary]);
  const promise = new Promise((resolve, reject) => new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '', resolve, reject));
  assets.set(name, promise);
  return promise;
}
