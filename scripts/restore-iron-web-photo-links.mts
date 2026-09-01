/**
 * **아이언 사진링크를 «홈페이지 상세주소»로 되돌린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-23 「외부사진 구글드라이브 넣은 거 번호 다 틀렸다 · 다시 작업하는 중 ·
 *   너는 일단 **기존 링크로 대체해라 · 원본 링크로** · 모드렌트카랑 아이언 거」
 *   「**아이언은 홈피 링크를 걸었었어**」 · 「지금 코덱스가 잘못된 거 고치고 있고」
 *
 *   드라이브에 올린 사진이 **엉뚱한 차번**에 붙었다. 코덱스가 드라이브 쪽을 바로잡는 동안,
 *   아이언은 원래대로 **홈페이지 상세주소**를 걸어 둔다 — 그 주소는 차번으로 맞춘 것이라 틀릴 일이 없다.
 *
 * ★차번은 **홈페이지에서 읽은 값과 시트 값을 맞춰서만** 바꾼다(`fetchIronRentcarCatalog`).
 *   ⚠ 사진링크 사고의 근원은 «누구 차인지 확인 안 하고 붙인 것»이다(2026-08-20 남의 차 86건).
 *     여기서도 차번이 안 맞으면 **건드리지 않는다.**
 *
 * ⚠ 고치는 곳은 **공급사 시트**다(정본). ERP 를 직접 고치면 다음 동기가 덮는다.
 *   반영 뒤 발행 → ERP 동기를 돌려야 화면에 나온다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/restore-iron-web-photo-links.mts
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/restore-iron-web-photo-links.mts --apply
 *
 * ★`--erp` 를 함께 주면 **ERP 에도 직접 넣는다.**
 *   유입은 판매시트 경로에서 사진을 일부러 버린다(`sheet-import`: 「번호판·폴더 증거를 검증하기 전까지
 *   판매 정본에서 ERP 로 자동 반영하지 않는다 — 기존 ERP 사진은 그대로 두며 **승인된 사진만 별도 복구
 *   작업으로 반영**한다」). 여기가 그 «별도 복구»다 — 차번을 홈페이지 값과 맞춘 것만 넣으므로 승인 조건을 만족한다.
 *   유입이 photo_link 를 안 건드리므로 다음 동기가 덮지 않는다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { fetchIronRentcarCatalog } from '../lib/server/ironrentcar-source';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

const APPLY = process.argv.includes('--apply');
const TO_ERP = process.argv.includes('--erp');
const S = (v: unknown) => String(v ?? '').trim();
const plateKey = (v: unknown) => S(v).replace(/\s+/g, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const api = async (u: string, init?: RequestInit): Promise<any> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(3000 * 2 ** n); continue; }
    throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
/** 열 번호 → A1 글자. 사진링크는 뒤쪽 열이라 **두 글자**가 나온다. */
const colA1 = (i: number) => { let s = ''; for (let n = i + 1; n > 0;) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;

// ── ① 홈페이지에서 차번 ↔ 상세주소
const cat = await fetchIronRentcarCatalog();
const items = (cat as any)?.items || (Array.isArray(cat) ? cat : []);
const urlOf = new Map<string, string>();
for (const it of items) {
  const p = (it as any)?.product || it;
  const plate = plateKey(p?.car_number);
  const url = S(p?.source_url || p?.url || (it as any)?.url || (it as any)?.listing?.url);
  if (plate && url) urlOf.set(plate, url);
}
console.log(`■ 아이언 사진링크 되돌리기 — 홈페이지에서 ${urlOf.size}대의 상세주소를 읽었다\n`);

// ── ② 아이언 시트 찾기
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const file = (found.files || []).find((f: any) => /아이언/.test(supplierSheetLabel(S(f.name))));
if (!file) throw new Error('아이언 시트를 못 찾았다');

const meta = await api(`${SH}/${S(file.id)}?fields=sheets.properties(title,hidden)`);
const tab = (meta.sheets || []).map((s: any) => S(s.properties.title))
  .find((t: string) => !isOurNonInventoryTab(t) && !(meta.sheets || []).find((s: any) => S(s.properties.title) === t)?.properties.hidden);
if (!tab) throw new Error('아이언 재고 탭을 못 찾았다');

const got = await api(`${SH}/${S(file.id)}/values/${encodeURIComponent(`${a1Tab(tab)}!A1:CZ700`)}`) as { values?: string[][] };
const rows = ((got.values || []) as string[][]).map((r) => (r || []).map(S));
const hi = rows.findIndex((r) => r.includes('차량번호'));
if (hi < 0) throw new Error('머리글에 「차량번호」가 없다');
const head = rows[hi];
const ip = head.indexOf('차량번호');
const ic = head.findIndex((h) => /사진링크|사진|이미지/.test(h));
if (ic < 0) throw new Error('사진 열을 못 찾았다');
console.log(`  시트 「${tab}」 · 사진 열 「${head[ic]}」\n`);

// ── ③ 차번이 맞는 줄만 바꾼다
const updates: { range: string; values: string[][] }[] = [];
const same: string[] = []; const miss: string[] = []; const changed: string[] = [];
for (let r = hi + 1; r < rows.length; r++) {
  const plate = plateKey(rows[r][ip]);
  if (!plate) continue;
  const want = urlOf.get(plate);
  if (!want) { miss.push(plate); continue; }
  const now = S(rows[r][ic]);
  if (now === want) { same.push(plate); continue; }
  changed.push(`  ${plate}  ${now.slice(0, 46) || '(빈칸)'} ▶ ${want.slice(0, 60)}`);
  updates.push({ range: `${a1Tab(tab)}!${colA1(ic)}${r + 1}`, values: [[want]] });
}
console.log(`  바꿀 줄 ${updates.length} · 이미 같음 ${same.length} · 홈페이지에 없는 차 ${miss.length}`);
changed.slice(0, 10).forEach((l) => console.log(l));
if (changed.length > 10) console.log(`  … 외 ${changed.length - 10}줄`);
if (miss.length) console.log(`\n  ⚠ 홈페이지에 없어 **안 건드린** 차: ${miss.slice(0, 8).join(' · ')}${miss.length > 8 ? ` 외 ${miss.length - 8}` : ''}`);

if (!APPLY) { console.log('\n  (미리보기다 — 반영하려면 --apply)'); process.exit(0); }
// ⚠ 시트에 바꿀 게 없어도 **ERP 반영은 따로 돌려야 한다** — 시트는 맞는데 ERP 만 빈 경우가 있다
//   (유입이 판매시트 사진을 일부러 버리므로 그 상태가 «정상»이다). 여기서 빠져나가면 --erp 가 안 돈다.
if (!updates.length && !TO_ERP) { console.log('\n  바꿀 것이 없다.'); process.exit(0); }

if (updates.length) {
  await api(`${SH}/${S(file.id)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
  });
  console.log(`\n  ✓ 시트 ${updates.length}줄 바꿨다.`);
} else {
  console.log('\n  시트는 이미 맞다.');
}
if (TO_ERP) {
  /**
   * ★**ERP 에 직접 넣는다** — 차번이 홈페이지 값과 맞는 줄만.
   * ⚠ 유입은 판매시트 경로에서 사진을 일부러 버린다(`sheet-import`: 「번호판·폴더 증거를 검증하기 전까지
   *   판매 정본에서 ERP 로 자동 반영하지 않는다 — 기존 ERP 사진은 그대로 두며 **승인된 사진만 별도 복구
   *   작업으로 반영**한다」). 그래서 시트만 고치면 화면엔 안 나온다. 여기가 그 «별도 복구»다.
   *   차번 대조를 통과한 것만 넣으므로 승인 조건을 만족하고, 유입이 안 건드리니 다음 동기가 안 덮는다.
   */
  const dbJwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
  const dbTok = (await dbJwt.getAccessToken()).token;
  const products = await (await fetch(`${DB}/v4/products.json?access_token=${dbTok}`)).json() as Record<string, any>;
  const patch: Record<string, string> = {};
  const sample: string[] = [];
  for (const [key, p] of Object.entries(products || {})) {
    const plate = plateKey((p as any).car_number);
    const want = urlOf.get(plate);
    if (!want || S((p as any).photo_link) === want) continue;
    patch[`${key}/photo_link`] = want;
    if (sample.length < 5) sample.push(`     ${plate} ▶ ${want.slice(0, 62)}`);
  }
  const n = Object.keys(patch).length;
  if (!n) console.log('\n  ERP 도 이미 맞다.');
  else {
    const r = await fetch(`${DB}/v4/products.json?access_token=${dbTok}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`ERP 반영 실패 ${r.status} ${(await r.text()).slice(0, 160)}`);
    console.log(`\n  ✓ ERP ${n}대 사진링크 반영`);
    sample.forEach((l) => console.log(l));
  }
} else {
  console.log('  ⚠ ERP 에는 아직 안 들어갔다 — 유입이 판매시트 사진을 버리므로 `--erp` 를 함께 줘야 화면에 나온다.');
}
