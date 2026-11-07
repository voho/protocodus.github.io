# Game dev tools and asset sources

Checked 7 November 2026. Our games are static three.js pages under `fun/`, with
`GLTFLoader` vendored per game and no Draco, Meshopt or KTX2 decoders yet.
Anything that ships must have a license that allows commercial use; record the
source, license and credit of every third-party asset next to the game.

## Ready-made 3D models

| Source | What it is | Format | License | Use it when |
| --- | --- | --- | --- | --- |
| [Polyfork](https://polyfork.dev/) | 3,026 free low-poly props and characters (plus paid HD). About 150 to 3,000 triangles each. | `.mjs` module that returns a `THREE.Group`, or `.glb`; zips add FBX/OBJ/USDZ | Free meshes CC BY 4.0, commercial use allowed. Don't redistribute the `.mjs` source. | First stop for low-poly props. Download the GLB into the game's assets rather than hotlinking the CDN. Credit Polyfork. |
| [threejsassets.com](https://threejsassets.com/assets/free) | 1,042 free low-poly GLBs (48 to 240k triangles). | Draco-compressed GLB | Free for commercial use, no attribution; no reselling as a pack. Read the full license before shipping. | Polyfork lacks the model. Needs a free account (magic link), so the person must download; also needs `DRACOLoader` vendored. |
| [abo-glb](https://huggingface.co/datasets/codepawl/abo-glb) | 7,953 real furniture and home products (Amazon Berkeley Objects), metres, Y up, full PBR. About 43k triangles on average. | Meshopt GLB; KTX2 and LOD variants | CC BY 4.0; credit ABO and cite the paper | Realistic interiors. Take the `lods/` file, vendor `MeshoptDecoder`, and fetch single files rather than the 43 GB dataset. |
| [Scenario 3D collection](https://huggingface.co/datasets/scenario-labs/3d-collection) | 1,342 AI-generated image-to-3D examples, 40k to 150k faces, 4K PBR. | GLB, some FBX/PLY/SPZ/blend/vox | CC BY 4.0, credit Scenario. The 393 Hunyuan examples have their own licenses: skip them. | Hero props or references where one detailed model is worth decimating in Blender first. Too heavy to ship as is. |

## Generating and texturing assets

| Tool | What it does | Needs | License | Use it when |
| --- | --- | --- | --- | --- |
| [StableGen](https://github.com/sakalond/StableGen) | Blender add-on: textures meshes and scenes with diffusion models, generates meshes from a prompt or image (TRELLIS.2), rigs them, and rebuilds them as low poly. | Blender 4.2 to 4.5 or 5.1+, a ComfyUI server with a GPU | GPL-3.0 (the add-on; check each model's license for the outputs) | A game needs custom textured or rigged models that no library has. Runs on the person's machine, not in a cloud thread. |
| [IDOL](https://huggingface.co/speridlabs/idol) | Turns one image into a 3D Gaussian splat. | NVIDIA GPU with about 7 GB VRAM; gated FLUX.2 and DINOv3 weights | Apache-2.0 | Rarely. It outputs `.ply` splats, not meshes, so three.js needs a splat renderer. Only for a splat backdrop. |

## Building and testing games

| Tool | What it does | License | Use it when |
| --- | --- | --- | --- |
| [Genex](https://github.com/genex-games/genex-desktop) | Desktop app where agents build and playtest games in Unreal, Unity, Godot, Roblox or the browser, with a Blender plugin and Meshy/Tripo/ElevenLabs. | MIT | Not for this repo, which threads build directly. Worth a look for a game in a full engine. |
| [Aura Autopilot](https://github.com/ramenvr/autopilot) | Learning playtest agent with an MCP server for Claude Code. | Apache-2.0; needs an Aura account or API key | Only Unreal 5, Unity 6 and Godot 4. Our browser games use the Playwright tests under `tests/` and each game's own tests instead. |

## Style reference

| Source | What it is | License | Use it when |
| --- | --- | --- | --- |
| [Game Art Style](https://gameartstyle.loopyhop.com/) | Gallery of 37 named art styles with 104 game screenshots. | None: reference only | Picking or describing a game's look at design time. Never copy its images into a game. |
