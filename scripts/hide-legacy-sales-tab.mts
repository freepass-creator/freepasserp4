/**
 * **판매시트 F01 의 «묵은 탭»을 숨긴다(지우지 않는다).** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-16 「09:05 회차가 새로 쓴 걸 확인한 뒤 옛 탭을 숨겨라」.
 *   왜 — 그날 F01 에 손오공 탭이 «두 장»이었다: 「손오공상품 01:25 · 54대」(erp5 엔진 이름)과
 *   「오공구독」(통합 엔진 이름). 영업자가 옛 탭을 보고 이미 나간 차를 팔 수 있다.
 *   ⚠ **지우지 않는다** — 숨기면 되돌리기가 한 번이고, 시트 기록도 그대로 남는다.
 *
 * 안전장치
 *   · 운영 F01 쓰기라 문지기를 지난다(`production-sheet-write-gate`) — 통합 워크플로 밖에서는 사장님 허락 표시가 있어야 열린다.
 *   · «오늘 회차가 새로 쓴 탭»이 있어야 숨긴다(`--fresh=오공구독` 같은 접두가 오늘 문패로 서 있는지 먼저 본다).
 *   · 이미 숨겨져 있으면 아무것도 안 한다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/hide-legacy-sales-tab.mts --tab=손오공상품 --fresh=오공구독 [--apply]
 */
import { JWT } from 'google-auth-library';
import nextEnv from '@next/env';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { assertProductionSheetWrite } from '../lib/server/production-sheet-write-gate';
import { googleSheetsServiceAccount } from '../lib/server/google-service-account';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const APPLY = process.argv.includes('--apply');
const legacy = S(arg('tab'));
const fresh = S(arg('fresh'));
if (!legacy) throw new Error('--tab=<숨길 탭 접두> 가 필요하다. 예: --tab=손오공상품');
if (APPLY) assertProductionSheetWrite('F01', `hide-legacy-sales-tab --tab=${legacy}`);

const sa = googleSheetsServiceAccount('tmp/firebase-auth/sa.json');
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 1; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await new Promise((k) => setTimeout(k, 2000 * n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const meta = await api(`${SH}/${SALES_SHEET_ID}?fields=sheets.properties(sheetId,title,index,hidden)`);
const tabs = (meta.sheets || []).map((s: any) => s.properties as { sheetId: number; title: string; index: number; hidden?: boolean });
const target = tabs.filter((t: any) => S(t.title).startsWith(legacy));
const fresher = fresh ? tabs.filter((t: any) => S(t.title).startsWith(fresh)) : [];
const 오늘 = new Date(Date.now() + 9 * 3600e3);
const p2 = (n: number) => String(n).padStart(2, '0');
const 오늘문패 = `${p2(오늘.getUTCMonth() + 1)}.${p2(오늘.getUTCDate())}`;
const 새로썼나 = fresher.some((t: any) => S(t.title).includes(오늘문패));

console.log(`\n■ 판매시트 F01 묵은 탭 정리 — 숨길 접두 「${legacy}」${fresh ? ` · 오늘 새로 선 탭 확인 「${fresh}」` : ''}`);
for (const t of tabs) console.log(`   ${String(t.index).padStart(2)} ${t.hidden ? '(숨김) ' : '       '}${t.title}`);
if (!target.length) { console.log(`\n※ 「${legacy}」 로 시작하는 탭이 없다 — 할 일 없음.\n`); process.exit(0); }
if (fresh && !새로썼나) {
  console.error(`\n⛔ 오늘(${오늘문패}) 문패로 선 「${fresh}」 탭이 없다 — 새 회차가 아직 안 썼다. 숨기지 않는다(옛 탭이라도 있어야 영업이 본다).\n`);
  process.exit(1);
}
const 할일 = target.filter((t: any) => !t.hidden);
if (!할일.length) { console.log('\n※ 이미 숨겨져 있다 — 할 일 없음.\n'); process.exit(0); }
console.log(`\n숨길 탭: ${할일.map((t: any) => t.title).join(' · ')}`);
if (!APPLY) { console.log('\n※ dry-run — --apply 로 숨긴다(지우지 않는다).\n'); process.exit(0); }

await api(`${SH}/${SALES_SHEET_ID}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({ requests: 할일.map((t: any) => ({ updateSheetProperties: { properties: { sheetId: t.sheetId, hidden: true }, fields: 'hidden' } })) }),
});
console.log(`\n✓ 숨김 ${할일.length}장 — 되돌리려면 시트에서 탭 표시(또는 hidden:false)로 한 번에 돌린다.\n`);
process.exit(0);
