# Ashes of Varkova

A first-person survival-horror game for the browser, inspired by the *Resident Evil Village* style of gothic horror. It's an original game with its own story, characters, map and monsters, and every model, texture and sound is generated in code.

You play Nadia Vos, searching the snowbound village of Varkova and the castle above it for your sister Ilse.

## Play

Open `village/index.html` through any static server, or on the GitHub Pages site under `/village/`. It shares Three.js with the other game in `../vendor/`.

```bash
npx http-server -p 8080 .
# open http://localhost:8080/village/
```

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move / sprint | `W A S D` / `Shift` | Left stick / push it all the way |
| Look | Mouse (click to lock) | Drag the right side |
| Shoot / aim | Left / right mouse | Fire / Aim |
| Reload | `R` | Reload |
| Knife, pistol, shotgun | `1` `2` `3`, mouse wheel | Swap |
| Interact (doors, items, ledgers, merchant) | `E` | Use |
| Flashlight | `F` | Light |
| Heal | `Q` | Heal |
| Case (inventory) / map | `Tab` / `M` | Case / Map |
| Pause | `Esc` | Pause |

## What's in it

- **The village:** a forest road, a crashed car, a palisade gate you open with a winch, a bell tower, a mill and enterable houses. A siege starts when the bell rings, and you survive until it stops. Then come a locked church and a cemetery.
- **The castle:** a grand hall, dining hall, armory, library, gallery, servants' quarters, a cellar and a chapel. Countess Velmira stalks you through the halls and opens doors to follow you. She can't be killed, only staggered.
- **The roof:** the final boss.
- **Enemies:**
  - The Hollowed (wolf-like villagers that weave and pounce)
  - An axe-wielding Alpha
  - Ashmaidens that rise from ash
  - The Shepherd, the village boss. Make him charge into a gravestone, then shoot the growth on his back.
  - Velmira's winged true form. Shoot her glowing heart.
- **Puzzles and keys:** a winch crank, a rusty key, the Lamb Crest, a cellar key, three masks, and the library's three listening busts.
- **Survival:** scarce ammo, a grid-based case to manage, herbs you can combine into a tincture, and breakable crates.
- **Brask the merchant:** buy supplies, sell treasures, upgrade weapons, enlarge your case.
- **Ledgers** save your progress. Safe rooms that nothing will enter. Nine documents tell the story.
- **Atmosphere:** moonlight and snow, a shadow-casting flashlight, a first-person weapon view with recoil and reloads, headshots, blood and gore (can be turned off), and synthesised wind, drones, chase music, howls and screams.

## Files

- `index.html`: HUD, menus and styles
- `js/engine.js`: renderer, post-processing, night sky, audio, particles, blood
- `js/level.js`: terrain, buildings, castle, roof, doors, pickups, colliders, enemy pathfinding
- `js/monsters.js`: creature rigs, the merchant, item and weapon models
- `js/game.js`: player, weapons, inventory, merchant, AI, story events, saving, UI
