import { esc, behaviorTypeIcon } from "./util.mjs";
import { behaviorLabel, behaviorStatus, brokenLinks } from "./requirements.mjs";
import {
  applyPresetDialog, deletePreset, exportPresets, getPreset, getPresets, importPresetsDialog, placePreset,
  savePresetDialog, upsertPreset, usePresetForNewRegions
} from "./presets.mjs";
import { armPreset, armedPresetId } from "./sticky.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class RegionPresetManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "kg-rqol-presets",
    classes: ["kg-rqol-manager"],
    window: {title: "Region Presets", icon: "fa-solid fa-swatchbook", resizable: true},
    position: {width: 560, height: 640},
    actions: {
      save: RegionPresetManager.#onSave,
      import: RegionPresetManager.#onImport,
      exportAll: RegionPresetManager.#onExportAll,
      place: RegionPresetManager.#onPlace,
      apply: RegionPresetManager.#onApply,
      arm: RegionPresetManager.#onArm,
      export: RegionPresetManager.#onExport,
      edit: RegionPresetManager.#onEdit,
      delete: RegionPresetManager.#onDelete
    }
  };

  static #instance;

  static open() {
    this.#instance ??= new this();
    this.#instance.render({force: true});
    return this.#instance;
  }

  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  #filter = "";

  /** @override */
  async _renderHTML() {
    const presets = getPresets();
    const armed = armedPresetId();
    const controlled = canvas.regions?.controlled?.length ?? 0;
    const rows = presets.map(p => this.#row(p, armed)).join("");
    return `
      <div class="rqol-toolbar">
        <button type="button" data-action="save" ${controlled === 1 ? "" : "disabled"}
          data-tooltip="${controlled === 1 ? "Save the selected region as a preset" : "Select one region on the canvas first"}">
          <i class="fa-solid fa-floppy-disk"></i> Save selected region</button>
        <button type="button" data-action="import"><i class="fa-solid fa-file-import"></i> Import</button>
        <button type="button" data-action="exportAll" ${presets.length ? "" : "disabled"}><i class="fa-solid fa-file-export"></i> Export all</button>
      </div>
      <input type="search" class="rqol-search" placeholder="Search presets" value="${esc(this.#filter)}">
      <ol class="rqol-list">${rows || `<li class="rqol-empty">No presets yet. Select a region and press <b>Save selected region</b>, or import a preset file.</li>`}</ol>`;
  }

  #row(p, armed) {
    const color = p.config?.color ?? "#888";
    let missingCount = 0;
    const chips = p.behaviors.map(b => {
      const status = behaviorStatus(b.type, p.packages, p.coreVersion);
      const label = esc(behaviorLabel(b));
      if ( !status.ok ) {
        missingCount++;
        return `<span class="rqol-chip missing" data-tooltip="${esc(status.reason)}">
          <i class="fa-solid fa-triangle-exclamation"></i> ${label}</span>`;
      }
      const broken = brokenLinks(b);
      const warn = broken.length
        ? ` data-tooltip="${esc(`Links to ${broken.length === 1 ? "a document" : "documents"} not in this world: ${broken.join(", ")}`)}"` : "";
      return `<span class="rqol-chip${broken.length ? " broken" : ""}${b.disabled ? " disabled" : ""}"${warn}>
        <i class="${esc(behaviorTypeIcon(b.type))}"></i> ${label}${broken.length ? ` <i class="fa-solid fa-link-slash"></i>` : ""}</span>`;
    }).join("");
    const geometry = p.geometry?.shapes?.length;
    const badges = [
      geometry ? `<span class="rqol-badge" data-tooltip="Includes ${geometry} shape${geometry === 1 ? "" : "s"}, elevation and level"><i class="fa-solid fa-draw-polygon"></i> Shape</span>` : "",
      missingCount ? `<span class="rqol-badge warn" data-tooltip="${esc(`${missingCount} behavior${missingCount === 1 ? "" : "s"} can't run here and will be left out when you use this preset. Hover each one to see what's missing.`)}"><i class="fa-solid fa-triangle-exclamation"></i> ${missingCount}</span>` : "",
      (armed === p.id) ? `<span class="rqol-badge on"><i class="fa-solid fa-bolt"></i> In use</span>` : ""
    ].join("");
    const hidden = this.#filter && !`${p.name} ${p.description}`.toLowerCase().includes(this.#filter.toLowerCase());
    return `<li class="rqol-preset" data-preset-id="${esc(p.id)}" ${hidden ? "hidden" : ""}>
      <div class="rqol-head">
        <span class="rqol-swatch" style="background:${esc(color)}"></span>
        <span class="rqol-name">${esc(p.name)}</span>${badges}
      </div>
      ${p.description ? `<p class="rqol-desc">${esc(p.description)}</p>` : ""}
      <div class="rqol-chips">${chips || `<span class="rqol-none">No behaviors</span>`}</div>
      <div class="rqol-actions">
        ${geometry ? `<button type="button" data-action="place" data-tooltip="Click on the canvas to stamp this region"><i class="fa-solid fa-stamp"></i> Place</button>` : ""}
        <button type="button" data-action="arm" data-tooltip="Every new region you draw gets this preset, until you clear it"><i class="fa-solid fa-bolt"></i> Use for new regions</button>
        <button type="button" data-action="apply" data-tooltip="Apply to the selected region(s)"><i class="fa-solid fa-wand-magic-sparkles"></i> Apply to selected</button>
        <span class="rqol-spacer"></span>
        <button type="button" class="icon" data-action="export" data-tooltip="Export as a file"><i class="fa-solid fa-file-export"></i></button>
        <button type="button" class="icon" data-action="edit" data-tooltip="Rename or describe"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="icon" data-action="delete" data-tooltip="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </li>`;
  }

  /** @override */
  _replaceHTML(result, content) {
    content.innerHTML = result;
    const search = content.querySelector(".rqol-search");
    search?.addEventListener("input", () => {
      this.#filter = search.value;
      for ( const li of content.querySelectorAll(".rqol-preset") ) {
        const p = getPreset(li.dataset.presetId);
        li.hidden = !!this.#filter && !`${p?.name} ${p?.description}`.toLowerCase().includes(this.#filter.toLowerCase());
      }
    });
  }

  static #preset(target) {
    return getPreset(target.closest("[data-preset-id]")?.dataset.presetId);
  }

  static async #onSave() { await savePresetDialog(); }
  static #onImport() { importPresetsDialog(); }
  static #onExportAll() { exportPresets(getPresets()); }
  static #onExport(event, target) { const p = RegionPresetManager.#preset(target); if ( p ) exportPresets([p]); }
  static async #onApply(event, target) { const p = RegionPresetManager.#preset(target); if ( p ) await applyPresetDialog(p); }

  static async #onPlace(event, target) {
    const p = RegionPresetManager.#preset(target);
    if ( !p ) return;
    this.minimize();
    try { await placePreset(p); } finally { this.maximize(); }
  }

  static #onArm(event, target) {
    const p = RegionPresetManager.#preset(target);
    if ( !p ) return;
    if ( armedPresetId() === p.id ) armPreset(null);
    else usePresetForNewRegions(p);
    this.render();
  }

  static async #onEdit(event, target) {
    const p = RegionPresetManager.#preset(target);
    if ( !p ) return;
    const data = await foundry.applications.api.DialogV2.prompt({
      window: {title: `Edit "${p.name}"`, icon: "fa-solid fa-pen"},
      position: {width: 420},
      content: `<div class="kg-rqol-form">
        <div class="form-group"><label>Preset name</label><div class="form-fields"><input type="text" name="name" value="${esc(p.name)}" required></div></div>
        <div class="form-group"><label>Region name</label><div class="form-fields"><input type="text" name="regionName" value="${esc(p.regionName ?? p.name)}"></div></div>
        <div class="form-group stacked"><label>Description</label><textarea name="description" rows="3">${esc(p.description)}</textarea></div>
      </div>`,
      ok: {label: "Save", icon: "fa-solid fa-check",
        callback: (e, button) => new foundry.applications.ux.FormDataExtended(button.form).object},
      rejectClose: false
    });
    if ( !data ) return;
    p.name = data.name?.trim() || p.name;
    p.regionName = data.regionName?.trim() || p.name;
    p.description = data.description?.trim() ?? "";
    await upsertPreset(p);
  }

  static async #onDelete(event, target) {
    const p = RegionPresetManager.#preset(target);
    if ( !p ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: {title: "Delete preset"},
      content: `<p>Delete the region preset <b>${esc(p.name)}</b>? Regions already made from it are not changed.</p>`,
      rejectClose: false
    });
    if ( ok ) await deletePreset(p.id);
  }
}
