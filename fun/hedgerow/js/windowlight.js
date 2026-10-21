/* Hedgerow — the light falling out of the lit windows.

   Every lit pane (rooms.js) has a lamp in the room behind it; its light
   leaves the house only through the pane, and lands on the wet street, a
   cart, the house across the way in the shape of the window, its glazing
   bars across it. Each pane gets a frustum in front of it round that light,
   out to ~5 m (one instanced draw, its back faces, so every pixel it covers
   is shaded once even with the eye inside it), drawn with the late
   particles (effects.js), where the
   scene's depth is at hand: each pixel's surface is rebuilt from the depth,
   and lit if the line from the lamp to it passes through the pane (so the
   patch has the window's shape, its glazing bars across it, soft at its
   edges the further it falls), as by a glowing window: by the inverse
   square of its distance from the pane, how squarely the pane faces it and
   how squarely it faces the pane (its normal from the rebuilt surface,
   from the neighbours on the same surface so thin things do not speckle).
   Added to the frame (an average albedo folded in); the rifle in your
   hands takes less of it. Nothing behind the pane's own wall is touched. */

import * as THREE from 'three';

const DEPTH = 5.5, BACK = 1.4;   // how far out the light reaches; how far behind the pane the lamp is

/* The lit panes of the rooms meshes under `root`, in world space. */
export function collectPanes(root) {
  const out = [], seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh || !o.material?.userData?.rooms) return;
    o.updateMatrixWorld();
    const P = o.geometry.attributes.position, N = o.geometry.attributes.normal, A = o.geometry.attributes.aWin;
    const e = o.matrixWorld.elements;
    for (let i = 0; i < A.count; i += 3) {
      const hw = A.getZ(i);
      if (hw === 0) continue;                          // a curtain
      const nx0 = N.getX(i), nz0 = N.getZ(i);
      // in world space (the static batches are; anything else through its matrix)
      const nx = e[0] * nx0 + e[8] * nz0, nz = e[2] * nx0 + e[10] * nz0, nl = Math.hypot(nx, nz) || 1;
      const n = [nx / nl, nz / nl], t = [n[1], -n[0]];
      const x0 = P.getX(i), y0 = P.getY(i), z0 = P.getZ(i);
      const wx = e[0] * x0 + e[4] * y0 + e[8] * z0 + e[12], wy = e[1] * x0 + e[5] * y0 + e[9] * z0 + e[13], wz = e[2] * x0 + e[6] * y0 + e[10] * z0 + e[14];
      const s = A.getX(i), u = A.getY(i), hh = A.getW(i) % 16;
      const c = [wx - t[0] * s, wy - u, wz - t[1] * s];
      const key = c.map((v) => Math.round(v * 20)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ c, n, hw, hh });
    }
  });
  return out;
}

const VERT = /* glsl */ `
attribute vec4 aPane;          // the pane's centre, its half width
attribute vec3 aPane2;         // its outward normal (x, z), half height
varying vec4 vPane;
varying vec3 vPane2;
void main() {
  vec3 c = aPane.xyz;
  vec3 n = vec3(aPane2.x, 0.0, aPane2.y), t = vec3(n.z, 0.0, -n.x);
  float hw = aPane.w, hh = aPane2.z;
  // the lamp's light through the pane spreads as it goes: a frustum round it (with a margin for
  // the soft edges), from where it starts to light things to where it has faded
  float d = mix(0.38, ${DEPTH.toFixed(1)}, (position.z + 1.0) * 0.5);
  float k = (${BACK.toFixed(1)} + d) / ${BACK.toFixed(1)};
  float m = 0.12 + 0.06 * d;
  vec3 p = c + t * position.x * (hw * k + m) + vec3(0.0, 0.2 * (1.0 - k) + position.y * (hh * k + m), 0.0) + n * d;
  vPane = aPane;
  vPane2 = aPane2;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uScreen;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uColor;
uniform float uPower;
varying vec4 vPane;
varying vec3 vPane2;
vec3 viewPos(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  // the surface this pixel shows
  vec2 uv = gl_FragCoord.xy * uScreen;
  float z = texture2D(tDepth, uv).x;
  if (z >= 1.0) discard;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  vec3 V = v.xyz / v.w;
  vec3 P = (uCamWorld * vec4(V, 1.0)).xyz;
  vec3 c = vPane.xyz, n = vec3(vPane2.x, 0.0, vPane2.y), t = vec3(n.z, 0.0, -n.x);
  float out_ = dot(P - c, n);
  // not the window's own frame, reveal, sill or display (it starts half a metre or so out)
  if (out_ < 0.4 || out_ > ${DEPTH.toFixed(1)}) discard;
  // the line from the lamp to it, where it crosses the pane
  vec3 L = c - n * ${BACK.toFixed(1)} + vec3(0.0, 0.2, 0.0);
  vec3 lp = P - L;
  vec3 H = L + lp * (dot(c - L, n) / dot(lp, n));
  vec2 q = vec2(dot(H - c, t), H.y - c.y);
  float hw = vPane.w, hh = vPane2.z;
  // soft at the patch's edges, the softer the further it falls (the room is a big lamp)
  float soft = 0.015 + 0.02 * out_;
  float lit = (1.0 - smoothstep(hw - soft, hw + soft, abs(q.x))) * (1.0 - smoothstep(hh - soft, hh + soft, abs(q.y)));
  if (lit <= 0.0) discard;
  // the glazing bars across it: a post down the middle (two more in a wide shop window), two rails
  float bx = hw > 0.9 ? min(abs(q.x), abs(abs(q.x) - hw * 0.62)) : abs(q.x);
  lit *= mix(1.0, smoothstep(0.02, 0.02 + soft * 2.0, bx), 0.85);
  if (hh > 0.35) lit *= mix(1.0, smoothstep(0.015, 0.015 + soft * 2.0, abs(abs(q.y) - hh / 3.0)), 0.7);
  // as from a glowing window: the inverse square of the distance from it, how squarely the pane
  // faces this surface and the surface the pane (its normal rebuilt from the depth, from the
  // neighbours on the same surface: the nearer in depth of each pair, so edges stay clean)
  vec3 r = viewPos(uv + vec2(uScreen.x, 0.0)), l = viewPos(uv - vec2(uScreen.x, 0.0));
  vec3 t_ = viewPos(uv + vec2(0.0, uScreen.y)), b_ = viewPos(uv - vec2(0.0, uScreen.y));
  vec3 dx = abs(r.z - V.z) < abs(l.z - V.z) ? r - V : V - l;
  vec3 dy = abs(t_.z - V.z) < abs(b_.z - V.z) ? t_ - V : V - b_;
  vec3 sn = normalize(mat3(uCamWorld) * cross(dx, dy));
  if (dot(sn, cameraPosition - P) < 0.0) sn = -sn;
  vec3 hp = P - H;
  float r2 = dot(hp, hp);
  vec3 hd = hp * inversesqrt(r2);
  // something a pixel thin (a blade of grass, a chair leg) has no neighbour on its own surface:
  // take it as facing the window
  float tol = 0.03 + 0.02 * -V.z;
  if (min(abs(r.z - V.z), abs(l.z - V.z)) > tol || min(abs(t_.z - V.z), abs(b_.z - V.z)) > tol) sn = -hd;
  // (the window is a big soft source, and a rebuilt normal can be wrong on small things: wrapped)
  float e = uPower * hw * hh * max(dot(hd, n), 0.0) * (0.35 + 0.65 * max(dot(sn, -hd), 0.0)) / (r2 + hw * hh * 4.0);
  e *= smoothstep(0.4, 0.9, out_) * (1.0 - smoothstep(${(DEPTH * 0.6).toFixed(1)}, ${DEPTH.toFixed(1)}, out_));
  // the rifle in your hands (nearer than 1.2 m) less
  e *= -V.z < 1.2 ? 0.35 : 1.0;
  gl_FragColor = vec4(uColor * e * lit, 1.0);
}`;

export function createWindowLight(panes, { power = 20, color = '#ffa860' } = {}) {
  if (!panes.length) return null;
  const box = new THREE.BoxGeometry(2, 2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = box.index;
  geo.setAttribute('position', box.attributes.position);
  const a = new Float32Array(panes.length * 4), b = new Float32Array(panes.length * 3);
  panes.forEach((p, i) => { a.set([p.c[0], p.c[1], p.c[2], p.hw], i * 4); b.set([p.n[0], p.n[1], p.hh], i * 3); });
  geo.setAttribute('aPane', new THREE.InstancedBufferAttribute(a, 4));
  geo.setAttribute('aPane2', new THREE.InstancedBufferAttribute(b, 3));
  geo.instanceCount = panes.length;
  const uniforms = {
    tDepth: { value: null }, uScreen: { value: new THREE.Vector2(1, 1) },
    uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    // the room lamps' light, as it lands (an average albedo of what it lands on folded in)
    uColor: { value: new THREE.Color(color).multiplyScalar(0.12) }, uPower: { value: power },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'windowlight';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return {
    mesh, uniforms,
    /* drawn in the late pass (it needs the depth: depth = {tDepth, uScreen} uniforms that pass keeps); not without it */
    drawLate(lateScene, depth = null) {
      if (lateScene && depth) {
        lateScene.add(mesh);
        uniforms.tDepth = depth.tDepth; uniforms.uScreen = depth.uScreen;
        mesh.visible = true;
      } else {
        mesh.removeFromParent();
        mesh.visible = false;
      }
      mat.needsUpdate = true;
    },
    update(camera) {
      uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      uniforms.uCamWorld.value.copy(camera.matrixWorld);
    },
  };
}
