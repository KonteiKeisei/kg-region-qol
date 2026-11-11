# KG Region QOL

Fixes the parts of Foundry VTT v13 and v14 region editing that cost you work.

**Install:** in Foundry, Add-on Modules, Install Module, paste this manifest URL:

```
https://github.com/KonteiKeisei/kg-region-qol/releases/latest/download/module.json
```

## The region stays the one you picked

Select a region, and every shape tool keeps adding to it. Switching tools, clicking empty canvas, or anything else that
deselects it no longer turns your next shape into a brand new region.

A bar above the canvas always says what your next shape will do:

- **Adding shapes to *Name*** (or **Cutting holes in *Name*** with the hole toggle on). Click the name to pan to it.
- **Next shape starts a new region**, when nothing is pinned.

To start a new region, press **New region** in the bar, or press **Esc**.

Turn it off per user in Configure Settings: *Keep the selected region as the drawing target*.

## Copy and paste regions between scenes

Ctrl+C (or Ctrl+X) on the Regions layer works as before, and now also survives a scene change and a reload.
On another scene, Ctrl+V pastes at the cursor with all behaviors. Shapes scale to the new scene's grid size, and
levels are matched by name or elevation (v14).

You can also copy from the region sheet's header menu or the Placeables sidebar menu (v14), and paste with a live
preview from the **Paste** tool in the Regions controls.

Only a GM can paste behaviors. Players' pastes keep the shapes and settings.

## Region presets (GM)

Open **Region presets** from the Regions controls.

- **Save selected region**: pick which behaviors to keep, and tick **Also save shape and level** to keep the outline,
  elevation, and level too. Also in the region sheet's header menu.
- **Place**: for presets with a shape, click on the canvas to stamp it (right-click or Esc cancels, Shift skips
  snapping).
- **Use for new regions**: every region you draw gets the preset's settings and behaviors until you clear it from the
  bar.
- **Apply to selected**: put the preset's settings and behaviors on regions you already drew.
- **Export / Import**: presets are JSON files, one preset or many per file.

### Behaviors from other modules

Presets keep every behavior, even ones from modules you don't have. Those show a warning sign; hover it to see which
module is missing and whether it's not installed, not active, or the wrong version. Missing behaviors are left out when
you use the preset, with a notice saying which. Exporting again keeps them, so nothing is lost when presets are shared.

Behaviors that link to documents (a teleport destination, a macro) get a broken-link mark when the linked document
isn't in your world.

## For developers

`game.modules.get("kg-region-qol").api` has `presets`, `clipboard`, `sticky`, and `openPresets()`.
