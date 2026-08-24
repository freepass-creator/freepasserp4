/**
 * **정산원장에 올라온 차번을 「계약중」으로 만든다** — 팀장은 차번만 올리면 된다.
 * 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-08-24
 *   「정산시트 입력을 계약금 들어온 거 차량번호만 올리면 알아서 계약중으로 바뀌는 거지」
 *   「정산시트 만들어 주고 강지수 팀장이 계약중으로 접수된 거 반영하라고 할 거야」
 *
 * ★**팀장이 넣는 것은 차량번호 하나다.** 나머지는 둘로 갈려 저절로 찬다 —
 *   ① 시트 수식: 모델명·차량가액·렌탈료·공급사·수수료율·청구금액·지급액·수익
 *      (「_상품」·「수수료표」 탭에서 차번으로 끌어온다)
 *   ② 이 도구: 상태 「계약중」 · 접수일(비었으면 오늘) · 정산월(비었으면 이번 달)
 *   그리고 **공급사 시트의 상태까지 같이 세운다** — 그래야 영업자 표와 ERP 에 뜬다.
 *
 * ★**어디를 보나** — 「정산」 탭에서 «차번이 있고 상태가 비어 있는 줄».
 *   상태가 이미 적힌 줄은 손대지 않는다(계약 완료·환수·취소…는 팀장이 정한 것이다).
 *
 * ⚠ 정산원장은 사장님 개인 드라이브에 있다. 팀장이 쓰려면 편집 권한이 있어야 한다.
 * ⚠ 우리 공급사 시트에 없는 차는 정산원장만 채우고 넘어간다 — 이미 목록에서 빠진 차다.
 * ⚠ 반영한 뒤 **판매시트를 다시 발행하고 ERP 동기를 돌려야** 화면까지 간다(맨 끝에 알려 준다).
 *
 *   npx tsx scripts/sync-contract-from-ledger.mts
 *   npx tsx scripts/sync-contract-from-ledger.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { SETTLEMENT_LEDGER_ID, SETTLEMENT_LEDGER_TAB, SETTLEMENT_CONTRACT_STATE } from '../lib/domain/settlement-ledger';

const LEDGER_ID = SETTLEMENT_LEDGER_ID;
const LEDGER_TAB = SETTLEMENT_LEDGER_TAB;
const STATE = SETTLEMENT_CONTRACT_STATE;

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s+/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const now = new Date();
const YMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const YM = YMD.slice(0, 7);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const a1 = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

// ── ① 정산원장에서 «차번 있고 상태 빈» 줄
const got = await api(`${SH}/${LEDGER_ID}/values/${encodeURIComponent(`${a1(LEDGER_TAB)}!A1:AL2000`)}`) as { values?: string[][] };
const rows = ((got?.values || []) as string[][]).map((r) => (r || []).map(S));
const head = rows[0] || [];
const iPlate = head.indexOf('차량번호');
const iState = head.indexOf('상태');
const iRecv = head.indexOf('접수일');
const iMonth = head.indexOf('정산월');
if (iPlate < 0 || iState < 0) throw new Error('정산원장에서 「차량번호」·「상태」 칸을 못 찾았다');

const fresh: { row: number; plate: string }[] = [];
for (let r = 1; r < rows.length; r++) {
  const plate = key(rows[r][iPlate]);
  if (!plate || plate === '신차') continue;   // 번호판 나오기 전 신차는 붙일 데가 없다
  if (S(rows[r][iState])) continue;           // 팀장이 정한 상태는 안 건드린다
  fresh.push({ row: r, plate });
}
console.log(`■ 정산원장 ${rows.length - 1}줄 — 차번 있고 상태 빈 줄 ${fresh.length}\n`);
if (!fresh.length) { console.log('  새로 올라온 차가 없다.'); process.exit(0); }
for (const x of fresh) console.log(`  ${x.plate}  (${x.row + 1}행)`);

// ── ② 정산원장 채우기 — 상태·접수일·정산월
if (APPLY) {
  const data: { range: string; values: string[][] }[] = [];
  for (const x of fresh) {
    data.push({ range: `${a1(LEDGER_TAB)}!${colA1(iState)}${x.row + 1}`, values: [[STATE]] });
    if (iRecv >= 0 && !S(rows[x.row][iRecv])) data.push({ range: `${a1(LEDGER_TAB)}!${colA1(iRecv)}${x.row + 1}`, values: [[YMD]] });
    if (iMonth >= 0 && !S(rows[x.row][iMonth])) data.push({ range: `${a1(LEDGER_TAB)}!${colA1(iMonth)}${x.row + 1}`, values: [[YM]] });
  }
  await api(`${SH}/${LEDGER_ID}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  console.log(`\n  ✓ 정산원장 ${fresh.length}줄 — 상태 「${STATE}」·접수일·정산월 채움`);
}

// ── ③ 공급사 시트의 상태도 같이 세운다(여기가 영업자 표·ERP 의 정본이다)
const want = [...new Set(fresh.map((x) => x.plate))];
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const seen = new Set<string>();
let changed = 0;
let unhid = 0;

for (const f of (found.files || [])) {
  const label = supplierSheetLabel(S(f.name));
  if (/구버전|폐기/.test(label)) continue;
  const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  const tabs = (meta?.sheets || [])
    .filter((s: any) => !s.properties.hidden && !isOurNonInventoryTab(S(s.properties.title)))
    .map((s: any) => S(s.properties.title));
  for (const tab of tabs) {
    const g = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`${a1(tab)}!A1:CZ700`)}`);
    const rs = ((g?.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = rs.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const h = rs[hi];
    const ip = h.indexOf('차량번호');
    const is = h.indexOf('상태');
    if (is < 0) continue;
    const upd: { range: string; values: string[][] }[] = [];
    const touched: number[] = [];
    for (let r = hi + 1; r < rs.length; r++) {
      const p = key(rs[r][ip]);
      if (!p || !want.includes(p)) continue;
      seen.add(p);
      touched.push(r);
      if (S(rs[r][is]) === STATE) continue;
      upd.push({ range: `${a1(tab)}!${colA1(is)}${r + 1}`, values: [[STATE]] });
    }
    if (!touched.length) continue;
    /**
     * 숨긴 줄·굳은 필터를 푼다 — 안 그러면 상태를 바꿔도 영업자 표에 안 뜬다(2026-08-24 실측).
     * 발행기는 «숨긴 줄»을 출고불가로 보고, 필터는 값이 바뀌어도 스스로 다시 세지 않는다.
     */
    const grid = await api(`${SH}/${S(f.id)}?includeGridData=true&ranges=${encodeURIComponent(`${a1(tab)}!A1:A${rs.length}`)}&fields=sheets(properties.sheetId,basicFilter,data.rowMetadata(hiddenByUser,hiddenByFilter))`);
    const sheetId = Number(grid?.sheets?.[0]?.properties?.sheetId);
    const bf = grid?.sheets?.[0]?.basicFilter;
    const rm = (grid?.sheets?.[0]?.data?.[0]?.rowMetadata || []) as any[];
    const hidden = touched.filter((r) => rm[r]?.hiddenByUser || rm[r]?.hiddenByFilter);
    if (APPLY && hidden.length && Number.isFinite(sheetId)) {
      const requests: Record<string, unknown>[] = hidden.map((r) => ({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 },
          properties: { hiddenByUser: false }, fields: 'hiddenByUser',
        },
      }));
      if (bf) {
        requests.push({ clearBasicFilter: { sheetId } });
        requests.push({ setBasicFilter: { filter: {
          range: bf.range,
          ...(bf.filterSpecs ? { filterSpecs: bf.filterSpecs } : {}),
          ...(bf.sortSpecs ? { sortSpecs: bf.sortSpecs } : {}),
        } } });
      }
      await api(`${SH}/${S(f.id)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    }
    if (hidden.length) { unhid += hidden.length; console.log(`  ${APPLY ? '✓' : '·'} ${label} 숨긴 줄 ${hidden.length} 품`); }
    if (APPLY && upd.length) {
      await api(`${SH}/${S(f.id)}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: upd }) });
      console.log(`  ✓ ${label} ${upd.length}대 → ${STATE}`);
    }
    changed += upd.length;
    await sleep(60);
  }
}

const miss = want.filter((p) => !seen.has(p));
console.log(`\n  공급사 시트에서 바꿀 것 ${changed} · 숨긴 줄 푼 것 ${unhid} · 우리 시트에 없는 차 ${miss.length}`);
if (miss.length) console.log(`     ${miss.join(' · ')}  ← 정산원장만 채웠다(이미 목록에서 빠진 차)`);
console.log(APPLY
  ? '\n  다음 — 판매시트를 다시 찍고 ERP 로 보낸다\n     npx tsx scripts/publish-origin-tab.mts --apply\n     npx tsx scripts/run-sheet-daily-sync-local.mts --apply'
  : '\n  (미리보기다 — 반영하려면 --apply)');
