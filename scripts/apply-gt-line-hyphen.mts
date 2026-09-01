/**
 * 엔카 작업 시트 세부트림 `GT Line` → `GT-Line` (기아 공식 가격표).
 * 머리글 이름으로 찾는다. 라이브 원장·정제칸은 안 씀. 기본 dry-run.
 *
 *   npx tsx scripts/apply-gt-line-hyphen.mts
 *   npx tsx scripts/apply-gt-line-hyphen.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { ENCAR_MASTER_SHEET_ID, ENCAR_MASTER_TAB, loadEncarWorkSheetGrids } from '../lib/domain/encar-master-sheet';
import { applyLatinBrandTokens } from '../lib/domain/vehicle-master-lock';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com',
});
const api = async (url: string, init?: RequestInit) => {
  const tok = (await jwt.getAccessToken()).token;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json() as Record<string, any>;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const a1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const grids = await loadEncarWorkSheetGrids(api);
const names = (grids.names || []).map((r) => (r || []).map(S));
const hdrRow = names.findIndex((r) => r.includes('제조사') && r.includes('세부모델') && r.includes('세부트림'));
if (hdrRow < 0) throw new Error('차종마스터 머리글을 못 찾음');
const hdr = names[hdrRow];
const trimI = hdr.indexOf('세부트림');
const modelI = hdr.indexOf('모델');
const subI = hdr.indexOf('세부모델');
if (trimI < 0) throw new Error('세부트림 열 없음');

const hits: { row: number; a1: string; model: string; sub: string; now: string; want: string }[] = [];
for (let r = hdrRow + 1; r < names.length; r++) {
  const now = S(names[r][trimI]);
  if (!now) continue;
  const want = applyLatinBrandTokens(now);
  if (want === now) continue;
  if (!/GT/i.test(now)) continue;
  hits.push({
    row: r + 1,
    a1: `${a1(trimI)}${r + 1}`,
    model: S(names[r][modelI]),
    sub: S(names[r][subI]),
    now,
    want,
  });
}

console.log(`머리글 행 ${hdrRow + 1} · 세부트림 ${a1(trimI)} · 바꿀 ${hits.length}칸 ${APPLY ? '(반영)' : '(dry-run)'}`);
for (const h of hits) console.log(`  ${h.a1}  ${h.model} / ${h.sub}  ${h.now} → ${h.want}`);

const leftover = names.slice(hdrRow + 1).filter((r) => {
  const t = S(r[trimI]);
  return t.includes('GT Line') || /GT라인/.test(t);
});
if (!APPLY) {
  if (leftover.length && !hits.length) console.log('※ GT Line/GT라인은 있는데 정규화 결과가 같아서 안 바꿈');
  process.exit(0);
}

if (!hits.length) {
  console.log('바꿀 칸 없음');
  process.exit(0);
}

const tab = `'${ENCAR_MASTER_TAB.replace(/'/g, "''")}'`;
for (let i = 0; i < hits.length; i += 400) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${ENCAR_MASTER_SHEET_ID}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: hits.slice(i, i + 400).map((h) => ({ range: `${tab}!${h.a1}`, values: [[h.want]] })),
    }),
  });
}

const after = await loadEncarWorkSheetGrids(api);
const afterNames = (after.names || []).map((r) => (r || []).map(S));
const still = afterNames.slice(hdrRow + 1).filter((r) => S(r[trimI]).includes('GT Line') || /GT라인/.test(S(r[trimI])));
const nowHyphen = afterNames.slice(hdrRow + 1).filter((r) => S(r[trimI]).includes('GT-Line')).length;
console.log(`재조회  GT-Line ${nowHyphen}칸 · 남은 GT Line/GT라인 ${still.length}`);
if (still.length) {
  for (const r of still.slice(0, 10)) console.log(`  남음 ${S(r[modelI])} / ${S(r[subI])} / ${S(r[trimI])}`);
  process.exit(1);
}
