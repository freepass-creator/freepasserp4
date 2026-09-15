/**
 * **하허호 F86 을 백업 사본으로 되돌린다** — 틀린 회차가 나갔을 때.
 *
 * ★사장님 2026-09-16 「운영 F86 되돌리기 준비」. 백업은 `backup-f86.mts`(통합 워크플로가 발행 직전에 뜬다).
 *
 * 되돌리는 법 — 백업 문서의 회사 탭(공지사항·안내 제외)을 대상 문서로 «탭째» 복사(값·서식·차번 링크 그대로)하고,
 *   대상의 옛 회사 탭을 지운 뒤 이름·차례를 백업과 같게 맞춘다. 대상의 공지사항은 손대지 않는다.
 * ⚠ 운영 F86 에 되돌리는 것도 «운영 쓰기»다 — 사장님 허락(`FREEPASS_MANUAL_PUBLISH_APPROVED`)이나 통합 워크플로 안에서만.
 *   기본은 dry-run(무엇을 바꿀지 보여만 준다). 미리보기 사본으로 먼저 해 볼 수 있다(`--시트=<사본 id>`).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/restore-f86-from-backup.mts --from=<백업 문서 id> [--시트=<사본 id>] [--apply]
 */
import { JWT } from 'google-auth-library';
import nextEnv from '@next/env';
import { HAHUHO_PRODUCT_SHEET_ID } from '../lib/domain/legacy-sheets';
import { assertProductionSheetWrite } from '../lib/server/production-sheet-write-gate';
import { googleSheetsServiceAccount } from '../lib/server/google-service-account';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const APPLY = process.argv.includes('--apply');
const from = S(arg('from'));
if (!from) throw new Error('--from=<백업 문서 id> 가 필요하다(backup-f86 이 찍은 id).');
const target = S(arg('시트')) || HAHUHO_PRODUCT_SHEET_ID;
if (from === target) throw new Error('백업과 대상이 같은 문서다.');
if (APPLY && target === HAHUHO_PRODUCT_SHEET_ID) assertProductionSheetWrite('F86', 'restore-f86-from-backup --apply');

const sa = googleSheetsServiceAccount('tmp/firebase-auth/sa.json');
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 1; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n <= 5) { await new Promise((k) => setTimeout(k, 3000 * n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const 지킴 = /공지|안내|이 시트|시트 지도/;
type Props = { sheetId: number; title: string; index: number };
const tabsOf = async (id: string): Promise<Props[]> => ((await api(`${SH}/${id}?fields=properties.title,sheets.properties(sheetId,title,index)`)).sheets || [])
  .map((s: any) => s.properties as Props).sort((a: Props, b: Props) => a.index - b.index);

const src = (await tabsOf(from)).filter((p) => !지킴.test(p.title));
const dst = await tabsOf(target);
const 지울 = dst.filter((p) => !지킴.test(p.title));
console.log(`\n■ F86 되돌리기 — ${target === HAHUHO_PRODUCT_SHEET_ID ? '운영 F86' : `사본 ${target}`} ← 백업 ${from}`);
console.log(`  들어올 탭 ${src.length}장 — ${src.map((p) => p.title).join(' | ')}`);
console.log(`  빠질 탭 ${지울.length}장 — ${지울.map((p) => p.title).join(' | ')}`);
if (!src.length) throw new Error('백업에 회사 탭이 없다 — 되돌리지 않는다.');
if (!APPLY) { console.log('\n※ dry-run — --apply 로 되돌린다.\n'); process.exit(0); }

const copied: { sheetId: number; title: string; index: number }[] = [];
for (const p of src) {
  const r = await api(`${SH}/${from}/sheets/${p.sheetId}:copyTo`, { method: 'POST', body: JSON.stringify({ destinationSpreadsheetId: target }) });
  copied.push({ sheetId: Number(r.sheetId), title: p.title, index: p.index });
}
const notice = dst.filter((p) => 지킴.test(p.title)).length;
const reqs: any[] = [
  ...지울.map((p) => ({ deleteSheet: { sheetId: p.sheetId } })),
  ...copied.map((c, i) => ({ updateSheetProperties: { properties: { sheetId: c.sheetId, title: c.title, index: notice + i }, fields: 'title,index' } })),
];
await api(`${SH}/${target}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
console.log(`\n✓ 되돌림 — 탭 ${copied.length}장 · 옛 탭 ${지울.length}장 지움 · 공지사항 그대로`);
console.log(`   https://docs.google.com/spreadsheets/d/${target}/edit`);
process.exit(0);
