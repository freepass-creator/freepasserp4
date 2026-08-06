/**
 * 종합시트 탭 이름으로 실소유 공급사를 되돌린다 — 기본 dry-run, 반영은 --apply.
 *
 * 아이카(RP004) 시트는 공급사별 탭이 든 «종합 시트»다(탭 24개). 그 시트로 들어온 차가
 * 전부 RP004 소유로 잡혀 있는데, 실제 주인은 탭 이름이 가리키는 공급사다.
 *
 * 그 결과 두 가지가 깨졌다:
 *   · 동기화 사각지대 — RP004 동기화는 설정된 탭 하나만 읽어 나머지 탭의 차를 영영 안 본다.
 *     실소유 공급사에게 돌려주면 그 공급사 자기 시트 동기화가 매일 본다.
 *   · 공급사 화면 — 남의 차가 아이카 재고로 보이고, 정작 주인은 자기 차를 못 본다.
 *
 * ★안전 계약
 *   · **탭 이름이 등록된 공급사명과 맞을 때만** 옮긴다. 「종합」·「샘플」·「시트1」은 근거가 아니다.
 *   · 후보가 둘 이상이면 건너뛴다.
 *   · 계약이 걸린 차(`locked_by_contract`·계약중)는 건드리지 않는다 — 소유가 바뀌면 정산 귀속이 딸려간다.
 *   · 쓰는 필드는 `provider_company_code` 하나.
 *
 *   npx tsx scripts/apply-reattribute-by-tab.mts
 *   npx tsx scripts/apply-reattribute-by-tab.mts --apply
 *   ... --from=RP004        기준 시트 주인(기본 RP004)
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
const plate = (p: Rec, key: string) => {
  for (const src of [p?.car_number, key, p?.product_code]) {
    const m = S(src).replace(/\s/g, '').match(PLATE);
    if (m) return m[0];
  }
  return '';
};
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const contractHeld = (r: Rec) => !!S(r.locked_by_contract) || S(r.vehicle_status).replace(/\s/g, '') === '계약중';
/** 공급사명이 아닌 탭 — 소유 근거로 쓰지 않는다. */
const GENERIC_TAB = /^(종합|샘플|시트\d*|sheet\d*|기본|목록)$/i;

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const apply = process.argv.includes('--apply');
  const FROM = (process.argv.find((a) => a.startsWith('--from=')) || '').split('=')[1] || 'RP004';

  const db = getDatabase();
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  /** 정규화 공급사명 → 코드. 탭 이름을 여기에 맞춘다. */
  const byName = new Map<string, string>();
  for (const p of Object.values(partners)) {
    const c = S(p.partner_code);
    if (!c) continue;
    for (const n of [p.partner_name, p.company_name, p.name]) {
      const k = norm(n);
      if (k && !byName.has(k)) byName.set(k, c);
    }
  }
  const nameOf = (c: string) => S(Object.values(partners).find((x) => S(x.partner_code) === c)?.partner_name
    || Object.values(partners).find((x) => S(x.partner_code) === c)?.company_name) || c;

  const src = Object.values(partners).find((p) => S(p.partner_code) === FROM);
  const id = (S(src?.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1];
  if (!id) { console.log(`${FROM} 시트 없음`); return; }

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<any>;
  };

  const meta = await api(`${id}?fields=sheets.properties.title,sheets.properties.sheetId`);
  const tabs = meta.sheets.map((s: any) => ({ title: s.properties.title as string, gid: String(s.properties.sheetId) }));
  const cfg = S(src?.sheet_tab).split(',').map((x) => x.trim()).filter(Boolean);

  console.log(`\n══ ${FROM} ${nameOf(FROM)} 종합시트 탭별 실소유 되돌리기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  탭 ${tabs.length}개 · 동기화 설정 gid ${cfg.length || '전체'}\n`);

  /** 차번 → 그 차번이 나온 «공급사명 탭»들 */
  const owners = new Map<string, Set<string>>();
  console.log('■ 탭 → 공급사 매핑');
  for (const t of tabs) {
    const code = byName.get(norm(t.title));
    const generic = GENERIC_TAB.test(t.title.trim());
    const inCfg = cfg.length ? cfg.includes(t.gid) : true;
    console.log(`   ${t.title.padEnd(16).slice(0, 16)} ${inCfg ? '[동기화]' : '        '} ${generic ? '· 공급사명 아님' : code ? `→ ${code} ${nameOf(code)}` : '· 매칭 실패'}`);
    if (!code || generic) continue;
    let vals: any;
    try { vals = await api(`${id}/values/${encodeURIComponent(`${t.title}!A1:BZ2000`)}`); } catch { continue; }
    for (const r of (vals.values || []) as string[][]) for (const c of r) {
      const pn = (S(c).replace(/\s/g, '').match(PLATE) || [''])[0];
      if (pn) owners.set(pn, (owners.get(pn) || new Set()).add(code));
    }
  }

  const plans: { key: string; from: string; to: string; plate: string; name: string }[] = [];
  const skipped: string[] = [];
  for (const [key, r] of Object.entries(v4)) {
    if (dead(r) || S(r.provider_company_code) !== FROM) continue;
    const pn = plate(r, key);
    if (!pn) continue;
    const cand = owners.get(pn);
    if (!cand || !cand.size) continue;
    if (cand.has(FROM)) continue;                       // 자기 탭에도 있으면 그대로 둔다
    if (cand.size > 1) { skipped.push(`   ${pn.padEnd(10)} 후보 여럿 — ${[...cand].join(' · ')}`); continue; }
    if (contractHeld(r)) { skipped.push(`   ${pn.padEnd(10)} 계약 걸림 — 소유 유지`); continue; }
    plans.push({ key, from: FROM, to: [...cand][0], plate: pn, name: `${S(r.maker)} ${S(r.model)}`.trim() });
  }

  console.log(`\n■ 되돌릴 대상 ${plans.length}대 · 건너뜀 ${skipped.length}대`);
  const byTo = new Map<string, number>();
  for (const p of plans) byTo.set(p.to, (byTo.get(p.to) || 0) + 1);
  for (const [c, n] of [...byTo].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대 → ${c.padEnd(9)} ${nameOf(c)}`);
  console.log('\n■ 표본');
  for (const p of plans.slice(0, 10)) console.log(`   ${p.plate.padEnd(10)} ${p.name.padEnd(18)} ${p.from} → ${p.to}`);
  if (plans.length > 10) console.log(`   … 그 외 ${plans.length - 10}대`);
  if (skipped.length) { console.log('\n■ 건너뜀'); for (const s of skipped.slice(0, 10)) console.log(s); if (skipped.length > 10) console.log(`   … 그 외 ${skipped.length - 10}대`); }

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0;
  const errors: string[] = [];
  for (const p of plans) {
    try { await db.ref(`v4/products/${p.key}`).update({ provider_company_code: p.to }); done++; }
    catch (e) { errors.push(`${p.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  반영 ${done}대`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-sync-scope.mts\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
