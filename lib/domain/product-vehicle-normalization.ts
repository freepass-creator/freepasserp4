/**
 * 차량번호 → 정규화 차명(제조사·모델·세부모델·파워트레인·세부트림).
 *
 * ★사장님 2026-08-15 — 「차량번호랑 차종마스터 코드를 생성하는 게 관건 · 나머지는 1/1로 댕겨오면 되는 거니까」
 * ★범위 3축(모델·세부모델·세부트림) — 사장님 2026-08-18 확정.
 *
 * 정본 차례(앞이 이긴다):
 *   ① 상품마스터의 차종코드 → 차종마스터 artifact 이름(원장 승격 후 정본).
 *      `preferMasterNames=false`(기본, 승격 전)이면 「차종마스터_규격채택」 채택 이름이 artifact보다 이긴다.
 *      승격 apply 이후에는 `preferMasterNames=true` 또는 채택 Map 비움 — 원장이 1순위, 채택은 폴백/이력.
 *      파워트레인은 항상 artifact(시트 합침열 제거 후에도 prior·파생 라벨).
 *   ② 사람 검토 결정 `data/product-vehicle-review-decisions.json` — CODE 는 ①과 같고, TRIPLE 은 3축만(파워트레인 없음).
 *      PARTIAL 은 모델·세부모델만, HOLD 는 아무것도 안 준다.
 *   ③ 여기서 못 찾으면 발행기가 기존 길(정제칸 → 스냅 → 원문)로 간다.
 *
 * 이 모듈은 API 를 부르지 않는다 — 값 배열을 받아 Map 을 만든다. 읽기는 호출자가 한다.
 */
import type { VehicleTrimMasterArtifact, VehicleTrimMasterRecord } from './vehicle-trim-master';
import type { ProductVehicleReviewDecision } from './product-vehicle-review-decisions';
import { isNoTrimLabel, canonSalesTrim } from './vehicle-master-options';
import { applyLatinBrandTokens } from './vehicle-master-lock';

export type NormalizedVehicleName = {
  maker: string; model: string; sub_model: string; powertrain: string; trim: string;
  /** 차종마스터 행의 연료·정확배기량(사장님 2026-08-18 「차종마스터 탭 활용하면 되고」) — 코드가 있으면 이 값이 판매시트 연료·배기량을 이긴다 */
  fuel: string; engine_cc: number | null;
  battery_kwh: number | null;
  /** code = 상품마스터 차종코드, decision = 3축 검토 결정 */
  source: 'code' | 'decision';
  trim_row_key: string;
  /** 규격채택 이름을 썼는지(false 면 artifact 이름) */
  adopted: boolean;
  /** 차종구분(규격채택 차종분류+차체형태, 「준대형 세단」) — 코드가 없어도 세부모델까지 마스터에 붙으면 준다(2026-08-19). */
  vehicle_class?: string;
};

const S = (value: unknown) => String(value ?? '').trim();
export const normalizePlate = (value: unknown) => S(value).replace(/\s/g, '');

export type AdoptedSpecName = { maker: string; model: string; sub_model: string; trim: string; status: string; vehicle_class?: string; body_form?: string };
/**
 * ★차종구분 = 규격_차종분류(경형·소형·준중형·중형·준대형·대형) + 규격_차체형태(SUV·세단·MPV·해치백·밴…) → 「준중형 SUV」·「준대형 세단」.
 *   사장님 2026-08-19 「주행거리 앞에 차종구분 하나 넣어 주라, 준중형 SUV 이런 거 — 공급사 시트에는 자동처리로, 차종마스터 연동해서」.
 *   코드가 있는 차는 이 값이 정본(정제칸 「차종분류」에 박고 판매시트 「차종구분」으로 나간다), 코드 없는 차는 classifyVehicleClass 스냅.
 */
export const adoptedVehicleClassText = (spec: AdoptedSpecName | undefined): string =>
  spec ? [S(spec.vehicle_class), S(spec.body_form)].filter(Boolean).join(' ') : '';

/** 「차종마스터_규격채택」 A:AD 값 → 트림행키별 채택 이름. 검토유지 행은 이름을 주지 않는다. */
export function adoptedSpecByKey(values: readonly unknown[][]): Map<string, AdoptedSpecName> {
  const headers = (values[0] || []).map(S);
  const col = (name: string) => headers.indexOf(name);
  for (const need of ['트림행키', '규격채택상태', '규격_제조사', '규격_모델', '규격_세부모델', '규격_세부트림']) {
    if (col(need) < 0) throw new Error(`규격채택 탭 머리글 없음: ${need}`);
  }
  const out = new Map<string, AdoptedSpecName>();
  for (const row of values.slice(1)) {
    const key = S(row[col('트림행키')]);
    const status = S(row[col('규격채택상태')]);
    if (!key || !status.startsWith('규격구조채택')) continue;
    out.set(key, {
      maker: S(row[col('규격_제조사')]), model: S(row[col('규격_모델')]),
      sub_model: S(row[col('규격_세부모델')]), trim: S(row[col('규격_세부트림')]), status,
      vehicle_class: col('규격_차종분류') >= 0 ? S(row[col('규격_차종분류')]) : '',
      body_form: col('규격_차체형태') >= 0 ? S(row[col('규격_차체형태')]) : '',
    });
  }
  return out;
}

export function normalizedNameForKey(
  key: string,
  masterByKey: Map<string, VehicleTrimMasterRecord>,
  adopted: Map<string, AdoptedSpecName>,
  options?: { preferMasterNames?: boolean },
): NormalizedVehicleName | null {
  const master = masterByKey.get(key);
  if (!master) return null;
  const spec = adopted.get(key);
  const preferMaster = Boolean(options?.preferMasterNames);
  const pick = (masterValue: string, adoptedValue: string | undefined) => (
    preferMaster ? (S(masterValue) || S(adoptedValue)) : (S(adoptedValue) || S(masterValue))
  );
  return {
    maker: pick(master.maker, spec?.maker),
    model: pick(master.model, spec?.model),
    sub_model: pick(master.sub_model, spec?.sub_model),
    powertrain: S(master.powertrain),
    trim: canonSalesTrim(pick(master.maker, spec?.maker), pick(master.model, spec?.model), pick(master.sub_model, spec?.sub_model), (() => {
      const t = applyLatinBrandTokens(pick(master.trim, spec?.trim));
      return isNoTrimLabel(t) ? '' : t;
    })()),
    fuel: S(master.fuel), engine_cc: master.engine_cc == null ? null : Number(master.engine_cc),
    battery_kwh: master.battery_kwh == null ? null : Number(master.battery_kwh),
    source: 'code', trim_row_key: key,
    adopted: Boolean(spec),
    vehicle_class: adoptedVehicleClassText(spec),
  };
}

/**
 * 상품마스터 A:AZ 값(머리글 포함) + 채택 이름 + artifact + 결정 → 차량번호별 정규화 차명.
 * 상품마스터에서 코드가 빈 차는 결정으로, 결정도 없으면 넣지 않는다.
 */
export function buildPlateNormalization(input: {
  productMasterValues: readonly unknown[][];
  adopted: Map<string, AdoptedSpecName>;
  artifact: VehicleTrimMasterArtifact;
  decisions: readonly ProductVehicleReviewDecision[];
  /** 원장 승격 후 true — artifact 이름 1순위, 규격채택은 빈칸 폴백. */
  preferMasterNames?: boolean;
}): { byPlate: Map<string, NormalizedVehicleName>; stats: Record<string, number> } {
  const headers = (input.productMasterValues[0] || []).map(S);
  const plateCol = headers.indexOf('차량번호');
  const codeCol = headers.indexOf('차종코드');
  if (plateCol < 0 || codeCol < 0) throw new Error('상품마스터 머리글에 차량번호/차종코드 없음');
  const masterByKey = new Map(input.artifact.records.map((row) => [row.trim_row_key, row]));
  const byPlate = new Map<string, NormalizedVehicleName>();
  const nameOpts = { preferMasterNames: Boolean(input.preferMasterNames) };
  const stats: Record<string, number> = { code_adopted: 0, code_artifact: 0, code_unknown_key: 0, decision_code: 0, decision_triple: 0, decision_partial: 0, decision_hold: 0, decision_overrides: 0 };
  for (const row of input.productMasterValues.slice(1)) {
    const plate = normalizePlate(row[plateCol]);
    const key = S(row[codeCol]);
    if (!plate || !key) continue;
    const name = normalizedNameForKey(key, masterByKey, input.adopted, nameOpts);
    if (!name) { stats.code_unknown_key++; continue; }
    byPlate.set(plate, name);
    if (name.adopted) stats.code_adopted++; else stats.code_artifact++;
  }
  for (const d of input.decisions) {
    const plate = normalizePlate(d.car_number);
    // 상품마스터 코드가 이긴다 — 단, 검토가 「현재 코드의 세부트림이 틀렸다」고 명시한 결정(overrides_current_code)은 예외.
    if (byPlate.has(plate) && !d.overrides_current_code) continue;
    if (d.overrides_current_code) { byPlate.delete(plate); stats.decision_overrides = (stats.decision_overrides || 0) + 1; }
    if (d.decision === 'HOLD') { stats.decision_hold++; continue; }
    if (d.decision === 'CODE' && d.trim_row_key) {
      const name = normalizedNameForKey(d.trim_row_key, masterByKey, input.adopted, nameOpts);
      if (name) { byPlate.set(plate, { ...name, source: 'decision' }); stats.decision_code++; continue; }
    }
    if (!S(d.model)) { stats.decision_hold++; continue; }
    // [자동합의] — 3축이 같은 후보키들이 있으면 채택 이름으로 통일한다(후보끼리 채택 이름이 다르면 결정값 그대로).
    // ★2026-08-19 사장님 「차종마스터 기준으로 통일 — G80 3세대 초기형 RG3 는 G80 RG3 · 준대형 세단이라고 해야」:
    //   후보키가 없으면 마스터에서 (제조사·모델·개발코드·초기형/FL) 로 후보를 찾고, 트림이 갈려도 «세부모델까지 같으면» 채택 이름(규격_세부모델)과 차종구분을 쓴다.
    const keys = (d.candidate_keys && d.candidate_keys.length) ? d.candidate_keys : guessCandidateKeys(d, input.artifact.records);
    const candidateNames = keys.map((key) => normalizedNameForKey(key, masterByKey, input.adopted, nameOpts)).filter(Boolean) as NormalizedVehicleName[];
    const subUniform = candidateNames.length && candidateNames.every((c) => c.maker === candidateNames[0].maker && c.model === candidateNames[0].model
      && c.sub_model === candidateNames[0].sub_model) ? candidateNames[0] : null;
    const uniform = subUniform && candidateNames.every((c) => c.trim === candidateNames[0].trim) ? candidateNames[0] : null;
    const samePowertrain = candidateNames.length && candidateNames.every((c) => c.powertrain === candidateNames[0].powertrain);
    const sameFuel = candidateNames.length && candidateNames.every((c) => c.fuel === candidateNames[0].fuel);
    const sameCc = candidateNames.length && candidateNames.every((c) => c.engine_cc === candidateNames[0].engine_cc);
    const sameBattery = candidateNames.length && candidateNames.every((c) => c.battery_kwh === candidateNames[0].battery_kwh);
    byPlate.set(plate, {
      maker: subUniform?.maker || S(d.maker), model: subUniform?.model || S(d.model), sub_model: subUniform?.sub_model || S(d.sub_model),
      powertrain: samePowertrain ? candidateNames[0].powertrain : '', trim: applyLatinBrandTokens(uniform?.trim || canonSalesTrim(subUniform?.maker || S(d.maker), subUniform?.model || S(d.model), subUniform?.sub_model || S(d.sub_model), S(d.trim))),
      fuel: sameFuel ? candidateNames[0].fuel : '', engine_cc: sameCc ? candidateNames[0].engine_cc : null,
      battery_kwh: sameBattery ? candidateNames[0].battery_kwh : null,
      source: 'decision', trim_row_key: '', adopted: Boolean(subUniform?.adopted),
      vehicle_class: subUniform?.vehicle_class || '',
    });
    if (d.decision === 'PARTIAL' || !S(d.trim)) stats.decision_partial++; else stats.decision_triple++;
  }
  return { byPlate, stats };
}

/**
 * 결정에 후보키가 없을 때 — 마스터에서 (제조사·모델·개발코드) 로 세부모델 후보를 찾는다.
 *   개발코드 = 「RG3」「DN8」「GL3」「NQ5」「MQ4」「KA4」「CN7」「LX2」「NE」 같은 토큰(영문 1~3 + 숫자 1~2 + 영문 0~1).
 *   결정 글에 「FL·페이스리프트·후기형」이 있으면 FL 세부모델만, 「초기형·전기형」이면 FL 아닌 것만. 후보가 여러 세부모델에 걸치면 빈 배열(안 정함).
 */
export function guessCandidateKeys(d: ProductVehicleReviewDecision, records: readonly { trim_row_key: string; maker?: string; model?: string; sub_model?: string }[]): string[] {
  const norm = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_./()（）·]/g, '');
  const maker = norm(d.maker), model = norm(d.model), sub = S(d.sub_model);
  if (!maker || !model || !sub) return [];
  // 개발코드 토큰 — 모델 이름 자체(G80·K8 …)는 뺀다(전 세대에 다 들어 있어 후보를 못 가른다)
  const codes = (sub.match(/\b[A-Za-z]{1,3}\d{1,2}[A-Za-z]?\b/g) || []).map((c) => c.toLowerCase()).filter((c) => c !== model && !model.includes(c));
  if (!codes.length) return [];
  const wantsFl = /\bfl\b|페이스리프트|후기형|f\/l/i.test(sub);
  const wantsPre = /초기형|전기형|프리페이스|이전/.test(sub);
  const wantsEv = /\bev\b|전기|electrified|일렉트리파이드/i.test(`${sub} ${S(d.supplier_text)}`);
  const hits = records.filter((r) => norm(r.maker) === maker && norm(r.model) === model && codes.some((c) => norm(r.sub_model).includes(c)))
    .filter((r) => { const isFl = /\bfl\b|페이스리프트/i.test(S(r.sub_model)); return wantsFl ? isFl : (wantsPre ? !isFl : true); })
    .filter((r) => { const isEv = /\bev\b|electrified|일렉트리파이드/i.test(S(r.sub_model)); return wantsEv ? isEv : !isEv; });
  const subs = new Set(hits.map((r) => norm(r.sub_model)));
  if (subs.size !== 1) return [];
  return hits.map((r) => r.trim_row_key);
}
