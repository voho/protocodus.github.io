/* THE RIDER'S OWN SHADOW.

   The sun's shadow map covers 360 metres of mountain and is redrawn at
   30 Hz, which is the right trade for a forest: the trees do not move, and
   the pass that draws them costs about three quarters of a frame. It was the
   wrong one for the rider, who was in it too. Between redraws the rider's
   shadow stayed where the rider had been, so at 60 frames a second it fell
   half a metre behind on every other frame at speed (measured against an
   every-frame redraw: a streak the length of the shadow on the stale frame,
   nothing on the fresh one), and at 144 it was stale four frames in five.
   And at 8.8 cm a texel the board was three or four texels wide, in the one
   shadow a player looks at continuously.

   So the rider casts here instead, into a map of their own: a three-metre
   box from the sun centred on the chest, redrawn every frame, at six
   millimetres a texel. It is only the rider, so it costs a few thousand
   triangles of depth. The receivers read it in the shared shading's shade
   patch, beside the mountain's own shadow (see FRAG_SHADE in shading.js),
   and take it off the direct light the way the sun's map does; the rider
   still receives the forest's shadow from the sun's map. The level is the
   sun map's own, so the two fade out together at dusk and in a storm.

   The matrix is built relative to the camera, and the shader feeds it the
   fragment's offset from the camera, so nothing on either side ever forms a
   world coordinate twenty-six kilometres down the run in single
   precision. */

export const RIDER_SHADOW_SIZE = 512;
const SIZE = RIDER_SHADOW_SIZE;
const HALF = 1.6;     // metres either side of the chest the box reaches
const BACK = 30;      // how far up the sun the lens of the box stands
const FAR = 90;       // and how far past it a receiver can still be shadowed
// Its own layer, so the pass draws the rider and nothing else.
export const RIDER_SHADOW_LAYER = 3;

export function createRiderShadow(THREE, renderer, shading) {
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
  target.depthTexture = new THREE.DepthTexture(SIZE, SIZE);
  const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.1, FAR);
  camera.layers.set(RIDER_SHADOW_LAYER);
  const depth = new THREE.MeshDepthMaterial();

  const u = shading.uniforms;
  u.uRiderShadowMap.value = target.depthTexture;

  const focus = new THREE.Vector3();
  const chest = new THREE.Vector3(0, 0.9, 0);
  const up = new THREE.Vector3();
  const toCamera = new THREE.Matrix4();
  const hidden = [];
  // NDC to texture space, as three builds its own shadow matrices
  const bias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  );

  /* Once a frame, after the rider is posed and the camera has moved, and
     before the frame is drawn. `root` is the rider model's root: where the
     rider is drawn, which between physics steps is not where the physics has
     them, and turned however the rider is turned. The box is centred on the
     chest in that turned frame, because a flip carries the chest round the
     board: centred 0.9 m straight up from the board, the box missed an
     inverted rider by nearly two metres. `level` is how much the sun's
     shadow is worth right now; at zero the pass is skipped and the receivers
     ignore it. */
  function update(scene, root, view, level, lights = null) {
    u.uRiderShadowLevel.value = level;
    if (level <= 0.001) return;

    const sun = u.uSunDir.value;
    focus.copy(chest).applyQuaternion(root.quaternion).add(root.position);
    camera.position.copy(focus).addScaledVector(sun, BACK);
    // Any up that is not the sun itself; world up unless the sun is overhead
    up.set(0, 1, 0);
    if (Math.abs(sun.y) > 0.99) up.set(0, 0, 1);
    camera.up.copy(up);
    camera.lookAt(focus);
    camera.updateMatrixWorld();

    // The sun's map is not this pass's business: hold its refresh back, or
    // drawing here would spend a redraw meant for the frame itself.
    const autoUpdate = renderer.shadowMap.autoUpdate;
    const needsUpdate = renderer.shadowMap.needsUpdate;
    const autoClear = renderer.autoClear;
    const previous = renderer.getRenderTarget();
    /* Only the rider is drawn here, so only the rider's matrices have to be
       current, and non-rider branches stay hidden so Three does not walk
       every terrain/forest/backdrop object to test layer membership. Keep
       `lights` visible so WebGLLights state matches the main pass. */
    const autoWorld = scene.matrixWorldAutoUpdate;
    root.updateMatrixWorld();
    let branch = root;
    while (branch && branch.parent !== scene) branch = branch.parent;
    let lightsBranch = lights;
    while (lightsBranch && lightsBranch.parent !== scene) lightsBranch = lightsBranch.parent;
    const children = scene.children;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.visible && c !== branch && c !== lightsBranch && !c.isLight) {
        c.visible = false;
        hidden.push(c);
      }
    }
    scene.matrixWorldAutoUpdate = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.autoClear = false;
    scene.overrideMaterial = depth;
    renderer.setRenderTarget(target);
    renderer.clear(false, true, false);
    try {
      renderer.render(scene, camera);
    } finally {
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      hidden.length = 0;
      scene.overrideMaterial = null;
      scene.matrixWorldAutoUpdate = autoWorld;
      renderer.setRenderTarget(previous);
      renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.shadowMap.needsUpdate = needsUpdate;
    }

    // World offsets from the main camera in, box texture space out
    toCamera.makeTranslation(view.matrixWorld.elements[12],
      view.matrixWorld.elements[13], view.matrixWorld.elements[14]);
    u.uRiderShadowMatrix.value.copy(bias)
      .multiply(camera.projectionMatrix)
      .multiply(camera.matrixWorldInverse)
      .multiply(toCamera);
  }

  return { update, target, camera };
}
