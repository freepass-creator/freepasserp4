#!/usr/bin/env node
/**
 * 현대·기아 조합지도 — new_car_trim(Firestore) → data/new-car/hk-config.json.
 *   (사장님 2026-09-06 「옵션이 있고 어디까지 조합되는지 + 최소~최대 두 끝」, 「할 수 있는 거 해」)
 *
 * 제네시스는 «기본모델+필수/선택 옵션»이지만 현대·기아는 «트림계층»이 변형축이다.
 * 그래서 조합지도 = 모델별 «트림 사다리(연료×트림, 각 완성가) + 트림별 옵션(추가금)».
 *   min = 최저 트림 세제후가(유료옵션 없음)
 *   maxCandidate = 트림별 (세제후가 + 그 트림 유료옵션 전부합) 중 최고
 *     ⚠ 단순합 — 옵션 상호배제(파노라마↔투톤루프 등)·종속 미검증. «상한후보»로만.
 * 정본 데이터는 new_car_trim(크롤/PDF 추출). 이 스크립트는 그걸 «조합지도»로 집계만 한다.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }) });
const FS = getFirestore();
const S = (v) => String(v ?? '').trim();
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const all = (await FS.collection('new_car_trim').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const hk = all.filter((t) => ['현대', '기아'].includes(t.maker));

// 모델 = maker|sub_model. 그 안에서 연료×트림이 사다리.
const byModel = new Map();
for (const t of hk) {
  const key = `${t.maker}|${S(t.sub_model)}`;
  (byModel.get(key) || byModel.set(key, []).get(key)).push(t);
}

const models = [];
for (const [key, trims] of byModel) {
  const [maker, sub_model] = key.split('|');
  const fuels = [...new Set(trims.map((t) => S(t.fuel)).filter(Boolean))];
  // 트림 사다리 (세제후가 오름차순)
  const ladder = trims
    .map((t) => {
      const opts = (t.options || []).filter((o) => num(o.price) && o.price > 0);
      const optSum = opts.reduce((s, o) => s + o.price, 0);
      return {
        fuel: S(t.fuel), trim: S(t.trim),
        priceBefore: num(t.priceBefore) ? t.priceBefore : null,
        priceAfter: num(t.priceAfter) ? t.priceAfter : (num(t.priceBefore) ? t.priceBefore : null),
        optionCount: opts.length, optionSum: optSum,
        loaded: (num(t.priceAfter) ? t.priceAfter : t.priceBefore) + optSum,
      };
    })
    .filter((x) => num(x.priceAfter))
    .sort((a, b) => a.priceAfter - b.priceAfter);
  if (!ladder.length) continue;
  // 옵션 초집합 (이름별 최고가) — «이 모델에서 살 수 있는 옵션 전부»
  const optMap = new Map();
  for (const t of trims) for (const o of (t.options || [])) {
    if (!num(o.price) || o.price <= 0) continue;
    const nm = S(o.name);
    if (!nm) continue;
    if (!optMap.has(nm) || optMap.get(nm) < o.price) optMap.set(nm, o.price);
  }
  const optionSuperset = [...optMap.entries()].map(([name, price]) => ({ name, price })).sort((a, b) => b.price - a.price);
  const min = ladder[0].priceAfter;
  const maxRow = ladder.reduce((m, x) => (x.loaded > m.loaded ? x : m), ladder[0]);
  const rules = [...new Set(trims.flatMap((t) => (t.rules || []).map(S)).filter(Boolean))];
  models.push({
    maker, sub_model, fuels,
    trimCount: ladder.length,
    trimLadder: ladder,
    optionSuperset,
    rules: rules.slice(0, 30),
    minMax: {
      min, minConfig: `최저 트림 「${ladder[0].fuel} ${ladder[0].trim}」 세제후가·유료옵션 없음`,
      maxCandidate: maxRow.loaded,
      maxConfig: `트림 「${maxRow.fuel} ${maxRow.trim}」 세제후 ${maxRow.priceAfter.toLocaleString()} + 그 트림 유료옵션 ${maxRow.optionCount}개 합 ${maxRow.optionSum.toLocaleString()}`,
      maxStatus: '배타 상한후보 — 옵션 단순합. 상호배제(파노라마↔투톤루프 등)·종속 미검증. 정밀 max 는 조합규칙 반영 후.',
      optionCoverage: optionSuperset.length ? 'has-options' : '옵션 미수집(있으면 정확·없으면 미수집이지 옵션없음 아님)',
    },
  });
}
models.sort((a, b) => (a.maker + a.sub_model).localeCompare(b.maker + b.sub_model, 'ko'));

const out = {
  _meta: {
    source: 'new_car_trim(Firestore) 집계. 현대=BFF+가격표PDF·기아=가격표PDF 좌표추출. 트림계층 변형축.',
    note: 'min=최저트림 세제후 · maxCandidate=트림+그트림 유료옵션 단순합(상호배제 미검증, 상한후보). 기아 옵션명 일부 조각(가격은 정확). 옵션 없는 모델=미수집(옵션없음 아님).',
    updatedAt: '2026-09-06',
    modelCount: models.length,
    trimTotal: models.reduce((s, m) => s + m.trimCount, 0),
  },
  models,
};
writeFileSync('data/new-car/hk-config.json', JSON.stringify(out, null, 1));
console.log(`hk-config: ${models.length}모델 ${out._meta.trimTotal}트림`);
for (const m of models) {
  console.log(`  ${m.maker} ${m.sub_model}: 트림 ${m.trimCount} · 옵션 ${m.optionSuperset.length} · min ${m.minMax.min.toLocaleString()} ~ max후보 ${m.minMax.maxCandidate.toLocaleString()}`);
}
