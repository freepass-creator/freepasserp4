/**
 * **접수된 차를 「계약중」으로 세운다** — 공급사 정제시트의 「상태」 칸. 기본 미리보기, 반영은 `--apply`.
 *
 * ★사장님 2026-08-24 「이거 기준으로 접수일에 표시 있는 차량은 계약중으로 변경해 줘」
 *   「공급사 정제시트랑 상품리스트 반영해 줘」
 *   근거는 「프리패스_PTR_관리현황」(양유담) 「상담진행현황」 탭 — 접수일이 찍힌 줄.
 *   나중에 프리패스 정산시트와 잇는다(사장님 「일단 이거 반영해서 해 줘」).
 *
 * ★**상태는 공급사 시트가 정본이다.** ERP 를 직접 고치지 않는다 —
 *   시트를 고치고 판매시트를 다시 발행하면 ERP 까지 저절로 따라온다.
 *   「계약중」은 정식 상태 여섯 중 하나다(즉시출고/출고가능/상품화중/출고협의/계약중/출고불가).
 *
 * ⚠ 목록에 있어도 **우리 시트에 없는 차는 건드리지 않는다** — 이미 목록에서 빠진 차다. 세어서 알린다.
 * ⚠ 차번은 공백을 지워 견준다(「43나 2130」·「43나2130」).
 * ★**숨긴 줄은 같이 푼다.** 발행기는 «시트에서 숨긴 줄»을 출고불가로 본다(오플에서 온 규칙).
 *   그래서 상태만 「계약중」으로 바꾸고 줄이 숨어 있으면 **영업자 표에 영영 안 뜬다** —
 *   실제로 101하8578(스타)이 그랬다(2026-08-24). 계약중은 «잡힌 차»를 보여 주자는 것이니
 *   보이게 하는 것이 맞다. 푼 줄은 세어서 알린다.
 * ⚠ **필터가 숨긴 줄은 `hiddenByUser` 로 안 풀린다.** 스타 시트는 「상태가 빈칸이거나 출고불가면 숨김」
 *   필터가 걸려 있었는데, **값을 「계약중」으로 고쳐도 구글이 필터를 다시 세지 않아** 줄이 계속 숨어 있었다.
 *   그래서 여기서는 그 시트의 필터를 **같은 조건으로 다시 걸어** 재계산시킨다(조건은 안 바꾼다).
 *
 *   npx tsx scripts/mark-contract-plates.mts --file=tmp/plates-contract.txt
 *   npx tsx scripts/mark-contract-plates.mts --file=tmp/plates-contract.txt --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const FILE = arg('file') || 'tmp/plates-contract.txt';
const STATE = arg('state') || '계약중';
const S = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => S(v).replace(/\s+/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

const want = [...new Set(readFileSync(FILE, 'utf8').split('\n').map(key).filter(Boolean))];
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if ((r.status === 429 || r.status >= 500) && n < 4) { await sleep(2500 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const seen = new Set<string>();
const plan: { label: string; plate: string; was: string }[] = [];
let done = 0;
let shown = 0;

for (const f of (found.files || [])) {
  const label = supplierSheetLabel(S(f.name));
  if (/구버전|폐기/.test(label)) continue;
  const meta = await api(`${SH}/${S(f.id)}?fields=sheets.properties(title,hidden)`);
  const tabs = (meta?.sheets || []).filter((s: any) => !s.properties.hidden && !isOurNonInventoryTab(S(s.properties.title))).map((s: any) => S(s.properties.title));
  for (const tab of tabs) {
    const got = await api(`${SH}/${S(f.id)}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:CZ700`)}`);
    const rows = ((got?.values || []) as string[][]).map((r) => (r || []).map(S));
    const hi = rows.findIndex((r) => r.includes('차량번호'));
    if (hi < 0) continue;
    const head = rows[hi];
    const ip = head.indexOf('차량번호');
    const is = head.indexOf('상태');
    if (is < 0) continue;
    const updates: { range: string; values: string[][] }[] = [];
    const rowsToShow: number[] = [];
    for (let r = hi + 1; r < rows.length; r++) {
      const p = key(rows[r][ip]);
      if (!p || !want.includes(p)) continue;
      seen.add(p);
      rowsToShow.push(r);
      const was = S(rows[r][is]);
      if (was === STATE) continue;
      plan.push({ label, plate: p, was });
      updates.push({ range: `'${tab.replace(/'/g, "''")}'!${colA1(is)}${r + 1}`, values: [[STATE]] });
    }
    /** 이 줄들이 숨어 있나 — 숨었으면 상태를 바꿔도 영업자 표에 안 뜬다. */
    const hidden: { row: number; plate: string }[] = [];
    if (rowsToShow.length) {
      const grid = await api(`${SH}/${S(f.id)}?includeGridData=true&ranges=${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:A${rows.length}`)}&fields=sheets(properties.sheetId,basicFilter,data.rowMetadata(hiddenByUser,hiddenByFilter))`);
      const sheetId = Number(grid?.sheets?.[0]?.properties?.sheetId);
      const basicFilter = grid?.sheets?.[0]?.basicFilter;
      const rm = (grid?.sheets?.[0]?.data?.[0]?.rowMetadata || []) as any[];
      for (const r of rowsToShow) if (rm[r]?.hiddenByUser || rm[r]?.hiddenByFilter) hidden.push({ row: r, plate: key(rows[r][ip]) });
      if (APPLY && hidden.length && Number.isFinite(sheetId)) {
        const requests: Record<string, unknown>[] = hidden.map((h) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: h.row, endIndex: h.row + 1 },
            properties: { hiddenByUser: false }, fields: 'hiddenByUser',
          },
        }));
        /** 필터를 같은 조건으로 다시 건다 — 값이 바뀌었는데 구글이 안 세어 준 것을 세게 한다. */
        if (basicFilter) {
          requests.push({ clearBasicFilter: { sheetId } });
          requests.push({ setBasicFilter: { filter: {
            range: basicFilter.range,
            ...(basicFilter.filterSpecs ? { filterSpecs: basicFilter.filterSpecs } : {}),
            ...(basicFilter.sortSpecs ? { sortSpecs: basicFilter.sortSpecs } : {}),
          } } });
        }
        await api(`${SH}/${S(f.id)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
      }
      if (hidden.length) { shown += hidden.length; console.log(`  ${APPLY ? '✓' : '·'} ${label} 숨긴 줄 ${hidden.length} 품 — ${hidden.map((h) => h.plate).join(' · ')}`); }
    }
    if (APPLY && updates.length) {
      await api(`${SH}/${S(f.id)}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates }) });
      done += updates.length;
      console.log(`  ✓ ${label} ${updates.length}대`);
    }
    await sleep(60);
  }
}

const miss = want.filter((p) => !seen.has(p));
console.log(`\n■ 「${STATE}」로 세울 차 — 목록 ${want.length}대\n`);
console.log(`  우리 시트에 있음 ${seen.size} · 바꿀 것 ${plan.length} · 이미 그 상태 ${seen.size - plan.length} · 우리 시트에 없음 ${miss.length}\n`);
for (const x of plan) console.log(`  ${x.plate.padEnd(12)} ${x.label.padEnd(12)} ${x.was} ▶ ${STATE}`);
if (miss.length) console.log(`\n  ⚠ 우리 시트에 없는 차 ${miss.length} — 이미 목록에서 빠졌다. 건드리지 않았다.\n     ${miss.join(' · ')}`);
console.log(APPLY ? `\n  ✓ ${done}대 반영 — 이제 판매시트를 다시 발행해야 상품리스트에 뜬다` : '\n  (미리보기다 — 반영하려면 --apply)');
