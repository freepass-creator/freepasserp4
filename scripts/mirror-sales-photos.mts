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
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';

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
/**
 * ★탭 이름을 손으로 박지 않는다 — 정본은 `SALES_PUBLISHED_TAB_PREFIXES`(4탭)다.
 *   2026-09-01 까지 여기엔 `상품리스트|손오공구독|오플구독` 셋만 박혀 있었다. **픽업구독이 빠져**
 *   손오공 픽업(T카) 차들은 시트에서 사진을 고쳐도 ERP 로 영영 오지 않았다.
 *   (2026-08-30 에 고친 `audit-status-drift` 의 「판매탭 3개」 하드코딩과 **같은 병**이다 —
 *    2026-08-28 에 픽업 탭이 붙으면서 손으로 박은 자리마다 하나씩 어긋났다.)
 */
const tabs = pickPublishedSalesTabs(((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title))).map((t) => t.title);
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
/**
 * ★★**갤러리를 줄이지 않는다** (2026-09-01 실측으로 막은 함정).
 *
 *   ERP `photo_link` 는 사진을 **콤마로 여러 장** 들고 있다(롯데 10장·손오공 10장…).
 *   그런데 판매시트가 주는 것은 차량번호 셀에 걸린 **대표 한 장**뿐이다.
 *   그대로 「정본」이라며 덮으면 **164대가 10장 → 1장**이 된다(픽업구독 탭을 넣고 재본 값).
 *   손님 상세의 사진이 통째로 사라지는 것이라 «갱신»이 아니라 «손실»이다.
 *
 *   그래서 **출처(호스트)가 같은데 장수만 줄어드는 것은 손대지 않는다.**
 *   출처가 «바뀐» 것(남의 차 폴더 → 제 폴더)은 원래 목적이므로 그대로 고친다.
 */
const urlsOf = (v: unknown) => S(v).split(/[\s,]+/).filter(Boolean);
const hostsOf = (v: unknown) => new Set(urlsOf(v).map((u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return u; } }));
const sameHosts = (a: unknown, b: unknown) => { const x = hostsOf(a), y = hostsOf(b); return x.size === y.size && [...x].every((h) => y.has(h)); };
let 갤러리보존 = 0;
for (const [key, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  if (p._deleted === true || S(p.status) === 'deleted') continue;
  const plate = norm(p.car_number); if (!plate || !wantPhoto.has(plate)) continue;   // 판매시트에 없는 차는 손대지 않는다
  const to = S(wantPhoto.get(plate));
  const from = S(p.photo_link);
  if (from === to) continue;
  if (to && from && urlsOf(to).length < urlsOf(from).length && sameHosts(from, to)) { 갤러리보존++; continue; }
  jobs.push({ key, plate, from, to, kind: !to ? '비움' : (!from ? '채움' : '바꿈') });
}
const by = (k: Job['kind']) => jobs.filter((j) => j.kind === k).length;
console.log(`\n■ ERP 사진링크 고칠 차 ${jobs.length}대 — 바꿈 ${by('바꿈')} · 채움 ${by('채움')} · 비움 ${by('비움')} ${APPLY ? '(반영)' : '(dry-run)'}`);
if (갤러리보존) console.log(`   ※ 그대로 둔 차 ${갤러리보존}대 — 시트가 대표 한 장뿐이라 덮으면 갤러리가 줄어든다(같은 출처)`);
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
