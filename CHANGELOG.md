# Changelog

## 0.1.0

First release. Tested on Foundry v14 (build 370). Written for v13 too, not yet tested there.

- **The region stays the one you picked.** Shape tools keep adding to the selected region after a tool switch, a click
  on empty canvas, or anything else that deselects it. A bar above the canvas says what your next shape will do.
  **New region** in the bar, or Esc, starts a new one. Can be turned off per user.
- **Copy and paste between scenes.** Ctrl+C / Ctrl+X on the Regions layer, then Ctrl+V on any scene, with behaviors.
  Shapes scale to the new grid, and levels are matched by name or elevation (v14). The clipboard survives a reload.
  Also from the region sheet's header menu, the Placeables sidebar (v14), and a Paste tool with a live preview.
- **Region presets** (GM): save a region's settings and chosen behaviors, optionally with its shape and level. Place
  them by clicking, use them for every new region you draw, or apply them to regions you already drew.
  Export and import as JSON files.
- Presets keep behaviors from modules you don't have, with a warning sign that names the missing module (not installed,
  not active, or the wrong version). Those behaviors are left out when the preset is used, and kept when it's exported.
- Behaviors that link to a document missing from your world (a teleport destination, a macro) are marked.
