/**
 * 관리자 응대 큐 판정 시험 — 쓰기 없음, 순수 함수만.
 *   npx tsx scripts/sim-desk-queue.mts
 *
 * 이 규칙이 조용히 바뀌면 관리자의 하루가 바뀐다(안 뜨는 건 = 안 하는 건).
 */
import { deskItemOf, sortDeskQueue } from '../features/desk/queue';
import type { EntityRecord } from '../lib/intake/entities';

let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fail += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : `  got=${String(got)} want=${String(want)}`}`);
}

const room = (over: Partial<EntityRecord> = {}): EntityRecord => ({
  _key: 'CH_P1_A1', room_code: 'CH_P1_A1', agent_code: 'A1',
  last_message: '안녕하세요', last_message_at: 1_700_000_000_000, last_sender_role: 'agent',
  ...over,
} as EntityRecord);

const contract = (over: Partial<EntityRecord> = {}): EntityRecord => ({
  contract_code: 'TMP-1', product_code: 'P1', agent_code: 'A1', contract_status: '진행',
  ...over,
} as EntityRecord);

console.log('\n[계약 전]');
eq('영업자가 말 걸었으면 내 차례', deskItemOf(room(), null).bucket, 'mine');
eq('라벨은 첫 응답', deskItemOf(room(), null).nextLabel, '첫 응답');
eq('운영이 마지막이면 대기', deskItemOf(room({ last_sender_role: 'admin' }), null).bucket, 'waiting');
eq('대화 자체가 없으면 대기', deskItemOf(room({ last_message_at: 0 }), null).bucket, 'waiting');

console.log('\n[계약 진행]');
// 1단계: 영업 문의 → 공급(=운영) 응답
eq('문의만 됐으면 대기(영업 차례)', deskItemOf(room(), contract()).bucket, 'waiting');
const inquired = contract({ agent_delivery_inquiry: 'yes' });
eq('문의 끝 → 출고응답은 내 차례', deskItemOf(room(), inquired).bucket, 'mine');
eq('라벨은 출고응답', deskItemOf(room(), inquired).nextLabel, '출고응답');

// 2단계: 영업 서류제출이 남으면 우리 일이 아니다
const step2 = contract({ agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능' });
eq('서류제출 대기 = 영업 차례', deskItemOf(room(), step2).bucket, 'waiting');
const step2b = contract({ ...step2, agent_docs_submitted: 'yes' });
eq('서류확인은 내 차례', deskItemOf(room(), step2b).bucket, 'mine');
eq('라벨은 서류확인', deskItemOf(room(), step2b).nextLabel, '서류확인');

console.log('\n[막힘·종료]');
const rejected = contract({ agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 불가' });
eq('출고 불가는 큐에서 내려간다', deskItemOf(room(), rejected).bucket, 'waiting');
eq('취소 계약은 done', deskItemOf(room(), contract({ contract_status: '계약취소' })).bucket, 'done');
eq('완료 계약은 done', deskItemOf(room(), contract({ contract_status: '계약완료' })).bucket, 'done');
const allChecked = contract({
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
});
eq('체크는 다 됐는데 완료 처리 전 = 내 차례', deskItemOf(room(), allChecked).bucket, 'mine');

console.log('\n[정렬]');
const older = deskItemOf(room({ _key: 'old', last_message_at: 1000 }), null);
const newer = deskItemOf(room({ _key: 'new', last_message_at: 9000 }), null);
const empty = deskItemOf(room({ _key: 'empty', last_message_at: 0 }), null);
const sorted = sortDeskQueue([newer, empty, older]).map((x) => String(x.room._key));
eq('오래 기다린 것이 위', sorted.join(','), 'old,new,empty');

console.log(fail ? `\n${fail}건 실패\n` : '\n전부 통과\n');
process.exit(fail ? 1 : 0);
