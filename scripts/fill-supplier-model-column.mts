/**
 * 전 공급사 「모델명」 채우기 — 차명(트림) 스냅 우선, 없으면 정제칸 「모델」, 그다음 글자 매칭.
 * 기본 dry-run, 반영은 --apply. 이미 값 있으면 유지(--overwrite 만 덮음).
 *
 *   npx tsx scripts/fill-supplier-model-column.mts
 *   npx tsx scripts/fill-supplier-model-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).trim();
const COL = '모델명';
const NAME = '차명(트림)';
const REFINE = '모델';
const MAKER = '제조사';

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec | MasterEntry[];
const entries = (Array.isArray(raw) ? raw : raw.entries) as MasterEntry[];
const modelList = [...new Set(entries.map((e) => S(e.model)).filter((m) => m.length >= 2))]
  .sort((a, b) => b.length - a.length);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const colA1 = (i: number) => {
  let t = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); }
  return t;
};
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { await sleep(Math.min(60_000, 5_000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 400)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

function guessModel(maker: string, name: string, refine: string): string {
  const nm = S(name);
  const rf = S(refine);
  if (nm) {
    const snap = snapToMaster({ maker: maker || undefined, trim_name: nm } as any, entries);
    const snapped = S(snap?.entry?.model);
    if (snapped) {
      // 정제값이 차명에도 보이면 정제 우선(표기 통일), 아니면 스냅(차명이 진실)
      if (rf && (nm.includes(rf) || norm(nm).includes(norm(rf)))) return rf;
      return snapped;
    }
    for (const m of modelList) {
      const cm = m.replace(/\s+/g, '');
      if (nm.includes(m) || norm(nm).includes(cm)) return m;
    }
  }
  if (rf) return rf;
  return '';
}

const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const files = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[];
let targets = files.map((f) => ({ id: S(f.id), name: supplierSheetLabel(S(f.name)), full: S(f.name) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
if (ONLY) targets = targets.filter((t) => t.name.includes(ONLY) || t.full.includes(ONLY));

console.log(`■ 전 공급사 「${COL}」 채우기 ${APPLY ? '반영' : '미리보기'} — ${targets.length}곳`);
let filled = 0, kept = 0, empty = 0, noCol = 0;
for (const t of targets) {
  const meta = await call(`${SH}/${t.id}?fields=sheets.properties(sheetId,title,hidden)`);
  for (const sh of (meta.sheets || []) as Rec[]) {
    const title = S(sh.properties.title);
    if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
    const rows = ((await call(`${SH}/${t.id}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`)).values || []) as string[][];
    if (!rows.length) continue;
    const hdr = rows[0].map(S);
    const ci = hdr.findIndex((c) => norm(c) === norm(COL));
    const ni = hdr.findIndex((c) => norm(c) === norm(NAME));
    const ri = hdr.findIndex((c) => c === REFINE); // 정제칸 「모델」만 (모델명과 구분)
    const mi = hdr.findIndex((c) => norm(c) === norm(MAKER));
    const pi = hdr.findIndex((c) => norm(c) === '차량번호');
    if (ci < 0 || ni < 0 || pi < 0) { if (ni >= 0 && pi >= 0) noCol++; continue; }

    const updates: { row: number; value: string }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (!S(row[pi])) continue;
      const cur = S(row[ci]);
      if (cur && !OVERWRITE) { kept++; continue; }
      const model = guessModel(mi >= 0 ? S(row[mi]) : '', S(row[ni]), ri >= 0 ? S(row[ri]) : '');
      if (!model) { empty++; continue; }
      if (cur === model) { kept++; continue; }
      updates.push({ row: i + 1, value: model });
    }
    if (!updates.length) continue;
    console.log(`  ${APPLY ? '✓' : '→'} ${t.name.padEnd(12)} 「${title}」 ${updates.length}칸`);
    filled += updates.length;
    if (!APPLY) continue;

    const data: string[][] = [];
    let start = updates[0].row;
    let prev = updates[0].row;
    const flush = async (from: number, block: string[][]) => {
      const range = `'${title.replace(/'/g, "''")}'!${colA1(ci)}${from}:${colA1(ci)}${from + block.length - 1}`;
      await call(`${SH}/${t.id}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        body: JSON.stringify({ values: block }),
      });
    };
    for (const u of updates) {
      if (u.row !== prev + 1 && data.length) {
        await flush(start, data);
        data.length = 0;
        start = u.row;
      }
      if (!data.length) start = u.row;
      data.push([u.value]);
      prev = u.row;
    }
    if (data.length) await flush(start, data);
    await sleep(700);
  }
}
console.log(APPLY
  ? `  반영 ${filled} · 유지 ${kept} · 못채움 ${empty} · 열없음탭 ${noCol}`
  : `※ dry-run 예정 ${filled} · 유지 ${kept} · 못채움 ${empty} · 열없음탭 ${noCol}. 반영은 --apply`);
