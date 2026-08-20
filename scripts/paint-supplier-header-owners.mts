/**
 * **재고 탭 머리행 색 — 렌트사 칸(남색) vs 프리패스/AI 칸(보라).** 값·표·드롭다운은 안 건드린다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-18 — 「렌트사가 입력하는 줄과 자동으로 입력되는 줄(AI가) 테이블 헤더 색깔 구분을 좀 해줘야 함」
 *   기준은 `columnOwner`(정제칸 12 + 정책코드 = ours) 하나 — 표준 생성기(buildTemplateFormat)도 같은 함수를 쓴다.
 * ⚠ 표(Table)를 지우지 않는다 — deleteTable 은 값까지 지운다(2026-08-18 실측, restore-stock-tabs-from-revision 로 되살림).
 *
 *   npx tsx scripts/paint-supplier-header-owners.mts
 *   npx tsx scripts/paint-supplier-header-owners.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { excludeMirrorSheets } from '../lib/domain/mirror-sources';
import { SHEET_NAME_MATCH, buildHeaderOwnerColors, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONE = arg('sheet');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const targets: { id: string; name: string }[] = [];
if (ONE) targets.push({ id: ONE, name: ONE });
else {
  const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) targets.push({ id: S(f.id), name: supplierSheetLabel(S(f.name)) });
  targets.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
const TARGETS_FILTERED = excludeMirrorSheets([...targets]); targets.length = 0; targets.push(...TARGETS_FILTERED);   // 복사본(--include-mirror 때 같은 배열이 비워지는 버그, 2026-08-19)
console.log(`■ 머리행 주인 색 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let n = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const p = sh.properties; const title = S(p.title);
    if (p.hidden || isOurNonInventoryTab(title)) continue;
    const v = await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`) as { values?: string[][] };
    const header = ((v.values || [])[0] || []).map(S);
    if (!header.some((c) => norm(c) === '차명(세부모델+트림)')) continue;
    const reqs = buildHeaderOwnerColors(p.sheetId, header.map((name) => ({ name })));
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(10)} 「${title}」 보라 머리 ${reqs.length}칸`);
    if (!APPLY || !reqs.length) continue;
    await call(`${SH}/${t.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
    n++; await sleep(1200);
  }
}
console.log(APPLY ? `  반영 탭 ${n}` : '※ dry-run. 반영은 --apply');
