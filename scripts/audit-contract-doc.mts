/**
 * 계약서 **전수 점검** — 규격·약관·표기.
 *
 * 사람이 눈으로 읽어 잡히지 않는 것만 기계로 센다.
 *   · 약관 조문 번호가 이어지는가 · 「제N조에 따라」가 실제 있는 조문을 가리키는가
 *   · HTML 약관과 코드 약관(esign-agreement-text)이 같은가
 *   · 규격 칸이 중복되거나 매핑에서 빠지지 않았는가
 *   · 한 칸에 들어가기 어려운 «너무 긴 값»이 어디인가
 *
 *   npx tsx scripts/audit-contract-doc.mts
 */
import { readFileSync } from 'node:fs';
import { AGREEMENT_SECTIONS, AGREEMENT_TITLE, AGREEMENT_VERSION } from '../lib/domain/esign-agreement-text';
import { FIELD_MAP } from '../lib/domain/esign-field-map';

const S = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const HTML = readFileSync('public/contract-template/rental-contract.html', 'utf8');
let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, note = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? '✓' : '✗'} ${name}${note ? `  ${note}` : ''}`); };

console.log(`\n══ 계약서 전수 점검 ══\n`);
console.log(`  약관 「${AGREEMENT_TITLE}」 ${AGREEMENT_VERSION} · ${AGREEMENT_SECTIONS.length}개 조문\n`);

/* ── 1. 조문 번호 ── */
console.log('■ 약관 조문');
const nums = AGREEMENT_SECTIONS.map((s) => Number(/제(\d+)조/.exec(s.t)?.[1] || 0));
const gaps: number[] = [];
for (let i = 1; i <= Math.max(...nums); i++) if (!nums.includes(i)) gaps.push(i);
check('번호가 1부터 빠짐없이 이어진다', gaps.length === 0, gaps.length ? `빠진 조문 ${gaps.join('·')}` : `제1~${Math.max(...nums)}조`);
check('번호가 겹치지 않는다', new Set(nums).size === nums.length);
check('제목이 비어 있지 않다', AGREEMENT_SECTIONS.every((s) => S(s.t) && S(s.b)));

/* ── 2. 상호참조 ── */
const refs = new Map<string, Set<number>>();
for (const s of AGREEMENT_SECTIONS) {
  for (const m of s.b.matchAll(/제(\d+)조/g)) {
    const n = Number(m[1]);
    (refs.get(s.t) || refs.set(s.t, new Set()).get(s.t)!).add(n);
  }
}
const dead: string[] = [];
for (const [from, set] of refs) for (const n of set) if (!nums.includes(n)) dead.push(`${from} → 제${n}조`);
check('「제N조」 참조가 모두 실재하는 조문을 가리킨다', dead.length === 0,
  dead.length ? `죽은 참조 ${dead.length}건` : `참조 ${[...refs.values()].reduce((a, s) => a + s.size, 0)}건`);
for (const d of dead.slice(0, 8)) console.log(`       ✗ ${d}`);

/* ── 3. HTML 약관과 코드 약관 ── */
console.log('\n■ 문서 ↔ 코드');
/**
 * 「형법 제225조」·「도로교통법 제95조」처럼 **다른 법률 인용**은 우리 조문이 아니다.
 * 바로 앞에 법률 이름이 붙어 있으면 뺀다 — 안 그러면 제225조가 우리 약관에 있다고 나온다.
 */
const htmlArts = [...new Set([...HTML.matchAll(/(.{0,14})제(\d+)조\s*\(/g)]
  .filter((m) => !/법」?\s*$|법률」?\s*$/.test(m[1]))
  .map((m) => Number(m[2])))].sort((a, b) => a - b);
check('HTML 에도 약관 조문이 실려 있다', htmlArts.length > 0, `HTML ${htmlArts.length}개 · 코드 ${nums.length}개`);
if (htmlArts.length) {
  const onlyHtml = htmlArts.filter((n) => !nums.includes(n));
  const onlyCode = nums.filter((n) => !htmlArts.includes(n));
  check('두 곳의 조문 번호가 같다', onlyHtml.length === 0 && onlyCode.length === 0,
    [onlyHtml.length ? `HTML 만: ${onlyHtml.join('·')}` : '', onlyCode.length ? `코드만: ${onlyCode.join('·')}` : ''].filter(Boolean).join(' / '));
}

/* ── 4. 규격 ── */
console.log('\n■ 규격(data-field)');
const inHtml = [...new Set([...HTML.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]))]
  .filter((f) => !/^['"+]|^키$/.test(f));      // 스크립트가 조립하는 이름은 칸이 아니다
const inMap = FIELD_MAP.map((f) => f.field);
check('매핑 키가 겹치지 않는다', new Set(inMap).size === inMap.length);
const onlyHtmlF = inHtml.filter((f) => !inMap.includes(f));
const onlyMapF = inMap.filter((f) => !inHtml.includes(f));
check('계약서 칸이 모두 매핑돼 있다', onlyHtmlF.length === 0, onlyHtmlF.length ? onlyHtmlF.join(' · ') : `${inHtml.length}칸`);
check('매핑이 모두 계약서에 자리가 있다', onlyMapF.length === 0, onlyMapF.length ? onlyMapF.join(' · ') : '');
check('모든 매핑에 라벨이 있다', FIELD_MAP.every((f) => S(f.label)));
/**
 * 원자는 «다른 곳에서 실려 오는 값»에만 있으면 된다.
 * `입력`(화면에서 직접 받음)·`본인확인`(우리가 안 받음)은 원자가 없는 게 정상이다.
 */
const noAtom = FIELD_MAP.filter((f) => ['계약', '재고', '정책', '파트너'].includes(f.from) && !f.atom);
check('밖에서 오는 값에는 원자가 지정돼 있다', noAtom.length === 0, noAtom.length ? noAtom.map((f) => f.field).join(' · ') : '');

/* ── 5. 표기 ── */
console.log('\n■ 표기·줄바꿈');
const long = AGREEMENT_SECTIONS.filter((s) => s.b.length > 1400);
check('한 조문이 지나치게 길지 않다(1,400자)', long.length === 0,
  long.length ? long.map((s) => `${s.t} ${s.b.length}자`).join(' · ') : `최장 ${Math.max(...AGREEMENT_SECTIONS.map((s) => s.b.length))}자`);
const badSpace = AGREEMENT_SECTIONS.filter((s) => /\s{2,}/.test(s.b) || /\n/.test(s.b));
check('조문 본문에 겹공백·줄바꿈이 없다', badSpace.length === 0, badSpace.length ? badSpace.map((s) => s.t).join(' · ') : '');
const circled = AGREEMENT_SECTIONS.filter((s) => !/^①/.test(s.b.trim()) && /②/.test(s.b));
check('항 번호가 ①부터 시작한다', circled.length === 0, circled.length ? circled.map((s) => s.t).join(' · ') : '');
// 계약서에 인쇄되는 안내문이 조문 번호를 손으로 적어 두면 조문이 밀릴 때 어긋난다
const hardRef = [...HTML.matchAll(/약관\s*제\s*(\d+)\s*조/g)].map((m) => Number(m[1]));
const badHard = [...new Set(hardRef)].filter((n) => !nums.includes(n));
check('본문에 손으로 적은 「약관 제N조」가 실재한다', badHard.length === 0,
  badHard.length ? `없는 조문 참조 ${badHard.join('·')}` : `${new Set(hardRef).size}건`);

console.log(`\n  ${pass}/${pass + fail} 통과\n`);
process.exit(fail ? 1 : 0);
