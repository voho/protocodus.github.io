/* A Czech resistance identification armband on captured field clothing.
   The field-grey rig supplies the body; the white cloth and small national
   flag identify the insurgent without inventing an American unit in Prague. */
import * as THREE from 'three';

function flagTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e4dfcf'; ctx.fillRect(0, 0, 128, 40);
  ctx.fillStyle = '#a1342b'; ctx.fillRect(0, 40, 128, 40);
  ctx.fillStyle = '#27435b'; ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(64, 40); ctx.lineTo(0, 80); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function attachResistanceIdentity(character, matlib, identity) {
  const arm = character.bones?.upperarm_l;
  if (identity !== 'czech-resistance' || !arm) return null;
  const group = new THREE.Group();
  group.name = 'czech_resistance_armband';
  // The imported arm bones run along local +Y from shoulder to elbow.
  group.position.y = 0.175;
  const cloth = matlib.get('canvas', { variant: 'resistance-armband', color: '#b9b5a7', roughness: 0.96 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.059, 0.075, 16, 1, true), cloth);
  band.name = 'white_armband';
  band.receiveShadow = true;
  const map = flagTexture();
  const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.061, 0.047, 12, 1, true, 0.25, 1.2),
    new THREE.MeshStandardMaterial({ map, roughness: 0.95, side: THREE.DoubleSide }));
  flag.name = 'czechoslovak_flag_patch'; flag.receiveShadow = true;
  group.add(band, flag); arm.add(group);
  let disposed = false;
  // Retire this kit's renderer-generation listeners while the context is
  // lost. Geometry attributes, the flag canvas and the mounted group stay
  // available for reupload; the shared cloth material belongs to matlib.
  function releaseGraphicsResources() {
    if (disposed) return;
    band.geometry.dispose(); flag.geometry.dispose();
    flag.material.dispose(); map.dispose();
  }
  return { group,
    releaseGraphicsResources,
    dispose() {
      if (disposed) return;
      releaseGraphicsResources();
      disposed = true;
      group.removeFromParent();
    },
  };
}
