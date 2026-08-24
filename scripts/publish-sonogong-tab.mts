/**
 * **별도 탭(손오공구독 · 오플구독)에 «원본 요금 블록»을 덧붙인다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-19 — 「복구하자, 판매시트 탭 3개로 회귀: 상품리스트 · 손오공구독(반납형이랑 인수형 붙여서) · 오플구독(정제된 거로)」
 *   · 줄은 `publish-origin-tab --only=RP012:구독 --tab=손오공구독`(또는 `--only=RP023 --tab=오플구독`)이 **상품리스트와 같은 발행기·같은 정본 차명·같은 열**로 먼저 찍는다.
 *   · 이 스크립트는 그 탭을 읽어 **우리 공통 대여료 블록(단기보증·1개월·12개월·장기보증·24~60개월)을 걷어 내고 그 자리에** 공급사 시트의 기간별 대여료를 둔다
 *     (사장님 2026-08-19 — 「우리 공통 기간별 대여료는 없애도 되고, 손오공이랑 오플은 그들의 기간별 대여료를 해 주면 됨」):
 *       손오공구독: 보증금 반납형(글자 「연수×대여료」 = 보증금) · 12~60개월 반납형 · 보증금 인수형 · 36/48/60개월 인수형 (제공시트 「구독재고」) → 반납형+인수형 한 탭
 *       오플구독:   12개월 2만km · 12개월 3만km · 18개월 … 36개월 3만km (오플 정제시트 「재고」, 머리글 「12개월3만」→「12개월 3만km」로 보임)      → 「12개월 3만Km 이렇게」
 *     기본값·표시 이름·별칭은 `lib/domain/sales-published-tabs.ts`(NATIVE_MONEY_BLOCK · nativeMoneyLabel · SALES_TAB_MONEY_ALIASES) 한 곳에.
 *     `--keep-standard` 를 주면 공통 블록을 남기고 뒤에 덧붙인다(옛 방식).
 *   · 값은 공급사 글자 그대로(숫자 없는 칸 「-」). 차명·정책·색은 origin-tab 이 찍은 그대로 — 여기서 다시 판단하지 않는다(2026-08-18 「스포티지 NQ5」 사고).
 *   · 두 번 돌려도 블록이 두 벌 안 된다(있으면 걷어 내고 다시 붙임). 탭 이름(「손오공구독 MM.DD HH:MM · N대」)은 origin-tab 이 준 그대로 둔다.
 * ★상품리스트에는 이 두 갈래가 @제외로 빠져 있다(SALES_EXCLUDE) — 같은 차가 두 탭에 서면 사고.
 * ★옛 「손오공인수형구독」 탭(2026-08-18 하루짜리)은 지운다.
 *
 *   npx tsx scripts/publish-sonogong-tab.mts [--apply]                 # 손오공구독(기본)
 *   npx tsx scripts/publish-sonogong-tab.mts --tab=오플구독 [--apply]   # 오플구독(src·srcTab·block 은 NATIVE_MONEY_BLOCK 기본값)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { buildSalesFormatRequests, columnWidths, rgb, LINK, FONT, SIZE, ITALIC } from '../lib/domain/sales-sheet-format';
import { NATIVE_MONEY_BLOCK, STANDARD_MONEY_COLUMNS, nativeMoneyLabel, type NativeLeadColumn } from '../lib/domain/sales-published-tabs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
/** 판매시트(영업자용). */
const SHEET = arg('sheet', '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');
const TAB = arg('tab', '손오공구독');
const NATIVE = (NATIVE_MONEY_BLOCK as Record<string, { src: string; srcTab: string; block: string[]; lead?: NativeLeadColumn } | undefined>)[TAB];
/** 블록 앞에 두는 파생 칸(오플 「보증금」 = 산출 규칙 글자). */
const LEAD = NATIVE?.lead;
/** 원본 요금이 있는 공급사 시트(우리 제공/정제시트)와 탭. 기본 = sales-published-tabs.NATIVE_MONEY_BLOCK. */
const SRC = arg('src', NATIVE?.src || '');
const SRC_TAB = arg('srcTab', NATIVE?.srcTab || '');
/** 그 자리에 둘 공급사 요금 칸(원본 시트 머리글 그대로). */
const BLOCK = (arg('block') ? arg('block').split(',') : (NATIVE?.block || [])).map(S).filter(Boolean);
if (!SRC || !SRC_TAB || !BLOCK.length) throw new Error(`「${TAB}」 의 원본 요금 블록 기본값이 없다 — --src/--srcTab/--block 을 주거나 NATIVE_MONEY_BLOCK 에 등록`);
/** 기본: 우리 공통 대여료 블록을 걷어 내고 그 자리에 둔다. --keep-standard 면 남기고 이 칸 뒤에 덧붙인다. */
const KEEP_STANDARD = process.argv.includes('--keep-standard');
const AFTER = arg('after', '60개월');
/** 영업자 표에 보이는 머리글(「12개월3만」→「12개월 3만km」). */
const LABEL = BLOCK.map(nativeMoneyLabel);
const normHead = (h: unknown) => S(h).replace(/\s+/g, '').replace(/km$/i, '').replace(/[()（）]/g, '');
/** 지울 옛 탭 접두. */
const LEGACY_TABS = arg('legacy', TAB === '손오공구독' ? '손오공인수형구독' : '').split(',').map(S).filter(Boolean);
/** 원본 시트에서 머리글이 다르게 적힌 경우의 별칭(정규식). */
const ALIASES: Record<string, RegExp> = {
  '보증금 인수형': /^(장기보증|보증금)\s*인수형$/, '보증금 반납형': /^(장기보증|보증금)\s*반납형$/,
  '36개월 인수형': /^36개월\s*\(?인수형\)?$/, '48개월 인수형': /^48개월\s*\(?인수형\)?$/, '60개월 인수형': /^60개월\s*\(?인수형\)?$/,
  '12개월 반납형': /^12개월\s*\(?반납형\)?$/, '24개월 반납형': /^24개월\s*\(?반납형\)?$/, '36개월 반납형': /^36개월\s*\(?반납형\)?$/, '48개월 반납형': /^48개월\s*\(?반납형\)?$/, '60개월 반납형': /^60개월\s*\(?반납형\)?$/,
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const api = async (u: string, init?: RequestInit) => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) as Rec : {} as Rec;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((ok) => setTimeout(ok, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

console.log(`■ 「${TAB}」 원본 요금 블록 덧붙이기 ${APPLY ? '반영' : '미리보기(dry-run)'} — 블록 ${BLOCK.join(' · ')} (← ${SRC_TAB})\n`);

// ── ① 발행된 별도 탭(최신) — publish-origin-tab --only 가 찍은 것
const meta0 = await api(`${SH}/${SHEET}?fields=sheets.properties(sheetId,title)`);
const tabTitle = ((meta0.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).find((t) => t.startsWith(TAB));
if (!tabTitle) throw new Error(`「${TAB}」 탭이 없다 — 먼저 npx tsx scripts/publish-origin-tab.mts --only=… --tab=${TAB} --apply`);
const gid = Number(((meta0.sheets || []) as Rec[]).find((s) => S(s.properties?.title) === tabTitle)?.properties?.sheetId);
const sg = await api(`${SH}/${SHEET}?includeGridData=true&ranges=${encodeURIComponent(`'${tabTitle.replace(/'/g, "''")}'!A1:CZ2000`)}&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns))))')}`);
const srowData = (((sg.sheets || [])[0]?.data || [])[0]?.rowData || []) as Rec[];
const sgrid = srowData.map((rd) => ((rd.values || []) as Rec[]).map((c) => S(c.formattedValue)));
const shdr0 = sgrid[0] || [];
const spi = shdr0.findIndex((h) => norm(h) === '차량번호');
if (spi < 0) throw new Error(`「${tabTitle}」 머리행에 차량번호가 없다`);
// 이미 붙어 있던 블록(원본 이름·표시 이름 둘 다)과 — 기본 모드면 — 우리 공통 대여료 블록을 걷어 낸다(재실행 멱등)
const isBlockCol = (h: string) => BLOCK.some((b) => normHead(b) === normHead(h)) || LABEL.some((b) => normHead(b) === normHead(h)) || (!!LEAD && normHead(LEAD.name) === normHead(h));
const isStdCol = (h: string) => (STANDARD_MONEY_COLUMNS as readonly string[]).some((c) => normHead(c) === normHead(h));
const removed = (h: string) => isBlockCol(h) || (!KEEP_STANDARD && isStdCol(h));
const firstRemoved = shdr0.findIndex(removed);
const keepIdx = shdr0.map((h, i) => (removed(h) ? -1 : i)).filter((i) => i >= 0);
const shdr = keepIdx.map((i) => shdr0[i]);
/**
 * 블록을 끼울 자리 — 기본: 걷어 낸 첫 칸(공통 블록 또는 이미 붙어 있던 원본 블록)이 있던 자리 = 주행거리(Km) 바로 뒤.
 * ⚠ 재실행 때 공통 블록이 이미 없으면 자리를 잃고 맨 뒤(23세 뒤)에 붙었다(2026-08-19 실측 「오플 구독 대여료 왜 저기로 갔냐 — 주행거리 뒤로 가야지」) → 걷어 낸 칸 자리를 기억하고, 그것도 없으면 Km 뒤.
 */
const classIdx = shdr.findIndex((h) => norm(h) === '차종구분');
const kmIdx = shdr.findIndex((h) => /^(Km|주행거리)$/i.test(norm(h)));
// ★자리는 «주행거리(Km) → 차종구분 바로 뒤»가 규칙이다(상품리스트의 공통 블록 자리와 같다 — 2026-08-19 「차종구분을 주행거리 다음으로」). 둘 다 없을 때만 걷어 낸 칸 자리 → 맨 뒤.
const anchorIdx = classIdx >= 0 ? classIdx : kmIdx;
const insertAtDefault = anchorIdx >= 0 ? anchorIdx + 1 : (firstRemoved >= 0 ? keepIdx.filter((i) => i < firstRemoved).length : shdr.length);
const spiKept = shdr.findIndex((h) => norm(h) === '차량번호');
const baseRows = sgrid.slice(1).filter((r) => S(r[spi])).map((r) => keepIdx.map((i) => S(r[i])));
const photoOf = new Map<string, string>();
srowData.slice(1).forEach((rd) => { const c = ((rd.values || []) as Rec[])[spi]; if (!c) return; const plate = norm(c.formattedValue); const link = S(c.hyperlink) || S((c.textFormatRuns || []).find((t: Rec) => t.format?.link?.uri)?.format?.link?.uri); if (plate && link.startsWith('http')) photoOf.set(plate, link); });
console.log(`  「${tabTitle}」 ${baseRows.length}대 · 열 ${shdr.length}${keepIdx.length !== shdr0.length ? ` (기존 블록 ${shdr0.length - keepIdx.length}칸 걷어 냄)` : ''}`);

// ── ② 원본 시트 — 블록 값(차번별)
const gv = await api(`${SH}/${SRC}/values/${encodeURIComponent(`'${SRC_TAB.replace(/'/g, "''")}'!A1:BZ700`)}`) as { values?: string[][] };
const ggrid = ((gv.values || []) as string[][]).map((r) => r.map(S));
const ghi = ggrid.findIndex((r) => r.some((c) => norm(c) === norm('차명(세부모델+트림)')) && r.some((c) => norm(c) === '차량번호'));
if (ghi < 0) throw new Error(`「${SRC_TAB}」 머리행(차량번호·차명(세부모델+트림))을 못 찾았다`);
const ghdr = ggrid[ghi];
const gAt = (name: string) => { let i = ghdr.findIndex((h) => norm(h) === norm(name)); if (i < 0 && ALIASES[name]) i = ghdr.findIndex((h) => ALIASES[name].test(norm(h))); return i; };
const gpi = gAt('차량번호'); const gphoto = gAt('사진링크');
const missingCols = BLOCK.filter((c) => gAt(c) < 0);
if (missingCols.length) throw new Error(`「${SRC_TAB}」 머리행에 없는 칸: ${missingCols.join(' · ')} — 머리글: ${ghdr.filter(Boolean).slice(0, 40).join(' | ')}`);
const dash = (v: string) => (!S(v) || /^(불가|불가능|x|X|-|—|―|없음|미운영|미판매)$/.test(S(v)) ? '-' : S(v));
const blockOf = new Map<string, string[]>();
for (const r of ggrid.slice(ghi + 1)) {
  const plate = norm(r[gpi]); if (!plate) continue;
  blockOf.set(plate, BLOCK.map((c) => dash(r[gAt(c)])));
  if (gphoto >= 0 && S(r[gphoto]).startsWith('http') && !photoOf.has(plate)) photoOf.set(plate, S(r[gphoto]));
}
const withMoney = [...blockOf.values()].filter((v) => v.some((x) => x !== '-')).length;
console.log(`  원본 「${SRC_TAB}」 ${blockOf.size}대 · 블록에 값 있는 차 ${withMoney}대`);

// ── ③ 열 — 기본: 공통 블록 자리에 / --keep-standard: AFTER 칸 뒤에(없으면 맨 뒤)
const afterIdx = shdr.findIndex((h) => norm(h) === norm(AFTER));
const cut = KEEP_STANDARD ? (afterIdx >= 0 ? afterIdx + 1 : shdr.length) : insertAtDefault;
const HEAD = [...(LEAD ? [LEAD.name] : []), ...LABEL];
const COLUMNS = [...shdr.slice(0, cut), ...HEAD, ...shdr.slice(cut)];
const p = COLUMNS.indexOf(shdr[spiKept]);
const rows = baseRows.map((r) => {
  const plate = norm(r[spiKept]); const b = blockOf.get(plate) || BLOCK.map(() => '-');
  const rec: Record<string, string> = {}; shdr.forEach((h, i) => { rec[h] = r[i]; });
  const lead = LEAD ? [LEAD.valueOf(rec)] : [];
  return [...r.slice(0, cut), ...lead, ...b, ...r.slice(cut)];
});
const notInSrc = baseRows.filter((r) => !blockOf.has(norm(r[spiKept]))).length;
console.log(`  실을 차 ${rows.length}대 · 원본에 없는 차(블록 「-」) ${notInSrc}대 · 사진링크 ${rows.filter((r) => photoOf.has(norm(r[p]))).length}대 · ${KEEP_STANDARD ? '공통 블록 유지+덧붙임' : `공통 블록 ${shdr0.length - keepIdx.length - (shdr0.filter(isBlockCol).length)}칸 걷어 내고 그 자리에`}`);
console.log(`  열: … ${COLUMNS.slice(Math.max(0, cut - 3), cut + BLOCK.length + 1).join(' | ')} …\n`);
if (!rows.length) throw new Error('한 대도 없다 — 발행하지 않는다');
if (!APPLY) { console.log('※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

// ── ④ 옛 탭 삭제 · 같은 탭에 값·서식·링크 다시 쓰기(이름은 그대로)
const legacy = ((meta0.sheets || []) as Rec[]).filter((s) => LEGACY_TABS.some((l) => S(s.properties?.title).startsWith(l)));
if (legacy.length) {
  await api(`${SH}/${SHEET}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: legacy.map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })) }) });
  console.log(`  옛 탭 지움: ${legacy.map((s) => `「${s.properties.title}」`).join(' · ')}`);
}
await api(`${SH}/${SHEET}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } }] }) });
await api(`${SH}/${SHEET}/values/${encodeURIComponent(`'${tabTitle.replace(/'/g, "''")}'!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [[...COLUMNS], ...rows] }) });
{
  const now = await api(`${SH}/${SHEET}?fields=sheets(properties(sheetId,gridProperties(columnCount)),bandedRanges(bandedRangeId),conditionalFormats)`);
  const me = ((now.sheets || []) as Rec[]).find((s) => Number(s.properties?.sheetId) === gid) || {};
  await api(`${SH}/${SHEET}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: buildSalesFormatRequests({
      gid, columns: COLUMNS, headerAt: 0,
      columnCountNow: Number(me.properties?.gridProperties?.columnCount) || COLUMNS.length,
      bandedRangeIds: ((me.bandedRanges || []) as Rec[]).map((b) => Number(b.bandedRangeId)),
      conditionalFormatCount: ((me.conditionalFormats || []) as unknown[]).length,
      widths: columnWidths(COLUMNS, rows),
      tabTitle,
      // 차량번호 셀에 사진 링크를 거는 데 쓴다(서식층 맨 끝).
      body: rows,
    }) }),
  });
}
// 차량번호 셀의 사진 링크는 서식층(`buildSalesFormatRequests` 맨 끝)이 세 탭에 똑같이 건다.
// ⚠ 여기서 따로 걸지 마라 — 갈래 탭만 되고 상품리스트는 안 되던 게 그래서였다.
console.log(`  차량번호에 사진링크 ${rows.filter((r) => S(r[COLUMNS.indexOf('사진')]).startsWith('http')).length}대`);

console.log(`\n  반영 완료 — 탭 「${tabTitle}」 (+${BLOCK.length}칸)\n  https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${gid}\n`);
