/**
 * Region presets: saved region settings and behaviors, with optional shapes and levels, that can be placed on
 * any scene, applied to an existing region, used for every new region you draw, and shared as JSON files.
 */
import { MODULE_ID, esc, readFileText, saveJSON, slug } from "./util.mjs";
import { CONFIG_KEYS, snapshotBehaviors, snapshotRegions } from "./geometry.mjs";
import { behaviorLabel, describePackages, splitBehaviors, summarizeMissing } from "./requirements.mjs";
import { placeSnapshot } from "./placement.mjs";
import { armPreset, armedPresetId, pinRegion } from "./sticky.mjs";

export const FORMAT = "kg-region-qol.presets";
export const FORMAT_VERSION = 1;

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

export function getPresets() {
  const list = game.settings.get(MODULE_ID, "presets");
  return Array.isArray(list) ? foundry.utils.deepClone(list) : [];
}

export function getPreset(id) {
  return getPresets().find(p => p.id === id) ?? null;
}

async function setPresets(list) {
  list.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  await game.settings.set(MODULE_ID, "presets", list);
  Hooks.callAll("kgRegionQolPresetsChanged", list);
}

export async function upsertPreset(preset) {
  const list = getPresets();
  const i = list.findIndex(p => p.id === preset.id);
  if ( i >= 0 ) list[i] = preset;
  else list.push(preset);
  await setPresets(list);
  return preset;
}

export async function deletePreset(id) {
  await setPresets(getPresets().filter(p => p.id !== id));
  if ( armedPresetId() === id ) armPreset(null);
}

/* -------------------------------------------- */
/*  Creating presets                            */
/* -------------------------------------------- */

/**
 * Build a preset from a Region.
 * @param {RegionDocument} region
 * @param {object} options
 * @param {string} options.name
 * @param {string} [options.description]
 * @param {boolean} [options.geometry=false]   Include shapes, elevation, and levels
 * @param {number[]} [options.behaviorIndexes] Which behaviors to keep (all when omitted)
 */
export function presetFromRegion(region, {name, description="", geometry=false, behaviorIndexes}={}) {
  const src = region.toObject();
  const config = {};
  for ( const key of CONFIG_KEYS ) if ( key in src ) config[key] = foundry.utils.deepClone(src[key]);
  if ( src.ownership?.default !== undefined ) config.ownership = {default: src.ownership.default};
  let behaviors = snapshotBehaviors(region);
  if ( behaviorIndexes ) behaviors = behaviors.filter((b, i) => behaviorIndexes.includes(i));
  const preset = {
    id: foundry.utils.randomID(),
    name: name || src.name,
    description,
    regionName: src.name,
    created: Date.now(),
    coreVersion: game.version,
    systemId: game.system.id,
    moduleVersion: game.modules.get(MODULE_ID)?.version ?? null,
    packages: describePackages(behaviors),
    config,
    behaviors,
    geometry: null
  };
  if ( geometry ) {
    const snap = snapshotRegions([region], {ownership: false});
    const item = snap.items[0];
    preset.geometry = {gridSize: snap.gridSize, gridDistance: snap.gridDistance, gridType: snap.gridType,
      shapes: item.shapes, elevation: item.elevation, levels: item.levels.map(({name, bottom, top}) =>
        ({id: null, name, bottom, top}))};
  }
  return preset;
}

/** Ask for a name and options, then save the Region as a preset. */
export async function savePresetDialog(region) {
  if ( !game.user.isGM ) return ui.notifications.warn("Only a GM can save region presets.");
  if ( !region ) {
    const controlled = canvas.regions?.controlled ?? [];
    if ( controlled.length !== 1 ) return ui.notifications.warn("Select one region to save it as a preset.");
    region = controlled[0].document;
  }
  const behaviors = region.behaviors.contents;
  const levelNames = [...(region._source.levels ?? [])].map(id => region.parent.levels?.get?.(id)?.name).filter(Boolean);
  const shapeCount = region.shapes.length;
  const elevation = region.elevation;
  const elevText = [elevation?.bottom, elevation?.top].map(v => Number.isFinite(v) ? v : "∞").join(" to ");
  const existing = getPresets().find(p => p.name === region.name);

  const behaviorRows = behaviors.length ? behaviors.map((b, i) => `
    <label class="rqol-check"><input type="checkbox" name="b${i}" checked>
      <i class="${esc(CONFIG.RegionBehavior.typeIcons?.[b.type] ?? "fa-solid fa-gear")}"></i> ${esc(behaviorLabel(b))}
      ${b.disabled ? "<em>(disabled)</em>" : ""}</label>`).join("") : "<p class='hint'>This region has no behaviors.</p>";

  const content = `
    <div class="kg-rqol-form">
      <div class="form-group"><label>Preset name</label>
        <div class="form-fields"><input type="text" name="name" value="${esc(region.name)}" required autofocus></div></div>
      <div class="form-group stacked"><label>Description</label>
        <textarea name="description" rows="2" placeholder="Optional: what this preset is for"></textarea></div>
      <fieldset><legend>Behaviors to save</legend>${behaviorRows}</fieldset>
      <label class="rqol-check rqol-geometry"><input type="checkbox" name="geometry">
        <span>Also save shape and level
        <span class="hint">${shapeCount} shape${shapeCount === 1 ? "" : "s"}, elevation ${esc(elevText)}${levelNames.length ? `, level ${esc(levelNames.join(", "))}` : ""}.
        Lets you stamp the same outline on another scene.</span></span></label>
      ${existing ? `<label class="rqol-check"><input type="checkbox" name="replace"> Replace the existing preset named "${esc(existing.name)}"</label>` : ""}
    </div>`;

  const data = await foundry.applications.api.DialogV2.prompt({
    window: {title: "Save region preset", icon: "fa-solid fa-swatchbook"},
    position: {width: 460},
    content,
    ok: {label: "Save preset", icon: "fa-solid fa-floppy-disk",
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object},
    rejectClose: false
  });
  if ( !data ) return null;
  const behaviorIndexes = behaviors.map((b, i) => i).filter(i => data[`b${i}`]);
  const preset = presetFromRegion(region, {name: data.name?.trim(), description: data.description?.trim() ?? "",
    geometry: !!data.geometry, behaviorIndexes});
  if ( data.replace && existing ) { preset.id = existing.id; preset.created = existing.created; }
  await upsertPreset(preset);
  ui.notifications.info(`Saved region preset "${preset.name}".`);
  return preset;
}

/* -------------------------------------------- */
/*  Using presets                               */
/* -------------------------------------------- */

function warnMissing(preset, missing) {
  if ( !missing.length ) return;
  ui.notifications.warn(`Preset "${preset.name}": left out ${missing.length} behavior${missing.length === 1 ? "" : "s"}. ${summarizeMissing(missing).join(" | ")}`,
    {permanent: true});
}

function usableBehaviors(preset) {
  const split = splitBehaviors(preset.behaviors, preset.packages, preset.coreVersion);
  warnMissing(preset, split.missing);
  return foundry.utils.deepClone(split.ok);
}

/** The data a preset contributes to a Region, apart from shapes. */
function presetRegionConfig(preset) {
  const schema = CONFIG.Region.documentClass.schema;
  const out = {};
  for ( const [key, value] of Object.entries(preset.config ?? {}) ) {
    if ( schema.has?.(key) ?? schema.fields?.[key] ) out[key] = foundry.utils.deepClone(value);
  }
  return out;
}

/** Place a preset that has saved shapes: click on the canvas to stamp it. */
export async function placePreset(preset, {scale=true}={}) {
  if ( !preset.geometry?.shapes?.length ) return ui.notifications.warn(`"${preset.name}" has no saved shape. Draw a region and apply it, or use it for new regions.`);
  const snapshot = {gridSize: preset.geometry.gridSize, items: [{
    name: preset.regionName || preset.name,
    config: presetRegionConfig(preset),
    behaviors: [],
    shapes: preset.geometry.shapes,
    elevation: preset.geometry.elevation,
    levels: preset.geometry.levels
  }]};
  ui.notifications.info(`Click to place "${preset.name}". Right-click or Esc cancels, hold Shift to skip snapping.`);
  return placeSnapshot(snapshot, {label: `Placing ${preset.name}`, scale, commit: async data => {
    const behaviors = usableBehaviors(preset);
    for ( const d of data ) d.behaviors = behaviors;
    const created = await canvas.scene.createEmbeddedDocuments("Region", data, {kgRegionQol: true});
    if ( created[0] ) { created[0].object?.control({releaseOthers: true, force: true}); pinRegion(created[0]); }
    return created;
  }});
}

/**
 * Apply a preset's settings and behaviors to existing Regions.
 * @param {object} preset
 * @param {RegionDocument[]} regions
 * @param {object} [options]
 * @param {boolean} [options.replaceBehaviors=false]
 * @param {boolean} [options.rename=false]
 */
export async function applyPreset(preset, regions, {replaceBehaviors=false, rename=false}={}) {
  const behaviors = usableBehaviors(preset);
  const config = presetRegionConfig(preset);
  delete config.ownership;
  for ( const region of regions ) {
    const update = foundry.utils.deepClone(config);
    if ( rename ) update.name = preset.regionName || preset.name;
    if ( !foundry.utils.isEmpty(update) ) await region.update(update);
    if ( replaceBehaviors && region.behaviors.size ) {
      await region.deleteEmbeddedDocuments("RegionBehavior", region.behaviors.map(b => b.id));
    }
    if ( behaviors.length ) await region.createEmbeddedDocuments("RegionBehavior", foundry.utils.deepClone(behaviors));
  }
  ui.notifications.info(`Applied "${preset.name}" to ${regions.length} region${regions.length === 1 ? "" : "s"}.`);
}

export async function applyPresetDialog(preset) {
  const regions = (canvas.regions?.controlled ?? []).map(o => o.document);
  if ( !regions.length ) return ui.notifications.warn("Select the region (or regions) to apply the preset to.");
  const data = await foundry.applications.api.DialogV2.prompt({
    window: {title: `Apply "${preset.name}"`, icon: "fa-solid fa-wand-magic-sparkles"},
    position: {width: 420},
    content: `<div class="kg-rqol-form">
      <p>Apply this preset's settings and behaviors to ${regions.length === 1 ? `<b>${esc(regions[0].name)}</b>` : `${regions.length} selected regions`}.
        Shapes stay as they are.</p>
      <label class="rqol-check"><input type="checkbox" name="replaceBehaviors"> Remove the region's current behaviors first</label>
      <label class="rqol-check"><input type="checkbox" name="rename"> Rename to "${esc(preset.regionName || preset.name)}"</label>
    </div>`,
    ok: {label: "Apply", icon: "fa-solid fa-check",
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object},
    rejectClose: false
  });
  if ( !data ) return;
  return applyPreset(preset, regions, {replaceBehaviors: !!data.replaceBehaviors, rename: !!data.rename});
}

/** While a preset is in use, every new region this user draws gets its settings and behaviors. */
export function installArmedPresetHook() {
  Hooks.on("preCreateRegion", (document, data, options, userId) => {
    if ( userId !== game.user.id ) return;
    if ( options.kgRegionQol ) return;
    const id = armedPresetId();
    if ( !id ) return;
    const preset = getPreset(id);
    if ( !preset ) return armPreset(null);
    const update = presetRegionConfig(preset);
    if ( !update.ownership ) delete update.ownership;
    else update.ownership = foundry.utils.mergeObject(document._source.ownership ?? {}, update.ownership, {inplace: false});
    update.name = preset.regionName || preset.name;
    if ( preset.geometry?.elevation && !data.elevation ) update.elevation = foundry.utils.deepClone(preset.geometry.elevation);
    const behaviors = usableBehaviors(preset);
    if ( behaviors.length ) update.behaviors = [...(data.behaviors ?? []), ...behaviors];
    document.updateSource(update);
  });
}

export function usePresetForNewRegions(preset) {
  armPreset(preset);
  if ( canvas.ready && !canvas.regions.active ) canvas.regions.activate({tool: "rectangle"});
  ui.notifications.info(`New regions you draw now get "${preset.name}". Clear it from the bar above the canvas.`);
}

/* -------------------------------------------- */
/*  Import and export                           */
/* -------------------------------------------- */

export function exportPresets(presets) {
  if ( !presets.length ) return ui.notifications.warn("No presets to export.");
  const file = {format: FORMAT, formatVersion: FORMAT_VERSION, exported: new Date().toISOString(),
    coreVersion: game.version, presets};
  const name = presets.length === 1 ? `region-preset-${slug(presets[0].name)}.json` : `region-presets-${presets.length}.json`;
  saveJSON(file, name);
}

function validatePreset(p) {
  if ( !p || (typeof p !== "object") ) return null;
  if ( typeof p.name !== "string" || !p.name.trim() ) return null;
  const preset = {
    id: foundry.utils.randomID(),
    name: p.name.trim().slice(0, 200),
    description: typeof p.description === "string" ? p.description : "",
    regionName: typeof p.regionName === "string" ? p.regionName : p.name,
    created: Number(p.created) || Date.now(),
    imported: Date.now(),
    coreVersion: p.coreVersion ?? null,
    systemId: p.systemId ?? null,
    moduleVersion: p.moduleVersion ?? null,
    packages: (p.packages && typeof p.packages === "object") ? p.packages : {},
    config: (p.config && typeof p.config === "object") ? p.config : {},
    behaviors: Array.isArray(p.behaviors) ? p.behaviors.filter(b => b && (typeof b.type === "string")).map(b => ({
      name: String(b.name ?? ""), type: b.type, system: (b.system && typeof b.system === "object") ? b.system : {},
      disabled: !!b.disabled, flags: (b.flags && typeof b.flags === "object") ? b.flags : {}
    })) : [],
    geometry: null
  };
  delete preset.config.ownership;
  if ( p.geometry && Array.isArray(p.geometry.shapes) ) {
    preset.geometry = {
      gridSize: Number(p.geometry.gridSize) || null,
      gridDistance: Number(p.geometry.gridDistance) || null,
      gridType: p.geometry.gridType ?? null,
      shapes: p.geometry.shapes.filter(s => s && (typeof s.type === "string")),
      elevation: p.geometry.elevation ?? {},
      levels: Array.isArray(p.geometry.levels) ? p.geometry.levels.map(l => ({id: null, name: l?.name ?? null,
        bottom: l?.bottom ?? null, top: l?.top ?? null})) : []
    };
  }
  return preset;
}

/** Ask for a JSON file and add its presets. */
export function importPresetsDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.multiple = true;
  input.addEventListener("change", async () => {
    let added = [];
    for ( const file of input.files ) {
      try {
        const json = JSON.parse(await readFileText(file));
        const raw = Array.isArray(json) ? json : (json?.format === FORMAT ? json.presets : (json?.presets ?? [json]));
        const valid = (raw ?? []).map(validatePreset).filter(Boolean);
        if ( !valid.length ) ui.notifications.warn(`${file.name}: no region presets found.`);
        added = added.concat(valid);
      } catch(err) {
        ui.notifications.error(`${file.name} isn't a region preset file: ${err.message}`);
      }
    }
    if ( !added.length ) return;
    const list = getPresets();
    const names = new Set(list.map(p => p.name));
    for ( const p of added ) {
      let name = p.name; let n = 2;
      while ( names.has(name) ) name = `${p.name} (${n++})`;
      p.name = name;
      names.add(name);
      list.push(p);
    }
    await setPresets(list);
    const needs = added.filter(p => splitBehaviors(p.behaviors, p.packages, p.coreVersion).missing.length);
    let msg = `Imported ${added.length} region preset${added.length === 1 ? "" : "s"}.`;
    if ( needs.length ) msg += ` ${needs.length} use${needs.length === 1 ? "s" : ""} behaviors you can't run here: look for the warning sign.`;
    ui.notifications[needs.length ? "warn" : "info"](msg);
  });
  input.click();
}
