/**
 * **판매시트에 없는 차는 ERP 에서 「출고불가」로 내린다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 「시트랑 똑같이 표현해 주면 되잖아 · 삭제를 하는 게 아니라 상태값을 출고불가로 전환하는 거잖아」.
 *   ERP 상품찾기는 판매시트를 그대로 비춰야 한다. 판매시트에는 «팔 수 있는 차»만 실리므로,
 *   **거기 없는데 상품찾기에 뜨는 차**는 상태를 출고불가로 바꾼다. 줄을 지우지 않는다 — 이력은 남는다.
 *
 * ★왜 일일 동기만으로 안 되나 — 부재처리(`applyAbsentBlocked`)는 **공급사별로** 돈다.
 *   `provider_company_code` 가 **빈 차**(키가 `EXT_…` 꼴)는 어느 공급사 처리에도 안 걸려 영영 남는다.
 *   실측 2026-08-20: 그런 차 6대가 상품찾기에 계속 떠 있었다(109호1983·3861·3835·5381·2576 · 125하2545).
 *
 * ⚠ **계약중은 건드리지 않는다** — 계약이 걸린 차의 상태를 바꾸면 계약 쪽 화면이 어긋난다. 목록만 보여 준다.
 * ⚠ **샘플 공급사(SAMPLE01)는 그대로 둔다** — 샘플계약서용이라 판매시트에 없는 것이 정상이다(사장님 2026-08-20).
 * ⚠ 판매시트를 못 읽었거나 0대면 아무것도 하지 않는다 — 0대는 «없다»가 아니라 «모름»이다.
 *
 *   npx tsx scripts/mirror-sales-absent.mts
 *   npx tsx scripts/mirror-sales-absent.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { pickPublishedSalesTabs } from '../lib/domain/sales-published-tabs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const BLOCKED = '출고불가';
/** 상품찾기에 뜨는 상태 — 이 중 판매시트에 없는 것이 내릴 대상이다. */
const OFFERABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);
/** 손대지 않는 것 — 계약이 걸린 차 · 샘플 공급사. */
const KEEP_STATUS = new Set(['계약중']);
const KEEP_CODES = new Set(['SAMPLE01']);

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbTok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const sheetJwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

// ── 판매시트에 실린 차번 ─────────────────────────────────────────────────────
const sheets = async (u: string): Promise<Rec> => {
  const tok = (await sheetJwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 150)}`);
  return JSON.parse(t);
};
const meta = await sheets(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}?fields=sheets.properties(title)`);
/**
 * ★★탭 이름을 손으로 박지 않는다 — 정본은 `SALES_PUBLISHED_TAB_PREFIXES`(4탭)다.
 *   2026-09-01 까지 여기엔 셋만 박혀 있었다. **픽업구독을 안 읽으니 픽업 차가 통째로
 *   「판매시트에 없는 차」로 보였고**, `--apply` 를 켰다면 손오공 픽업(T카)을 몽땅 「출고불가」로
 *   내릴 뻔했다. 이 자는 «없으면 내리는» 도구라 탭 하나를 빠뜨리는 것이 곧 오출고정지다.
 */
const tabs = pickPublishedSalesTabs(((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title))).map((t) => t.title);
const inSheet = new Set<string>();
for (const tab of tabs) {
  const v = await sheets(`https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}/values/${encodeURIComponent(tab)}`);
  const rows = ((v.values || []) as string[][]);
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === '차량번호')); if (hi < 0) continue;
  const pi = rows[hi].map(norm).indexOf('차량번호');
  for (const r of rows.slice(hi + 1)) { const p = norm(r[pi]); if (p) inSheet.add(p); }
}
console.log(`■ 판매시트 ${tabs.length}탭 · 차 ${inSheet.size}대`);
if (inSheet.size < 50) { console.log('⛔ 판매시트를 제대로 못 읽었다(0대는 «모름»이다) — 아무것도 하지 않는다\n'); process.exit(1); }

// ── ERP 에서 «상품찾기에 뜨는데 시트에 없는 차» ──────────────────────────────
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbTok}`)).text()) || {};
type Hit = { key: string; plate: string; code: string; status: string };
const down: Hit[] = []; const kept: Hit[] = [];
for (const [key, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object') continue;
  if (p._deleted === true || S(p.status) === 'deleted') continue;
  const plate = norm(p.car_number); if (!plate) continue;
  const status = S(p.vehicle_status).replace(/\s+/g, '');
  const code = S(p.provider_company_code);
  if (inSheet.has(plate)) continue;
  if (KEEP_CODES.has(code)) continue;
  const hit: Hit = { key, plate, code: code || '(빈칸)', status };
  if (KEEP_STATUS.has(status)) { kept.push(hit); continue; }
  if (!OFFERABLE.has(status)) continue;
  down.push(hit);
}

console.log(`\n■ 판매시트에 없는데 상품찾기에 뜨는 차 ${down.length}대 → 「${BLOCKED}」 ${APPLY ? '(반영)' : '(dry-run)'}`);
for (const h of down) console.log(`   ${h.plate.padEnd(10)} 공급사 ${h.code.padEnd(10)} ${h.status} → ${BLOCKED}   key=${h.key}`);
if (kept.length) {
  console.log(`\n■ 손대지 않은 차 ${kept.length}대 — 계약이 걸려 있다(사람이 볼 것)`);
  for (const h of kept) console.log(`   ${h.plate.padEnd(10)} 공급사 ${h.code.padEnd(10)} ${h.status}   key=${h.key}`);
}
writeFileSync('tmp/mirror-sales-absent.json', JSON.stringify({ down, kept }, null, 2));
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply · 목록 tmp/mirror-sales-absent.json\n'); process.exit(0); }

for (const h of down) {
  const r = await fetch(`${DB}/v4/products/${encodeURIComponent(h.key)}.json?access_token=${dbTok}`, {
    method: 'PATCH',
    body: JSON.stringify({ vehicle_status: BLOCKED, updatedBy: 'mirror-sales-absent', updatedAt: new Date().toISOString() }),
  });
  if (!r.ok) { console.log(`   ⚠ ${h.plate} — ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
}
console.log(`\n■ 끝 — ${down.length}대를 「${BLOCKED}」로 내렸다(줄은 지우지 않았다) · 되돌릴 값 tmp/mirror-sales-absent.json\n`);
