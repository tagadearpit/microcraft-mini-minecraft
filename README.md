# MicroCraft — Mini Minecraft Showcase

A compact browser-based voxel survival game built with HTML, CSS, JavaScript, and Three.js. Designed to run from VS Code Live Server and deploy directly to GitHub Pages, Vercel, or Netlify.

## Gameplay features

- Procedural voxel terrain with grass, dirt, stone, sand, trees, water, and crystal ore
- Finite 64-block inventory stacks
- Hold-to-mine cracking stages, block particles, placement animation, and first-person hand motion
- Crafting recipes for wood planks, stone bricks, and glowing blocks
- Day/night cycle with moving sun and moon, stars, fog, changing sky colors, and hostile night slimes
- Slime combat, health, fall damage, death, and respawning
- Sprint stamina and water movement slowdown
- Five sequential challenges, score tracking, crystals, and local progress saving
- Live minimap with nearby enemy markers
- Screenshot export, world-seed copying, quality mode, and sound toggle
- Keyboard/mouse controls and touch controls for phones/tablets
- Installable PWA metadata and a service worker for cached repeat visits

## Run locally

1. Open the project folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html`.
4. Select **Open with Live Server**.
5. Click **Enter world**.

> Tip: Opening `index.html` directly with a `file://` URL is not recommended because browser module and service-worker security rules require a local HTTP server.

## Desktop controls

| Control | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Space | Jump |
| Shift | Sprint |
| Hold left click | Mine block |
| Right click | Place selected block |
| 1–8 / mouse wheel | Select hotbar slot |
| F | Attack targeted slime |
| C | Open crafting |
| P | Save screenshot |
| R | Respawn |
| Esc | Pause |

## Deploy to GitHub Pages

1. Create a new GitHub repository.
2. Upload all files from this folder to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)` folder.
6. Save and wait for the Pages URL.

The included `.nojekyll` file prevents GitHub Pages from applying Jekyll processing.

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Select **Other** as the framework preset if Vercel does not detect a framework.
3. Leave the build command empty.
4. Set the output directory to `.` or leave it empty.
5. Deploy.

`vercel.json` contains basic security headers.

## Deploy to Netlify

Drag this entire folder into Netlify Drop, or connect the GitHub repository. The included `netlify.toml` publishes the repository root.

## Data and security notes

- World data is stored only in the visitor's browser through `localStorage`.
- There is no account system, backend, analytics, or multiplayer server.
- Clearing browser site data removes the saved world.
- Three.js is loaded from jsDelivr, so the first visit requires internet access.
- This is an original learning project and does not use Minecraft code, textures, branding assets, or proprietary game data.

## Main files

- `index.html` — UI, menus, HUD, metadata
- `style.css` — responsive UI and animations
- `game.js` — renderer, terrain, physics, mobs, crafting, persistence
- `manifest.webmanifest` — installable app metadata
- `sw.js` — local asset caching
- `vercel.json` / `netlify.toml` — static-host configuration
