/**
 * 손님 화면의 «단계 키»와 서버 허용목록(PROGRESS_KEYS)이 어긋나지 않게 한다.
 *
 * ★왜 필요한가: 화면에서 단계를 새로 만들거나 쪼개면 그 키로 진행을 기록하는데,
 *   서버 허용목록에 없으면 **400 이 나고 손님이 그 화면에 갇힌다.**
 *   실제로 개인 계약이 「매출증빙」에서 통째로 막혀 있었다(2026-08-28).
 *   ⚠ 화면도 서버도 각자 「고쳤겠지」 하고 지나가기 쉬운 자리라, 사람 눈이 아니라 여기서 맞춘다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('app/sign/[token]/page.tsx', 'utf8');
const route = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');

// ── 서버 허용목록
const setBody = route.match(/const PROGRESS_KEYS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(setBody, 'PROGRESS_KEYS 를 찾지 못했습니다');
const allowed = new Set([...setBody![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
assert.ok(allowed.size > 5, `허용목록이 비었습니다 (${allowed.size}개)`);

// ── 화면의 단계 목록(steps useMemo) 안에서만 키를 걷는다
const stepsStart = page.indexOf('const steps = useMemo<JourneyStep[]>');
assert.ok(stepsStart > 0, '화면에서 steps 목록을 찾지 못했습니다');
const stepsEnd = page.indexOf('], [', stepsStart);
assert.ok(stepsEnd > stepsStart, 'steps 목록의 끝을 찾지 못했습니다');
const stepsBlock = page.slice(stepsStart, stepsEnd);
const used = [...new Set([...stepsBlock.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]))];
assert.equal(used.length, 7, `손님 단계 키는 7개여야 합니다 (${used.length}개)`);
// information은 UI 묶음 이름이다. 서버에는 privacy·identity 등 실제 기록 키로만 저장한다.
const recorded = used.filter((key) => key !== 'information');

const missing = recorded.filter((key) => !allowed.has(key));
assert.deepEqual(
  missing, [],
  `화면 단계 키가 서버 허용목록(PROGRESS_KEYS)에 없습니다 — 손님이 그 화면에서 400 으로 갇힙니다:\n  ${missing.join(', ')}`,
);

// 계약조건은 세부계약·약관 화면에 합쳐 보여도 서버에는 차량·대여·결제 등 7개 확인
// 기록을 각각 남겨야 한다. 화면 수를 줄이다가 법적 확인 이력이 사라지는 회귀를 막는다.
assert.match(page, /kind: 'agreement'/, '세부계약·약관 화면이 없습니다');
assert.match(page, /pages\.map\(\(page\) => markProgress\(S\(page\.key\)\)\)/,
  '통합 계약조건 확인 시 모든 개별 조건의 진행기록을 남겨야 합니다');
assert.match(page, /conditionsConfirmed/, '통합 계약조건의 단일 중요조건 확인이 없습니다');
assert.match(page, /차량·기간·금액, 결제·만기, 운전자·보험, 사고·중도해지 조건을 확인했습니다/, 
  '고객에게 확인시키는 중요 계약조건 문구가 없습니다');

// 개인의 신분증과 셀카는 정보입력 속에 섞지 않는다. 법인은 이 자료를 받지 않으므로
// 화면 단계에서 빠지고, 개인은 셀카 단계 완료 시에만 identity 진행기록을 남긴다.
assert.match(stepsBlock, /kind: 'id-card' as const, key: 'id_card'/,
  '개인 신분증 촬영 전용 단계가 없습니다');
assert.match(stepsBlock, /kind: 'selfie' as const, key: 'selfie'/,
  '개인 본인 셀카 전용 단계가 없습니다');
assert.match(page, /step\.kind === 'selfie' && !selfie/, '셀카 단계의 필수 검증이 없습니다');
assert.match(page, /else if \(step\.kind === 'selfie'\) \{\s*await markProgress\('selfie'\)/,
  '개인 본인확인 완료의 서버 진행기록이 없습니다');
assert.match(page, /else if \(step\.kind === 'id-card'\) \{\s*await markProgress\('id_card'\)/,
  '개인 신분증 촬영 완료의 서버 진행기록이 없습니다');
assert.match(page, /\.\.\.\(corporate \? \[markProgress\('identity'\)\] : \[\]\)/,
  '법인 본인확인 진행기록이 누락되었습니다');

/* ── 계약조건 낱장(consentPages)도 같은 길로 기록된다 ──
   「위 내용을 확인합니다」를 누르면 그 낱장 키로 markProgress 가 돈다(page.tsx ContractSection onToggle).
   낱장 키는 발행 스냅샷(데이터)에서 오지만, 실제로 쓰는 일곱은 코드가 만든다 — 그래서 여기서 못 박는다.
   ⚠ onToggle 의 markProgress 는 `.catch(() => {})` 로 «조용히» 삼킨다.
     허용목록에서 빠지면 화면은 멀쩡히 체크되는데 서버 기록만 안 남는다 — 눈으로는 절대 못 잡는다. */
const PAGE_KEYS = ['vehicle', 'rental', 'payment', 'driver', 'insurance', 'accident', 'service'];
const missingPages = PAGE_KEYS.filter((key) => !allowed.has(key));
assert.deepEqual(
  missingPages, [],
  `계약조건 낱장 키가 허용목록에 없습니다 — 확인 기록이 조용히 사라집니다:
  ${missingPages.join(', ')}`,
);
console.log(`✓ 진행 단계 키: 화면 ${used.length}개(저장 ${recorded.length}개)가 서버 허용목록(${allowed.size}개) 안에 있다`);
console.log(`  화면: ${used.join(' · ')}`);
console.log(`  낱장: ${PAGE_KEYS.join(' · ')}`);
