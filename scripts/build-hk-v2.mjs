#!/usr/bin/env node
/**
 * 현대·기아 조합지도 v2 = new_car_trim(현재 트림·가격) + 현대 PDF 옵션(parse-hyundai-pdf) 병합.
 *   (사장님 2026-09-06 「현대기아 얼른 마무리」)
 * 트림계층 구조: 모델별 트림 사다리 + 트림별/모델별 옵션 초집합 + min(최저트림)~max(최고트림+옵션).
 * 현대 옵션 미수집 296트림을 PDF 옵션으로 보강. 기아 옵션은 new_car_trim 것 유지.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\n/g, '\n') }) });
const FS = getFirestore();
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const hyOpts = JSON.parse(readFileSync('tmp/hyundai-pdf-options.json', 'utf8'));

// 현대 PDF 슬러그 → new_car_trim sub_model 키워드
const SLUG2KEY = { grandeur: '그랜저', avante: '아반떼', sonata: '쏘나타', tucson: '투싼', santafe: '싼타페',
  kona: '코나', palisade: '팰리세이드', venue: '베뉴', staria: '스타리아', nexo: '넥쏘',
  ioniq5: '아이오닉 5', ioniq6: '아이오닉 6', ioniq9: '아이오닉 9' };

// 모델별 현대 옵션 초집합(이름별 최고가) — 하이브리드/가솔린 PDF 합침
function hyundaiSupersetFor(subModel) {
  const map = new Map();
  for (const [slug, trims] of Object.entries(hyOpts)) {
    const base = slug.replace(/-hybrid$/, '');
    const key = SLUG2KEY[base];
    if (!key || !subModel.includes(key)) continue;
    for (const opts of Object.values(trims)) for (const o of opts) {
      const nm = o.name.trim();
      if (!nm || o.price <= 0) continue;
      if (!map.has(nm) || map.get(nm) < o.price) map.set(nm, o.price);
    }
  }
  return [...map.entries()].map(([name, price]) => ({ name, price })).sort((a, b) => b.price - a.price);
}

const all = (await FS.collection('new_car_trim').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const hk = all.filter((t) => ['현대', '기아'].includes(t.maker));
const byModel = new Map();
for (const t of hk) { const k = `${t.maker}|${t.sub_model}`; (byModel.get(k) || byModel.set(k, []).get(k)).push(t); }

const models = [];
for (const [key, trims] of byModel) {
  const [maker, sub_model] = key.split('|');
  const ladder = trims.map((t) => ({ fuel: t.fuel, trim: t.trim, priceAfter: num(t.priceAfter) ? t.priceAfter : t.priceBefore }))
    .filter((x) => num(x.priceAfter)).sort((a, b) => a.priceAfter - b.priceAfter);
  if (!ladder.length) continue;
  // 옵션 초집합: 현대=PDF 파서 우선(더 완전), 없으면 new_car_trim
  let optSuperset = [];
  if (maker === '현대') optSuperset = hyundaiSupersetFor(sub_model);
  if (!optSuperset.length) {
    const m = new Map();
    for (const t of trims) for (const o of (t.options || [])) { if (num(o.price) && o.price > 0) { const n = String(o.name).trim(); if (n && (!m.has(n) || m.get(n) < o.price)) m.set(n, o.price); } }
    optSuperset = [...m.entries()].map(([name, price]) => ({ name, price })).sort((a, b) => b.price - a.price);
  }
  const optSum = optSuperset.reduce((s, o) => s + o.price, 0);
  const min = ladder[0].priceAfter;
  const topTrim = ladder[ladder.length - 1];
  models.push({
    maker, sub_model, trimCount: ladder.length,
    trimLadder: ladder, optionSuperset: optSuperset, optionSource: maker === '현대' && optSuperset.length ? '현대 공식 PDF' : 'new_car_trim',
    minMax: {
      min, minConfig: `최저 트림 「${ladder[0].fuel} ${ladder[0].trim}」`,
      maxCandidate: topTrim.priceAfter + optSum,
      maxConfig: `최고 트림 「${topTrim.fuel} ${topTrim.trim}」 ${topTrim.priceAfter.toLocaleString()} + 옵션초집합 ${optSum.toLocaleString()}`,
      maxStatus: '트림 최고가 + 옵션 단순합(상호배제·트림별 적용가능 미검증·상한후보). 옵션은 모델 초집합이라 특정 트림엔 일부 불가.',
    },
  });
}
models.sort((a, b) => (a.maker + a.sub_model).localeCompare(b.maker + b.sub_model, 'ko'));
const withOpt = models.filter((m) => m.optionSuperset.length).length;
const out = { _meta: { source: 'new_car_trim(현재 트림·가격) + 현대 공식 PDF 옵션(parse-hyundai-pdf) 병합. 2026-09-06.',
  note: 'min=최저트림 세제후 · maxCandidate=최고트림+옵션초집합 단순합(상한후보). 현대 옵션=공식 PDF, 기아=new_car_trim. 정밀 배타·트림별 적용은 후속.',
  updatedAt: '2026-09-06', modelCount: models.length, withOptions: withOpt }, models };
writeFileSync('data/new-car/hk-config.json', JSON.stringify(out, null, 1));
console.log(`hk-config v2: ${models.length}모델 · 옵션보유 ${withOpt}`);
for (const m of models.slice(0, 40)) console.log(`  ${m.maker} ${m.sub_model}: 트림 ${m.trimCount} · 옵션 ${m.optionSuperset.length}(${m.optionSource}) · min ${m.minMax.min.toLocaleString()}~max ${m.minMax.maxCandidate.toLocaleString()}`);
