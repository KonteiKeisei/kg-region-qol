/**
 * Region copy and paste that works across scenes and survives a reload.
 * Ctrl+C / Ctrl+X on the Region layer fill this clipboard as well as the core one. Ctrl+V on a different
 * scene pastes from here; on the same scene the core paste runs unchanged.
 */
import { MODULE_ID, regionLayerClass } from "./util.mjs";
import { buildRegions, snapshotRegions } from "./geometry.mjs";
import { placeSnapshot } from "./placement.mjs";
import { splitBehaviors, summarizeMissing } from "./requirements.mjs";
import { pinRegion } from "./sticky.mjs";

const STORAGE_KEY = `${MODULE_ID}.clipboard`;
let clip = load();

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(err) { return null; }
}

function store() {
  try {
    if ( clip ) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clip));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch(err) { /* storage unavailable: memory only */ }
}

export function hasClipboard() {
  return !!clip?.items?.length;
}

export function clipboardSummary() {
  if ( !hasClipboard() ) return null;
  const n = clip.items.length;
  return `${n} region${n === 1 ? "" : "s"} from ${clip.sceneName ?? "another scene"}${clip.cut ? " (cut)" : ""}`;
}

/** Copy Regions into the cross-scene clipboard. */
export function copyRegions(regions, {cut=false, notify=false}={}) {
  regions = regions.filter(r => r?.parent);
  if ( !regions.length ) return;
  clip = {...snapshotRegions(regions), cut, ids: regions.map(r => r.id), time: Date.now(),
    version: game.version, worldId: game.world.id};
  store();
  if ( notify ) ui.notifications.info(`Copied ${clipboardSummary()}. Paste with Ctrl+V on any scene.`);
  ui.controls?.render?.({reset: true});
}

async function createFromClip(data, {cut}) {
  const scene = canvas.scene;
  const strip = !game.user.isGM;
  let missing = [];
  for ( const d of data ) {
    if ( strip ) { d.behaviors = []; continue; }
    const split = splitBehaviors(d.behaviors);
    d.behaviors = split.ok;
    missing = missing.concat(split.missing);
  }
  if ( clip?.worldId && (clip.worldId !== game.world.id) ) for ( const d of data ) delete d.ownership;
  const created = await scene.createEmbeddedDocuments("Region", data, {kgRegionQol: true});
  if ( missing.length ) {
    ui.notifications.warn(`Some behaviors were left off: ${summarizeMissing(missing).join(" | ")}`, {permanent: true});
  }
  if ( strip && data.length ) ui.notifications.info("Behaviors aren't pasted: only a GM can create region behaviors.");

  // Finish a cut by removing the originals
  if ( cut && created.length && clip ) {
    const source = game.scenes.get(clip.sceneId);
    const ids = (clip.ids ?? []).filter(id => source?.regions.has(id));
    if ( source && ids.length && (source !== scene) ) await source.deleteEmbeddedDocuments("Region", ids);
    clip = null;
    store();
    ui.controls?.render?.({reset: true});
  }
  if ( created.length === 1 ) {
    created[0].object?.control({releaseOthers: true, force: true});
    pinRegion(created[0]);
  }
  return created;
}

/** Paste with a live preview: click to place. */
export function pasteWithPreview() {
  if ( !hasClipboard() ) return ui.notifications.warn("Nothing copied yet. Select regions and press Ctrl+C.");
  ui.notifications.info("Click to paste. Right-click or Esc cancels, hold Shift to skip snapping.");
  const cut = clip.cut;
  return placeSnapshot(clip, {label: `Pasting ${clipboardSummary()}`, commit: data => createFromClip(data, {cut})});
}

/** Paste straight at a point, like the core Ctrl+V. */
async function pasteAt(point, {snap=true, hidden=false}={}) {
  const data = buildRegions(clip, point, {snap});
  if ( hidden ) for ( const d of data ) d.hidden = true;
  return createFromClip(data, {cut: clip.cut});
}

/** Wrap the Region layer's copy and paste. */
export function installClipboard() {
  const Layer = regionLayerClass();
  if ( !Layer ) return;
  const proto = Layer.prototype;

  const copyObjects = proto.copyObjects;
  proto.copyObjects = function(options={}) {
    const result = copyObjects.call(this, options);
    try {
      const objects = result ?? this.clipboard?.objects ?? [];
      if ( objects.length ) copyRegions(objects.map(o => o.document), {cut: !!options.cut});
    } catch(err) { console.error("kg-region-qol | copy failed", err); }
    return result;
  };

  const onPasteKey = proto._onPasteKey;
  proto._onPasteKey = function(event) {
    try {
      const shapeOnClipboard = !!this._shapeClipboard?.shape;
      const otherScene = hasClipboard() && (clip.sceneId !== canvas.scene?.id);
      const coreHasNothing = !this.clipboard?.objects?.length;
      if ( !shapeOnClipboard && hasClipboard() && (otherScene || coreHasNothing) ) {
        pasteAt(canvas.mousePosition, {snap: !event?.shiftKey, hidden: !!event?.altKey})
          .catch(err => ui.notifications.error(`Paste failed: ${err.message}`));
        return true;
      }
    } catch(err) { console.error("kg-region-qol | paste failed", err); }
    return onPasteKey.call(this, event);
  };
}
