"""Hedgerow — fill the colour under transparent texels of alpha-card atlases.

    python3 -I fun/hedgerow/tools/fix_card_alpha.py fun/hedgerow/assets/models/nature.glb [...]

Alpha-tested foliage samples mipmaps: where a texture's transparent texels
hold a colour unlike the leaves next to them (Blender leaves them light), the
averaged texels at a distance pick it up and grass and leaves turn pale.
This replaces the colour of every texel that is not fully opaque (the
transparent ones and the pale anti-aliased fringe) with a push-pull fill of
the opaque colours around it (alpha untouched), for every material with
alphaMode MASK/BLEND, and repacks the GLB (WebP, exact RGB under alpha).
Idempotent; deterministic.
"""
import io, json, struct, sys
import numpy as np
from PIL import Image


def push_pull(rgb, a):
    """Fill rgb where a is small with the alpha-weighted average of its
    neighbourhood at ever coarser scales."""
    levels = []
    c = rgb * a[..., None]
    w = a.copy()
    while min(w.shape) > 1:
        levels.append((c, w))
        h, wd = w.shape
        h2, w2 = h // 2 * 2, wd // 2 * 2
        c = c[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2, 3).sum((1, 3))
        w = w[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).sum((1, 3))
    fill = c / np.maximum(w, 1e-6)[..., None]
    for c_l, w_l in reversed(levels):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        up = np.pad(up, ((0, c_l.shape[0] - up.shape[0]), (0, c_l.shape[1] - up.shape[1]), (0, 0)), mode='edge')
        own = c_l / np.maximum(w_l, 1e-6)[..., None]
        k = np.clip(w_l, 0, 1)[..., None]
        fill = own * k + up * (1 - k)
    return fill


def fix_image(data):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    arr = np.asarray(im).astype(np.float32) / 255
    rgb, a = arr[..., :3], arr[..., 3]
    # only fully opaque texels are trusted: the anti-aliased fringe of a
    # leaf rendered over a light background is pale too, and alpha-tested
    # cards draw the fringe up to the cutoff
    solid = np.where(a > 0.95, 1.0, 0.0).astype(np.float32)
    filled = push_pull(rgb, solid)
    out = np.where((a > 0.95)[..., None], rgb, filled)
    res = np.dstack([out, a])
    buf = io.BytesIO()
    Image.fromarray((np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(buf, 'WEBP', quality=85, method=6, exact=True)
    return buf.getvalue()


def repack(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    bin_start = 20 + jl + 8
    bl = struct.unpack('<I', b[20 + jl:24 + jl])[0]
    binc = b[bin_start:bin_start + bl]
    views = [binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in j['bufferViews']]

    targets = set()
    for m in j['materials']:
        if m.get('alphaMode') not in ('MASK', 'BLEND'):
            continue
        t = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if not t:
            continue
        tex = j['textures'][t['index']]
        src = tex.get('source', tex.get('extensions', {}).get('EXT_texture_webp', {}).get('source'))
        if src is not None:
            targets.add(src)
    for src in sorted(targets):
        img = j['images'][src]
        vi = img['bufferView']
        before = len(views[vi])
        views[vi] = fix_image(views[vi])
        img['mimeType'] = 'image/webp'
        print(f'  {path.split("/")[-1]} image {src} ({img.get("name", "")}): {before // 1024} -> {len(views[vi]) // 1024} KB')

    # rebuild the binary chunk, 4-byte aligned views
    out = bytearray()
    for v, data in zip(j['bufferViews'], views):
        while len(out) % 4:
            out.append(0)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(data)
        out += data
    while len(out) % 4:
        out.append(0)
    j['buffers'][0]['byteLength'] = len(out)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942))
        f.write(out)
    return len(targets)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        n = repack(p)
        print(f'{p}: {n} card atlas(es) filled')
