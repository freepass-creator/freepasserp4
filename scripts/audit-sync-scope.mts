/**
 * 동기화가 «재고 전부»를 덮나 — 설정된 탭 범위 vs ERP 재고. 읽기 전용.
 *
 * 「앞으로 어떤 차가 오더라도 받을 수 있어야 한다」의 전제는 «그 차가 동기화 범위 안에 있다»는 것이다.
 * 공급사마다 `sheet_tab` 에 gid 를 지정하는데, 시트 탭이 그보다 많으면 나머지 탭의 차는
 * 영원히 갱신되지 않는다 — 처음 어떻게든 들어왔더라도 그 뒤로는 시트를 안 본다.
 *
 * 그래서 셋을 낸다:
 *   1) 공급사별 시트 탭 수 vs 설정된 gid 수
 *   2) ERP 재고 중 «설정된 탭에 차번이 있는» 비율
 *   3) 설정 밖 탭에만 있는 차 — 동기화 사각지대
 *
 * npx tsx scripts/audit-sync-scope.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plate = (v: unknown) => (S(v).replace(/\s/g, '').match(PLATE) || [''])[0];
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const db = getDatabase();
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<any>;
  };
  const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';

  console.log('\n══ 동기화 범위가 재고를 덮나 ══\n');
  console.log('  공급사            탭  설정  |  ERP재고  설정탭에있음  사각지대');

  let totalStock = 0, totalCovered = 0, totalBlind = 0;

  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const code = S(p.partner_code);
    const name = S(p.partner_name || p.company_name);
    const id = idOf(S(p.sheet_url));
    if (!id) continue;

    const stock = Object.entries(v4)
      .filter(([, r]) => !dead(r) && S(r.provider_company_code) === code)
      .map(([k, r]) => plate(r.car_number) || plate(k))
      .filter(Boolean);

    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title,sheets.properties.sheetId`); } catch { continue; }
    const all = meta.sheets.map((s: any) => ({ title: s.properties.title, gid: String(s.properties.sheetId) }));
    const cfg = S(p.sheet_tab).split(',').map((x) => x.trim()).filter(Boolean);
    // 설정이 비면 «전 탭»으로 본다(어댑터 기본 동작).
    const inScope = cfg.length ? all.filter((t: any) => cfg.includes(t.gid)) : all;

    const scopePlates = new Set<string>();
    for (const t of inScope) {
      let vals: any;
      try { vals = await api(`${id}/values/${encodeURIComponent(`${t.title}!A1:BZ2000`)}`); } catch { continue; }
      for (const r of (vals.values || []) as string[][]) for (const c of r) { const pn = plate(c); if (pn) scopePlates.add(pn); }
    }

    const covered = stock.filter((pn) => scopePlates.has(pn)).length;
    const blind = stock.length - covered;
    totalStock += stock.length; totalCovered += covered; totalBlind += blind;
    const mark = blind ? '❌' : '✅';
    console.log(`  ${mark} ${(code + ' ' + name).padEnd(24).slice(0, 24)} ${String(all.length).padStart(3)} ${String(cfg.length || all.length).padStart(4)}  | ${String(stock.length).padStart(6)} ${String(covered).padStart(11)} ${String(blind).padStart(8)}`);
  }

  console.log(`\n  합계   ERP재고 ${totalStock}대 · 설정탭에 있음 ${totalCovered}대 · ❌사각지대 ${totalBlind}대`);
  console.log(`\n  ※ 사각지대 = 그 공급사 재고인데 동기화가 읽는 탭엔 차번이 없다.`);
  console.log(`     시트에서 사라져도 «부재차단»이 안 걸리고, 옵션·가격이 바뀌어도 반영되지 않는다.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
