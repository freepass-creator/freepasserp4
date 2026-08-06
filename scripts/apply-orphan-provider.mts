/**
 * 공급사 미지정 매물에 공급사코드를 부여한다 — 기본 dry-run, 반영은 --apply.
 *
 * `provider_company_code` 가 비면 **어느 공급사 동기화도 그 차를 안 본다**. 영구 고아이고,
 * 공급사 화면에도 안 뜬다. 공급사코드는 우리가 정하는 값이므로 채워 넣는다.
 *
 * ★부여 규칙 — 위에서부터 먼저 맞는 것을 쓴다. 근거가 강한 순서다.
 *   ① 레코드 키 접두사        `RP011_100신0009` → RP011 · `금강렌터카_…` → 이름으로 파트너 조회
 *   ② 시트 탭 이름이 공급사명  아이카 종합시트의 「리더스렌트카」 탭 → 리더스렌터카(RP008)
 *                            («종합»·«시트1»처럼 공급사명이 아닌 탭은 근거로 안 쓴다)
 *   ③ 그 차번이 실린 시트 주인  탭 이름으로 못 정하면 시트를 관리하는 공급사
 *   ④ 임시코드                위 셋으로 안 되면 `--temp` 값(기본 SP900)
 *
 * 후보가 둘 이상 갈리면 **건너뛴다** — 소유가 바뀌면 원가·수수료가 딸려가므로 추측하지 않는다.
 *
 *   npx tsx scripts/apply-orphan-provider.mts
 *   npx tsx scripts/apply-orphan-provider.mts --apply
 *   ... --temp=SP900
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).toLowerCase().replace(/[\s()（）주식회사㈜]/g, '');
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plate = (v: unknown) => (S(v).replace(/\s/g, '').match(PLATE) || [''])[0];
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const apply = process.argv.includes('--apply');
  const TEMP = (process.argv.find((a) => a.startsWith('--temp=')) || '').split('=')[1] || 'SP900';

  const db = getDatabase();
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  const codes = new Set<string>();
  const byName = new Map<string, string>();          // 정규화 공급사명 → 코드
  for (const p of Object.values(partners)) {
    const c = S(p.partner_code);
    if (!c) continue;
    codes.add(c);
    for (const n of [p.partner_name, p.company_name, p.name]) {
      const k = norm(n);
      if (k && !byName.has(k)) byName.set(k, c);
    }
  }
  const nameOf = (c: string) => S(Object.values(partners).find((x) => S(x.partner_code) === c)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === c)?.company_name) || '(파트너 레코드 없음)';

  const orphans = Object.entries(v4).filter(([, r]) => !dead(r) && !S(r.provider_company_code));

  // ── 시트에서 차번 → [{시트주인, 탭}] 수집 ──
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<any>;
  };
  const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';

  const orphanPlates = new Set(orphans.map(([k, r]) => plate(r.car_number) || plate(k)).filter(Boolean));
  const hits = new Map<string, { owner: string; tab: string }[]>();
  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const owner = S(p.partner_code);
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title`); } catch { continue; }
    for (const tab of meta.sheets.map((s: any) => s.properties.title) as string[]) {
      let vals: any;
      try { vals = await api(`${id}/values/${encodeURIComponent(`${tab}!A1:BZ2000`)}`); } catch { continue; }
      for (const r of (vals.values || []) as string[][]) for (const c of r) {
        const pn = plate(c);
        if (pn && orphanPlates.has(pn)) hits.set(pn, [...(hits.get(pn) || []), { owner, tab }]);
      }
    }
  }

  // ── 부여 ──
  type Plan = { key: string; code: string; via: string; name: string };
  const plans: Plan[] = [];
  const skipped: string[] = [];

  for (const [key, r] of orphans) {
    const pn = plate(r.car_number) || plate(key);
    const label = `${S(r.maker)} ${S(r.model)}`.trim() || '(차종 미상)';

    // ① 키 접두사
    const prefix = key.includes('_') ? key.split('_')[0] : '';
    if (prefix && codes.has(prefix)) { plans.push({ key, code: prefix, via: '① 키 접두사', name: label }); continue; }
    if (prefix && byName.has(norm(prefix))) { plans.push({ key, code: byName.get(norm(prefix))!, via: '① 키 접두사(이름)', name: label }); continue; }

    const list = pn ? (hits.get(pn) || []) : [];
    // ② 탭 이름이 공급사명
    const byTab = new Set(list.map((h) => byName.get(norm(h.tab))).filter(Boolean) as string[]);
    if (byTab.size === 1) { plans.push({ key, code: [...byTab][0], via: '② 탭 이름', name: label }); continue; }
    if (byTab.size > 1) { skipped.push(`   ${(pn || key).padEnd(12)} 탭이 여러 공급사를 가리킴 — ${[...byTab].join(' · ')}`); continue; }

    // ③ 시트 주인
    const owners = new Set(list.map((h) => h.owner));
    if (owners.size === 1) { plans.push({ key, code: [...owners][0], via: '③ 시트 주인', name: label }); continue; }
    if (owners.size > 1) { skipped.push(`   ${(pn || key).padEnd(12)} 여러 시트에 걸침 — ${[...owners].join(' · ')}`); continue; }

    // ④ 임시코드
    plans.push({ key, code: TEMP, via: '④ 임시코드', name: label });
  }

  console.log(`\n══ 공급사 미지정 코드 부여 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  미지정 ${orphans.length}대 → 부여 ${plans.length}대 · 건너뜀 ${skipped.length}대\n`);

  const byVia = new Map<string, number>();
  const byCode = new Map<string, number>();
  for (const p of plans) {
    byVia.set(p.via, (byVia.get(p.via) || 0) + 1);
    byCode.set(p.code, (byCode.get(p.code) || 0) + 1);
  }
  console.log('■ 근거별');
  for (const [v, n] of [...byVia].sort()) console.log(`   ${String(n).padStart(4)}대  ${v}`);
  console.log('\n■ 부여될 공급사');
  for (const [c, n] of [...byCode].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${c.padEnd(10)} ${c === TEMP ? '← 임시' : nameOf(c)}`);

  console.log('\n■ 표본');
  for (const p of plans.slice(0, 12)) console.log(`   ${p.key.slice(0, 26).padEnd(28)} → ${p.code.padEnd(10)} ${p.via}  ${p.name}`);
  if (plans.length > 12) console.log(`   … 그 외 ${plans.length - 12}대`);

  if (skipped.length) {
    console.log(`\n■ 건너뜀 — 후보가 갈려 사람이 판단`);
    for (const s of skipped.slice(0, 12)) console.log(s);
    if (skipped.length > 12) console.log(`   … 그 외 ${skipped.length - 12}대`);
  }

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0;
  const errors: string[] = [];
  for (const p of plans) {
    try { await db.ref(`v4/products/${p.key}`).update({ provider_company_code: p.code }); done++; }
    catch (e) { errors.push(`${p.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  반영 ${done}대`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-sync-scope.mts\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
