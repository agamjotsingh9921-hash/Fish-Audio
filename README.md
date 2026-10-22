# Wrath of Olympus

A third-person Greek-myth hack-and-slash that runs in the browser, built from scratch in the style of *God of War*. You play a Spartan with chained fire blades and fight through five waves in a ruined temple. The last wave is a boss fight against Polyphemos, the Cyclops King.

This is an original fan-made game. Every model, texture and sound is generated in code. It uses no assets, characters or names from Sony's games.

## Play

**Fastest:** double-click `index.html`. Three.js is included in `vendor/`, so it runs offline with no server or build step.

**Or serve it locally:**

```bash
npx http-server -p 8080 .
# open http://localhost:8080
```

You need a browser with WebGL (any current Chrome, Edge, Firefox or Safari). It works on phones too, with on-screen controls.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `W A S D` | Left stick |
| Camera | Mouse (click to lock), `← → ↑ ↓` | Drag the right side of the screen |
| Light attack (4-hit combo) | Left click / `J` | Attack |
| Heavy spin attack | Right click / `K` | Heavy |
| Jump / double jump | `Space` | Jump |
| Air slam | Light attack while in the air | Attack in the air |
| Dodge roll (brief invulnerability) | `Shift` / `L` | Dodge |
| Olympian Wrath (area blast, costs 50 magic) | `F` | Wrath |
| Rage of Sparta (when the rage bar is full) | `Q` | Rage |
| Execute a weakened enemy | `E` | Finish |
| Pause / mute | `Esc` or `P` / `M` | Pause |

## Features

- **Chain-blade combat.** The blades fly out on chains along real attack arcs, and hits are checked along the chain. Includes a 4-hit combo ending in a ground slam, a multi-hit spin, air slams, hitstop, screen shake and fire trails.
- **Executions.** Enemies glow with a ring when they drop below about 20% health. Press `E` to finish them off for extra orbs and some health back.
- **Rage of Sparta.** Fills as you deal and take damage. While active you deal 60% more damage, attack faster, take half damage and heal on every hit.
- **Olympian Wrath.** Lightning plus a shockwave ring that knocks back everything nearby.
- **Enemies with their own AI:**
  - Undead legionnaires: shield, sword and telegraphed lunges.
  - Harpies: circle overhead, screech, then dive at you.
  - Minotaurs: paw the ground, then charge. They get stunned if they hit a pillar, so lure them into one.
  - **Polyphemos the Cyclops:** club slams, sweeps, stomp shockwaves (jump over them), thrown boulders, two enrage phases that summon reinforcements, and a cinematic finisher.
- **Red, green and blue orbs** for currency, health and magic. Spend red orbs between waves at the Altar of Hephaestus on blade damage, max health, max magic and rage upgrades.
- **Synthesised audio:** war drums, a drone, and sound effects all made with WebAudio.

## Files

- `index.html`: page layout, HUD, menus and styles
- `game.js`: the whole game (rendering, combat, AI, audio, UI)
- `vendor/three.min.js`: Three.js r128
