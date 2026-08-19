/**
 * 손오공 「모델명」 칸 채우기 — 정제칸 「모델」 있으면 그걸, 없으면 차명(트림)에서 스냅.
 * 기본 dry-run, 반영은 --apply. 이미 값이 있으면 덮지 않음(--overwrite 만 덮음).
 *
 *   npx tsx scripts/fill-sonogong-model-column.mts
 *   npx tsx scripts/fill-sonogong-model-column.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { snapToMaster, type MasterEntry } from '../lib/domain/vehicle-master-match';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const SHEET_ID = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const COL = '모델명';
const NAME = '차명(트림)';
const REFINE = '모델';
const MAKER = '제조사';

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec | MasterEntry[];
const entries = (Array.isArray(raw) ? raw : raw.entries) as MasterEntry[];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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

function guessModel(maker: string, name: string, refine: string): { model: string; how: string } {
  if (S(refine)) return { model: S(refine), how: '정제칸' };
  if (!S(name)) return { model: '', how: '빈차명' };
  const snap = snapToMaster({
    maker: maker || undefined,
    trim_name: name,
    model: undefined,
  } as any, entries);
  if (snap?.entry?.model) return { model: S(snap.entry.model), how: '스냅' };
  // 짧은 폴백 — 알려진 모델 토큰이 차명 앞에 있으면
  const compact = name.replace(/\s+/g, '');
  const models = [...new Set(entries.map((e) => S(e.model)).filter((m) => m.length >= 2))]
    .sort((a, b) => b.length - a.length);
  for (const m of models) {
    const cm = m.replace(/\s+/g, '');
    if (compact.includes(cm) || name.includes(m)) return { model: m, how: '글자' };
  }
  return { model: '', how: '못찾음' };
}

console.log(`■ 손오공 「${COL}」 채우기 ${APPLY ? '반영' : '미리보기'}${OVERWRITE ? ' (덮어쓰기)' : ''}`);
const meta = await call(`${SH}/${SHEET_ID}?fields=sheets.properties(sheetId,title,hidden)`);
let filled = 0, kept = 0, empty = 0;
const samples: string[] = [];
for (const sh of (meta.sheets || []) as Rec[]) {
  const title = S(sh.properties.title);
  if (sh.properties.hidden || isOurNonInventoryTab(title)) continue;
  const rows = ((await call(`${SH}/${SHEET_ID}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ700`)}`)).values || []) as string[][];
  if (!rows.length) continue;
  const hdr = rows[0].map(S);
  const ci = hdr.findIndex((c) => norm(c) === norm(COL));
  const ni = hdr.findIndex((c) => norm(c) === norm(NAME));
  const ri = hdr.findIndex((c) => norm(c) === norm(REFINE));
  const mi = hdr.findIndex((c) => norm(c) === norm(MAKER));
  if (ci < 0 || ni < 0) { console.log(`  · 「${title}」 열 없음(모델명/차명)`); continue; }

  const updates: { row: number; value: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const plate = S(row[hdr.indexOf('차량번호')]);
    if (!plate) continue;
    const cur = S(row[ci]);
    if (cur && !OVERWRITE) { kept++; continue; }
    const { model, how } = guessModel(mi >= 0 ? S(row[mi]) : '', S(row[ni]), ri >= 0 ? S(row[ri]) : '');
    if (!model) { empty++; if (samples.length < 8) samples.push(`${title} ${plate} ← ${S(row[ni]).slice(0, 40) || '(빈)'} (${how})`); continue; }
    if (cur === model) { kept++; continue; }
    updates.push({ row: i + 1, value: model });
    if (samples.length < 12) samples.push(`${title} ${plate} → ${model} (${how}) · ${S(row[ni]).slice(0, 36)}`);
  }
  console.log(`  「${title}」 채울 ${updates.length}칸`);
  if (!APPLY || !updates.length) { filled += updates.length; continue; }

  // 연속 구간으로 묶어 update
  const data: string[][] = [];
  let start = updates[0].row;
  let prev = updates[0].row;
  const flush = async (from: number, block: string[][]) => {
    const range = `'${title.replace(/'/g, "''")}'!${colA1(ci)}${from}:${colA1(ci)}${from + block.length - 1}`;
    await call(`${SH}/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
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
  filled += updates.length;
  await sleep(600);
}
console.log('--- 샘플 ---');
for (const s of samples) console.log(' ', s);
console.log(APPLY
  ? `  반영 ${filled} · 유지 ${kept} · 못채움 ${empty}`
  : `※ dry-run 예정 ${filled} · 유지 ${kept} · 못채움 ${empty}. 반영은 --apply`);
