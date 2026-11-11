export const MODULE_ID = "kg-region-qol";

/** Region tool names that draw shapes, for Foundry versions whose tools lack the `creation` flag. */
const SHAPE_TOOLS = new Set(["rectangle", "circle", "ellipse", "cone", "ring", "line", "emanation", "polygon", "grid"]);

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function regionLayerClass() {
  return foundry.canvas?.layers?.RegionLayer ?? CONFIG.Canvas.layers.regions?.layerClass;
}

/** Is the active scene-control tool a region shape tool (rectangle, polygon, ...)? */
export function isShapeToolActive() {
  if ( !canvas?.ready || !canvas.regions?.active ) return false;
  if ( canvas.regions.templateMode ) return false;
  const tool = ui.controls?.tool;
  if ( tool && (typeof tool === "object") && ("creation" in tool) ) return !!tool.creation;
  const name = (typeof tool === "string") ? tool : (tool?.name ?? game.activeTool);
  return SHAPE_TOOLS.has(name);
}

export function isHoleToolActive() {
  const tools = ui.controls?.tools ?? ui.controls?.control?.tools;
  return !!tools?.hole?.active;
}

export function schemaHas(key) {
  const schema = CONFIG.Region.documentClass.schema;
  return !!(schema.has?.(key) ?? schema.fields?.[key]);
}

export function saveJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
  save(json, "application/json", filename);
}

export function readFileText(file) {
  const read = foundry.utils.readTextFromFile ?? globalThis.readTextFromFile;
  if ( read ) return read(file);
  return file.text();
}

export function slug(text) {
  return String(text || "preset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";
}

export function localizeBehaviorType(type) {
  const label = CONFIG.RegionBehavior.typeLabels?.[type];
  return label ? game.i18n.localize(label) : type;
}

export function behaviorTypeIcon(type) {
  return CONFIG.RegionBehavior.typeIcons?.[type] ?? "fa-solid fa-gear";
}

export function cancelCanvasDrag() {
  const mim = canvas.currentMouseManager;
  if ( !mim ) return;
  try {
    mim.interactionData.cancelled = true;
    mim.cancel();
  } catch(err) { /* nothing to cancel */ }
}
