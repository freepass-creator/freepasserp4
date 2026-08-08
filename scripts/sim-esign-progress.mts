/**
 * 전자계약 진행 판정 회귀검증 — 저장소 없이 순수 함수만.
 * 실행: npx tsx scripts/sim-esign-progress.mts
 */
import {
  ESIGN_STEPS, compareEsign, consentKeys, esignNeedsAttention, esignStage, matchesEsignFilter,
} from '../lib/domain/esign-progress';
import type { EntityRecord } from '../lib/intake/entities';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};
const r = (o: Record<string, unknown>) => o as unknown as EntityRecord;

const NOW = 1_754_000_000_000;
const base = { contract_code: 'TMP-1', customer_name: '홍길동' };
const issued = { ...base, esign_id: 'chd_1', sign_sent_at: NOW - 1000 };

// ── 발행 전 ──
check('계약 없음 = 미발송', esignStage(null).state === '미발송');
check('약정만 끝난 계약 = 미발송', esignStage(r(base), NOW).state === '미발송');
check('미발송은 진행 0', esignStage(r(base), NOW).done === 0);

// ── 발행 후 ──
check('발행됨', esignStage(r(issued), NOW).state === '발행');
check('열람 표시', esignStage(r({ ...issued, esign_opened_at: NOW }), NOW).state === '열람');

// ── 단계 진행 ──
const at = (keys: string[]) => esignStage(r({ ...issued, sign_consents: Object.fromEntries(keys.map((k) => [k, NOW])) }), NOW);
check('본인확인만 통과 = 1/8, 다음은 본인정보',
  at(['identity_verified']).done === 1 && at(['identity_verified']).current === '본인정보', at(['identity_verified']));
check('원자 4묶음까지 = 5/8, 다음은 서류제출',
  at(['identity_verified', 'identity', 'vehicle', 'rental', 'insurance']).done === 5
  && at(['identity_verified', 'identity', 'vehicle', 'rental', 'insurance']).current === '서류제출');
// 중간이 비면 거기서 멈춘 것이다 — 뒤엣것이 있다고 건너뛰어 세면 «다 했다»로 잘못 보인다.
check('중간이 빠지면 그 앞까지만 센다',
  at(['identity_verified', 'identity', 'insurance']).done === 2, at(['identity_verified', 'identity', 'insurance']));
check('진행중은 amber', at(['identity_verified']).tone === 'amber');

// ── 저장 형태 둘 다 읽는다 ──
check('레거시 콤마 문자열도 읽는다', consentKeys('identity_verified,identity').size === 2);
check('빈 값·false 는 통과로 세지 않는다',
  consentKeys({ identity_verified: NOW, identity: 0, vehicle: false, rental: '' }).size === 1,
  [...consentKeys({ identity_verified: NOW, identity: 0, vehicle: false, rental: '' })]);

// ── 착한거래가 진행도를 직접 줄 때 ──
check('esign_progress 가 더 크면 그걸 쓴다',
  esignStage(r({ ...issued, esign_progress: 6 }), NOW).done === 6);
check('esign_progress 는 총 단계를 넘지 않는다',
  esignStage(r({ ...issued, esign_progress: 99 }), NOW).done === ESIGN_STEPS.length);

// ── 끝난 것·막힌 것 ──
check('서명완료', esignStage(r({ ...issued, sign_signed_at: NOW }), NOW).state === '서명완료');
check('서명완료는 8/8', esignStage(r({ ...issued, sign_signed_at: NOW }), NOW).done === ESIGN_STEPS.length);
check('반려', esignStage(r({ ...issued, sign_reject_reason: '주소 오류' }), NOW).state === '반려');
check('만료', esignStage(r({ ...issued, sign_expires_at: NOW - 1 }), NOW).state === '만료');
check('폐기된 링크도 만료로', esignStage(r({ ...issued, sign_revoked_at: NOW }), NOW).state === '만료');
// 우선순위 — 끝난 것을 먼저 본다. 서명 끝난 계약이 만료일 지났다고 «만료»로 보이면 안 된다.
check('서명완료가 만료보다 우선',
  esignStage(r({ ...issued, sign_signed_at: NOW - 5000, sign_expires_at: NOW - 1 }), NOW).state === '서명완료');
check('반려가 진행보다 우선',
  esignStage(r({ ...issued, sign_consents: { identity_verified: NOW }, sign_rejected_at: NOW }), NOW).state === '반려');

// ── 필터·정렬 ──
const signed = r({ ...issued, sign_signed_at: NOW });
const rejected = r({ ...issued, sign_rejected_at: NOW });
const midway = r({ ...issued, sign_consents: { identity_verified: NOW } });
const unsent = r(base);
check('확인 필요 = 반려·만료', esignNeedsAttention(rejected) && !esignNeedsAttention(midway));
check('진행중 필터는 발행·열람·진행을 모두 잡는다',
  matchesEsignFilter(r(issued), '진행중') && matchesEsignFilter(midway, '진행중'));
check('서명완료 필터', matchesEsignFilter(signed, '서명완료') && !matchesEsignFilter(midway, '서명완료'));
check('전체 필터는 다 통과', [signed, rejected, midway, unsent].every((x) => matchesEsignFilter(x, '전체')));

const sorted = [signed, unsent, midway, rejected].sort(compareEsign).map((x) => esignStage(x, NOW).state);
check('손봐야 할 것이 위로', sorted.join('|') === '반려|진행중|미발송|서명완료', sorted);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
