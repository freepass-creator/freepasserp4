/**
 * **ERP 사진링크를 판매시트 기준으로 갈아엎는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 「사진 바뀐 거 ERP 랑은 연동 안 돼?? · 지금 기준으로 ERP 를 갈아엎어 줘야지 사진 정보까지」.
 *   실측 2026-08-20 — 아침에 시트에서 «남의 차» 사진링크 90건을 뗐는데 **ERP 는 그대로 들고 있었다**:
 *   35우0775(빌린카 스파크) 상세에 161허1176(스포티지) 사진 24장이 그대로 떴다.
 *   일일 동기는 **값**만 옮긴다 — 사진은 차량번호 «셀 링크»로 다니므로 아예 옮겨지지 않았다.
 *
 * ★판매시트가 정본이다(공급사시트 → 상품시트 → ERP). 판매시트 차량번호 셀의 링크를 그 차의 사진으로 본다.
 *   · 시트에 링크가 있으면 그대로 넣는다
 *   · **시트에 링크가 없으면 ERP 도 비운다** — 남의 차 사진이 남아 있는 것보다 «사진 없음»이 낫다
 *   · 판매시트에 없는 차는 손대지 않는다(그 차는 지금 파는 차가 아니다)
 * ⚠ 판매시트를 못 읽었거나 50대 미만이면 아무것도 하지 않는다 — 0대는 «없다»가 아니라 «모름»이다.
 *
 *   npx tsx scripts/mirror-sales-photos.mts
 *   npx tsx scripts/mirror-sales-photos.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { isPhotoUrl } from '../lib/domain/photo-link-guard';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const sheetJwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const call = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const t = (await sheetJwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    const x = await r.text();
    if (r.ok) return JSON.parse(x);
    if (r.status === 429 && n < 5) { await sleep(20_000 * (n + 1)); continue; }
    throw new Error(`${r.status} ${x.slice(0, 140)}`);
  }
};
const linkOf = (c: Rec | undefined): string => {
  if (!c) return '';
  if (S(c.hyperlink)) return S(c.hyperlink);
  for (const r of (c.textFormatRuns || []) as Rec[]) { const u = S(r.format?.link?.uri); if (u) return u; }
  const u2 = S(c.userEnteredFormat?.textFormat?.link?.uri); if (u2) return u2;
  for (const r of (c.chipRuns || []) as Rec[]) { const u = S(r.chip?.richLinkProperties?.uri); if (u) return u; }
  return '';
};

// ── 판매시트: 차번 → 사진링크(차량번호 셀 링크 · 「사진링크」 열이 있으면 그것도) ──────────
const meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}?fields=sheets.properties(title)`);
const tabs = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter((t) => /^(상품리스트|손오공구독|오플구독)/.test(t));
const wantPhoto = new Map<string, string>();
for (const tab of tabs) {
  const grid = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}?ranges=${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:BZ900`)}&includeGridData=true&fields=${encodeURIComponent('sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link)),chipRuns(chip(richLinkProperties(uri)))))))')}`);
  const rows = ((((grid.sheets || []) as Rec[])[0]?.data || [])[0]?.rowData || []).map((r: Rec) => ((r.values || []) as Rec[]));
  const hi = rows.findIndex((r: Rec[]) => r.some((c) => norm(c.formattedValue) === '차량번호')); if (hi < 0) continue;
  const hdr = rows[hi].map((c: Rec) => norm(c.formattedValue));
  const pi = hdr.indexOf('차량번호'); const li = hdr.indexOf('사진링크');
  for (const r of rows.slice(hi + 1)) {
    const plate = norm(r[pi]?.formattedValue); if (!plate) continue;
    const cell = linkOf(r[pi]);
    const col = li >= 0 ? S(r[li]?.formattedValue) : '';
    const url = isPhotoUrl(cell) ? cell : (isPhotoUrl(col) ? col : '');
    if (!wantPhoto.has(plate)) wantPhoto.set(plate, url);
  }
}
const withPhoto = [...wantPhoto.values()].filter(Boolean).length;
console.log(`■ 판매시트 ${tabs.length}탭 · 차 ${wantPhoto.size}대 (사진 있는 차 ${withPhoto} · 없는 차 ${wantPhoto.size - withPhoto})`);
if (wantPhoto.size < 50) { console.log('⛔ 판매시트를 제대로 못 읽었다 — 아무것도 하지 않는다\n'); process.exit(1); }

// ── ERP 와 대조 ──────────────────────────────────────────────────────────────
const dbTok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbTok}`)).text()) || {};

type Job = { key: string; plate: string; from: string; to: string; kind: '바꿈' | '비움' | '채움' };
const jobs: Job[] = [];
for (const [key, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  if (p._deleted === true || S(p.status) === 'deleted') continue;
  const plate = norm(p.car_number); if (!plate || !wantPhoto.has(plate)) continue;   // 판매시트에 없는 차는 손대지 않는다
  const to = S(wantPhoto.get(plate));
  const from = S(p.photo_link);
  if (from === to) continue;
  jobs.push({ key, plate, from, to, kind: !to ? '비움' : (!from ? '채움' : '바꿈') });
}
const by = (k: Job['kind']) => jobs.filter((j) => j.kind === k).length;
console.log(`\n■ ERP 사진링크 고칠 차 ${jobs.length}대 — 바꿈 ${by('바꿈')} · 채움 ${by('채움')} · 비움 ${by('비움')} ${APPLY ? '(반영)' : '(dry-run)'}`);
for (const j of jobs.slice(0, 25)) console.log(`   ${j.plate.padEnd(10)} ${j.kind}  ${(j.from || '(빈칸)').slice(-28).padEnd(30)} → ${(j.to || '(빈칸)').slice(-28)}`);
if (jobs.length > 25) console.log(`   … 그 밖 ${jobs.length - 25}대`);
writeFileSync('tmp/mirror-sales-photos.json', JSON.stringify(jobs, null, 2));
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply · 되돌릴 값 tmp/mirror-sales-photos.json\n'); process.exit(0); }

let ok = 0, bad = 0;
for (const j of jobs) {
  const r = await fetch(`${DB}/v4/products/${encodeURIComponent(j.key)}.json?access_token=${dbTok}`, {
    method: 'PATCH',
    body: JSON.stringify({ photo_link: j.to, updatedBy: 'mirror-sales-photos', updatedAt: new Date().toISOString() }),
  });
  if (r.ok) ok++; else { bad++; console.log(`   ⚠ ${j.plate} ${r.status} ${(await r.text()).slice(0, 100)}`); }
}
console.log(`\n■ 끝 — 고침 ${ok}대${bad ? ` · 실패 ${bad}` : ''} · 되돌릴 값 tmp/mirror-sales-photos.json\n`);
