/**
 * **하허호 F86 «완전 커스텀 레트로» 규격이 사라지지 않게 지킨다.**
 *
 * ★★★사장님 2026-09-16 「하허호 시트 매뉴얼 규격 픽스」
 *   2026-09-15~16 이틀 동안 칸·대여료·색이 여러 번 오갔다(9칸 늘 → 쓰는 칸만 · 보라 구분 → 옛 색 · 단기 칸 뺌 · 종합 탭).
 *   정한 답이 다음 세션에서 또 흔들리지 않게 «기계가» 잡는다.
 *
 * ★바꾸려면 차례를 지킨다 — **사장님께 여쭙고 → `docs/영업자시트-매뉴얼.md` §하허호 F86 을 고치고 → 이 검사를 고친다.**
 *   ⚠ 이 검사를 «먼저» 고쳐서 통과시키는 것은 규격을 지운 것과 같다.
 *
 *   npm run check:f86
 */
import { readFileSync } from 'node:fs';
import {
  applyRetroSkin, inRetroSummary, RETRO_FONT, RETRO_LAYOUT, RETRO_ROW_PX, RETRO_SHORT, RETRO_SIZE,
  RETRO_SUMMARY_EXCLUDE, RETRO_SUMMARY_TAB, retroCellValue, retroHasLongFee, retroLayout, retroTabColorRequest, retroUsesColumn,
} from '../lib/domain/channel-retro-skin';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fails: string[] = [];
const must = (ok: boolean, what: string, where: string) => { if (!ok) fails.push(`${what}\n      → ${where}`); };
const SKIN = 'lib/domain/channel-retro-skin.ts';
const MANUAL = 'docs/영업자시트-매뉴얼.md §하허호 F86 «완전 커스텀 레트로»';
const J = (v: unknown) => JSON.stringify(v);
const hex = (c: any) => c ? ['red', 'green', 'blue'].map((k) => Math.round((c[k] || 0) * 255).toString(16).padStart(2, '0')).join('') : '';

/* ── ② 칸 — 이름·차례 ────────────────────────────────────────────
   사장님 「순서를 똑같이, 내용도 똑같이」 · 「맨 앞에 공급사명, 코드 말고」 · 「입고 일자는 빼도 된다」 · 「차량상태가 배차상태야」   */
const HEADS = [
  '공급사명', '배차상태', '구분', '차량번호', '차종분류', '세부모델', '연료', '외장', '내장', 'Km', '@요금',
  '트림', '옵션', '최초등록', '소비자가격', '제조사', '배기량', '차고지', '운전자범위', '연주행', '분납',
  '21세', '23세', '1만+', '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌', '비고', '공급사코드', '정책코드', '사진', '차번링크',
];
must(J(RETRO_LAYOUT.map((e) => e.head)) === J(HEADS),
  `F86 칸 이름·차례가 바뀌었습니다.\n      실제 ${RETRO_LAYOUT.map((e) => e.head).join('·')}`,
  `${SKIN} · RETRO_LAYOUT — ${MANUAL} 2`);
must(RETRO_LAYOUT[0]?.src.kind === 'company', '맨 앞 「공급사명」이 회사명(탭 이름과 같은 이름)이 아닙니다 — 코드가 아니라 이름이어야 합니다.', `${SKIN} · RETRO_LAYOUT[0] — ${MANUAL} 2`);

/* ── ③ 대여료 ───────────────────────────────────────────────────
   「하허호는 단기칸 빼」(12개월까지) · 「자기 시트는 자기 고유 대여료만」 · 종합은 렌트사 규격 칸 늘   */
must(J(RETRO_SHORT) === J(['단기보증', '1개월', '6개월', '12개월']), `단기 칸 넷(단기보증·1개월·6개월·12개월)이 바뀌었습니다: ${J(RETRO_SHORT)}`, `${SKIN} · RETRO_SHORT — ${MANUAL} 3`);
const feeSlot = (heads: string[]) => heads.slice(heads.indexOf('Km') + 1, heads.indexOf('트림'));
const 회사탭 = feeSlot(retroLayout(['단기보증', '1개월', '12개월', '36개월', '48개월', '12개월 반납형', '보증금 반납형']).map((c) => c.head));
must(J(회사탭) === J(['36개월', '48개월', '12개월 반납형', '보증금 반납형']),
  `회사 탭 요금 칸이 «쓰는 칸만 · 단기 없음 · 고유 요금은 뒤»가 아닙니다: ${회사탭.join('·')}`, `${SKIN} · retroLayout — ${MANUAL} 3`);
const 종합탭 = feeSlot(retroLayout(['단기보증', '36개월'], { 모든기간: true }).map((c) => c.head));
must(J(종합탭) === J(['장기보증', '24개월', '36개월', '48개월', '60개월']),
  `종합 탭 요금 칸이 «장기보증·24~60개월 5칸 늘»이 아닙니다: ${종합탭.join('·')}`, `${SKIN} · retroLayout({모든기간}) — ${MANUAL} 3`);
must(!retroUsesColumn('12개월') && retroUsesColumn('36개월'), '감사기가 단기 칸을 «F86 에 실리는 칸»으로 셉니다(누락으로 웁니다).', `${SKIN} · retroUsesColumn — ${MANUAL} 3`);
const 셀 = (o: Record<string, string>) => retroHasLongFee((c) => o[c], Object.keys(o));
must(!셀({ '12개월': '600,000' }) && !셀({ '36개월': '-' }) && !셀({}) && 셀({ '36개월': '500,000' }),
  '「장기 월 요금이 없는 차는 안 싣는다」 판정이 바뀌었습니다(단기만·요금 빈 차 = 안 실음).', `${SKIN} · retroHasLongFee — ${MANUAL} 3`);

/* ── ① 탭 — 종합 ─────────────────────────────────────────────── */
must(RETRO_SUMMARY_TAB === '종합' && J(RETRO_SUMMARY_EXCLUDE) === J(['손오공', '오토플러스']) && !inRetroSummary('손오공') && inRetroSummary('아이카'),
  `「종합」 탭 규칙(손오공·오토플러스만 뺀다)이 바뀌었습니다: ${RETRO_SUMMARY_TAB} · 뺌 ${J(RETRO_SUMMARY_EXCLUDE)}`, `${SKIN} · RETRO_SUMMARY_* — ${MANUAL} 1`);
must(hex(retroTabColorRequest(0, '종합')?.updateSheetProperties?.properties?.tabColor) === '00ffff', '종합 탭 색이 옛 종합 색(00FFFF)이 아닙니다.', `${SKIN} · RETRO_TAB_COLOR — ${MANUAL} 1`);

/* ── ④ 겉 — 레트로 ───────────────────────────────────────────── */
must(RETRO_FONT === 'Malgun Gothic' && RETRO_SIZE === 9 && RETRO_ROW_PX === 21, `글꼴·크기·줄 높이가 바뀌었습니다: ${RETRO_FONT} ${RETRO_SIZE}pt · 줄 ${RETRO_ROW_PX}`, `${SKIN} — ${MANUAL} 4`);
const cols = ['구분', '36개월', '36개월 반납형', '분납', '최초등록', '배기량', '배차상태'];
const reqs: any[] = applyRetroSkin([{ addConditionalFormatRule: { rule: {} } }, { repeatCell: { fields: 'note' } }], [], { gid: 0, columns: cols, headerAt: 0 });
must(!reqs.some((r) => r.addConditionalFormatRule), '조건부서식이 남습니다 — 옛 시트는 0개입니다.', `${SKIN} · applyRetroSkin ① — ${MANUAL} 4`);
const whole = reqs.find((r) => r.repeatCell && r.repeatCell.range?.startColumnIndex === undefined && r.repeatCell.range?.startRowIndex === undefined)?.repeatCell?.cell?.userEnteredFormat;
must(!!whole && whole.textFormat?.italic === true && whole.textFormat?.bold === false && whole.horizontalAlignment === 'CENTER' && whole.wrapStrategy === 'OVERFLOW_CELL',
  '탭 전체 겉(기울임 · 굵기 없음 · 가운데 · 넘침)이 바뀌었습니다.', `${SKIN} · applyRetroSkin ③ — ${MANUAL} 4`);
const cellsAt = (i: number, head: boolean) => reqs.filter((r) => r.repeatCell && r.repeatCell.range?.startColumnIndex === i && (head ? r.repeatCell.range?.endRowIndex === 1 : r.repeatCell.range?.startRowIndex === 1)).map((r) => r.repeatCell.cell?.userEnteredFormat || {});
const last = <T,>(xs: T[]) => xs[xs.length - 1];
const headBg = (i: number) => hex(last(cellsAt(i, true).filter((f) => f.backgroundColor))?.backgroundColor);
const bodyInk = (i: number) => hex(last(cellsAt(i, false).filter((f) => f.textFormat?.foregroundColor))?.textFormat?.foregroundColor);
const bodyBg = (i: number) => hex(last(cellsAt(i, false).filter((f) => f.backgroundColor && hex(f.backgroundColor) !== 'ffffff'))?.backgroundColor);
const nf = (i: number) => last(cellsAt(i, false).filter((f) => f.numberFormat))?.numberFormat?.pattern;
must(headBg(1) === 'cc4125' && bodyInk(1) === '0000ff', `36개월 칸 색(머리 CC4125 · 글자 파랑)이 바뀌었습니다: 머리 ${headBg(1)} · 글자 ${bodyInk(1)}`, `${SKIN} · HEAD_BG/BODY_INK — ${MANUAL} 4`);
must(headBg(2) === 'cc4125' && bodyInk(2) === '0000ff',
  `고유 요금 칸(36개월 반납형)이 «기간이 같은 옛 칸 색»이 아닙니다: 머리 ${headBg(2)} · 글자 ${bodyInk(2)} — 사장님 「컬러 느낌은 동일하게 대여료 구간」`, `${SKIN} · retroFeeStyleOf — ${MANUAL} 4`);
must(bodyInk(0) === '34a853', `구분 글자색이 초록(34A853)이 아닙니다: ${bodyInk(0)}`, `${SKIN} · BODY_INK — ${MANUAL} 4`);
must(bodyInk(6) === '0000ff', `배차상태 글자색이 파랑이 아닙니다: ${bodyInk(6)}`, `${SKIN} · BODY_INK — ${MANUAL} 4`);
must(bodyBg(3) === 'ffff00' && bodyInk(3) === 'ff0000', `분납 칸(노란 바탕 · 빨강 글자)이 바뀌었습니다: ${bodyBg(3)} · ${bodyInk(3)}`, `${SKIN} · BODY_BG — ${MANUAL} 4`);
must(nf(4) === 'yy-m-d' && nf(5) === '#,##0' && nf(1) === '#,##0', `숫자·날짜 형식(요금·배기량 #,##0 · 최초등록 yy-m-d)이 바뀌었습니다: ${nf(1)} · ${nf(5)} · ${nf(4)}`, `${SKIN} · applyRetroSkin ④¼ — ${MANUAL} 4`);
must(retroCellValue('36개월', '1,050,000') === 1050000 && retroCellValue('최초등록', '2024-01-01') === 45292 && retroCellValue('단기보증', '무보증') === '무보증' && retroCellValue('최초등록', '22-03') === '22-03',
  '숫자·날짜로 넣는 값 변환(retroCellValue)이 바뀌었습니다.', `${SKIN} · retroCellValue — ${MANUAL} 4`);

/* ── ⓪ F86 만 · 발행기·감사기가 같은 표 ─────────────────────────── */
const build = read('scripts/build-channel-supplier-sheet.mts');
const audit = read('scripts/audit-sheet-vs-atom.mts');
must(/const RETRO = channel === '하허호'/.test(build), '레트로 분기가 «하허호 한 곳»에서만 켜지지 않습니다 — 다른 채널 시트로 번집니다.', `scripts/build-channel-supplier-sheet.mts · RETRO — ${MANUAL} 0`);
for (const name of ['retroLayout', 'retroHasLongFee', 'RETRO_SUMMARY_TAB']) {
  must(build.includes(name) && audit.includes(name), `발행기·감사기가 같은 «${name}» 를 안 씁니다 — 한쪽만 바뀌면 감사가 거짓말합니다.`, `build-channel-supplier-sheet.mts · audit-sheet-vs-atom.mts — ${MANUAL}`);
}
must(/if \(RETRO\) \{\s*const lock = spawnSync\([^)]*check-f86-locked\.mts/.test(build) && /lock\.status !== 0/.test(build),
  '발행기가 --apply 전에 이 잠금을 안 돌립니다 — 어긋난 규격으로 운영 F86 을 덮을 수 있습니다.', `scripts/build-channel-supplier-sheet.mts · F86 확정 규격 잠금 — ${MANUAL}`);
const pkg = read('package.json');
must(/"check:sync": "[^"]*npm run check:f86/.test(pkg), '`check:sync`(→ check:release) 에서 check:f86 이 빠졌습니다.', `package.json — ${MANUAL}`);
must(!read('lib/domain/sales-sheet-format.ts').includes('channel-retro-skin'), '공용 서식기가 레트로 스킨을 끌어 씁니다 — F01 모양이 같이 바뀝니다.', `lib/domain/sales-sheet-format.ts — ${MANUAL} 0`);

/* ── 매뉴얼 절 ───────────────────────────────────────────────── */
const man = read('docs/영업자시트-매뉴얼.md');
for (const phrase of ['«완전 커스텀 레트로» 규격 (2026-09-16 픽스)', 'npm run check:f86', '단기보증·1개월·6개월·12개월', '손오공·오토플러스를 뺀 렌트사 차 한 장', 'retroHasLongFee', '맑은 고딕 9pt', '기간이 같은 옛 칸 색', '회사 탭도 그대로 같이 둔다']) {
  must(man.includes(phrase), `매뉴얼 F86 절에서 「${phrase}」가 사라졌습니다.`, MANUAL);
}

if (fails.length) {
  console.error(`\n⛔ 하허호 F86 확정 규격이 어긋났습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  console.error('  바꾸려면: 사장님께 여쭙고 → 매뉴얼 §하허호 F86 → 이 검사 순서로.\n');
  process.exit(1);
}
console.log('✓ 하허호 F86 확정 규격 그대로 — 탭(종합·회사) · 칸 36 · 대여료(단기 없음·쓰는 칸만·종합 5칸·장기 요금 없는 차 안 실음) · 레트로 겉 · F86 만');
