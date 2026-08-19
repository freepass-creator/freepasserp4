/**
 * **정책 작성 매뉴얼 — 한 곳에서 만든다.** 리포 문서(`docs/SUPPLIER_POLICY_SHEET_MANUAL.md`)와 제공시트의
 * 「정책 작성법」 탭이 같은 표를 쓴다. 규격은 `policy-value-spec`, 항목·쓰는 곳은 `policy-sheet-layout` 에서 온다 —
 * 여기서 새 규칙을 적지 않는다(적으면 세 벌이 된다).
 */
import { PART_LABEL, POLICY_PREFILL, POLICY_SHEET_FIELDS, USE_LABEL } from './policy-sheet-layout';
import { POLICY_VALUE_RULES, POLICY_VALUE_RULE_BY_NAME } from './policy-value-spec';

export const POLICY_GUIDE_TAB = '정책 작성법';

/** 표기 원칙 — 매뉴얼 앞머리. `policy-value-spec` 머리 주석과 같은 내용이다. */
export const POLICY_WRITING_PRINCIPLES: string[] = [
  '금액은 한글 단위로 붙여 쓴다 — 「50만원」·「100만원」·「5천만원」·「1천5백만원」·「1억원」·「1억5천만원」. 쉼표·띄어쓰기 없음. 숫자만(「100000」)·단위 없이(「70만」)·소수 억(「1.5억원」)·쉼표 만원(「5,000만원」)은 쓰지 않는다. 만원 아래만 「200원」·「1,000원」.',
  '나이는 「만 N세 …」 — 띄어쓰기 하나. 「만 21세까지」·「만 26세 이상」·「만 70세 이하」. 숫자만(「70」) 금지.',
  '거리는 「연 20,000km」 — 소문자 km, 천 단위 쉼표. 「연간 2만Km」 금지.',
  '비율은 「30%」(「0.3」 금지). 횟수는 「3회」·「연간 5회」(숫자만 금지).',
  '가·부는 「가능 / 불가 / 협의」 세 말만. 「불가능」·「미제공」은 「불가」·「불포함」으로.',
  '없으면 「없음」. 빈칸은 «아직 안 적음»이라 「없음」과 다르다.',
  '드롭다운이 있는 칸은 목록에서 고른다. 목록에 없는 답이 실제로 있으면(예: 보증금분납 「2회까지」) 위 원칙대로 적는다.',
  '자유 서술 칸(전용계좌·특이사항·가입 보험사·지정 정비점·자차 처리 제외)은 표기 강제 없음. 「공급사 기재」 같은 자리표시 문구는 빈칸으로 본다.',
  '「추가운전」은 가능 여부만(가능/불가/협의). 인원과 요금은 「추가운전 요금」에 「N인까지 · 1인당 월 M만원」으로. 무료면 「N인까지 · 무료」, 인원 제한이 없으면 「제한없음 · 1인당 월 M만원」.',
  '한 줄이 정책 하나다. 첫 줄 「(프리패스 기본)」은 프리패스 기본 정책, 그 아래가 그 회사 정책(정책코드별). 차량 시트의 「정책코드」가 이 줄을 가리킨다.',
];

export const POLICY_GUIDE_HEADER = ['묶음', '항목', '쓰는 곳', '무엇을 적나', '표기 규격', '예시', '고르는 값(드롭다운)'] as const;

/** 항목표 — 시트 열 차례 그대로. */
export function policyGuideRows(): string[][] {
  return POLICY_SHEET_FIELDS.map((f) => {
    const rule = POLICY_VALUE_RULE_BY_NAME[f.name];
    return [
      PART_LABEL[f.part], f.name, USE_LABEL[f.use], f.note,
      rule?.format || '자유 서술', (rule?.examples || []).join(' · '), (rule?.allowed || []).join(' / '),
    ];
  });
}

/** 자주 틀리는 표기 → 규격 (동의어표에서 뽑는다). */
export function policyGuideSynonymRows(): string[][] {
  const out: string[][] = [];
  for (const rule of POLICY_VALUE_RULES) {
    for (const [from, to] of Object.entries(rule.synonyms || {})) out.push([rule.name, from, to]);
  }
  out.push(['금액 전반', '100000 · 70만 · 1.5억원 · 5,000만원 · 1,500만원', '10만원 · 70만원 · 1억5천만원 · 5천만원 · 1천5백만원']);
  out.push(['나이 전반', '만21세 · 26 · 70', '만 21세까지 · 만 26세 이상 · 만 70세 이하']);
  out.push(['기본주행', '연간 2만Km · 연간 2.5만Km', '연 20,000km · 연 25,000km']);
  out.push(['비율·횟수', '0.3 · 3 · 연 5회', '30% · 3회 · 연간 5회']);
  out.push(['추가운전(옛 추가운전자)', '1인 · 2인', '가능 (인원은 「추가운전 요금」에 「1인까지 · …」)']);
  out.push(['추가운전 요금', '월 5만원 · 50000 · 월 0만원', '1인까지 · 1인당 월 5만원 · 1인까지 · 무료']);
  return out;
}

/** 리포 문서 본문(마크다운). */
export function policyGuideMarkdown(): string {
  const lines: string[] = [];
  lines.push('# 공급사 「정책」 탭 작성 매뉴얼');
  lines.push('');
  lines.push('기준일 2026-08-18 · 정본: `lib/domain/policy-value-spec.ts`(표기 규격) · `lib/domain/policy-sheet-layout.ts`(항목·쓰는 곳) · 이 문서와 제공시트 「정책 작성법」 탭은 `lib/domain/policy-guide.ts` 가 같은 표로 찍는다(`npx tsx scripts/publish-policy-guide.mts`).');
  lines.push('');
  lines.push('> 사장님 2026-08-18 — 「규격 통일 좀 하고 매뉴얼 만들면 되잖아」 · 「어디는 70만 달랑이고」 · 「어떤 건 만21세 어떤 건 만71세 이상 이러니까 표기 통일하자」 · 「추가운전이라고 하고 가능 여부만 · 요금은 1인까지 / 1인당 얼마」');
  lines.push('');
  lines.push('## 왜 — 무엇이 갈려 있었나');
  lines.push('');
  lines.push('실측 2026-08-18, 20곳 정책 탭: 기본주행 「연 20,000km」×22 · 「연간 2만Km」×8 · 「연간 2.5만Km」 / 연령인하 「만 21세까지」×22 · 「만21세」×8 / 최대연령 「70」×7 / 연령 하향 요금 「100000」×7 / 위약금 「0.3」×7 / 초과주행 「200」×7 …');
  lines.push('뿌리는 규격이 두 곳(드롭다운 목록 · 머리글 메모)에 따로 있어 서로 다른 표기를 권했던 것. 정본을 `policy-value-spec` 하나로 모으고, 20곳 333칸을 규격으로 고쳤다(`scripts/normalize-policy-values.mts`).');
  lines.push('');
  lines.push('## 표기 원칙');
  lines.push('');
  POLICY_WRITING_PRINCIPLES.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push('');
  lines.push('## 프리패스 기본 정책 — (프리패스 기본) 줄의 값');
  lines.push('');
  lines.push('사장님이 2026-08-19 확정. 모든 공급사 시트의 첫 줄 「(프리패스 기본)」이 이 값이고, 공급사는 **자기 정책이 다를 때만** 자기 줄에 적는다. 정본은 `policy-sheet-layout.ts POLICY_PREFILL`.');
  lines.push('');
  lines.push('| 파트 | 항목 | 프리패스 기본 |');
  lines.push('|---|---|---|');
  for (const f of POLICY_SHEET_FIELDS) {
    const v = POLICY_PREFILL[f.name];
    lines.push(`| ${PART_LABEL[f.part]} | ${f.name} | ${v ?? '(공급사별)'} |`);
  }
  lines.push('');
  lines.push('## 항목표 — 시트 열 차례 그대로');
  lines.push('');
  lines.push(`| ${POLICY_GUIDE_HEADER.join(' | ')} |`);
  lines.push(`|${POLICY_GUIDE_HEADER.map(() => '---').join('|')}|`);
  for (const r of policyGuideRows()) lines.push(`| ${r.map((c) => c.replace(/\|/g, '／').replace(/\n/g, ' ')).join(' | ')} |`);
  lines.push('');
  lines.push('## 자주 틀리는 표기 → 규격');
  lines.push('');
  lines.push('| 항목 | 이렇게 적혀 있으면 | 이렇게 |');
  lines.push('|---|---|---|');
  for (const r of policyGuideSynonymRows()) lines.push(`| ${r.map((c) => c.replace(/\|/g, '／')).join(' | ')} |`);
  lines.push('');
  lines.push('## 도구');
  lines.push('');
  lines.push('- 표기 통일(정규화·드롭다운·메모 재적용): `npx tsx scripts/normalize-policy-values.mts` → `--apply`. 뜻이 갈리는 값은 «검토»로 남긴다(고치지 않는다).');
  lines.push('- 매뉴얼 재발행(이 문서): `npx tsx scripts/publish-policy-guide.mts`. 공급사 시트에는 안내 탭을 두지 않는다(사장님 2026-08-18) — 칸별 규격은 정책 탭 머리글 메모에 있다.');
  lines.push('- 판매시트에서 보이는 옵션 뒤 정책 칸은 `publish-origin-tab` 이 우리 제공시트 「정책」 탭을 정책코드로 조인해 채운다(문패가 어디를 가리키든).');
  lines.push('');
  return `${lines.join('\n')}\n`;
}
