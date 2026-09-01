/**
 * **정제칸 「차종크기」·「차종구분」을 「차종마스터 신규」 시트 값으로 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-21 「어긋난거를 수정은 했어?? 수정이력 남기고」.
 *
 * ★왜 이 두 칸만 — 시트 「안내」 탭이 「**차종크기·차종구분은 이 시트 칸**」이라고 못 박았다.
 *   이름(세부모델)은 시트가 「엔카 중고차만」이라 절반이 안 잡히므로 여기서 건드리지 않는다.
 *
 * ★안 고치는 것 — 짐작이 들어가는 자리는 전부 뺀다.
 *   · 세부모델이 시트에 없으면 건너뛴다(비슷한 차로 붙이지 않는다)
 *   · **그 세부모델 안에서 시트 값이 갈리면 건너뛴다** — 4075줄 중 한 줄만 다를 수도 있다.
 *     하나로 모일 때만 쓴다. 「틀린 값보다 빈 칸」(안내 탭).
 *   · 출고불가·판매완료 줄은 안 본다
 *
 * ★이력 — 고친 칸마다 **전·후를 남긴다**. 되돌리려면 이 파일이 있어야 한다.
 *   · 되돌림용 원본: `tmp/refine-class-fix-<시각>.json`
 *   · 사람이 읽는 이력: `docs/수정이력-정제칸.md` (맨 위에 쌓인다)
 *
 *   npx tsx scripts/fix-refine-vehicle-class.mts
 *   npx tsx scripts/fix-refine-vehicle-class.mts --apply
 *   npx tsx scripts/fix-refine-vehicle-class.mts --apply --only=빌린카,아이카
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { ENCAR_MASTER_SHEET_ID } from '../lib/domain/legacy-sheets';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const key = (v: unknown) => norm(v).toLowerCase().replace(/[()（）\-_.·,/]/g, '');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const ONLY = new Set(arg('only').split(',').map(S).filter(Boolean));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => { let t = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 120)}`);
  }
};

// ── 사전 — 세부모델 하나에 값이 하나로 모일 때만 쓴다
const SIZE = new Map<string, string>();
const KIND = new Map<string, string>();
const SPLIT = new Set<string>();
{
  const rows = ((await call(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}/values/${encodeURIComponent('차종마스터!A1:AB5000')}`)).values || []) as string[][];
  const h = (rows[0] || []).map(norm);
  const [si, zi, ki] = ['세부모델', '차종크기', '차종구분'].map((n) => h.indexOf(norm(n)));
  if (si < 0 || zi < 0 || ki < 0) throw new Error('「차종마스터」 탭에 세부모델·차종크기·차종구분 열이 없다');
  for (const r of rows.slice(1)) {
    const k = key(r[si]); if (!k) continue;
    const size = S(r[zi]), kind = S(r[ki]);
    if (size) { const p = SIZE.get(k); if (p && p !== size) SPLIT.add(`${k}:크기`); else SIZE.set(k, size); }
    if (kind) { const p = KIND.get(k); if (p && p !== kind) SPLIT.add(`${k}:구분`); else KIND.set(k, kind); }
  }
  console.log(`■ 사전 — 「차종마스터 신규」 ${rows.length - 1}줄 · 세부모델 ${SIZE.size}종 (시트 안에서 갈리는 것 ${SPLIT.size} — 안 쓴다)`);
}

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const books = (((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[])
  .map((f) => ({ id: S(f.id), label: supplierSheetLabel(S(f.name)) })).sort((a, b) => a.label.localeCompare(b.label));

type Change = { supplier: string; sheetId: string; tab: string; row: number; col: number; a1: string; plate: string; sub: string; column: string; before: string; after: string; why: '빈칸 채움' | '어긋남 고침' };
const changes: Change[] = [];
let seen = 0, skipNoName = 0, skipSplit = 0;

for (const b of books) {
  if (ONLY.size && !ONLY.has(b.label)) continue;
  const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,hidden)`);
  for (const p of ((meta.sheets || []) as Rec[]).map((s) => s.properties as Rec)) {
    const tab = S(p.title);
    if (p.hidden || isOurNonInventoryTab(tab) || !/재고/.test(tab) || /상품시트/.test(tab)) continue;
    let rows: string[][];
    try { rows = (((await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(`${tab}!A1:CZ700`)}`)).values || []) as string[][]); } catch { continue; }
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호'));
    if (hi < 0) continue;
    const h = rows[hi].map(norm);
    const at = (n: string) => h.indexOf(norm(n));
    const pi = at('차량번호'), si2 = at('상태'), subAt = at('세부모델'), zAt = at('차종크기'), kAt = at('차종구분');
    if (subAt < 0 || zAt < 0 || kAt < 0) continue;
    rows.slice(hi + 1).forEach((r, k) => {
      const plate = norm(r[pi]); if (!plate) return;
      if (/출고불가|판매완료|말소/.test(si2 >= 0 ? S(r[si2]) : '')) return;
      seen++;
      const sub = S(r[subAt]); if (!sub) return;
      const kk = key(sub);
      if (!SIZE.has(kk) && !KIND.has(kk)) { skipNoName++; return; }
      const row = hi + 2 + k;
      for (const [colName, colAt, dict, splitTag] of [['차종크기', zAt, SIZE, '크기'], ['차종구분', kAt, KIND, '구분']] as const) {
        if (SPLIT.has(`${kk}:${splitTag}`)) { skipSplit++; continue; }
        const want = dict.get(kk); if (!want) continue;
        const before = S(r[colAt]);
        if (before === want) continue;
        changes.push({
          supplier: b.label, sheetId: b.id, tab, row, col: colAt, a1: `${colA1(colAt)}${row}`,
          plate, sub, column: colName, before, after: want, why: before ? '어긋남 고침' : '빈칸 채움',
        });
      }
    });
  }
}

const fixes = changes.filter((c) => c.why === '어긋남 고침');
const fills = changes.filter((c) => c.why === '빈칸 채움');
console.log(`\n■ 정제칸 차급 맞추기 — 팔 수 있는 차 ${seen}대 ${APPLY ? '(반영)' : '(dry-run)'}`);
console.log(`  고칠 칸 ${changes.length} — 어긋남 고침 ${fixes.length} · 빈칸 채움 ${fills.length}`);
console.log(`  건너뜀 — 시트에 이름 없음 ${skipNoName}대 · 시트 안에서 값이 갈림 ${skipSplit}칸\n`);

if (fixes.length) {
  console.log('  ── 어긋남 고침(값이 바뀐다)');
  for (const c of fixes) console.log(`   ${c.supplier.slice(0, 10).padEnd(11)} ${c.plate.padEnd(10)} ${c.column.padEnd(6)} 「${c.before}」 → 「${c.after}」   ${c.sub}`);
}
if (fills.length) {
  console.log(`\n  ── 빈칸 채움 ${fills.length} (앞 15줄만)`);
  for (const c of fills.slice(0, 15)) console.log(`   ${c.supplier.slice(0, 10).padEnd(11)} ${c.plate.padEnd(10)} ${c.column.padEnd(6)} (빈칸) → 「${c.after}」   ${c.sub}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/refine-class-fix-${stamp}.json`;
writeFileSync(backup, JSON.stringify(changes, null, 2));
if (!APPLY) { console.log(`\n※ dry-run — 아무것도 안 썼다. 반영은 --apply · 목록 ${backup}\n`); process.exit(0); }
if (!changes.length) { console.log('\n고칠 게 없다.\n'); process.exit(0); }

// ── 반영 — 문서별로 묶어 한 번에
const byBook = new Map<string, { range: string; values: string[][] }[]>();
for (const c of changes) {
  const list = byBook.get(c.sheetId) || [];
  list.push({ range: `'${c.tab.replace(/'/g, "''")}'!${c.a1}`, values: [[c.after]] });
  byBook.set(c.sheetId, list);
}
for (const [id, data] of byBook) {
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
}

// ── 사람이 읽는 이력 — 맨 위에 쌓는다
const LOG = 'docs/수정이력-정제칸.md';
const when = new Date().toLocaleString('ko-KR', { hour12: false });
const head = existsSync(LOG) ? readFileSync(LOG, 'utf8') : `# 수정이력 — 정제칸\n\n> 기계가 정제칸을 고칠 때마다 여기에 쌓는다. 새 것이 위.\n> 되돌릴 원본은 \`tmp/refine-class-fix-*.json\`.\n`;
const body = [
  ``,
  `## ${when} · 차종크기·차종구분을 「차종마스터 신규」 시트에 맞춤`,
  ``,
  `도구 \`scripts/fix-refine-vehicle-class.mts --apply\` · 되돌림 \`${backup}\``,
  `고친 칸 **${changes.length}** — 어긋남 고침 ${fixes.length} · 빈칸 채움 ${fills.length}`,
  `건너뜀 — 시트에 이름 없음 ${skipNoName}대 · 시트 안에서 값이 갈림 ${skipSplit}칸`,
  ``,
  `| 공급사 | 차량번호 | 칸 | 전 | 후 | 세부모델 |`,
  `|---|---|---|---|---|---|`,
  ...changes.map((c) => `| ${c.supplier} | ${c.plate} | ${c.column} | ${c.before || '(빈칸)'} | ${c.after} | ${c.sub} |`),
  ``,
].join('\n');
const marker = '> 되돌릴 원본은';
const cut = head.indexOf(marker);
const insertAt = cut >= 0 ? head.indexOf('\n', cut) + 1 : head.length;
writeFileSync(LOG, head.slice(0, insertAt) + body + head.slice(insertAt));

console.log(`\n■ 끝 — ${changes.length}칸을 고쳤다.`);
console.log(`   이력 ${LOG} · 되돌림 ${backup}\n`);
