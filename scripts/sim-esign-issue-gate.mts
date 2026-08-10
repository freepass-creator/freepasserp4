/**
 * 전자계약 **발행 문(門) 점검** — 손님에게 문서를 내보내는 경로가 잠금을 부르는가.
 *
 * ★왜 «함수»가 아니라 «경로»를 세는가
 *   `isEsignTemplateAllowed` 자체는 이미 검사되고 있었다(sim-esign-agreement).
 *   그런데 2026-08-10 실측에서 구멍이 나왔다 — 착한거래 경로에는 잠금이 걸려 있고
 *   **자체 발행 경로에는 없었다.** 함수가 맞게 동작해도 그것을 «부르지 않는 문»이 있으면
 *   잠근 것이 아니다. 그래서 여기서는 파일을 열어 호출 여부를 센다.
 *
 *   새 발행 경로를 만들면 이 목록에 더한다. 더하지 않으면 이 검사가 놓친다 —
 *   그러라고 목록을 손으로 적는다(자동 탐색은 «안 걸린 새 경로»를 조용히 통과시킨다).
 *
 *   npx tsx scripts/sim-esign-issue-gate.mts
 */
import { readFileSync } from 'node:fs';
import { isEsignTemplateAllowed, STANDARD_IS_SAMPLE } from '../lib/domain/esign-templates';

/** 손님에게 계약서를 내보내는 문. 발행(issue)·발송(send) 하는 곳 전부. */
const ISSUE_ROUTES = [
  { path: 'app/api/freepass-esign/contracts/[contractCode]/route.ts', what: '프리패스 자체 발행' },
  { path: 'app/api/chakhandeal/contracts/send/route.ts', what: '착한거래 발송' },
];

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${note ? `  ${note}` : ''}`);
};

console.log('\n══ 전자계약 발행 문 점검 ══\n');
console.log(`  표준계약서 상태 — ${STANDARD_IS_SAMPLE ? '샘플(sample)' : '정본'}\n`);

for (const route of ISSUE_ROUTES) {
  let src = '';
  try { src = readFileSync(route.path, 'utf8'); }
  catch { check(`${route.what} — 파일이 있다`, false, route.path); continue; }
  check(`${route.what} 이 잠금을 부른다`, src.includes('isEsignTemplateAllowed'), route.path);
}

// 잠금 자체의 동작 — 샘플이면 운영에서 닫히고, 정본이 되면 열린다.
check('Preview 는 샘플 검증을 허용한다', isEsignTemplateAllowed('preview'));
check('Production 은 샘플 여부의 반대로 열린다',
  isEsignTemplateAllowed('production') === !STANDARD_IS_SAMPLE);
check('개발(환경 미지정)에서는 막지 않는다', isEsignTemplateAllowed(undefined));

console.log(`\n  ${pass}/${pass + fail} 통과\n`);
if (fail) {
  console.log('  ※ 발행 경로가 잠금을 부르지 않으면 샘플 문안이 운영에서 손님에게 나간다.\n');
}
process.exit(fail ? 1 : 0);
