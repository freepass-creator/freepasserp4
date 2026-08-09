/**
 * 전자계약 진행 판정 회귀검증 — 저장소 없이 순수 함수만.
 * 실행: npx tsx scripts/sim-esign-progress.mts
 */
import {
  ESIGN_STEPS, compareEsign, consentAt, consentKeys, esignDocuments, esignIdentityShots,
  esignNeedsAttention, esignSeal, esignStage, matchesEsignFilter, sealGaps,
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

// ── 4번 패널: 진행 디테일·첨부 ──
check('단계 통과 시각을 읽는다', consentAt({ identity: NOW }, 'identity') === NOW);
check('콤마 문자열엔 시각이 없다', consentAt('identity,vehicle', 'identity') === 0);
check('시각 없는 키는 0', consentAt({ identity: NOW }, 'vehicle') === 0);

const withDocs = r({
  ...issued,
  esign_documents: [
    { key: 'family_register', label: '가족관계증명서', submittedAt: NOW, sha256: 'abc' },
    { key: 'extra_note', label: '추가 제출물', submittedAt: NOW },
    { key: '', label: '키 없는 쓰레기' },
  ],
});
const docs = esignDocuments(withDocs);
check('첨부 서류를 읽는다', docs.length === 2, docs.map((d) => d.key));
check('키 없는 행은 버린다', !docs.some((d) => !d.key));
check('라벨 없으면 키로 대신', esignDocuments(r({ ...issued, esign_documents: [{ key: 'bank_book', submittedAt: NOW }] }))[0].label === 'bank_book');
// RTDB 는 배열을 객체로 돌려주는 일이 잦다 — 둘 다 읽어야 «첨부 없음»으로 잘못 보이지 않는다.
check('객체 형태 첨부도 읽는다',
  esignDocuments(r({ ...issued, esign_documents: { a: { key: 'family_register', submittedAt: NOW } } })).length === 1);
check('첨부 없으면 빈 배열', esignDocuments(r(issued)).length === 0);

// ── 봉인 ──
check('서명 전엔 봉인 없음', esignSeal(r(issued)) === null);
// 봉인은 «서명 + 해시»가 다 있어야 성립한다 — 하나만 있으면 반쪽이다.
check('해시만 있으면 봉인 아님', esignSeal(r({ ...issued, esign_seal_hash: 'sha256:x' })) === null);
check('서명만 있고 해시 없으면 봉인 아님', esignSeal(r({ ...issued, sign_signed_at: NOW })) === null);
const sealed = r({
  ...issued, sign_signed_at: NOW, esign_seal_hash: 'sha256:abc',
  esign_verify_url: 'https://chd/v?id=1', esign_document_url: 'https://chd/doc.pdf',
  esign_template_version: 'sample-v1', sign_consent_version: 'rental-v1-2026-08-08',
});
check('봉인 읽기', esignSeal(sealed)?.sealHash === 'sha256:abc');
check('약관 판이 기록된다', esignSeal(sealed)?.agreementVersion === 'rental-v1-2026-08-08');
check('완전한 봉인엔 결손 없음', sealGaps(sealed).length === 0, sealGaps(sealed));
// 봉인은 됐는데 링크·사본이 안 오면 나중에 계약서를 못 연다 — 조용히 넘기면 안 된다.
check('검증링크 누락을 잡는다',
  sealGaps(r({ ...sealed, esign_verify_url: '' })).includes('검증링크 없음'));
check('계약서 사본 누락을 잡는다',
  sealGaps(r({ ...sealed, esign_document_url: '' })).includes('계약서 사본 없음'));
check('봉인 안 된 계약은 결손 검사 안 함', sealGaps(r(issued)).length === 0);

check('본인확인 자료 미제출', !esignIdentityShots(r(issued)).idCard);
const shots = esignIdentityShots(r({ ...issued, esign_identity: { idCardPath: 'a.png', selfieSha256: 'z', verifiedAt: NOW } }));
check('신분증·셀피 제출 판정', shots.idCard && shots.selfie && shots.verifiedAt === NOW, shots);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
