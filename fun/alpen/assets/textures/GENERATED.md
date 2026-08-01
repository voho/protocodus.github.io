# Alpen generated texture sources

Generated with Codex's built-in image-generation tool on 2026-07-31, then
prepared locally for real-time WebGL use. The panorama edges were blended into
a continuous 360-degree wrap. Snow sources were made periodic and packed as:

- R: neutral albedo variation, centred at 0.5
- G: surface height, centred at 0.5
- B: crystalline-density mask
- A: reserved

## Source prompt set

The clear plate was generated before the runtime moved away from its original
low-poly direction; the shipped shader now relights and combines it with the
high-density scene rather than enforcing that prompt's geometry style.

### Clear Swiss Alps panorama

Production 360-degree equirectangular game skybox for a low-poly snowboarding
game: a continuous, distant Swiss Alpine range inspired by the Bernese
Oberland and Engadin; layered snow peaks and glacial bowls; restrained
hand-painted 3D environment style; crisp cold morning; level horizon; seamless
left/right join; no foreground, buildings, people, text, sun disc, or fantasy
elements.

### Storm Swiss Alps panorama

Edit the clear panorama by changing only weather and lighting to a readable
Swiss Alpine snow squall. Preserve projection, camera, horizon, every mountain
silhouette, and the seamless wrap for runtime crossfade. Use diffuse silver and
steel-blue overcast light, distant snowfall and ridge cloud; no lightning,
black clouds, new landmarks, text, or composition shift.

### Powder snow

Perfectly seamless square, top-down material texture of fresh high-Alpine
powder with neutral diffuse light, fine crystal grain, shallow wind-packed
microstructure, soft powder pockets and restrained glacier-blue variation. No
tracks, footprints, rocks, dirt, objects, shadows, border, text, or dominant
centre.

### Groomed snow

Edit the powder material into a perfectly seamless groomed Swiss-piste surface,
preserving snow colour, crystal scale, exposure and orthographic presentation.
Add uniform, shallow horizontal corduroy ribs with natural softening. No deep
trenches, tracks, moire, objects, dirt, borders, text, or directional light.
