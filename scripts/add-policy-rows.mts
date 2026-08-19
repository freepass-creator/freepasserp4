/**
 * **정책 탭에 빠진 항목 줄을 끼워 넣는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★정책 탭은 «세로가 항목, 가로가 정책»이다. 재고 탭과 반대라 열이 아니라 **줄**을 끼운다.
 *   규격(`POLICY_COLUMN_NAMES`)에 있는데 시트에 없는 항목을 **그 규격 순서 자리에** 넣는다.
 *
 * ★**줄만 민다.** 값은 안 건드린다 — 옆 칸의 정책 값들이 그대로 따라 내려간다.
 *   표를 지우면 값까지 지워진다(2026-08-11 · 196대가 날아갔다). 여기서는 표를 손대지 않는다.
 * ★이미 있는 항목은 넘어간다. 두 번 돌려도 안전하다.
 * ⚠ 「프리패스 기본」 열에는 **우리 표준값**이 필요하다. 아직 안 정한 항목은 비워 두고
 *   사람에게 알린다 — 「협의」라고 지어 넣으면 그게 계약서에 찍힌다.
 *
 *   npx tsx scripts/add-policy-rows.mts
 *   npx tsx scripts/add-policy-rows.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_COLUMN_NAMES, SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
import { policyTabTitle } from '../lib/domain/supplier-template-sheet';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '${SHEET_NAME_MATCH}'`);
const files = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`)).files || []) as Rec[];
console.log(`■ 정책 탭에 빠진 항목 줄 끼우기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

let total = 0;
for (const f of files) {
  const label = supplierSheetLabel(f.name);
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets.properties(sheetId,title)`);
  const TAB = policyTabTitle(((meta.sheets || []) as Rec[]).map((x) => S(x.properties?.title))) || '운영정책';
  const sh = ((meta.sheets || []) as Rec[]).find((x) => S(x.properties?.title) === TAB);
  if (!sh) { console.log(`  △ ${label.padEnd(14)}「${TAB}」 탭이 없다`); continue; }
  const gid = Number(sh.properties?.sheetId ?? 0);
  const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${TAB}!A1:A80`)}`);
  const labels = ((vals.values || []) as string[][]).map((r) => S(r[0]));

  /**
   * 규격 순서를 따라가며 «없는 항목»을 찾는다. 넣을 자리는 **그 다음 규격 항목이 있는 줄** 앞이다 —
   * 뒤에 아무 항목도 없으면 맨 끝에 붙인다. 이렇게 해야 규격과 시트의 순서가 어긋나지 않는다.
   */
  const missing: { name: string; at: number; idx: number }[] = [];
  for (const [i, name] of POLICY_COLUMN_NAMES.entries()) {
    if (name === '정책코드' || labels.includes(name)) continue;
    let at = labels.length;                       // 못 찾으면 맨 끝
    for (const next of POLICY_COLUMN_NAMES.slice(i + 1)) {
      const found = labels.indexOf(next);
      if (found >= 0) { at = found; break; }
    }
    missing.push({ name, at, idx: i });
  }
  if (!missing.length) continue;
  /**
   * 아래에서부터 끼운다 — 위에서부터 넣으면 다음 자리가 밀린다.
   * ★같은 자리에 둘 이상 들어갈 땐 **규격 순서의 뒤쪽부터** 넣어야 한다.
   *   앞쪽부터 넣으면 나중 것이 그 위에 얹혀 순서가 뒤집힌다(승계 가능여부 ↔ 승계수수료).
   */
  missing.sort((a, b) => b.at - a.at || b.idx - a.idx);
  console.log(`  ${label.padEnd(14)}${missing.length}줄 — ${missing.map((m) => `${m.name}(${m.at + 1}행 앞)`).join(' · ')}`);
  total += missing.length;
  if (!APPLY) continue;
  for (const m of missing) {
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          insertDimension: {
            range: { sheetId: gid, dimension: 'ROWS', startIndex: m.at, endIndex: m.at + 1 },
            inheritFromBefore: true,      // 위 줄 서식을 물려받는다 — 맨 줄이 생기지 않게
          },
        }],
      }),
    });
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${TAB}!A${m.at + 1}`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: [[m.name]] }),
    });
  }
}
console.log(`\n  끼울 줄 ${total}개`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
