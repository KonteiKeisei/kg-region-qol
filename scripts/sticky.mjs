/**
 * Sticky region target. The region you select stays the drawing target: switching tools, clicking empty canvas,
 * or anything else that deselects it doesn't make your next shape a new region. Only "New region" (in the bar)
 * or Escape lets go. A bar at the top of the canvas always says what the next shape will do.
 */
import { MODULE_ID, esc, isHoleToolActive, isShapeToolActive, regionLayerClass } from "./util.mjs";
import { isPlacing, placementLabel, cancelPlacement } from "./placement.mjs";

/** sceneId -> regionId */
const pins = new Map();
/** The preset applied to every new region this user draws, or null. */
let armed = null;

export function stickyEnabled() {
  return game.settings.get(MODULE_ID, "stickyTarget");
}

export function pinnedRegion(scene=canvas?.scene) {
  if ( !scene ) return null;
  const id = pins.get(scene.id);
  const region = id ? scene.regions.get(id) : null;
  if ( id && !region ) pins.delete(scene.id);
  return region ?? null;
}

export function pinRegion(region) {
  if ( !region?.parent ) return;
  pins.set(region.parent.id, region.id);
  refreshBar();
}

export function unpin({release=true}={}) {
  if ( canvas?.scene ) pins.delete(canvas.scene.id);
  if ( release && canvas?.regions?.active ) canvas.regions.releaseAll();
  refreshBar();
}

export function armPreset(preset) {
  armed = preset ? {id: preset.id, name: preset.name} : null;
  refreshBar();
}

export function armedPresetId() {
  return armed?.id ?? null;
}

/** Make sure the pinned region is the one controlled, so the next shape is added to it. */
function ensurePinnedControlled() {
  if ( !stickyEnabled() || !isShapeToolActive() ) return;
  const region = pinnedRegion();
  const obj = region?.object;
  if ( !obj || obj.destroyed || !obj.visible ) return;
  const controlled = canvas.regions.controlled;
  if ( (controlled.length === 1) && (controlled[0] === obj) ) return;
  // Shape tools aren't "interaction" tools, so core refuses a normal control() while one is active
  obj.control({releaseOthers: true, force: true});
}

export function installSticky() {
  const Layer = regionLayerClass();
  if ( !Layer ) return;
  const proto = Layer.prototype;

  // Right before a shape starts, put the pinned region back under control
  const canDragLeftStart = proto._canDragLeftStart;
  proto._canDragLeftStart = function(user, event) {
    try {
      if ( (this === canvas.regions) && !this._placementContext && !isPlacing() ) ensurePinnedControlled();
    } catch(err) { console.error("kg-region-qol | sticky target", err); }
    return canDragLeftStart.call(this, user, event);
  };

  // Escape lets go of the pinned region (after anything in progress has been cancelled)
  const onDismissKey = proto._onDismissKey;
  proto._onDismissKey = function(event) {
    if ( isPlacing() ) { cancelPlacement(); return true; }
    if ( (this === canvas.regions) && !this._placementContext && pinnedRegion() ) unpin({release: false});
    return onDismissKey.call(this, event);
  };

  Hooks.on("controlRegion", (region, controlled) => {
    if ( !controlled ) return refreshBar();
    if ( canvas.regions.controlled.length === 1 ) pinRegion(region.document);
    else refreshBar();
  });
  Hooks.on("deleteRegion", region => {
    if ( pins.get(region.parent?.id) === region.id ) pins.delete(region.parent.id);
    refreshBar();
  });
  Hooks.on("updateRegion", region => { if ( pinnedRegion()?.id === region.id ) refreshBar(); });
  Hooks.on("renderSceneControls", () => {
    ensurePinnedControlled();
    refreshBar();
  });
  Hooks.on("canvasReady", () => refreshBar());
  Hooks.on("canvasTearDown", () => { cancelPlacement(); refreshBar(); });
  Hooks.on("kgRegionQolPlacement", () => refreshBar());
}

/* -------------------------------------------- */
/*  Status bar                                  */
/* -------------------------------------------- */

let bar = null;

function getBar() {
  if ( bar?.isConnected ) return bar;
  bar = document.createElement("div");
  bar.id = "kg-rqol-bar";
  bar.setAttribute("role", "status");
  bar.addEventListener("click", event => {
    const action = event.target.closest("[data-rqol]")?.dataset.rqol;
    if ( action === "new" ) { unpin(); ui.notifications.info("Your next shape starts a new region."); }
    else if ( action === "pan" ) panToPinned();
    else if ( action === "disarm" ) armPreset(null);
    else if ( action === "cancel" ) cancelPlacement();
  });
  const host = document.getElementById("interface") ?? document.body;
  host.append(bar);
  return bar;
}

function panToPinned() {
  const obj = pinnedRegion()?.object;
  if ( !obj ) return;
  const b = obj.bounds;
  canvas.animatePan({x: b.x + (b.width / 2), y: b.y + (b.height / 2)});
}

export function refreshBar() {
  if ( !game.ready ) return;
  const el = getBar();
  const show = game.settings.get(MODULE_ID, "showBar") && canvas?.ready && canvas.regions?.active
    && game.user.can("REGION_CREATE");
  if ( !show ) { el.hidden = true; return; }

  const parts = [];
  if ( isPlacing() ) {
    parts.push(`<span class="rqol-msg"><i class="fa-solid fa-hand-pointer"></i> ${esc(placementLabel())}: click to place</span>`,
      `<button type="button" data-rqol="cancel">Cancel</button>`);
  } else {
    const region = stickyEnabled() ? pinnedRegion() : null;
    const shapeTool = isShapeToolActive();
    const hole = isHoleToolActive();
    if ( region ) {
      const verb = shapeTool ? (hole ? "Cutting holes in" : "Adding shapes to") : "Editing";
      const locked = region.locked ? ` <i class="fa-solid fa-lock" data-tooltip="This region is locked: shapes can't be added"></i>` : "";
      parts.push(`<span class="rqol-swatch" style="background:${esc(region.color)}"></span>`,
        `<span class="rqol-msg">${verb} <a data-rqol="pan" data-tooltip="Pan to this region">${esc(region.name)}</a>${locked}</span>`,
        `<button type="button" data-rqol="new" data-tooltip="Let go of this region (Esc). Your next shape starts a new one.">
          <i class="fa-solid fa-plus"></i> New region</button>`);
    } else if ( shapeTool ) {
      parts.push(`<span class="rqol-msg rqol-new"><i class="fa-solid fa-plus"></i> Next shape starts a <b>new region</b></span>`);
    }
    if ( armed && game.user.isGM ) {
      parts.push(`<span class="rqol-armed" data-tooltip="New regions you draw get this preset's settings and behaviors">
        <i class="fa-solid fa-swatchbook"></i> ${esc(armed.name)}
        <button type="button" data-rqol="disarm" data-tooltip="Stop using this preset"><i class="fa-solid fa-xmark"></i></button></span>`);
    }
  }
  el.innerHTML = parts.join("");
  el.hidden = !parts.length;
}
