/**
 * 트림/세부모델 게이트 회귀 — 「트림이나 하위 모델을 벗어난 거를 절대 선택할 수 없다」(2026-09-12).
 * 외부 read/write 없음 · 실 차종마스터(public/data/vehicle-master.json) 사용.
 *
 * 확인하는 것 셋:
 *  ① atomViolations — 세부모델 밖 트림은 이제 block(예전 warn).
 *  ② prepareMasterIngress(products, master) — master를 넘기면 block 위반이 있는 레코드는
 *     snap confidence가 high여도 «확정»될 수 없다(_needs_master_review=true).
 *  ③ master를 안 넘기면(예전 호출부) 예전 동작 그대로 — 하위호환 깨지지 않음.
 *
 *   npx tsx scripts/sim-trim-scope-gate.mts
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { atomViolations, isConfirmable, type AtomView } from '../lib/domain/atom-invariants';
import { buildMasterIndex } from '../lib/domain/atom-health';
import { prepareMasterIngress } from '../lib/domain/sheet-import';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

const cases: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => cases.push({ name, ok, detail });

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
const master: MasterEntry[] = Array.isArray(raw) ? raw : raw.entries || [];
const idx = buildMasterIndex(master);

// 실 데이터 전제 확인 — 이 사실이 깨지면 아래 케이스는 무의미해진다.
const cn7 = master.find((e) => e.sub_model === '아반떼 CN7');
const ad = master.find((e) => e.sub_model === '아반떼 AD');
assert.ok(cn7 && cn7.trims?.includes('모던'), '전제 깨짐: 아반떼 CN7에 「모던」 트림이 없다 — 마스터가 바뀜');
assert.ok(ad && ad.trims?.includes('GDI 스타일') && !cn7!.trims?.includes('GDI 스타일'),
  '전제 깨짐: 「GDI 스타일」이 더 이상 AD만의 트림이 아니다 — 마스터가 바뀜');

// ① atomViolations — 세부모델 안 트림은 통과, 밖 트림은 block.
const inScope: AtomView = { maker: '현대', model: '아반떼', sub_model: '아반떼 CN7', trim_name: '모던' };
const outOfScope: AtomView = { maker: '현대', model: '아반떼', sub_model: '아반떼 CN7', trim_name: 'GDI 스타일' };
check('세부모델 안 트림 → block 위반 없음', !atomViolations(inScope, idx).some((v) => v.severity === 'block'), atomViolations(inScope, idx));
check('세부모델 밖 트림(다른 세대 것) → TRIM block',
  atomViolations(outOfScope, idx).some((v) => v.code === 'TRIM' && v.severity === 'block'),
  atomViolations(outOfScope, idx));
check('세부모델 밖 트림 → isConfirmable=false', !isConfirmable(outOfScope, idx));
check('세부모델 안 트림 → isConfirmable=true', isConfirmable(inScope, idx));
// 트림풀 자체가 없는 세부모델(마스터가 아직 트림 미채움) — block 아니라 warn(판단 보류).
const noPoolSub = master.find((e) => !e.trims?.length && e.sub_model);
if (noPoolSub) {
  const noPool: AtomView = { maker: noPoolSub.maker, model: noPoolSub.model, sub_model: noPoolSub.sub_model, trim_name: '아무거나' };
  check('트림풀 없는 세부모델 → block 아님(판단 보류)', !atomViolations(noPool, idx).some((v) => v.severity === 'block'), atomViolations(noPool, idx));
}

// ② prepareMasterIngress — master를 넘기면 block이 confirmed를 막는다.
const baseRec = (trim: string): EntityRecord => ({
  car_number: '12가3456', maker: '현대', model: '아반떼', sub_model: '아반떼 CN7', trim_name: trim,
  _snapped: true, _snap_confidence: 'high',
});
const gatedGood = prepareMasterIngress([baseRec('모던')], master);
check('세부모델 안 트림 + high confidence + master 전달 → 확정',
  gatedGood.confirmed === 1 && gatedGood.review === 0 && gatedGood.products[0]._needs_master_review === false,
  gatedGood);

const gatedBad = prepareMasterIngress([baseRec('GDI 스타일')], master);
check('세부모델 밖 트림 + high confidence + master 전달 → 확정 안 됨(검수)',
  gatedBad.confirmed === 0 && gatedBad.review === 1 && gatedBad.products[0]._needs_master_review === true,
  gatedBad);
check('확정 안 된 레코드에 _invariant_block 코드가 남음',
  String(gatedBad.products[0]._invariant_block || '').includes('TRIM'),
  gatedBad.products[0]._invariant_block);

// ③ master를 안 넘기면(예전 호출부) — 하위호환, 예전처럼 confidence만 본다.
const ungatedBad = prepareMasterIngress([baseRec('GDI 스타일')]);
check('master 미전달 → 하위호환(예전처럼 confidence만 보고 확정)',
  ungatedBad.confirmed === 1 && ungatedBad.review === 0,
  ungatedBad);

// snap confidence가 애초에 낮으면 master를 넘겨도(트림이 맞아도) 여전히 검수.
const lowConfRec: EntityRecord = { ...baseRec('모던'), _snap_confidence: 'low' };
const lowConfGated = prepareMasterIngress([lowConfRec], master);
check('confidence=low면 트림이 맞아도 여전히 검수(게이트가 확정선을 낮추지 않음)',
  lowConfGated.confirmed === 0 && lowConfGated.review === 1,
  lowConfGated);

let pass = 0, fail = 0;
for (const c of cases) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`);
  if (!c.ok) { console.log('   ', JSON.stringify(c.detail)); fail++; } else pass++;
}
console.log(`\ntrim scope gate simulation: ${pass}/${cases.length} PASS`);
process.exit(fail ? 1 : 0);
