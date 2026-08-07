# MicroCraft — Realistic Visual Upgrade

A static, GitHub Pages-friendly voxel survival sandbox with a stronger 3D presentation.

## Visual upgrades

- PBR-style block materials with tuned roughness/metalness
- Procedural high-resolution block textures with subtle surface variation
- Dynamic ambient occlusion-style vertex shading for voxel depth
- Gradient sky dome with visible sun glow, moon glow, and stars
- Moving volumetric-looking cloud sprites with day/night tinting
- Dynamic grass billboards with wind sway near the player
- Animated reflective water with ripples and underwater depth fog
- Underwater color grading, caustic overlay, bubbles, and splash particles
- Mining debris, footstep dust, and environmental ambient motes/fireflies
- Pooled point lights for crystal/glowing blocks
- Head bob, sprint FOV kick, and landing/footstep feedback
- ACES tone mapping, soft shadows, and resolution-aware rendering

## Deployment

This project is static and can be deployed directly to **GitHub Pages**.

1. Upload/push the contents of this folder to your repository.
2. In GitHub, open **Settings → Pages**.
3. Select **Deploy from a branch**, choose your branch and `/ (root)` folder.
4. Open the generated Pages URL.

The game engine no longer downloads a separate MicroCraft engine file at runtime. The only external runtime dependency is the pinned Three.js build in `index.html`.

## Controls

- `W A S D` — move
- Mouse — look
- `Space` — jump
- `Shift` — sprint
- Left click — mine
- Right click — place
- `F` — attack
- `C` — crafting
- `P` — screenshot
