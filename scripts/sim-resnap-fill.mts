/**
 * 재매칭 빈칸 채움 — **덮지도 지우지도 않는가.**
 * 실행: npx tsx scripts/sim-resnap-fill.mts
 *
 * 새 차가 들어오면 공급사는 차명 한 칸만 주는 경우가 많다. 그대로 두면 화면에
 * 세부모델·트림이 빈 채로 서고 영업자가 그 차를 못 고른다. 받자마자 물려 둔다.
 *
 * 다만 **있는 값은 건드리지 않는다** — 재매칭이 못 잡았다고 지우면
 * 「공급사가 적어 준 트림이 마스터에 아직 없을 뿐」인 경우까지 날아간다.
 */
import { readFileSync } from 'node:fs';
import { planResnapFill, summarizeResnapFill } from '../lib/domain/resnap-fill';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};

const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const master: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

/** 공급사가 차명 한 칸만 준 새 차 — 이게 채워져야 목록에 제대로 선다. */
const fresh = {
  _key: 'NEW1', car_number: '12가3456',
  maker: '현대', model: '아반떼', year: '2023',
  _raw_vehicle: { model: '아반떼 CN7 2023 가솔린 1.6 모던' },
} as unknown as EntityRecord & { _key: string };

const one = planResnapFill([fresh], master);
check('빈 차종 칸을 채운다', one.length === 1 && Object.keys(one[0].patch).length > 0, one[0]?.patch);
check('세부모델이 채워진다', !!one[0]?.patch.sub_model, one[0]?.patch.sub_model);

/** ★공급사가 적어 준 값은 그대로 둔다 — 마스터에 없는 트림이어도. */
const stored = {
  ...fresh, _key: 'KEEP1',
  sub_model: '아반떼 CN7', trim_name: '있을리없는트림', variant: '가솔린 1.6',
} as unknown as EntityRecord & { _key: string };
const kept = planResnapFill([stored], master);
const patch = kept[0]?.patch || {};
check('★있는 트림을 덮지 않는다', !('trim_name' in patch), patch);
check('★있는 세부모델을 덮지 않는다', !('sub_model' in patch), patch);
check('★있는 파워트레인을 덮지 않는다', !('variant' in patch), patch);

/** 원문이 없으면 근거가 없다 — 건너뛴다. */
check('원문 없으면 손대지 않는다',
  planResnapFill([{ _key: 'NORAW', car_number: '34나5678', model: '아반떼' } as never], master).length === 0);

/** 두 번 돌려도 같아야 한다 — 아침마다 손으로 돌릴 것이므로. */
const applied = { ...fresh, ...one[0].patch } as unknown as EntityRecord & { _key: string };
check('두 번째는 채울 것이 없다', planResnapFill([applied], master).length === 0,
  planResnapFill([applied], master)[0]?.patch);

/** 마스터가 비면 아무것도 하지 않는다 — 빈 마스터로 전 재고를 지우면 안 된다. */
check('마스터가 비면 손대지 않는다', planResnapFill([fresh], []).length === 0);

const by = summarizeResnapFill(one);
check('칸별 집계가 나온다', Object.values(by).some((n) => n > 0), by);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
