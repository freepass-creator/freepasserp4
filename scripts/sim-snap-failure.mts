/**
 * 시트 매물이 왜 «빈칸»이 되는지 재현 — 실제 실패 레코드를 차종마스터에 물려본다. 읽기 전용.
 *
 * 확인하려는 것:
 *   1) snapToMaster 가 무엇을 돌려주는가 (maker·model 을 정하는가, 비우는가)
 *   2) confidence 가 왜 low 인가
 *   3) applySnap 후 제조사·모델이 원본보다 «나빠지는가»
 *
 * npx tsx scripts/sim-snap-failure.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinnedSubModelSupportedByRawName, snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
import type { EntityRecord } from '../lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();

assert.equal(pinnedSubModelSupportedByRawName('더 뉴 G70 슈팅브레이크', 'G70 2.5T가솔린 2WD'), false,
  '원문에 슈팅브레이크가 없는 일반 G70은 과거 슈팅브레이크 확정값을 재사용하지 않는다');
assert.equal(pinnedSubModelSupportedByRawName('더 뉴 G70 슈팅브레이크', '더 뉴G70 2.0T 2WD 슈팅브레이크 프리미엄'), true,
  '원문이 슈팅브레이크를 명시하면 기존 확정값을 유지한다');

function master(): MasterEntry[] {
  const d = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
  return (d.entries || d) as MasterEntry[];
}

const CASES: { label: string; rec: EntityRecord }[] = [
  { label: '손오공 실물 — 모델·연료만', rec: { model: '카니발', fuel_type: '디젤', year: 2022, mileage: '79,500', vehicle_class: '대형 RV' } as EntityRecord },
  { label: '손오공 실물 — K7 가솔린', rec: { model: 'K7', fuel_type: '가솔린', year: 2020, vehicle_class: '준대형' } as EntityRecord },
  { label: '제조사까지 있으면', rec: { maker: '기아', model: '카니발', fuel_type: '디젤', year: 2022 } as EntityRecord },
  { label: '세부모델까지 있으면', rec: { maker: '기아', model: '카니발', sub_model: '더 뉴 카니발 KA4', fuel_type: '디젤', year: 2022 } as EntityRecord },
];

function main() {
  const entries = master();
  const ironG70 = snapToMaster({
    maker: '제네시스', model: 'G70', vehicle_name: 'G70 2.5T가솔린 2WD',
    sub_model: 'G70 2.5T가솔린 2WD', fuel_type: '가솔린', year: '2024',
  } as EntityRecord, entries);
  assert.equal(ironG70?.sub_model, '더 뉴 G70', '아이언 일반 G70 원문은 슈팅브레이크가 아닌 더 뉴 G70으로 재매칭한다');
  assert.equal(ironG70?.confidence, 'high');

  const sonokongG70 = snapToMaster({
    maker: '제네시스', model: 'G70', vehicle_name: '제네시스 더 뉴G70 가솔린 2.0T 2WD 슈팅브레이크 프리미엄',
    sub_model: '제네시스 더 뉴G70 가솔린 2.0T 2WD 슈팅브레이크 프리미엄', fuel_type: '가솔린', year: '2022',
  } as EntityRecord, entries);
  assert.equal(sonokongG70?.sub_model, '더 뉴 G70 슈팅브레이크', '손오공 원문이 명시한 슈팅브레이크는 그대로 매칭한다');
  assert.equal(sonokongG70?.confidence, 'high');
  console.log(`\n차종마스터 ${entries.length}세대 로드\n`);

  for (const { label, rec } of CASES) {
    console.log(`══ ${label}`);
    console.log(`   입력   maker«${S(rec.maker)}» model«${S(rec.model)}» sub«${S(rec.sub_model)}» fuel«${S(rec.fuel_type)}»`);
    const res = snapToMaster(rec, entries);
    if (!res) {
      console.log(`   결과   null — applySnap 안 탐(원본 유지)\n`);
      continue;
    }
    console.log(`   스냅   confidence=${res.confidence} · maker«${S(res.maker)}» model«${S(res.model)}» sub«${S(res.sub_model)}» variant«${S(res.variant)}»`);
    const after = applySnap(rec, res, { source: 'sim' });
    const worse = (f: string) => S(rec[f]) && !S(after[f]) ? '  ❌ 원본이 지워짐' : '';
    for (const f of ['maker', 'model', 'sub_model', 'fuel_type', 'year']) {
      console.log(`     ${f.padEnd(11)} «${S(rec[f])}» → «${S(after[f])}»${worse(f)}`);
    }
    console.log(`     _needs_master_review = ${after._needs_master_review}\n`);
  }
}

main();
