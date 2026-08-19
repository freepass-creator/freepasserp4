/**
 * **공급사 제공시트(21곳) 재고 탭에서 열 하나를 이름으로 지운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「공급사 전체 시트에 정제하기 위해서 모델·세부모델·파워트레인·세부트림 이렇게 있는데 파워트레인 없애」
 *   차종은 모델·세부모델·세부트림 3축(판매시트·차종마스터에서 이미 뺐다). 정제칸의 「파워트레인」도 같은 이유로 뺀다.
 * ★열을 **통째로 지운다**(deleteDimension) — 값·서식·드롭다운·표 범위·줄무늬가 같이 줄어든다. 값을 지우고 빈 열을 남기지 않는다.
 * ★값이 들어 있는 열도 지운다 — 파워트레인은 연료·배기량 정제칸이 이미 품고 있는 정보다. 지우기 전 그 값을 tmp/ 에 백업한다(되돌릴 길).
 * ⚠ 재고 탭(머리행에 「차명(트림)」)만 본다. 정책·안내·AI 인계 탭은 안 건드린다.
 *
 *   npx tsx scripts/drop-supplier-column.mts --name=파워트레인
 *   npx tsx scripts/drop-supplier-column.mts --name=파워트레인 --apply
 *   npx tsx scripts/drop-supplier-column.mts --name=파워트레인 --sheet=<ID> --apply
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const NAME = arg('name');
const ONE = arg('sheet');
if (!NAME) throw new Error('--name=<열 이름> 이 필요하다');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(f.name) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
console.log(`■ 「${NAME}」 열 지우기 ${APPLY ? '반영' : '미리보기'} — 시트 ${targets.length}곳`);
mkdirSync('tmp', { recursive: true });
const backup: Rec = { name: NAME, at: new Date().toISOString(), sheets: [] as Rec[] };
let dropped = 0, absent = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const p of (meta.sheets || []).map((x: Rec) => x.properties)) {
    const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
    const rows = ((v.values || []) as string[][]).map((r) => r.map(S));
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차명(트림)'));
    if (hi < 0) continue;
    const ci = rows[hi].findIndex((h) => norm(h) === norm(NAME));
    if (ci < 0) { absent++; console.log(`  · ${t.name.padEnd(10)} 「${title}」 — 「${NAME}」 열 없음`); continue; }
    const pi = rows[hi].findIndex((h) => norm(h) === '차량번호');
    const values = rows.slice(hi + 1).filter((r) => S(r[ci])).map((r) => [S(r[pi]), S(r[ci])]);
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 — ${ci + 1}번째 열 지움 (값 있는 줄 ${values.length})`);
    backup.sheets.push({ id: t.id, name: t.name, tab: title, columnIndex: ci, values });
    if (!APPLY) continue;
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 } } }] }) });
    dropped++;
  }
}
const file = `tmp/drop-column-${norm(NAME)}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`;
writeFileSync(file, JSON.stringify(backup, null, 1), 'utf8');
console.log(`\n  ${APPLY ? `지움 ${dropped}탭` : `지울 탭 ${backup.sheets.length}`} · 열 없음 ${absent} · 백업 ${file}${APPLY ? '' : '\n※ dry-run. 반영은 --apply'}`);
