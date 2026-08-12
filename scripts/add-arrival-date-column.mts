/**
 * **우리 규격 시트에 「입고일자」 열을 끼워 넣는다**(「상태」 앞). 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-12) — 「이 차를 상품에 언제 입고했는지, 그 입고일로부터 며칠동안 안 나가는지」.
 *   재고일수의 기준점이라 이 칸이 비면 오래 서 있는 차를 영영 못 찾는다.
 *   최초등록일과 다른 값이다 — 2020년식 중고차를 이번 달에 상품화하면 입고일자는 이번 달이다.
 *
 * ★**표를 지우지 않는다.** `deleteTable` 은 값까지 지운다(실측 2026-08-11 · 196대가 날아갔다).
 *   `insertDimension` 으로 열만 밀어 넣으면 값·서식·드롭다운이 그대로 따라 밀린다.
 * ★이미 그 열이 있으면 손대지 않는다. 두 번 돌려도 안전하다.
 * ⚠ 서식(머리행 색·너비·줄무늬)은 여기서 안 건드린다. 끼운 뒤
 *   `restyle-supplier-sheets --apply` 로 한 번에 다시 입힌다 — 그게 서식 SSOT다.
 *
 *   npx tsx scripts/add-arrival-date-column.mts
 *   npx tsx scripts/add-arrival-date-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isVehicleTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).trim();
const COLUMN = '입고일자';
const BEFORE = '상태';        // 이 열 «앞»에 끼운다

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
const A = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const files = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`)).files || []) as Rec[];
console.log(`■ 「${COLUMN}」 열 끼우기 ${APPLY ? '(반영)' : '(dry-run)'} — 「${BEFORE}」 앞\n`);

let added = 0; let already = 0;
for (const f of files) {
  const label = supplierSheetLabel(f.name);
  if (ONLY && !label.includes(ONLY)) continue;
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}?fields=sheets.properties(sheetId,title)`);
  const tabs = ((meta.sheets || []) as Rec[]).filter((sh) => isVehicleTab(S(sh.properties?.title)));
  for (const sh of tabs) {
    const tab = S(sh.properties?.title);
    const gid = Number(sh.properties?.sheetId ?? 0);
    const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${tab}!A1:BZ1`)}`);
    const hdr = (((vals.values || []) as string[][])[0] || []).map(S);
    if (hdr.includes(COLUMN)) { already++; continue; }
    const at = hdr.indexOf(BEFORE);
    if (at < 0) { console.log(`  △ ${label}/${tab} — 「${BEFORE}」 열이 없다`); continue; }
    console.log(`  ${`${label}/${tab}`.padEnd(20)}${A(at)}열 앞에 끼움`);
    added++;
    if (!APPLY) continue;
    // 열만 민다 — 값·서식·드롭다운이 그대로 따라간다. 표 범위도 구글이 같이 넓힌다.
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          insertDimension: {
            range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 },
            // 왼쪽 열(차량번호)의 서식을 물려받게 한다 — 아무 서식 없는 맨 열이 생기지 않게.
            inheritFromBefore: true,
          },
        }],
      }),
    });
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(f.id)}/values/${encodeURIComponent(`${tab}!${A(at)}1`)}?valueInputOption=RAW`, {
      method: 'PUT', body: JSON.stringify({ values: [[COLUMN]] }),
    });
  }
}
console.log(`\n  끼운 탭 ${added}개 · 이미 있는 탭 ${already}개`);
if (APPLY && added) console.log('\n  ※ 이어서 `npx tsx scripts/restyle-supplier-sheets.mts --apply` 로 서식을 다시 입힐 것\n');
else if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
