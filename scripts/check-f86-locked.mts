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
  RETRO_SUMMARY_EXCLUDE, RETRO_SUMMARY_TAB, retroCellValue, retroHasLongFee, retroTabColorRequest, retroUsesColumn,
  RETRO_TAB_FEES, RETRO_TAB_ORDER, retroTabLayout, retroWidthOf,
} from '../lib/domain/channel-retro-skin';
import { MISSING_INK } from '../lib/domain/sales-sheet-format';

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
/* ── ⑤ 굳힌 양식 — 탭 차례 · 탭별 요금 칸 · 칸 폭 ─────────────────
   사장님 2026-09-16 「하허호 시트 양식을 굳히라고 … 또 매번 달라지지 말고」 — 데이터 따라 흔들리던 셋을 표로 박았다.   */
const L5 = ['장기보증', '24개월', '36개월', '48개월', '60개월'];
const ORDER = ['종합', '손오공', '이안카', '아이카', '오토플러스', '빌린카', '아이언', '우리캐피탈', '케이에이치', '에스에이', '스타스카이', '제이앤제이', '웰릭스', '에코', '경진', '리더스', '마음카', '센트로', '렌트존'];
const FEES: Record<string, string[]> = {
  종합: L5,
  손오공: ['보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형', '보증금 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형', '12개월 인수형', '24개월 인수형'],
  이안카: L5, 아이카: ['장기보증', '36개월', '48개월'],
  오토플러스: ['보증금', '12개월 2만km', '12개월 3만km', '18개월 2만km', '18개월 3만km', '24개월 2만km', '24개월 3만km', '36개월 2만km', '36개월 3만km'],
  빌린카: L5, 아이언: ['장기보증', '36개월', '48개월', '60개월'], 우리캐피탈: ['장기보증', '36개월', '48개월', '60개월'], 케이에이치: L5,
  에스에이: ['장기보증', '24개월', '36개월', '48개월'], 스타스카이: L5, 제이앤제이: L5, 웰릭스: ['장기보증', '24개월', '36개월', '48개월'],
  에코: ['장기보증', '24개월', '36개월', '48개월'], 경진: ['장기보증', '24개월', '36개월', '48개월'], 리더스: ['장기보증', '24개월', '36개월'],
  마음카: ['24개월', '36개월', '48개월'], 센트로: ['장기보증', '48개월'], 렌트존: ['장기보증', '48개월', '60개월'],
};
must(J(RETRO_TAB_ORDER) === J(ORDER), `굳힌 탭 차례가 바뀌었습니다: ${RETRO_TAB_ORDER.join('·')}`, `${SKIN} · RETRO_TAB_ORDER — ${MANUAL} 5`);
must(J(Object.keys(RETRO_TAB_FEES).sort()) === J(Object.keys(FEES).sort()) && Object.entries(FEES).every(([k, v]) => J(RETRO_TAB_FEES[k]) === J(v)),
  '굳힌 탭별 요금 칸 표가 바뀌었습니다.', `${SKIN} · RETRO_TAB_FEES — ${MANUAL} 5`);
must(RETRO_TAB_ORDER.every((k) => !!RETRO_TAB_FEES[k]) && Object.keys(RETRO_TAB_FEES).every((k) => RETRO_TAB_ORDER.includes(k)), '탭 차례 표와 요금 칸 표의 회사가 서로 다릅니다.', `${SKIN} — ${MANUAL} 5`);
must(retroTabLayout('표에없는회사') === null, '표에 없는 회사도 칸을 만들어 줍니다 — 멈춰야 합니다.', `${SKIN} · retroTabLayout — ${MANUAL} 5`);
must(J(feeSlot((retroTabLayout('아이카') || []).map((c) => c.head))) === J(['장기보증', '36개월', '48개월']) && J(feeSlot((retroTabLayout('종합') || []).map((c) => c.head))) === J(L5),
  '탭 칸이 «굳힌 표»에서 안 나옵니다.', `${SKIN} · retroTabLayout — ${MANUAL} 5`);
const W: Record<string, number> = { 공급사명: 82, 세부모델: 180, 트림: 342, 옵션: 857, 전용계좌: 292, 장기보증: 75, '36개월': 75, '12개월 반납형': 108, '12개월 2만km': 101, '보증금 반납형': 233, 보증금: 239 };
must(Object.entries(W).every(([k, v]) => retroWidthOf(k) === v), `굳힌 칸 폭이 바뀌었습니다: ${Object.keys(W).map((k) => `${k} ${retroWidthOf(k)}`).join(' · ')}`, `${SKIN} · RETRO_WIDTH — ${MANUAL} 5`);
must(!retroUsesColumn('12개월') && retroUsesColumn('36개월'), '감사기가 단기 칸을 «F86 에 실리는 칸»으로 셉니다(누락으로 웁니다).', `${SKIN} · retroUsesColumn — ${MANUAL} 3`);
const 셀 = (o: Record<string, string>) => retroHasLongFee((c) => o[c], Object.keys(o));
must(!셀({ '12개월': '600,000' }) && !셀({ '36개월': '-' }) && !셀({ '36개월': '미입력' }) && !셀({ '48개월': '해당없음' }) && !셀({}) && 셀({ '36개월': '500,000' }),
  '「장기 요금 있음/없음」 판정 자체가 바뀌었습니다(2026-09-16부터 이 값은 제외가 아니라 알림에만 씁니다).', `${SKIN} · retroHasLongFee — ${MANUAL} 3`);
/** ★사장님 2026-09-16 「24개월 이후로 대여료가 없으면 대여료 없이 그냥 두자, 그래야 총 상품 숫자를 맞출 수 있다」 — 계획이 그 차를 다시 «빼면» 막는다. */
must(!/shortOnly\.push\(x\);\s*continue/.test(read('lib/server/channel-f86-plan.ts')) && /const f86대상차 = new Set\(f01\.map\(\(r\) => r\.car\)\)/.test(read('scripts/audit-sheet-vs-atom.mts')),
  '발행 계획이 장기 요금 없는 차를 다시 «뺍니다»(또는 감사기가 뺀다고 기대합니다) — F86 대수가 F01 과 어긋납니다.', `lib/server/channel-f86-plan.ts · audit-sheet-vs-atom.mts — ${MANUAL} 3`);

/* ── ① 탭 — 종합 ─────────────────────────────────────────────── */
must(RETRO_SUMMARY_TAB === '종합' && J(RETRO_SUMMARY_EXCLUDE) === J(['손오공', '오토플러스']) && !inRetroSummary('손오공') && inRetroSummary('아이카'),
  `「종합」 탭 규칙(손오공·오토플러스만 뺀다)이 바뀌었습니다: ${RETRO_SUMMARY_TAB} · 뺌 ${J(RETRO_SUMMARY_EXCLUDE)}`, `${SKIN} · RETRO_SUMMARY_* — ${MANUAL} 1`);
must(hex(retroTabColorRequest(0, '종합')?.updateSheetProperties?.properties?.tabColor) === '00ffff', '종합 탭 색이 옛 종합 색(00FFFF)이 아닙니다.', `${SKIN} · RETRO_TAB_COLOR — ${MANUAL} 1`);

/* ── ④ 겉 — 레트로 ───────────────────────────────────────────── */
must(RETRO_FONT === 'Malgun Gothic' && RETRO_SIZE === 9 && RETRO_ROW_PX === 21, `글꼴·크기·줄 높이가 바뀌었습니다: ${RETRO_FONT} ${RETRO_SIZE}pt · 줄 ${RETRO_ROW_PX}`, `${SKIN} — ${MANUAL} 4`);
const cols = ['구분', '36개월', '36개월 반납형', '분납', '최초등록', '배기량', '배차상태', '차량번호'];
const reqs: any[] = applyRetroSkin([{ addConditionalFormatRule: { rule: {} } }, { repeatCell: { fields: 'note' } }], [], { gid: 0, columns: cols, headerAt: 0 });
must(!reqs.some((r) => r.addConditionalFormatRule), '레트로 입력엔 「구분」 값별 조건부서식이 없는데도 살아남았습니다 — 필터가 열려 있습니다.', `${SKIN} · applyRetroSkin ① — ${MANUAL} 4`);
{
  // ★2026-09-16 — 「구분」·「배차상태」 값별 색(GUBUN_INK·STATE_INK)은 예외로 살아야 한다(F01과 같은 뜻·같은 색).
  const 구분조건부 = { addConditionalFormatRule: { rule: { ranges: [{ sheetId: 0, startColumnIndex: 0, endColumnIndex: 1 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '픽업구독' }] }, format: { textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 } } } } } } };
  const 배차상태조건부 = { addConditionalFormatRule: { rule: { ranges: [{ sheetId: 0, startColumnIndex: 6, endColumnIndex: 7 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '출고가능' }] }, format: { textFormat: { foregroundColor: { red: 0, green: 0, blue: 1 } } } } } } };
  const 다른칸조건부 = { addConditionalFormatRule: { rule: { ranges: [{ sheetId: 0, startColumnIndex: 5, endColumnIndex: 6 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '가솔린' }] }, format: {} } } } };
  // ★2026-09-16 — 「미입력」·「해당없음」 연한 회색(표 전체 범위)도 예외로 살아야 한다.
  const 미입력조건부 = { addConditionalFormatRule: { rule: { ranges: [{ sheetId: 0, startColumnIndex: 0, endColumnIndex: 7 }], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: '미입력' }] }, format: { textFormat: { foregroundColor: { red: 0.72, green: 0.72, blue: 0.72 } } } } } } };
  const r2 = applyRetroSkin([구분조건부, 배차상태조건부, 다른칸조건부, 미입력조건부], [], { gid: 0, columns: cols, headerAt: 0 });
  must(r2.some((r) => r.addConditionalFormatRule === 구분조건부.addConditionalFormatRule), '「구분」 값별 조건부서식(GUBUN_INK)이 레트로에서 걷힙니다 — F01·F86 상품 갈래 색이 갈라집니다.', `${SKIN} · applyRetroSkin ① 예외 — ${MANUAL} 4`);
  must(r2.some((r) => r.addConditionalFormatRule === 배차상태조건부.addConditionalFormatRule), '「배차상태」 값별 조건부서식(STATE_INK)이 레트로에서 걷힙니다 — F01·F86 배차상태 색이 갈라집니다.', `${SKIN} · applyRetroSkin ① 예외 — ${MANUAL} 4`);
  must(r2.some((r) => r.addConditionalFormatRule === 미입력조건부.addConditionalFormatRule), '「미입력」 연한 회색 조건부서식이 레트로에서 걷힙니다 — 사장님 「미입력은 좀 색깔이 회색이어야지」(2026-09-16) 위반.', `${SKIN} · applyRetroSkin ① 예외 — ${MANUAL} 4`);
  must(!r2.some((r) => r.addConditionalFormatRule === 다른칸조건부.addConditionalFormatRule), '「구분」·「배차상태」가 아닌 칸의 조건부서식까지 살아남습니다 — 레트로 「옛 시트 느낌」이 깨집니다.', `${SKIN} · applyRetroSkin ① 예외 — ${MANUAL} 4`);
}
must(MISSING_INK === 'B7B7B7', `「미입력」 연한 회색(B7B7B7)이 바뀌었습니다: ${MISSING_INK}`, `lib/domain/sales-sheet-format.ts · MISSING_INK — ${MANUAL} 4`);
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
must(bodyInk(0) === '', `「구분」에 옛 고정색(BODY_INK)이 남아 있습니다: ${bodyInk(0)} — 이제 값별 표(GUBUN_INK)로만 정한다.`, `${SKIN} · BODY_INK — ${MANUAL} 4`);
must(bodyInk(6) === '', `「배차상태」에 옛 고정색(BODY_INK)이 남아 있습니다: ${bodyInk(6)} — 이제 값별 표(STATE_INK)로만 정한다.`, `${SKIN} · BODY_INK — ${MANUAL} 4`);
// ★2026-09-16 — 「차량번호」 고정색 금지. 사장님 「링크 잇는애들은 링크색깔 링크없으면 그냥 색깔 검정색이겟지?」
//   칸 전체를 링크색으로 칠하면 링크 없는 차도 파랗게 보인다. 링크 있는 줄만 그 셀 textFormatRuns 가 파랑으로 덮는다.
must(bodyInk(7) === '', `「차량번호」에 고정 링크색(BODY_INK)이 남아 있습니다: ${bodyInk(7)} — 링크 있는 줄만 파랑이어야 합니다.`, `${SKIN} · BODY_INK — ${MANUAL} 4`);
must(bodyBg(3) === 'ffff00' && bodyInk(3) === 'ff0000', `분납 칸(노란 바탕 · 빨강 글자)이 바뀌었습니다: ${bodyBg(3)} · ${bodyInk(3)}`, `${SKIN} · BODY_BG — ${MANUAL} 4`);
must(nf(4) === 'yy-m-d' && nf(5) === '#,##0' && nf(1) === '#,##0', `숫자·날짜 형식(요금·배기량 #,##0 · 최초등록 yy-m-d)이 바뀌었습니다: ${nf(1)} · ${nf(5)} · ${nf(4)}`, `${SKIN} · applyRetroSkin ④¼ — ${MANUAL} 4`);
const 폭요청 = reqs.filter((r) => r.updateDimensionProperties?.range?.dimension === 'COLUMNS' && r.updateDimensionProperties?.properties?.pixelSize);
must(cols.every((name, i) => last(폭요청.filter((r) => r.updateDimensionProperties.range.startIndex === i))?.updateDimensionProperties.properties.pixelSize === retroWidthOf(name)),
  '칸 폭이 «굳힌 표»로 안 박힙니다 — 값 길이로 재면 회차마다 폭이 흔들립니다.', `${SKIN} · applyRetroSkin ④½ — ${MANUAL} 5`);
must(retroCellValue('36개월', '1,050,000') === 1050000 && retroCellValue('최초등록', '2024-01-01') === 45292 && retroCellValue('단기보증', '무보증') === '무보증' && retroCellValue('최초등록', '22-03') === '22-03',
  '숫자·날짜로 넣는 값 변환(retroCellValue)이 바뀌었습니다.', `${SKIN} · retroCellValue — ${MANUAL} 4`);

/* ── ⓪ F86 만 · 발행기·감사기가 같은 표 ─────────────────────────── */
const build = read('scripts/build-channel-supplier-sheet.mts');
const audit = read('scripts/audit-sheet-vs-atom.mts');
/** ★2026-09-16 「하허호 시트는 제일 중요하게」 — 칸·줄·값·차례는 계획 한 벌(`buildF86Plan`)에서만 · F86 감사기도 같은 계획. */
const planSrc = read('lib/server/channel-f86-plan.ts');
const auditF86 = read('scripts/audit-f86-vs-atom.mts');
must(/const RETRO = channel === '하허호'/.test(build), '레트로 분기가 «하허호 한 곳»에서만 켜지지 않습니다 — 다른 채널 시트로 번집니다.', `scripts/build-channel-supplier-sheet.mts · RETRO — ${MANUAL} 0`);
must(/양식어긋남/.test(planSrc) && /retroTabLayout\(company\)/.test(planSrc) && /retroTabRank/.test(planSrc) && /plan\.layoutViolations/.test(build),
  '발행 계획이 «굳힌 표»(탭 차례·요금 칸)를 안 쓰거나 발행기가 표 밖 데이터에서 안 멈춥니다.', `lib/server/channel-f86-plan.ts · build-channel-supplier-sheet.mts 굳힌 양식 문지기 — ${MANUAL} 5`);
must(build.includes('buildF86Plan') && auditF86.includes('buildF86Plan'),
  '발행기와 F86 감사기가 같은 계획(buildF86Plan)을 안 씁니다 — 한쪽만 바뀌면 감사가 거짓말합니다.', `build-channel-supplier-sheet.mts · audit-f86-vs-atom.mts — ${MANUAL} 6`);
for (const f of ['scripts/backup-f86.mts', 'scripts/restore-f86-from-backup.mts']) {
  let ok = true; try { read(f); } catch { ok = false; }
  must(ok, `${f} 가 없습니다 — 운영 F86 되돌리기 준비가 사라졌습니다.`, `${f} — ${MANUAL} 6`);
}
must(/--max-age-min/.test(auditF86), 'F86 감사기에 신선도(--max-age-min) 검사가 없습니다.', `scripts/audit-f86-vs-atom.mts — ${MANUAL} 6`);
/** ★2026-09-18 — 신선도 검사가 탭명 규격을 제 손으로 적어(전 탭 · 초까지) 정시 회차를 매번 빨간불로 만들었다. 발행기와 같은 한 줄(`f86TabCarriesMark`)을 쓴다. */
const auditChecks = read('lib/server/f86-audit-checks.ts');
must(/checkF86TabFreshness\(/.test(auditF86) && /compareF86Cells\(/.test(auditF86) && /f86TabCarriesMark\(/.test(auditChecks)
  && /return f86TabCarriesMark\(company, retro\)/.test(planSrc),
  'F86 감사기 신선도가 발행기의 탭 이름 규칙(f86TabCarriesMark)을 안 씁니다 — 「종합」만 시각·회사 탭 「회사 · N대」를 두 벌로 적으면 또 어긋납니다.', `lib/server/f86-audit-checks.ts · scripts/audit-f86-vs-atom.mts — ${MANUAL} 6`);
must(/retroTabLayout\(company\)/.test(audit) && /탭 차례가 굳힌 표와 다르다/.test(audit),
  '감사기가 «굳힌 표»로 머리글·탭 차례를 안 봅니다.', `scripts/audit-sheet-vs-atom.mts — ${MANUAL} 5`);
for (const name of ['retroTabLayout', 'retroHasLongFee', 'RETRO_SUMMARY_TAB']) {
  must(planSrc.includes(name) && audit.includes(name), `발행기·감사기가 같은 «${name}» 를 안 씁니다 — 한쪽만 바뀌면 감사가 거짓말합니다.`, `build-channel-supplier-sheet.mts · audit-sheet-vs-atom.mts — ${MANUAL}`);
}
must(/if \(RETRO\) \{\s*const lock = spawnSync\([^)]*check-f86-locked\.mts/.test(build) && /lock\.status !== 0/.test(build),
  '발행기가 --apply 전에 이 잠금을 안 돌립니다 — 어긋난 규격으로 운영 F86 을 덮을 수 있습니다.', `scripts/build-channel-supplier-sheet.mts · F86 확정 규격 잠금 — ${MANUAL}`);
/* ── ⓪¾ 2026-09-16 확정 — 공지사항 없음 · 탭명(종합만 시각, 회사는 회사·대수) ──────── */
must(/if \(!RETRO\) \{\s*const tok = /.test(build),
  'F86(하허호) 발행 때 공지사항 탭을 만듭니다 — 사장님 「f86은 공지사항 탭 지워주시고」(2026-09-16) 규격 위반.', `scripts/build-channel-supplier-sheet.mts · 공지사항 — ${MANUAL} 6`);
must(/RETRO \? \/안내\|이 시트\|시트 지도\/ : \/공지\|안내\|이 시트\|시트 지도\//.test(build),
  'F86 묵은 탭 청소가 공지사항을 계속 지켜 줍니다 — 남아 있던 공지사항이 안 지워집니다.', `scripts/build-channel-supplier-sheet.mts · 공지사항 청소 — ${MANUAL} 6`);
must(/RETRO \? 0 : 1;/.test(build), 'F86 탭 index 가 공지사항 자리(1부터)를 그대로 씁니다 — 종합이 맨 앞(0)이어야 합니다.', `scripts/build-channel-supplier-sheet.mts · index — ${MANUAL} 6`);
/** 탭 이름 규칙은 계획 한 벌(`f86TabTitle`)에만 적는다 — 발행기·감사기가 그 함수를 부른다(두 벌로 적으면 한쪽만 바뀐다). */
must(/export function f86TabTitle/.test(planSrc) && /company !== RETRO_SUMMARY_TAB/.test(planSrc)
  && /`\$\{company\} · \$\{count\}대`/.test(planSrc) && /`\$\{company\} \$\{mark\} · \$\{count\}대`/.test(planSrc),
  'F86 탭 이름 규칙이 바뀌었습니다 — 사장님 「시간은 맨 앞에 탭 하나만」(2026-09-16): 「종합」만 시각을 달고, 회사 탭은 「회사 · N대」만 씁니다.', `lib/server/channel-f86-plan.ts · f86TabTitle — ${MANUAL} 6`);
must(/f86TabTitle\(/.test(audit), '감사기가 탭 이름을 제 손으로 짓습니다 — 발행기와 어긋납니다(f86TabTitle 한 벌을 쓰세요).', `scripts/audit-sheet-vs-atom.mts · 탭 이름 — ${MANUAL} 6`);
const pkg = read('package.json');
must(/"check:sync": "[^"]*npm run check:f86/.test(pkg), '`check:sync`(→ check:release) 에서 check:f86 이 빠졌습니다.', `package.json — ${MANUAL}`);
must(!read('lib/domain/sales-sheet-format.ts').includes('channel-retro-skin'), '공용 서식기가 레트로 스킨을 끌어 씁니다 — F01 모양이 같이 바뀝니다.', `lib/domain/sales-sheet-format.ts — ${MANUAL} 0`);

/* ── 매뉴얼 절 ───────────────────────────────────────────────── */
const man = read('docs/영업자시트-매뉴얼.md');
for (const phrase of ['«완전 커스텀 레트로» 규격 (2026-09-16 픽스)', 'npm run check:f86', '단기보증·1개월·6개월·12개월', '손오공·오토플러스를 뺀 렌트사 차 한 장', 'retroHasLongFee', '맑은 고딕 9pt', '기간이 같은 옛 칸 색', '회사 탭도 그대로 같이 둔다', '굳힌 양식', '빈 값 표기 = F01 과 같다', '지키는 장치', 'F86 엔 공지사항 탭이 없다', '시각은 「종합」 하나에만', 'GUBUN_INK', 'STATE_INK']) {
  must(man.includes(phrase), `매뉴얼 F86 절에서 「${phrase}」가 사라졌습니다.`, MANUAL);
}

if (fails.length) {
  console.error(`\n⛔ 하허호 F86 확정 규격이 어긋났습니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`  ✗ ${f}\n`);
  console.error('  바꾸려면: 사장님께 여쭙고 → 매뉴얼 §하허호 F86 → 이 검사 순서로.\n');
  process.exit(1);
}
console.log('✓ 하허호 F86 확정 규격 그대로 — 탭(종합·회사) · 칸 36 · 대여료(단기 없음·쓰는 칸만·종합 5칸·장기 요금 없는 차도 실음·칸만 빔) · 레트로 겉 · F86 만');
