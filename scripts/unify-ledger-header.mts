/**
 * **정산원장 모든 탭의 상단 두 줄을 하나의 규격으로.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-25 「타이틀헤더 동일하게 해주고」 「모든 탭이 상단 규격 동일해야지」.
 *   실측하니 설명 줄 높이가 108·62·46·40·21 로 제각각이고, 「수수료표」는 설명 줄이 **아예 없었다**.
 *
 * ```
 * 1행   A = 탭 이름(굵게) · B부터 합쳐서 = 그 탭이 무엇인지  · 높이 62 · 옅은 파랑
 * 2행   머리글(굵게 · 가운데 · 옅은 파랑)
 * 고정  2행 · 1열
 * ```
 * ★**설명 줄이 없는 탭에는 줄을 끼운다.** 머리글이 1행에 있으면 한 줄 밀어 넣는다 —
 *   값은 그대로 따라 내려가고, 읽는 도구는 «「차량번호」가 있는 줄»을 머리글로 찾으니 안 깨진다.
 * ⚠ 「이 시트는」은 표가 아니라 안내문이라 손대지 않는다.
 *
 *   npx tsx scripts/unify-ledger-header.mts
 *   npx tsx scripts/unify-ledger-header.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const SKIP = ['이 시트는'];
const H1 = 62;
const FONT = 'Noto Sans KR';
/** 설명이 없는 탭에 붙일 글. 있는 탭은 그대로 둔다. */
const DESC: Record<string, string> = {
  수수료표: '수수료표 — 공급사·상품별로 수수료를 어떻게 내는지. 기준이 셋이다: '
    + '「고정」은 그 금액 그대로(오플구독 100만·80만), 「차량가액」은 차값 × 요율(선출고·견적출고), '
    + '「대여료×기간」은 월 대여료 × 계약기간 × 요율(장기렌트·구독). 청구액이 여기서 나온다.',
};

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 180)}`);
  }
};

const meta = await api(`${SH}/${LEDGER}?fields=sheets.properties(sheetId,title,hidden,gridProperties)`);
const tabs = ((meta.sheets || []) as any[]).map((s) => s.properties).filter((p: any) => !p.hidden && !SKIP.includes(S(p.title)));

console.log(`\n■ 상단 규격 통일 — ${tabs.length}탭 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
const plan: { p: any; insert: boolean; desc: string; cols: number }[] = [];
for (const p of tabs) {
  const title = S(p.title);
  const got = await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(title)}!A1:BZ2`)}`);
  const rows = ((got?.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const banner = S(rows[0]?.[0]) === title;                    // A1 이 탭 이름이면 이미 설명 줄이다
  const cols = Math.max((rows[banner ? 1 : 0] || []).filter(Boolean).length, 4);
  const desc = banner ? S(rows[0]?.[1]) : (DESC[title] || `${title} — 기계가 채웁니다. 손대지 마세요.`);
  plan.push({ p, insert: !banner, desc, cols });
  console.log(`   ${title.padEnd(10)} ${banner ? '설명 줄 있음' : '설명 줄 없음 → 끼운다'} · 열 ${cols} · 높이 ${p.gridProperties?.rowCount ? '' : ''}${banner ? '맞춤' : '신설'}`);
}
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다.\n'); process.exit(0); }

for (const { p, insert, desc, cols } of plan) {
  const gid = Number(p.sheetId);
  const title = S(p.title);
  if (insert) {
    // ★한 줄 끼우고 그 줄에 이름·설명을 적는다. 값은 그대로 한 칸씩 내려간다.
    await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
      { insertDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, inheritFromBefore: false } },
    ] }) });
    await api(`${SH}/${LEDGER}/values/${encodeURIComponent(`${a1(title)}!A1`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: [[title, desc]] }),
    });
  }
  await api(`${SH}/${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    // 합친 칸을 먼저 푼다 — 열 수가 바뀌어도 안 깨지게 1행 전체를 대상으로.
    { unmergeCells: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 } } },
    { mergeCells: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: cols }, mergeType: 'MERGE_ROWS' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: {
      textFormat: { fontFamily: FONT, fontSize: 10, foregroundColor: { red: 0.25, green: 0.29, blue: 0.35 } },
      backgroundColor: { red: 0.97, green: 0.98, blue: 1 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', horizontalAlignment: 'LEFT',
    } }, fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy,horizontalAlignment)' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: {
      textFormat: { fontFamily: FONT, fontSize: 11, bold: true }, horizontalAlignment: 'LEFT',
    } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: H1 }, fields: 'pixelSize' } },
    { repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: {
      textFormat: { fontFamily: FONT, fontSize: 10, bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.99 }, horizontalAlignment: 'CENTER',
    } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
    { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 26 }, fields: 'pixelSize' } },
    { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 2, frozenColumnCount: 1 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  ] }) });
  console.log(`   ✓ ${title}${insert ? ' (설명 줄 끼움)' : ''}`);
}
console.log(`\n■ 끝 — 1행 설명(높이 ${H1}) · 2행 머리글 · 고정 2행\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
