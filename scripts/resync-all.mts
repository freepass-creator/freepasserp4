/**
 * **전 공급사 시트 재반영 — 한 프로세스에서.**
 *
 * `for c in ...; do npx tsx apply-sheet-sync ...; done` 를 대체한다.
 * 공급사마다 프로세스를 새로 띄우면 Git Bash 의 fork 가 먼저 무너진다(PC 다운 실측).
 *
 * `apply-sheet-sync.mts` 와 같은 로직을 쓰되, DB 다운로드는 한 번만 한다.
 *
 *   npx tsx scripts/resync-all.mts             dry-run
 *   npx tsx scripts/resync-all.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } from '../lib/domain/sheet-import';
import { importAutoplusMerged, AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } from '../lib/domain/sheet-autoplus';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { planProductUpsert, planAbsentBlocked } from '../lib/domain/sheet-merge';
import type { EntityRecord } from '../lib/intake/entities';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;
type Rec = Record<string, unknown>;

function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}
const mergeN = (a: Record<string, Rec>, b: Record<string, Rec>) => {
  const m: Record<string, Rec> = {};
  for (const [k, v] of Object.entries(a || {})) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries(b || {})) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  console.log('[resync] RTDB 내려받는 중…');
  const [t3, t4, p3, p4, m3, m4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
  ]);
  const v3All = (p3.val() || {}) as Record<string, Rec>;
  const v4All = (p4.val() || {}) as Record<string, Rec>;
  const partners = mergeN((t3.val() || {}) as Record<string, Rec>, (t4.val() || {}) as Record<string, Rec>);
  const master = Object.values(mergeN((m3.val() || {}) as Record<string, Rec>, (m4.val() || {}) as Record<string, Rec>)).filter(Boolean);
  const allLive = Object.values(mergeN(v3All, v4All))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');

  const targets = Object.values(partners)
    .filter((p) => p && p._deleted !== true && S(p.sheet_url))
    .sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)));

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  const backup: Record<string, unknown> = {};
  let totRevive = 0, totCreate = 0, totPatch = 0, totAbsent = 0;

  console.log(`\n공급사        시트   신규  수정  부재  되살림`);
  console.log('─'.repeat(52));

  for (const p of targets) {
    const code = S(p.partner_code) || S(p._key);
    const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) continue;
    const adapter = resolveAdapter(p as never);
    const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
    const fetchTable = async (url: string, gid?: string) => {
      const sid = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || id;
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${sid}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
      if (!res.ok) throw new Error(`CSV ${res.status}`);
      return parseCsv(await res.text());
    };
    const existing = allLive.filter((x) => S(x.provider_company_code) === code || S(x._key).startsWith(`${code}_`));
    const incoming: Rec[] = [];
    let err = '';
    try {
      if (adapter.id === 'autoplus') {
        const r = await importAutoplusMerged({
          url: S(p.sheet_url), providerCode: code, entries: master as never,
          profile: parseMappingProfile(p.mapping_profile), profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
          headerRow: Math.max(0, Number(p.header_row) || 0), depositRule: parseDepositRule(p.deposit_rule), fetchTable,
        });
        incoming.push(...(r.products as Rec[]));
      } else {
        for (const gid of (gids.length ? gids : [''])) {
          const table = adapter.prepareTable(await fetchTable(S(p.sheet_url), gid || undefined), { headerRow: Math.max(0, Number(p.header_row) || 0) });
          if (table.length < 2) continue;
          const r = importSheetTable(table, {
            providerCode: code, entries: master as never,
            profile: parseMappingProfile(p.mapping_profile), profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
            depositRule: parseDepositRule(p.deposit_rule),
          });
          incoming.push(...(r.products as Rec[]));
        }
      }
    } catch (e) { err = String((e as Error).message || e).slice(0, 44); }
    if (err) { console.log(`${code.padEnd(12)} ❌ ${err}`); continue; }

    const plateOf = (x: Rec) => { const c = S(x.car_number).replace(/\s/g, ''); return c && PLATE.test(c) ? c : ''; };
    const upsert = planProductUpsert(incoming as never, existing as never);
    const absent = planAbsentBlocked({
      existing: existing as never, providerCode: code,
      presentKeys: new Set(incoming.map((x) => S(x.product_code) || S(x._key)).filter(Boolean)),
      presentPlates: new Set(incoming.map(plateOf).filter(Boolean)),
    });

    let revived = 0;
    const revive = (key: string) => {
      const t3r = v3All[key], t4r = v4All[key];
      const dead = t4r?._deleted === true || S(t4r?.status) === 'deleted' || !!t4r?.deletedAt
        || t3r?._deleted === true || S(t3r?.status) === 'deleted' || !!t3r?.deletedAt;
      if (!dead) return;
      patch[`products/${key}/_deleted`] = null;
      patch[`products/${key}/deletedAt`] = null;
      patch[`products/${key}/status`] = null;
      patch[`products/${key}/revived_at`] = now;
      revived++;
    };
    const touch = (key: string) => { if (!backup[key]) backup[key] = { v3: v3All[key] ?? null, v4: v4All[key] ?? null }; };

    for (const c of upsert.creates) {
      const key = S(c.product_code) || S(c._key); if (!key) continue;
      touch(key); revive(key);
      for (const [f, v] of Object.entries(c)) if (v !== undefined) patch[`products/${key}/${f}`] = v;
      patch[`products/${key}/_key`] = key; patch[`products/${key}/updatedAt`] = now;
    }
    for (const pt of upsert.patches) {
      const key = S(pt.key); if (!key) continue;
      touch(key); revive(key);
      for (const [f, v] of Object.entries(pt.patch)) if (v !== undefined) patch[`products/${key}/${f}`] = v;
      patch[`products/${key}/updatedAt`] = now;
    }
    for (const ab of absent.patches) {
      const key = S(ab.key); if (!key) continue;
      touch(key);
      for (const [f, v] of Object.entries(ab.patch)) if (v !== undefined) patch[`products/${key}/${f}`] = v;
      patch[`products/${key}/updatedAt`] = now;
    }
    patch[`partners/${S(p._key)}/lastSyncedAt`] = now;

    totCreate += upsert.creates.length; totPatch += upsert.patches.length;
    totAbsent += absent.patches.length; totRevive += revived;
    console.log(`${code.padEnd(12)} ${String(incoming.length).padStart(4)} ${String(upsert.creates.length).padStart(6)} ${String(upsert.patches.length).padStart(5)} ${String(absent.patches.length).padStart(5)} ${String(revived || '').padStart(7)}`);
  }

  console.log('─'.repeat(52));
  console.log(`${'합계'.padEnd(12)}      ${String(totCreate).padStart(6)} ${String(totPatch).padStart(5)} ${String(totAbsent).padStart(5)} ${String(totRevive).padStart(7)}`);
  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }

  writeFileSync('tmp/resync-all-backup.json', JSON.stringify(backup), 'utf8');
  console.log(`\n백업 → tmp/resync-all-backup.json (${Object.keys(backup).length}키)`);
  await db.ref('v4').update(patch);
  console.log('반영 완료\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
