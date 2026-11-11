/**
 * Region snapshots: a scene-independent copy of one or more Regions (config, behaviors, shapes relative to a
 * shared origin, elevation, and level names) that can be rebuilt as Region data on any scene.
 */
import { schemaHas } from "./util.mjs";

/** Region fields that describe how a Region looks and acts, independent of where it is. */
export const CONFIG_KEYS = ["color", "visibility", "highlightMode", "displayMeasurements", "restriction", "hidden",
  "locked", "flags"];

/* -------------------------------------------- */
/*  Shape transforms                            */
/* -------------------------------------------- */

/**
 * Map every coordinate of raw shape data.
 * @param {object} shape                 Raw shape data
 * @param {(x:number, y:number) => number[]} P   Point transform
 * @param {number} k                     Size scale
 * @param {object} grid                  {toCenters(offsets) => points, toOffsets(points) => offsets}
 * @param {"out"|"in"} direction         "out" converts grid offsets to points, "in" converts back
 */
function mapShape(shape, P, k, grid, direction) {
  const s = foundry.utils.deepClone(shape);
  const xy = () => { [s.x, s.y] = P(s.x, s.y); };
  switch ( s.type ) {
    case "rectangle": xy(); s.width *= k; s.height *= k; break;
    case "circle": xy(); s.radius *= k; break;
    case "ellipse": xy(); s.radiusX *= k; s.radiusY *= k; break;
    case "cone": xy(); s.radius *= k; break;
    case "ring": xy(); s.radius *= k; s.innerWidth *= k; s.outerWidth *= k; break;
    case "line": xy(); s.length *= k; s.width *= k; break;
    case "token": xy(); s.x = Math.round(s.x); s.y = Math.round(s.y); break;
    case "emanation": s.base = mapShape(s.base, P, k, grid, direction); s.radius *= k; break;
    case "polygon": {
      const pts = [];
      for ( let i = 0; i < s.points.length; i += 2 ) pts.push(...P(s.points[i], s.points[i + 1]));
      s.points = pts;
      if ( s.origin ) { const [x, y] = P(s.origin.x, s.origin.y); s.origin = {x, y}; }
      break;
    }
    case "grid": {
      if ( direction === "out" ) {
        s._kgCenters = grid.toCenters(s.offsets ?? []).map(p => P(p.x, p.y));
        delete s.offsets;
      } else {
        s.offsets = grid.toOffsets((s._kgCenters ?? []).map(([x, y]) => {
          const [px, py] = P(x, y);
          return {x: px, y: py};
        }));
        delete s._kgCenters;
      }
      if ( s.origin ) { const [x, y] = P(s.origin.x, s.origin.y); s.origin = {x, y}; }
      break;
    }
    default:
      if ( Number.isFinite(s.x) && Number.isFinite(s.y) ) xy();
  }
  return s;
}

/** Points that pin down where a shape is: used for the group origin and for snapping. */
function keyPoints(shape, grid) {
  switch ( shape.type ) {
    case "polygon": {
      const out = [];
      for ( let i = 0; i < shape.points.length; i += 2 ) out.push([shape.points[i], shape.points[i + 1]]);
      return out;
    }
    case "emanation": return keyPoints(shape.base, grid);
    case "grid": return grid.toCenters(shape.offsets ?? []).map(p => [p.x, p.y]);
    default: return Number.isFinite(shape.x) ? [[shape.x, shape.y]] : [];
  }
}

function gridAdapter(gridObject) {
  return {
    toCenters: offsets => offsets.map(o => gridObject.getCenterPoint(o)),
    toOffsets: points => {
      const seen = new Set();
      const out = [];
      for ( const p of points ) {
        const o = gridObject.getOffset(p);
        const key = `${o.i},${o.j}`;
        if ( seen.has(key) ) continue;
        seen.add(key);
        out.push({i: o.i, j: o.j});
      }
      return out;
    }
  };
}

/* -------------------------------------------- */
/*  Snapshots                                   */
/* -------------------------------------------- */

function levelInfo(region) {
  const ids = region._source.levels ?? [];
  const scene = region.parent;
  return ids.map(id => {
    const level = scene?.levels?.get?.(id);
    return {id, name: level?.name ?? null, bottom: level?.elevation?.bottom ?? null, top: level?.elevation?.top ?? null};
  });
}

/**
 * Snapshot behaviors without ids or stats so they can be recreated anywhere.
 * @param {RegionDocument} region
 */
export function snapshotBehaviors(region) {
  return region.toObject().behaviors.map(b => ({
    name: b.name ?? "", type: b.type, system: b.system ?? {}, disabled: !!b.disabled, flags: b.flags ?? {}
  }));
}

/**
 * Snapshot Regions so they can be rebuilt on any scene, keeping their relative layout.
 * @param {RegionDocument[]} regions   Regions from one scene
 * @param {object} [options]
 * @param {boolean} [options.ownership=true]   Keep per-user ownership (same world only)
 * @returns {{sceneId: string, gridSize: number, gridDistance: number, items: object[]}}
 */
export function snapshotRegions(regions, {ownership=true}={}) {
  const scene = regions[0].parent;
  const grid = gridAdapter(scene.grid);

  // The group origin is the centre of the bounding box of all key points
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for ( const r of regions ) {
    for ( const s of r.toObject().shapes ) {
      for ( const [x, y] of keyPoints(s, grid) ) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if ( !Number.isFinite(minX) ) { minX = maxX = 0; minY = maxY = 0; }
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  const toRel = (x, y) => [x - ox, y - oy];

  const items = regions.map(r => {
    const src = r.toObject();
    const config = {};
    for ( const key of CONFIG_KEYS ) if ( key in src ) config[key] = foundry.utils.deepClone(src[key]);
    const item = {
      name: src.name,
      config,
      behaviors: snapshotBehaviors(r),
      shapes: src.shapes.map(s => mapShape(s, toRel, 1, grid, "out")),
      elevation: foundry.utils.deepClone(src.elevation ?? {}),
      levels: levelInfo(r)
    };
    if ( ownership ) item.ownership = foundry.utils.deepClone(src.ownership);
    else if ( src.ownership?.default !== undefined ) item.ownership = {default: src.ownership.default};
    return item;
  });

  return {sceneId: scene.id, sceneName: scene.name, gridSize: scene.grid.size, gridDistance: scene.grid.distance,
    gridType: scene.grid.type, items};
}

/* -------------------------------------------- */
/*  Rebuilding                                  */
/* -------------------------------------------- */

/**
 * Map saved level references onto the target scene's levels, by name and then by elevation band.
 * @returns {string[]}
 */
export function mapLevels(levels, scene) {
  if ( !levels?.length || !scene?.levels ) return [];
  const sameScene = levels.every(l => scene.levels.has?.(l.id));
  if ( sameScene ) return levels.map(l => l.id);
  const out = new Set();
  const targets = [...scene.levels];
  for ( const l of levels ) {
    const byName = l.name && targets.find(t => t.name?.toLowerCase() === l.name.toLowerCase());
    const byBand = targets.find(t => (t.elevation?.bottom === l.bottom) && (t.elevation?.top === l.top));
    const match = byName || byBand;
    if ( match ) out.add(match.id);
  }
  if ( !out.size && canvas.level?.id ) out.add(canvas.level.id);
  return [...out];
}

function snapPoint(p) {
  const M = CONST.GRID_SNAPPING_MODES;
  return canvas.grid.getSnappedPoint({x: p.x, y: p.y}, {mode: M.CENTER | M.VERTEX | M.CORNER | M.SIDE_MIDPOINT});
}

/**
 * Build Region creation data from a snapshot at a target point on the current canvas.
 * @param {object} snapshot              From snapshotRegions or a preset geometry
 * @param {{x:number,y:number}} target   Where the group origin lands
 * @param {object} [options]
 * @param {boolean} [options.snap=true]  Snap the first shape's anchor to the grid
 * @param {boolean} [options.scale=true] Scale to the target scene's grid size
 * @param {boolean} [options.behaviors=true]
 * @returns {object[]} Region data
 */
export function buildRegions(snapshot, target, {snap=true, scale=true, behaviors=true}={}) {
  const k = (scale && snapshot.gridSize) ? (canvas.grid.size / snapshot.gridSize) : 1;
  const grid = gridAdapter(canvas.grid);
  let cx = 0; let cy = 0;
  const P = (x, y) => [target.x + (x * k) + cx, target.y + (y * k) + cy];

  // Snap correction from the first key point
  if ( snap && !canvas.grid.isGridless ) {
    const first = snapshot.items.flatMap(i => i.shapes).at(0);
    const ref = first && (first.type === "grid" ? first._kgCenters?.[0]
      : first.type === "polygon" ? [first.points[0], first.points[1]]
        : first.type === "emanation" ? [first.base.x, first.base.y] : [first.x, first.y]);
    if ( ref && Number.isFinite(ref[0]) ) {
      const [px, py] = P(ref[0], ref[1]);
      const s = snapPoint({x: px, y: py});
      cx = s.x - px; cy = s.y - py;
    }
  }

  return snapshot.items.map(item => buildOne(item, {P, k, grid, behaviors}));
}

function buildOne(item, {P, k, grid, behaviors}) {
  const data = {name: item.name};
  for ( const [key, value] of Object.entries(item.config ?? {}) ) {
    if ( schemaHas(key) ) data[key] = foundry.utils.deepClone(value);
  }
  data.shapes = (item.shapes ?? []).map(s => mapShape(s, P, k, grid, "in"));
  if ( item.elevation && schemaHas("elevation") ) {
    const e = foundry.utils.deepClone(item.elevation);
    if ( !schemaHas("levels") ) delete e.topInclusive;
    data.elevation = e;
  }
  if ( schemaHas("levels") ) data.levels = mapLevels(item.levels, canvas.scene);
  if ( (data.restriction?.enabled) && schemaHas("levels") && (data.levels.length !== 1) ) {
    data.levels = canvas.level?.id ? [canvas.level.id] : data.levels.slice(0, 1);
  }
  if ( item.ownership ) data.ownership = foundry.utils.deepClone(item.ownership);
  if ( schemaHas("attachment") ) data.attachment = {token: null};
  data.behaviors = behaviors ? foundry.utils.deepClone(item.behaviors ?? []) : [];
  return data;
}
