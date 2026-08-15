/**
 * **매뉴얼이 코드와 어긋났는지 본다.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「매뉴얼에 다 적고 있는 거지???」)
 *   물어보셔서 확인해 보니 다섯 군데가 낡아 있었고, 그중 셋은 **지금과 반대로** 적혀 있었다 —
 *   「재시도가 없다」(있다) · 「사전이 스스로 닳는다」(고쳤다) · 「@매핑이 롤백된다」(지킨다).
 *   **거짓말하는 매뉴얼은 없느니만 못하다.** 읽는 사람이 그걸 믿고 움직이기 때문이다.
 *
 * ★그래서 «기계가 확인할 수 있는 것»만 골라 대조한다.
 *   글꼴·크기·행높이·정제칸 목록·재시도 유무처럼 코드에 상수로 있는 것들이다.
 *   서술·판단·이력은 사람 몫이라 여기서 안 본다 — 못 보는 것을 본다고 하면 그게 또 거짓말이다.
 *
 *   npx tsx scripts/check-manual-drift.mts
 */
import { readFileSync } from 'node:fs';
import { FONT, SIZE, rowPx, unitPx } from '../lib/domain/sales-sheet-format';
import { AI_TAIL_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { SALES_COLUMNS } from '../lib/domain/sales-sheet-mapping';

const DOC = 'docs/영업자시트-매뉴얼.md';
const doc = readFileSync(DOC, 'utf8');
const has = (s: string) => doc.includes(s);

type Check = { what: string; ok: boolean; detail: string };
const out: Check[] = [];
const check = (what: string, ok: boolean, detail: string) => out.push({ what, ok, detail });

// ── 서식 상수
check('글꼴', has(`${FONT} ${SIZE}pt`), `코드 ${FONT} ${SIZE}pt`);
check('행높이', has(`행높이 ${rowPx()}px`), `코드 ${rowPx()}px`);
check('열너비 계수', has('unitPx'), '문서가 계산식을 가리켜야 한다(숫자를 박아 두면 또 어긋난다)');
void unitPx;

// ── 정제칸
const ai = AI_TAIL_COLUMNS.map((c) => c.name);
check('정제칸 수', has(`정제칸 ${ai.length}칸`) || has(`정제칸 ${ai.length}개`), `코드 ${ai.length}칸`);
const missing = ai.filter((n) => !has(n));
check('정제칸 이름', missing.length === 0, missing.length ? `문서에 없는 칸: ${missing.join(', ')}` : '전부 적혀 있다');

// ── 판매시트 열 수
check('상품리스트 열 수', has(`| ${SALES_COLUMNS.length} |`), `코드 ${SALES_COLUMNS.length}열`);

/**
 * ── 재시도 — 「없다」고 적어 두고 실제로는 있는 일이 있었다.
 *   반대(있다고 적었는데 없는 것)가 더 위험하므로 코드 쪽을 기준으로 본다.
 */
const RETRY_SCRIPTS = [
  'publish-origin-tab', 'publish-clean-tab', 'publish-sonogong-tab', 'sync-mirror-sheet',
  'publish-supplier-handover-tab', 'audit-sheet-vs-sales', 'audit-supplier-schema', 'fix-supplier-table',
];
const noRetry = RETRY_SCRIPTS.filter((n) => {
  try { return !/429/.test(readFileSync(`scripts/${n}.mts`, 'utf8')); } catch { return true; }
});
check('재시도', noRetry.length === 0, noRetry.length ? `재시도가 없는 스크립트: ${noRetry.join(', ')}` : `${RETRY_SCRIPTS.length}개 전부 있다`);
const claimsNoRetry = /`publish-origin-tab` 에는 \*\*재시도가 없다/.test(doc);
check('재시도 서술', !claimsNoRetry, claimsNoRetry ? '⛔ 「재시도가 없다」는 낡은 문장이 남아 있다' : '낡은 문장 없음');

/** ── 사람 값 보호 — 세 곳이 실제로 «쓰기 전에 읽는가» */
const guards: [string, string, RegExp][] = [
  // ⚠ 문구가 아니라 «장치»를 본다. 문구로 재면 말만 바꿔도 검사가 통과한다.
  ['@매핑 보존', 'scripts/publish-handover-tab.mts', /시트에서 고친 \$\{used\.size\}줄은 지키고/],
  ['치환 사전 보존', 'scripts/publish-clean-tab.mts', /지금 시트엔 없음 — 규칙은 지킨다/],
  ['제공시트 메모 보존', 'scripts/publish-supplier-handover-tab.mts', /keepMemo/],
  /**
   * ★정제칸을 지키는 장치 셋. 매뉴얼 1장·4장이 이걸 약속한다.
   * ⚠ 하나라도 빠지면 «채운 값이 소리 없이 뒤집히는» 예전 상태로 돌아간다.
   */
  ['정제칸 재판단 안 함', 'scripts/publish-origin-tab.mts', /const already = !!exact\('파워트레인'\)/],
  ['정제칸 빈 칸만 채움', 'scripts/fill-supplier-ai-columns.mts', /if \(now\) \{ kept\+\+; continue; \}/],
  ['배기량 되짚기', 'scripts/fill-supplier-ai-columns.mts', /Math\.abs\(rawCc - snapCc\) \/ rawCc > 0\.07/],
  ['전후 견주기', 'scripts/publish-origin-tab.mts', /const dump = arg\('dump'\)/],
  // 대수를 «우리/아닌/총» 으로 세는 장치와 «팔 수 있는데 금액 없는 차» 표시
  ['대수 세 갈래', 'scripts/publish-origin-tab.mts', /우리 시트 \$\{all\.ours\}대 · 아닌 시트 \$\{all\.other\}대 · 총 \$\{all\.all\}대/],
  ['금액 빠진 차', 'scripts/publish-origin-tab.mts', /const noMoneySellable = split/],
  /**
   * ★차종코드 절차의 약속 넷(매뉴얼 4장) — 하나라도 빠지면 «틀린 코드가 영구히 박히는» 길이 열린다.
   */
  ['코드 실재 확인', 'scripts/stamp-vehicle-codes.mts', /!BOOK\.byCode\.has\(c\)/],
  ['배정 금지 관문', 'scripts/stamp-vehicle-codes.mts', /usageTier === 'blocked'/],
  ['정제시트 어긋남 보존', 'scripts/build-refine-sheet.mts', /t\.clash\+\+/],
  ['정제시트 표기 동일 비교', 'scripts/build-refine-sheet.mts', /sameValue\(now, next\)/],
];
for (const [what, file, re] of guards) {
  let ok = false;
  try { ok = re.test(readFileSync(file, 'utf8')); } catch { /* 없으면 실패 */ }
  check(what, ok, ok ? `${file} 에 장치가 있다` : `⛔ ${file} 에 지키는 장치가 없다`);
}
const claimsErode = /사전이 스스로 닳는다/.test(doc);
check('사전 서술', !claimsErode, claimsErode ? '⛔ 「사전이 스스로 닳는다」는 낡은 문장이 남아 있다' : '낡은 문장 없음');

const bad = out.filter((c) => !c.ok);
console.log(`■ 매뉴얼 ↔ 코드 대조 — ${DOC}\n`);
for (const c of out) console.log(`  ${c.ok ? '✓' : '✗'} ${c.what.padEnd(16)} ${c.detail}`);
console.log(`\n  맞음 ${out.length - bad.length} · 어긋남 ${bad.length}`);
if (bad.length) {
  console.log('\n  ⛔ 매뉴얼이 코드와 다르다. 매뉴얼을 고치거나, 코드가 틀렸으면 코드를 고쳐라.');
  console.log('     거짓말하는 매뉴얼은 없느니만 못하다 — 읽는 사람이 그걸 믿고 움직인다.\n');
  process.exit(1);
}
console.log('');
