# Wrath of Olympus

> This repo now holds two browser games: **Wrath of Olympus** (below, `index.html`) and the survival-horror **[Ashes of Varkova](village/README.md)** (`village/index.html`).

An open-world, third-person Greek-myth action game that runs in the browser, built from scratch in the style of *God of War*. You play a Spartan with fire blades on chains. Your son Atreus fights beside you with his bow. Together you break three strongholds of the dead to open the Temple of Polyphemos, the Cyclops King.

This is an original fan-made game. Every model, texture, sky and sound is generated in code. It uses no assets from Sony's games. (Atreus is a figure from Greek myth, so he fits the setting.)

## Play

**Fastest:** double-click `index.html`. Three.js is included in `vendor/`, so it runs offline with no server or build step.

**Or serve it locally:**

```bash
npx http-server -p 8080 .
# open http://localhost:8080
```

You need a browser with WebGL 2 (any current Chrome, Edge, Firefox or Safari). On older laptops or phones, switch **Graphics** to *low* in the pause menu.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move / sprint | `W A S D` / hold `Shift` | Left stick / push it all the way |
| Camera | Mouse (click to lock), arrow keys | Drag the right side of the screen |
| Light attack (4-hit combo) | Left click / `J` | Attack |
| Heavy spin attack | Right click / `K` | Heavy |
| Jump, double jump, air slam | `Space`, then attack in the air | Jump |
| Dodge roll | Tap `Shift` / `L` | Dodge |
| Atreus: lightning volley | `R` | Volley |
| Olympian Wrath (costs 50 magic) | `F` | Wrath |
| Rage of Sparta (rage bar full) | `Q` | Rage |
| Execute, open a chest, pray at an altar | `E` | Use |
| World map | `N` / `Tab` | Map |
| Pause / mute | `Esc` or `P` / `M` | Pause |

## The world

- **An 800 m landscape:** rolling hills, cypress and olive groves, pine-covered mountains, a lake, dirt roads, and ruins and fallen statues scattered across the land.
- **Three strongholds,** each marked by a beam of light:
  - **Legion Camp:** a palisade fort with undead legionnaires and hellhounds.
  - **Harpy Cliffs:** a mesa of nests where harpies dive from the sky.
  - **Labyrinth Ruins:** broken walls patrolled by minotaurs. Lure them into charging a wall to stun them.
- **Temple of Polyphemos:** sealed by fire until all three strongholds fall. Inside is the boss fight, with two enraged phases and a finishing scene.
- **Altars of Hephaestus** (at the shrine and the crossroads): spend red orbs on upgrades, restore your health, and set your respawn point.
- **13 chests:** red orbs, plus Gorgon Eyes (more health) and Phoenix Feathers (more magic). Each stronghold also guards a reward chest.
- **Roaming packs** of legionnaires and hellhounds keep the roads dangerous.
- **Dying** returns you to the last altar you prayed at. Strongholds you cleared stay cleared.
- **After the boss** you can keep exploring in free roam.

## Atreus

He follows you, keeps his distance in a fight, and shoots whatever you're fighting (he's especially good against harpies). He rolls away from enemies that get close. Press **R** for a three-arrow lightning volley that stuns. The *Atreus's Bow* upgrade makes him shoot faster and harder. He also comments on the fight and the journey.

## Graphics and blood

- HDR rendering with bloom, ACES tone mapping and colour grading.
- A procedural sky with sun and drifting clouds, which also lights every surface.
- Soft shadows that follow you, and terrain with grass, rock, dirt and sand blended by slope and height.
- Wind-swept grass, swaying trees, and reflective water.
- Smooth character models.
- **Blood:** sprays from every hit that fall and stain the ground, pools under the dead, heavy splatter on executions, blades that darken with blood, wounded enemies that redden, and screen blood when you're hurt. Turn it off under **Blood** in the pause menu.

## Files

- `index.html`: page layout, HUD, menus and styles
- `js/core.js`: renderer and post-processing, sky and lighting, audio, particles and blood
- `js/world.js`: terrain, water, vegetation, strongholds, temple, chests, altars, map
- `js/actors.js`: character models for the Spartan, Atreus and the enemies
- `js/game.js`: combat, Atreus's AI, enemy AI, quests, HUD, camera and the main loop
- `vendor/three.min.js`: Three.js r128
