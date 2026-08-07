/**
 * 계약 중복(이관 잔재) 합치기 시험 — 쓰기 없음.
 *   npx tsx scripts/sim-contract-dedupe.mts
 *
 * 이 규칙이 흔들리면 계약이 두 줄로 보이거나(과다 집계) 살아 있는 값이 잔재로 덮인다(유실).
 */
import { dedupeContractsByCode } from '../lib/domain/contract-dedupe';
import type { EntityRecord } from '../lib/intake/entities';

let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fail += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

// 실측 형태 그대로 — 이관본(push key)과 정본(code key)
const legacy = {
  _key: '-OsUKH4xL6yUQSe-YmCH', contract_code: 'TMP-260513-03', contract_status: '계약요청',
  migrated_from_v3_at: '2026-08-05T06:22:05.389Z', customer_name: '이승아',
} as unknown as EntityRecord;
const live = {
  _key: 'TMP-260513-03', contract_code: 'TMP-260513-03', contract_status: '계약요청',
  agent_delivery_inquiry: true, updated_at: 1778642248840, vehicle_name_snapshot: '기아 더 뉴 셀토스 SP2',
} as unknown as EntityRecord;

const one = dedupeContractsByCode([legacy, live]);
eq('두 벌이 한 벌로', one.length, 1);
eq('정본 키는 계약코드', String(one[0]._key), 'TMP-260513-03');
eq('살아 있는 단계값 유지', one[0].agent_delivery_inquiry, true);
eq('정본에 없던 칸은 이관본에서 채움', one[0].customer_name, '이승아');
eq('이관 표식도 보존', String(one[0].migrated_from_v3_at || ''), '2026-08-05T06:22:05.389Z');

// 순서가 바뀌어도 결과가 같아야 한다(조회 순서는 보장되지 않는다)
const flipped = dedupeContractsByCode([live, legacy]);
eq('순서 무관 — 키', String(flipped[0]._key), 'TMP-260513-03');
eq('순서 무관 — 단계값', flipped[0].agent_delivery_inquiry, true);

// 덮어쓰기 금지: 이관본의 옛 상태가 살아 있는 상태를 이기지 못한다
const stale = { _key: 'X1', contract_code: 'CT-1', contract_status: '계약요청' } as unknown as EntityRecord;
const fresh = { _key: 'CT-1', contract_code: 'CT-1', contract_status: '계약완료' } as unknown as EntityRecord;
eq('잔재가 살아 있는 값을 덮지 않는다', String(dedupeContractsByCode([stale, fresh])[0].contract_status), '계약완료');

// 코드키가 아예 없으면 최신(updated_at) 우선
const a = { _key: 'A', contract_code: 'CT-2', contract_status: '계약요청', updated_at: 1 } as unknown as EntityRecord;
const b = { _key: 'B', contract_code: 'CT-2', contract_status: '계약완료', updated_at: 9 } as unknown as EntityRecord;
eq('코드키 없으면 최신 우선', String(dedupeContractsByCode([a, b])[0].contract_status), '계약완료');

// 코드 없는 레코드는 손대지 않는다
const noCode = [{ _key: 'N1' }, { _key: 'N2' }] as unknown as EntityRecord[];
eq('코드 없는 건 그대로', dedupeContractsByCode(noCode).length, 2);

// 중복이 없으면 건수가 그대로
eq('중복 없으면 무변화', dedupeContractsByCode([live]).length, 1);

console.log(fail ? `\n${fail}건 실패\n` : '\n전부 통과\n');
process.exit(fail ? 1 : 0);
