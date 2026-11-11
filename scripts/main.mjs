import { MODULE_ID } from "./util.mjs";
import { installSticky, refreshBar, pinRegion, unpin, pinnedRegion } from "./sticky.mjs";
import { installClipboard, copyRegions, hasClipboard, clipboardSummary, pasteWithPreview } from "./clipboard.mjs";
import {
  installArmedPresetHook, savePresetDialog, getPresets, getPreset, placePreset, applyPreset, exportPresets,
  importPresetsDialog, usePresetForNewRegions
} from "./presets.mjs";
import { RegionPresetManager } from "./preset-manager.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "presets", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => RegionPresetManager.refresh()
  });
  game.settings.register(MODULE_ID, "stickyTarget", {
    name: "Keep the selected region as the drawing target",
    hint: "Shape tools keep adding to the region you selected, even after a tool switch or a click on empty canvas. Press Esc or New region in the bar to start a new one.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshBar()
  });
  game.settings.register(MODULE_ID, "showBar", {
    name: "Show the region status bar",
    hint: "While the Regions layer is active, a bar above the canvas shows which region your next shape goes into.",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshBar()
  });

  installSticky();
  installClipboard();
  installArmedPresetHook();
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = {
    presets: {list: getPresets, get: getPreset, place: placePreset, apply: applyPreset, export: exportPresets,
      import: importPresetsDialog, save: savePresetDialog, useForNewRegions: usePresetForNewRegions},
    clipboard: {copy: copyRegions, paste: pasteWithPreview, has: hasClipboard, summary: clipboardSummary},
    sticky: {pin: pinRegion, unpin, pinned: pinnedRegion},
    openPresets: () => RegionPresetManager.open()
  };
  refreshBar();
});

Hooks.on("kgRegionQolPresetsChanged", () => RegionPresetManager.refresh());
Hooks.on("controlRegion", () => RegionPresetManager.refresh());

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", controls => {
  const regions = controls.regions ?? (Array.isArray(controls) ? controls.find(c => c.name === "regions") : null);
  if ( !regions?.tools || Array.isArray(regions.tools) ) return;
  regions.tools.kgRqolPresets = {
    name: "kgRqolPresets",
    order: 50,
    title: "Region presets",
    icon: "fa-solid fa-swatchbook",
    button: true,
    visible: game.user.isGM,
    onChange: () => RegionPresetManager.open()
  };
  regions.tools.kgRqolPaste = {
    name: "kgRqolPaste",
    order: 51,
    title: hasClipboard() ? `Paste ${clipboardSummary()}` : "Paste regions (copy some with Ctrl+C first)",
    icon: "fa-solid fa-paste",
    button: true,
    visible: hasClipboard(),
    onChange: () => pasteWithPreview()
  };
});

/* -------------------------------------------- */
/*  Region sheet header and sidebar menus       */
/* -------------------------------------------- */

function isRealRegion(doc) {
  return !!(doc?.id && doc.parent?.regions?.has?.(doc.id));
}

Hooks.on("getHeaderControlsRegionConfig", (app, controls) => {
  const doc = app.document;
  if ( !isRealRegion(doc) ) return;
  controls.push({
    icon: "fa-solid fa-copy",
    label: "Copy region (paste on any scene)",
    onClick: () => copyRegions([doc], {notify: true})
  });
  if ( game.user.isGM ) controls.push({
    icon: "fa-solid fa-swatchbook",
    label: "Save as region preset",
    onClick: () => savePresetDialog(doc)
  });
});

Hooks.on("getRegionPlaceableContextOptions", (app, options) => {
  const docFrom = li => app._getPlaceableFromElement?.(li);
  options.push({
    label: "Copy (paste on any scene)",
    icon: "fa-solid fa-copy",
    onClick: (event, li) => {
      const doc = docFrom(li);
      if ( !doc ) return;
      const selected = doc.object?.controlled ? canvas.regions.controlled.map(o => o.document) : [doc];
      copyRegions(selected, {notify: true});
    }
  });
  if ( game.user.isGM ) options.push({
    label: "Save as region preset",
    icon: "fa-solid fa-swatchbook",
    onClick: (event, li) => { const doc = docFrom(li); if ( doc ) savePresetDialog(doc); }
  });
});
