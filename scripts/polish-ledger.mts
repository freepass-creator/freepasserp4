/**
 * **정산원장 다듬기 — 수수료 정제 · 글꼴 · 필터 · 고정.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25
 *   「공급사수수료율이 정액이 있고 퍼센트가 있으니까」 「아직도 퍼센트나 이런게 정제가 덜됐네」
 *   「폰트는 노토산스kr로」 「필터랑 필요한거 다 반영해주고」
 *
 * ★**한 칸에 두 갈래가 산다 — 열 전체에 % 를 걸면 안 된다.**
 *   실측 2026-08-25: 율 칸에 `0.0325`(정률)과 `1000000`(건당 정액)이 섞여 있다.
 *   열에 `0.00%` 를 걸었더니 정액이 **100000000.00%** 로 보였다 — 내가 만든 사고다.
 *   ⇒ ① 「수수료기준」 열을 세워 어느 갈래인지 **적어 두고**
 *     ② 서식은 **셀 단위**로 나눈다(정률 0.00% · 정액 #,##0).
 *   기준 세 가지는 공급사 「수수료」 탭과 같은 말이다(고정 / 차량가액 / 대여료×기간).
 *
 * ★글꼴 — 실측하니 정산원장·접수시트가 **Arial**(아무 규격도 아님)이었다.
 *   한글이 많고 폰으로 보는 표라 **Noto Sans KR**로 세운다. Roboto 에는 한글 글리프가 없어
 *   기기마다 다른 글꼴로 그려진다(윈도=맑은고딕 · 아이폰=애플SD고딕).
 *
 * ★필터·고정 — 머리행 고정 + 기본 필터. 1,700줄을 눈으로 훑을 수는 없다.
 *
 *   npx tsx scripts/polish-ledger.mts
 *   npx tsx scripts/polish-ledger.mts --apply
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as ID, SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB } from '../lib/domain/settlement-ledger';
import { readFeeCell } from '../lib/domain/supplier-fee-table';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const FONT = 'Noto Sans KR';
const BASIS_COL = '수수료기준';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(30_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};

/** 상품구분으로 «무엇에 곱하나»를 정한다. 정률일 때만 쓴다. */
const basisOf = (kind: string) => (/구독|장기렌트|월렌트/.test(kind) ? '대여료×기간' : '차량가액');

const meta = await api(`${SH}/${ID}?fields=sheets.properties(title,sheetId,gridProperties(frozenRowCount))`);
const props = (meta.sheets || []).map((s: any) => s.properties);
const reqs: Record<string, unknown>[] = [];
let 정률 = 0, 정액 = 0, 모름 = 0, 기준칸 = 0;
const 이상: string[] = [];

for (const tab of [SETTLEMENT_CURRENT_TAB, SETTLEMENT_PAST_TAB]) {
  const p = props.find((x: any) => S(x.title) === tab);
  if (!p) continue;
  const sheetId = Number(p.sheetId);

  const v = await api(`${SH}/${ID}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = ((v?.values || []) as any[][]).map((r) => (r || []).map(S));
  const head = rows[0] || [];
  const iRate = head.indexOf('공급사수수료율');
  const iAg = head.indexOf('에이전시수수료율');
  const iKind = head.indexOf('상품구분');
  const iPlate = head.indexOf('차량번호');
  if (iRate < 0) continue;

  // ── ① 「수수료기준」 열이 없으면 공급사수수료율 **앞**에 끼운다
  let iBasis = head.indexOf(BASIS_COL);
  const needCol = iBasis < 0;
  if (needCol) iBasis = iRate;   // 끼우면 율이 한 칸 뒤로 밀린다

  const basisValues: string[][] = [];
  const cellFmt: Record<string, unknown>[] = [];
  rows.slice(1).forEach((r, k) => {
    const row = k + 2;
    const rate = readFeeCell(r[iRate]);
    const kind = iKind >= 0 ? S(r[iKind]) : '';
    let basis = '';
    if (rate.kind === 'amount') { basis = '고정'; 정액++; }
    else if (rate.kind === 'rate') { basis = basisOf(kind); 정률++; }
    else if (S(r[iRate])) { 모름++; 이상.push(`${tab} ${row}행 ${S(r[iPlate])} 「${S(r[iRate])}」`); }
    basisValues.push([basis]);
    if (basis) 기준칸++;
    // ★서식은 셀 단위. 정액 줄만 #,##0, 정률 줄만 0.00%.
    const nf = rate.kind === 'amount' ? { type: 'NUMBER', pattern: '#,##0' } : rate.kind === 'rate' ? { type: 'PERCENT', pattern: '0.00%' } : null;
    if (!nf) return;
    for (const c of [iRate, iAg]) {
      if (c < 0) continue;
      const col = needCol && c >= iBasis ? c + 1 : c;
      cellFmt.push({ repeatCell: {
        range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { numberFormat: nf, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      } });
    }
  });

  if (needCol) {
    reqs.push({ insertDimension: { range: { sheetId, dimension: 'COLUMNS', startIndex: iBasis, endIndex: iBasis + 1 }, inheritFromBefore: false } });
    reqs.push({ updateCells: {
      rows: [{ values: [{ userEnteredValue: { stringValue: BASIS_COL }, note: '고정 = 건당 정액(요율 아님) / 차량가액 = 차량가액×요율 / 대여료×기간 = 계약대여료×계약기간×요율. 공급사 「수수료」 탭과 같은 말이다' }] }],
      fields: 'userEnteredValue,note', start: { sheetId, rowIndex: 0, columnIndex: iBasis },
    } });
    reqs.push({ updateCells: {
      rows: basisValues.map((x) => ({ values: [{ userEnteredValue: { stringValue: x[0] } }] })),
      fields: 'userEnteredValue', start: { sheetId, rowIndex: 1, columnIndex: iBasis },
    } });
  }
  reqs.push(...cellFmt);

  // ── ② 글꼴 · 고정 · 필터
  reqs.push({ repeatCell: { range: { sheetId }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10 } } }, fields: 'userEnteredFormat.textFormat(fontFamily,fontSize)' } });
  reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } });
  if (!p.gridProperties?.frozenRowCount) {
    // ★머리행 + 차량번호 한 칸을 얼린다 — 오른쪽으로 밀어도 «어느 차 줄인지»가 안 사라진다.
    reqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } });
  }
  reqs.push({ setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: head.length + (needCol ? 1 : 0) } } } });
}

console.log(`\n■ 정산원장 다듬기 — ${APPLY ? '반영' : 'dry-run'}`);
console.log(`  수수료 갈래 — 정률 ${정률} · 정액 ${정액} · 모름 ${모름}`);
console.log(`  「${BASIS_COL}」 채울 칸 ${기준칸} · 글꼴 ${FONT} · 머리행+차번 고정 · 기본 필터`);
if (이상.length) { console.log(`\n  ⚠ 율도 금액도 아닌 값 ${이상.length} — 사람이 봐야 한다`); for (const x of 이상.slice(0, 10)) console.log(`     ${x}`); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 바꿨다. 반영은 --apply\n`); process.exit(0); }

// 요청이 많다 — 나눠 보낸다(한 번에 너무 크면 거절당한다).
for (let i = 0; i < reqs.length; i += 200) {
  await api(`${SH}/${ID}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 200) }) });
}

const LOG = 'docs/수정이력-정산원장.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head0 = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정산원장\n\n> 기계가 정산원장 구조를 바꿀 때마다 여기에 쌓는다. 새 것이 위.\n`;
const body = [
  ``,
  `## ${when} · 수수료 정제 · 글꼴 · 필터`,
  ``,
  `도구 \`scripts/polish-ledger.mts --apply\``,
  `**「${BASIS_COL}」 열 신설** — 한 칸에 정률(0.0325)과 정액(1000000)이 섞여 있어 열 서식으로는 못 고친다.`,
  `기준을 적어 두고 **서식을 셀 단위로** 나눴다 — 정률 \`0.00%\` · 정액 \`#,##0\`.`,
  `실측: 정률 ${정률} · 정액 ${정액} · 모름 ${모름}`,
  `글꼴 ${FONT} 10pt(Arial 이었다) · 머리행+차번 고정 · 기본 필터.`,
  ``,
].join('\n');
const marker = '> 기계가 정산원장 구조를';
const cut = head0.indexOf(marker);
const insertAt = cut >= 0 ? head0.indexOf('\n', cut) + 1 : head0.length;
writeFileSync(LOG, head0.slice(0, insertAt) + body + head0.slice(insertAt));

console.log(`\n■ 끝 — 「${BASIS_COL}」 ${기준칸}칸 · 셀 서식 · 글꼴 · 필터. 이력 ${LOG}\n`);
