import type { EntityRecord } from '@/lib/intake/entities';
import {
  FUEL_ALIAS,
  fuelDisplay,
  fuelEmbeddedCc,
  parseYear,
} from '@/lib/domain/vehicle-master-format';
import { vehicleSignalBlob } from '@/lib/domain/vehicle-master-signals';
import { isNoTrimLabel, realMasterTrims } from '@/lib/domain/vehicle-master-options';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';

export type VehicleNormalizeDeps = {
  norm: (value: unknown) => string;
  carYear: (product: EntityRecord) => number;
  seatsFromBlob: (blob: string) => number;
  normDrive: (value: unknown) => string;
  driveFromBlob: (blob: string) => string;
  makerGroup: (maker: string) => string[];
  looksCompoundVehicleText: (value: unknown) => boolean;
  canonMasterTrim: (value: unknown, pool?: string[] | null) => string;
  modelAlias: Record<string, string>;
};

function yearFromBlob(blob: string): number {
  const match =
    /(\d{2,4})\s*년\s*식/.exec(blob) ||
    /(20\d{2}|\d{2})\s*년(?!\s*식)/.exec(blob) ||
    /\b(20\d{2})\b/.exec(blob);
  return match ? parseYear(match[1]) : 0;
}

function ccFromBlob(blob: string): number {
  const liter = /(?:^|[^\d])(\d\.\d)\s*(?:l|L|리터)?(?=$|[^\d])/.exec(blob);
  if (liter) {
    const number = Number(liter[1]);
    if (number >= 0.6 && number <= 8) return Math.round(number * 1000);
  }
  const cc = /(?:^|[^\d])([1-7]\d{3})\s*(?:cc|CC)?(?=$|[^\d.])/.exec(blob);
  if (cc) {
    const number = Number(cc[1]);
    if (number >= 600 && number <= 8000 && !(number >= 1990 && number <= 2099)) return number;
  }
  return 0;
}

export function unpackVehicleSignalsEngine(
  product: EntityRecord,
  entries: MasterEntry[],
  deps: VehicleNormalizeDeps,
): EntityRecord {
  if (!entries.length) return product;
  const out: EntityRecord = { ...product };
  const blob = vehicleSignalBlob(out);
  if (!blob.trim()) return out;
  const normalizedBlob = deps.norm(blob);

  if (!deps.carYear(out)) {
    const year = yearFromBlob(blob);
    if (year) out.year = String(year);
  } else {
    const year = parseYear(out.year) || yearFromBlob(String(out.year));
    if (year) out.year = String(year);
  }

  {
    const rawCc = String(out.engine_cc ?? '').trim();
    const number = Number(rawCc.replace(/,/g, ''));
    let cc = 0;
    if (Number.isFinite(number) && number > 0) {
      if (number >= 0.6 && number <= 8) cc = Math.round(number * 1000);
      else if (number >= 600 && number <= 8000) cc = Math.round(number);
    }
    if (!cc) cc = fuelEmbeddedCc(out.fuel_type) || ccFromBlob(blob);
    if (cc) out.engine_cc = String(cc);
  }

  if (!(Number(out.seats) > 0)) {
    const seats = deps.seatsFromBlob(blob);
    if (seats) out.seats = String(seats);
  }
  if (!deps.normDrive(out.drive_type)) {
    const drive = deps.driveFromBlob(blob);
    if (drive) out.drive_type = drive;
  } else {
    out.drive_type = deps.normDrive(out.drive_type) || out.drive_type;
  }

  if (!fuelDisplay(out.fuel_type)) {
    for (const key of Object.keys(FUEL_ALIAS)) {
      if (!normalizedBlob.includes(key)) continue;
      const display = fuelDisplay(FUEL_ALIAS[key]);
      if (display) {
        out.fuel_type = display;
        break;
      }
    }
  }

  const catalog = String(out.catalog_id || out.type_number || '').trim().toUpperCase();
  if (catalog) {
    let candidates = entries.filter((entry) => String(entry.gen_code || '').trim().toUpperCase() === catalog);
    const maker = String(out.maker || '').trim();
    if (maker) {
      const makerGroup = deps.makerGroup(deps.norm(maker));
      candidates = candidates.filter((entry) => makerGroup.some((group) => {
        const entryMaker = deps.norm(entry.maker);
        return entryMaker === group || entryMaker.includes(group) || group.includes(entryMaker);
      }));
    }
    const model = String(out.model || '').trim();
    if (model && !deps.looksCompoundVehicleText(model)) {
      candidates = candidates.filter((entry) => deps.norm(entry.model) === deps.norm(model) || deps.norm(model).includes(deps.norm(entry.model)));
    }
    if (candidates.length === 1) {
      const hit = candidates[0];
      if (!String(out.sub_model ?? '').trim()) out.sub_model = hit.sub_model;
      if (!String(out.model ?? '').trim()) out.model = hit.model;
      if (!maker) out.maker = hit.maker;
    } else if (candidates.length > 1) {
      const models = new Set(candidates.map((entry) => entry.model));
      const makers = new Set(candidates.map((entry) => entry.maker));
      if (models.size === 1 && !String(out.model ?? '').trim()) out.model = candidates[0].model;
      if (makers.size === 1 && !maker) out.maker = candidates[0].maker;
    }
  }

  const modelProbe = deps.norm([
    out.model,
    out.sub_model,
    out.cert_car_name,
    out.vehicle_name,
    out.trim_name,
    out.variant,
    out.options,
    out.partner_memo,
    out.engine_type,
  ].map((value) => String(value ?? '').trim()).filter(Boolean).join(' '));
  const models = [...new Set(entries.map((entry) => entry.model))].sort((a, b) => b.length - a.length);
  let hitModel = '';
  if (modelProbe) {
    for (const model of models) {
      const normalizedModel = deps.norm(model);
      if (normalizedModel.length >= 2 && modelProbe.includes(normalizedModel)) {
        hitModel = model;
        break;
      }
    }
    if (!hitModel) {
      for (const [alias, canonical] of Object.entries(deps.modelAlias)) {
        if (!modelProbe.includes(alias)) continue;
        const real = models.find((model) => deps.norm(model) === deps.norm(canonical))
          || models.find((model) => deps.norm(model) === alias);
        if (real) {
          hitModel = real;
          break;
        }
      }
    }
  }

  const trimHintModel = hitModel;
  const trimEmpty = !String(out.trim_name ?? '').trim();
  const modelWasBlob = deps.looksCompoundVehicleText(product.model)
    || deps.looksCompoundVehicleText(product.sub_model)
    || deps.looksCompoundVehicleText(product.cert_car_name)
    || deps.looksCompoundVehicleText(product.vehicle_name);
  if (trimEmpty || modelWasBlob) {
    const trimSet = new Set<string>();
    for (const entry of entries) {
      if (trimHintModel && entry.model !== trimHintModel) continue;
      for (const trim of realMasterTrims(entry.trims)) trimSet.add(trim);
      for (const variant of entry.variants || []) {
        for (const trim of realMasterTrims(variant.trims)) trimSet.add(trim);
      }
    }
    if (!trimHintModel) {
      for (const entry of entries) {
        for (const trim of realMasterTrims(entry.trims)) trimSet.add(trim);
        for (const variant of entry.variants || []) {
          for (const trim of realMasterTrims(variant.trims)) trimSet.add(trim);
        }
      }
    }
    for (const trim of [...trimSet].sort((a, b) => b.length - a.length)) {
      if (deps.norm(trim).length < 2) continue;
      if (normalizedBlob.includes(deps.norm(trim))) {
        out.trim_name = trim;
        break;
      }
    }
  }

  if (isNoTrimLabel(out.trim_name) || String(out.trim_name || '').trim().length > 40) {
    out.trim_name = '';
  } else if (String(out.trim_name || '').trim()) {
    const pool: string[] = [];
    const hint = String(out.model || hitModel || '').trim();
    for (const entry of entries) {
      if (hint && entry.model !== hint) continue;
      for (const trim of realMasterTrims(entry.trims)) pool.push(trim);
      for (const variant of entry.variants || []) {
        for (const trim of realMasterTrims(variant.trims)) pool.push(trim);
      }
    }
    const canonical = deps.canonMasterTrim(out.trim_name, pool.length ? pool : null);
    if (canonical) out.trim_name = canonical;
  }

  if (hitModel) {
    const modelRaw = String(out.model ?? '').trim();
    const peeled = !!(
      out.trim_name
      && deps.norm(modelRaw).includes(deps.norm(String(out.trim_name)))
      && deps.norm(modelRaw).includes(deps.norm(hitModel))
      && deps.norm(modelRaw) !== deps.norm(hitModel)
    );
    if (!modelRaw || deps.looksCompoundVehicleText(modelRaw) || peeled) out.model = hitModel;
    if (!String(out.maker ?? '').trim()) {
      const maker = entries.find((entry) => entry.model === hitModel)?.maker;
      if (maker) out.maker = maker;
    }
  }

  return out;
}
