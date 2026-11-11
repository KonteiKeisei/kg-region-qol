/**
 * Which behavior types can run here, and which package a missing one comes from.
 */
import { localizeBehaviorType } from "./util.mjs";

const UUID_PATTERN = /^(Compendium\.[\w.-]+\.[\w-]+\.[A-Za-z0-9]{16}|(Scene|Macro|Actor|Item|JournalEntry|RollTable|Playlist|Cards|Adventure|Folder|User)\.[A-Za-z0-9]{16})(\.[\w.]+)?$/;

export function availableBehaviorTypes() {
  const types = new Set(game.documentTypes?.RegionBehavior ?? []);
  for ( const t of Object.keys(CONFIG.RegionBehavior.dataModels ?? {}) ) types.add(t);
  types.delete("base");
  return types;
}

/** Record which package provides each behavior type, so a missing one can be named later. */
export function describePackages(behaviors) {
  const out = {};
  for ( const b of behaviors ) {
    const id = packageIdOf(b.type);
    if ( !id || out[id] ) continue;
    const pkg = game.modules.get(id) ?? ((game.system.id === id) ? game.system : null);
    out[id] = {
      title: pkg?.title ?? id,
      version: pkg?.version ?? null,
      kind: (game.system.id === id) ? "system" : "module",
      url: pkg?.url ?? null
    };
  }
  return out;
}

export function packageIdOf(type) {
  const dot = type?.indexOf(".") ?? -1;
  return dot > 0 ? type.slice(0, dot) : null;
}

/**
 * Can this behavior type be used in this world? If not, say why.
 * @param {string} type
 * @param {object} [packages]      The preset's recorded packages
 * @param {string} [coreVersion]   The Foundry version the preset was made on
 * @returns {{ok: boolean, reason: string|null, packageId: string|null}}
 */
export function behaviorStatus(type, packages={}, coreVersion=null) {
  if ( availableBehaviorTypes().has(type) ) return {ok: true, reason: null, packageId: packageIdOf(type)};
  const pkgId = packageIdOf(type);
  if ( !pkgId ) {
    const made = coreVersion ? ` It was saved on Foundry ${coreVersion}; this world runs ${game.version}.` : "";
    return {ok: false, packageId: null,
      reason: `Core behavior "${type}" isn't part of this Foundry version.${made}`};
  }
  const meta = packages[pkgId] ?? {};
  const title = meta.title ?? pkgId;
  const ver = meta.version ? ` (saved with v${meta.version})` : "";
  if ( pkgId === game.system.id ) {
    return {ok: false, packageId: pkgId,
      reason: `Needs system "${title}"${ver} with behavior "${type}". This system version doesn't have it.`};
  }
  const mod = game.modules.get(pkgId);
  if ( meta.kind === "system" ) {
    return {ok: false, packageId: pkgId, reason: `Needs game system "${title}"${ver}. This world uses ${game.system.title}.`};
  }
  if ( !mod ) return {ok: false, packageId: pkgId, reason: `Needs module "${title}"${ver}, which isn't installed.`};
  if ( !mod.active ) return {ok: false, packageId: pkgId, reason: `Needs module "${mod.title}", which is installed but not active in this world.`};
  return {ok: false, packageId: pkgId,
    reason: `Module "${mod.title}" is active, but its version ${mod.version} doesn't provide "${type}"${ver}.`};
}

/** Split behaviors into usable ones and missing ones with reasons. */
export function splitBehaviors(behaviors, packages={}, coreVersion=null) {
  const ok = [];
  const missing = [];
  for ( const b of behaviors ?? [] ) {
    const status = behaviorStatus(b.type, packages, coreVersion);
    if ( status.ok ) ok.push(b);
    else missing.push({behavior: b, ...status});
  }
  return {ok, missing};
}

/** Document links inside behavior settings that don't resolve in this world. */
export function brokenLinks(behavior) {
  const found = [];
  const walk = value => {
    if ( typeof value === "string" ) {
      if ( UUID_PATTERN.test(value) ) {
        let doc = null;
        try { doc = fromUuidSync(value, {strict: false}); } catch(err) { doc = null; }
        if ( !doc ) found.push(value);
      }
    }
    else if ( Array.isArray(value) ) value.forEach(walk);
    else if ( value && (typeof value === "object") ) Object.values(value).forEach(walk);
  };
  walk(behavior.system);
  return found;
}

export function behaviorLabel(b) {
  return b.name || localizeBehaviorType(b.type);
}

/** One line per missing behavior, for notifications. */
export function summarizeMissing(missing) {
  const byPkg = new Map();
  for ( const m of missing ) {
    const key = m.reason;
    if ( !byPkg.has(key) ) byPkg.set(key, []);
    byPkg.get(key).push(behaviorLabel(m.behavior));
  }
  return [...byPkg].map(([reason, names]) => `${names.join(", ")}: ${reason}`);
}
