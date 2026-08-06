/**
 * 공급사 미지정 매물의 실소유를 시트에서 역추적한다. 읽기 전용.
 *
 * `provider_company_code` 가 비면 어느 공급사 동기화도 그 차를 안 본다 — 영구 고아다.
 * 그런데 차번은 어딘가의 공급사 시트에 적혀 있다. 그 시트의 주인이 실소유다.
 * 아이카 종합시트처럼 «탭 이름이 곧 공급사»인 경우도 있어 탭 이름까지 같이 낸다.
 *
 * npx tsx scripts/audit-orphan-owner.mts
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

  const orphans = Object.entries(v4).filter(([, r]) => !dead(r) && !S(r.provider_company_code));
  const orphanPlates = new Map<string, string>();   // 차번 → 레코드키
  for (const [k, r] of orphans) {
    const pn = plate(r.car_number) || plate(k);
    if (pn) orphanPlates.set(pn, k);
  }

  console.log(`\n══ 공급사 미지정 매물의 실소유 역추적 ══\n`);
  console.log(`  미지정 ${orphans.length}대 · 그중 차번이 있는 것 ${orphanPlates.size}대\n`);

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<any>;
  };
  const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';

  /** 차번 → [ "공급사코드/탭" ] */
  const found = new Map<string, string[]>();
  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const code = S(p.partner_code);
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title`); } catch { continue; }
    for (const tab of meta.sheets.map((s: any) => s.properties.title) as string[]) {
      let vals: any;
      try { vals = await api(`${id}/values/${encodeURIComponent(`${tab}!A1:BZ2000`)}`); } catch { continue; }
      for (const r of (vals.values || []) as string[][]) {
        for (const c of r) {
          const pn = plate(c);
          if (pn && orphanPlates.has(pn)) found.set(pn, [...(found.get(pn) || []), `${code}/${tab}`]);
        }
      }
    }
  }

  const resolved: string[] = [];
  const ambiguous: string[] = [];
  const unknown: string[] = [];
  for (const [pn, key] of orphanPlates) {
    const hits = [...new Set(found.get(pn) || [])];
    // 탭 이름이 다른 공급사를 가리키는 종합시트는 «탭 이름»이 실소유 힌트다.
    const owners = new Set(hits.map((h) => h.split('/')[0]));
    if (!hits.length) unknown.push(`   ${pn.padEnd(10)} ${key}`);
    else if (owners.size === 1 && hits.length === 1) resolved.push(`   ${pn.padEnd(10)} → ${hits[0]}`);
    else ambiguous.push(`   ${pn.padEnd(10)} → ${hits.join(' · ')}`);
  }

  console.log(`■ 시트 한 곳에서만 발견 — 소유 확정 가능   ${resolved.length}대`);
  for (const r of resolved.slice(0, 12)) console.log(r);
  if (resolved.length > 12) console.log(`   … 그 외 ${resolved.length - 12}대`);

  console.log(`\n■ 여러 시트·탭에 걸침 — 사람이 판단   ${ambiguous.length}대`);
  for (const r of ambiguous.slice(0, 12)) console.log(r);
  if (ambiguous.length > 12) console.log(`   … 그 외 ${ambiguous.length - 12}대`);

  console.log(`\n■ 어느 시트에도 없음 — 임시코드 대상   ${unknown.length}대`);
  for (const r of unknown.slice(0, 12)) console.log(r);
  if (unknown.length > 12) console.log(`   … 그 외 ${unknown.length - 12}대`);

  const noPlate = orphans.length - orphanPlates.size;
  if (noPlate) console.log(`\n■ 차번조차 없음 — 임시코드 대상   ${noPlate}대`);
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
