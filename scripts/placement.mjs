/**
 * Click-to-place for a group of Regions: a live preview follows the cursor, left-click places,
 * right-click or Escape cancels. Shift holds off grid snapping.
 */
import { buildRegions } from "./geometry.mjs";
import { cancelCanvasDrag } from "./util.mjs";

let active = null;

export function isPlacing() {
  return !!active;
}

export function cancelPlacement() {
  if ( active ) active.finish(null);
}

/**
 * @param {object} snapshot                    Snapshot from snapshotRegions or a preset
 * @param {object} options
 * @param {string} options.label               Shown in the notification
 * @param {(data: object[]) => Promise<RegionDocument[]>} options.commit   Creates the regions
 * @param {boolean} [options.scale=true]
 * @returns {Promise<RegionDocument[]|null>}
 */
export function placeSnapshot(snapshot, {label, commit, scale=true}) {
  if ( !canvas.ready ) return Promise.resolve(null);
  cancelPlacement();
  canvas.regions._cancelPlacement?.();
  if ( !canvas.regions.active ) canvas.regions.activate({tool: "select"});

  const {promise, resolve} = Promise.withResolvers();
  const previews = [];
  let last = canvas.mousePosition ?? {x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2};
  let shift = false;
  let frame = null;

  // Preview objects drawn with the core Region renderer; skipped quietly if that fails
  const previewData = buildRegions(snapshot, last, {scale, behaviors: false});
  for ( const data of previewData ) {
    try {
      const doc = new CONFIG.Region.documentClass(foundry.utils.mergeObject(data, {_id: foundry.utils.randomID()},
        {inplace: false}), {parent: canvas.scene});
      const obj = new CONFIG.Region.objectClass(doc);
      obj._previewType = "creation";
      doc._object = obj;
      canvas.regions.preview.addChild(obj);
      obj.draw();
      previews.push(obj);
    } catch(err) {
      console.warn("kg-region-qol | preview unavailable", err);
    }
  }

  const refresh = () => {
    frame = null;
    const data = buildRegions(snapshot, last, {scale, snap: !shift, behaviors: false});
    previews.forEach((obj, i) => {
      if ( obj.destroyed || !data[i] ) return;
      try {
        obj.document.updateSource({shapes: data[i].shapes});
        obj.document.updateShapeConstraints?.();
        obj.renderFlags.set({refreshShapes: true, refreshState: true});
      } catch(err) { /* keep the last good preview */ }
    });
  };
  const schedule = () => { frame ??= requestAnimationFrame(refresh); };

  const onMove = event => {
    last = event.getLocalPosition(canvas.regions);
    shift = !!event.shiftKey;
    canvas._onDragCanvasPan?.(event);
    schedule();
  };
  const onDown = async event => {
    if ( event.button === 2 ) return finish(null, true);
    if ( event.button !== 0 ) return;
    const point = event.getLocalPosition(canvas.regions);
    const snap = !event.shiftKey;
    setTimeout(cancelCanvasDrag, 0);
    const data = buildRegions(snapshot, point, {scale, snap});
    finish("placing");
    try {
      resolve(await commit(data));
    } catch(err) {
      console.error(err);
      ui.notifications.error(`Couldn't place the region: ${err.message}`);
      resolve(null);
    }
  };
  const onKey = event => {
    if ( event.key === "Escape" ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null, true);
    }
    else if ( event.key === "Shift" ) { shift = event.type === "keydown"; schedule(); }
  };

  function finish(result, cancelled=false) {
    if ( !active ) return;
    active = null;
    canvas.stage.off("pointermove", onMove);
    canvas.stage.off("pointerdown", onDown);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    if ( frame ) cancelAnimationFrame(frame);
    for ( const obj of previews ) if ( !obj.destroyed ) obj.destroy({children: true});
    document.body.classList.remove("kg-rqol-placing");
    Hooks.callAll("kgRegionQolPlacement", false);
    if ( cancelled ) ui.notifications.info("Placement cancelled.");
    if ( result !== "placing" ) resolve(result);
  }

  active = {finish, label};
  canvas.stage.on("pointermove", onMove);
  canvas.stage.on("pointerdown", onDown);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  document.body.classList.add("kg-rqol-placing");
  Hooks.callAll("kgRegionQolPlacement", true, label);
  schedule();
  return promise;
}

export function placementLabel() {
  return active?.label ?? null;
}
