/**
 * 시트에 적힌 옵션을 ERP 에 채운다 — 기본 dry-run, 반영은 --apply.
 *
 * 옵션은 손님 견적서에 그대로 나가는 값인데 ERP 에 3분의 2가 비어 있었다(실측 563/846).
 * 시트가 정본이므로 값을 만들지 않고 옮긴다.
 *
 * ★안전 계약
 *   · ERP 에 **이미 옵션이 있으면 건드리지 않는다**(공급사가 화면에서 고친 값을 시트로 덮지 않는다).
 *   · 같은 차번이 여러 탭에 나올 때, **띄어쓰기·순서·줄바꿈만 다른 것은 같은 값**으로 본다
 *     (토큰 집합 비교). 그중 가장 정보가 많은 표기를 쓴다.
 *   · 토큰 집합이 실제로 다르면 **건너뛴다** — 어느 쪽이 맞는지는 사람이 정한다.
 *     틀린 옵션을 손님에게 보내는 것이 빈칸보다 나쁘다.
 *   · 쓰는 필드는 `options` 하나.
 *
 *   npx tsx scripts/apply-sheet-options.mts
 *   npx tsx scripts/apply-sheet-options.mts --apply
 *   ... --conflicts tmp/option-conflicts.csv   충돌분을 파일로
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';
import { HEADER_ALIASES } from '../lib/domain/sheet-import';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plate = (v: unknown) => (S(v).replace(/\s/g, '').match(PLATE) || [''])[0];
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const csvCell = (v: unknown) => `"${S(v).replace(/"/g, '""')}"`;

/** 표기 차이를 걷어낸 «옵션 집합» — 구분자(,/+·줄바꿈)로 쪼개 공백 제거 후 정렬. */
const optionKey = (raw: string) => S(raw)
  .split(/[,\n/+·]/)
  .map((t) => norm(t))
  .filter(Boolean)
  .sort()
  .join('|');

const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const apply = process.argv.includes('--apply');
  const conflictOut = process.argv.includes('--conflicts') ? process.argv[process.argv.indexOf('--conflicts') + 1] : '';

  const db = getDatabase();
  const [v4s, pl, po] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  const live = (pl.val() || {}) as Record<string, Rec>;
  const over = (po.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) partners[k] = { ...(live[k] || {}), ...(over[k] || {}) };

  /** ERP: 차번 → 레코드 키(살아있고 옵션이 빈 것만 대상) */
  const target = new Map<string, { key: string; name: string }>();
  for (const [k, p] of Object.entries(v4)) {
    if (dead(p)) continue;
    const pn = plate(p.car_number) || plate(k);
    if (!pn) continue;
    if (S(p.options)) continue;                    // 이미 있으면 대상 아님
    target.set(pn, { key: k, name: `${S(p.maker)} ${S(p.model)}`.trim() });
  }

  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await jwt.authorize();
  const token = (await jwt.getAccessToken()).token;
  const api = async (p: string) => {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json() as Promise<any>;
  };
  const idOf = (u: string) => (u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';

  /** 차번 → 시트에서 본 옵션 표기들 */
  const seen = new Map<string, string[]>();
  for (const p of Object.values(partners)) {
    if (!S(p.sheet_url) || dead(p)) continue;
    const id = idOf(S(p.sheet_url));
    if (!id) continue;
    let meta: any;
    try { meta = await api(`${id}?fields=sheets.properties.title`); } catch { continue; }
    for (const tab of meta.sheets.map((s: any) => s.properties.title) as string[]) {
      let vals: any;
      try { vals = await api(`${id}/values/${encodeURIComponent(`${tab}!A1:BZ2000`)}`); } catch { continue; }
      const rows: string[][] = vals.values || [];
      if (!rows.length) continue;
      let best = 0, hits = -1;
      rows.forEach((r, i) => { const h = r.filter((c) => (HEADER_ALIASES as Rec)[norm(c)]).length; if (h > hits) { hits = h; best = i; } });
      const hdr = rows[best] || [];
      const iPlate = hdr.findIndex((c) => (HEADER_ALIASES as Rec)[norm(c)] === 'car_number');
      const iOpts = hdr.findIndex((c) => (HEADER_ALIASES as Rec)[norm(c)] === 'options');
      if (iPlate < 0 || iOpts < 0) continue;
      for (const r of rows.slice(best + 1)) {
        const pn = plate(r[iPlate]);
        const so = S(r[iOpts]);
        if (!pn || !so || !target.has(pn)) continue;
        seen.set(pn, [...(seen.get(pn) || []), so]);
      }
    }
  }

  const fill: { plate: string; key: string; name: string; opts: string }[] = [];
  const conflicts: { plate: string; name: string; values: string[] }[] = [];
  for (const [pn, list] of seen) {
    const t = target.get(pn)!;
    const keys = new Set(list.map(optionKey));
    if (keys.size === 1) {
      // 같은 값 — 가장 정보가 많은 표기를 쓴다(줄바꿈은 쉼표로 편다).
      const pick = [...list].sort((a, b) => b.length - a.length)[0];
      fill.push({ plate: pn, key: t.key, name: t.name, opts: pick.replace(/\s*\n\s*/g, ', ').trim() });
    } else {
      conflicts.push({ plate: pn, name: t.name, values: [...new Set(list)] });
    }
  }

  console.log(`\n══ 시트 옵션 채우기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  ERP 에 옵션이 빈 차 중 시트에 값이 있는 것   ${seen.size}대`);
  console.log(`  ├ ✅ 채울 수 있음(표기만 다름 포함)          ${fill.length}대`);
  console.log(`  └ ⏸ 값이 실제로 갈려 건너뜀                 ${conflicts.length}대\n`);

  console.log('■ 채울 표본');
  for (const f of fill.slice(0, 10)) console.log(`   ${f.plate.padEnd(10)} ${f.name.padEnd(16)} «${f.opts.slice(0, 52)}»`);
  if (fill.length > 10) console.log(`   … 그 외 ${fill.length - 10}대`);

  if (conflicts.length) {
    console.log('\n■ 건너뛴 것 — 사람이 정해야 한다');
    for (const c of conflicts.slice(0, 5)) {
      console.log(`   ${c.plate} ${c.name}`);
      for (const v of c.values) console.log(`      «${v.replace(/\s*\n\s*/g, ' / ').slice(0, 66)}»`);
    }
    if (conflicts.length > 5) console.log(`   … 그 외 ${conflicts.length - 5}대`);
    if (conflictOut) {
      const head = '차번,차명,표기1,표기2,표기3\n';
      const body = conflicts.map((c) => [c.plate, c.name, ...c.values.slice(0, 3)].map(csvCell).join(',')).join('\n');
      writeFileSync(conflictOut, head + body, 'utf8');
      console.log(`\n   충돌 전량 → ${conflictOut}`);
    }
  }

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  let done = 0;
  const errors: string[] = [];
  for (const f of fill) {
    try { await db.ref(`v4/products/${f.key}`).update({ options: f.opts }); done++; }
    catch (e) { errors.push(`${f.key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  반영 ${done}대`);
  if (errors.length) { console.log(`  ❌ 오류 ${errors.length}건`); for (const e of errors.slice(0, 10)) console.log(`     ${e}`); }
  console.log(`\n끝. 확인: npx tsx scripts/audit-options-vs-sheet.mts\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
