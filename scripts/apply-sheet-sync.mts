/**
 * **시트를 읽어 우리 데이터에 반영한다** — 공급사 하나씩.
 *
 * fp4 는 이 반영을 사실상 한 번도 하지 않았다(`partner.lastSyncedAt` 16곳 중 14곳 없음,
 * 부재차단 표식 0건). 그래서 화면 숫자가 «시트를 읽은 결과»가 아니라 erp3 가 v3 에 남긴
 * 낡은 스냅샷이었고, 실재고와 어긋났다.
 *
 * `preview-sheet-sync.mts` 와 **같은 경로**를 쓴다 — 미리보기 숫자와 반영 결과가 달라지면
 * 미리보기가 무의미하다. 반영 전에 반드시 미리보기로 확인할 것.
 *
 * 안전장치:
 *   · `--apply` 없이는 아무것도 쓰지 않는다.
 *   · 부재차단은 `planAbsentBlocked` 의 보호를 그대로 탄다 — 락 있거나 `계약중` 인 매물은 안 내린다.
 *   · 반영 전 대상 스냅샷을 백업 파일로 남긴다.
 *
 *   npx tsx scripts/apply-sheet-sync.mts --code=RP023            미리보기(=preview 와 동일)
 *   npx tsx scripts/apply-sheet-sync.mts --code=RP023 --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const APPLY = process.argv.includes('--apply');
const CODE = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

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

async function main() {
  if (!CODE) { console.log('--code=<공급사코드> 필요'); return; }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  const db = getDatabase();

  const { importSheetTable, parseMappingProfile, parseMappingHeaderSignature, parseDepositRule } = await import('../lib/domain/sheet-import');
  const { importAutoplusMerged, AUTOPLUS_GID_MAIN, AUTOPLUS_GID_PROMO } = await import('../lib/domain/sheet-autoplus');
  const { resolveAdapter } = await import('../lib/domain/sheet-adapters');
  const { planProductUpsert, planAbsentBlocked } = await import('../lib/domain/sheet-merge');
  type Rec = Record<string, unknown>;

  const merge = (a: unknown, b: unknown) => {
    const m: Record<string, Rec> = {};
    for (const [k, v] of Object.entries((a || {}) as Record<string, Rec>)) m[k] = { ...v, _key: k };
    for (const [k, v] of Object.entries((b || {}) as Record<string, Rec>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
    return m;
  };
  const [t3, t4, p3, p4, m3, m4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
  ]);
  const partners = merge(t3.val(), t4.val());
  const p = partners[CODE] || Object.values(partners).find((x) => S(x.partner_code) === CODE);
  if (!p) { console.log(`${CODE} 없음`); return; }
  const master = Object.values(merge(m3.val(), m4.val())).filter(Boolean);
  const existing = Object.values(merge(p3.val(), p4.val()))
    .filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted')
    .filter((x) => S(x.provider_company_code) === CODE || S(x._key).startsWith(`${CODE}_`));

  // ── 시트 유입 (preview 와 동일 경로)
  const adapter = resolveAdapter(p as never);
  const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
  const fetchTable = async (url: string, gid?: string, options: { visibleRowsOnly?: boolean } = {}) => {
    if (options.visibleRowsOnly) {
      throw new Error('오토플러스 숨김 행 제외는 관리자 상품 검증/API 경로로만 실행하세요');
    }
    const sid = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || id;
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sid}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
    if (!res.ok) throw new Error(`CSV ${res.status}`);
    return parseCsv(await res.text());
  };
  const incoming: Rec[] = [];
  let srcRows = 0, excluded = 0, noPrice = 0, invalid = 0, dup = 0;
  if (adapter.id === 'autoplus') {
    const r = await importAutoplusMerged({
      url: S(p.sheet_url), providerCode: CODE, entries: master as never,
      profile: parseMappingProfile(p.mapping_profile),
      profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
      headerRow: Math.max(0, Number(p.header_row) || 0),
      depositRule: parseDepositRule(p.deposit_rule),
      fetchTable,
    });
    srcRows = r.total; excluded = r.excludedCount; noPrice = r.noPriceCount; invalid = r.invalidCount; dup = r.duplicateCount;
    incoming.push(...(r.products as Rec[]));
  } else {
    for (const gid of (gids.length ? gids : [''])) {
      const table = adapter.prepareTable(await fetchTable(S(p.sheet_url), gid || undefined), { headerRow: Math.max(0, Number(p.header_row) || 0) });
      if (table.length < 2) continue;
      const r = importSheetTable(table, {
        providerCode: CODE, entries: master as never,
        profile: parseMappingProfile(p.mapping_profile),
        profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
        depositRule: parseDepositRule(p.deposit_rule),
      });
      srcRows += r.total; excluded += r.excludedCount; noPrice += r.noPriceCount;
      invalid += r.invalidCount; dup += r.duplicateCount;
      incoming.push(...(r.products as Rec[]));
    }
  }

  const plateOf = (x: Rec) => { const c = S(x.car_number).replace(/\s/g, ''); return c && PLATE.test(c) ? c : ''; };
  const upsert = planProductUpsert(incoming as never, existing as never);
  const presentKeys = new Set(incoming.map((x) => S(x.product_code) || S(x._key)).filter(Boolean));
  const presentPlates = new Set(incoming.map(plateOf).filter(Boolean));
  const absent = planAbsentBlocked({ existing: existing as never, providerCode: CODE, presentKeys, presentPlates });

  console.log(`\n══ ${CODE} ${S(p.name) || S(p.partner_name)} — 시트 반영 ══`);
  console.log(`  시트 ${srcRows}행 → 올림 ${incoming.length}  (출고불가 제외 ${excluded} · 가격없음 ${noPrice} · 무효 ${invalid} · 중복 ${dup})`);
  console.log(`  신규 ${upsert.creates.length} · 수정 ${upsert.patches.length}`);
  console.log(`  부재차단 ${absent.patches.length} · 계약락 보류 ${absent.skipped_locked} · 이미 출고불가 ${absent.already_blocked}`);

  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply'); return; }

  // 백업 — 건드릴 키의 현재 스냅샷
  const touched = new Set<string>([
    ...upsert.patches.map((x) => S(x.key)),
    ...absent.patches.map((x) => S(x.key)),
  ]);
  const backup: Record<string, unknown> = {};
  for (const k of touched) backup[k] = { v3: ((p3.val() || {}) as Rec)[k] ?? null, v4: ((p4.val() || {}) as Rec)[k] ?? null };
  writeFileSync(`tmp/sync-${CODE}-backup.json`, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n백업 → tmp/sync-${CODE}-backup.json (${touched.size}키)`);

  // ── 반영: v4 오버레이 멀티패스. v3 는 건드리지 않는다.
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  const v3All = (p3.val() || {}) as Record<string, Rec>;
  const v4All = (p4.val() || {}) as Record<string, Rec>;

  /**
   * 톰스톤 해제 — **시트에 살아 있는 차면 삭제 표식을 걷어낸다.**
   *
   * 예전 일괄 정리가 남긴 `_deleted`/`status=deleted` 위에 시트 값만 덮으면
   * 값은 들어가는데 삭제 상태로 남아 화면에 안 뜬다(실제로 아이카 6대가 그랬다).
   * 시트가 원본이라는 원칙에 따라, 시트가 그 차를 팔 수 있다고 하면 살린다.
   */
  const reviveIfTombstoned = (key: string): boolean => {
    const t3 = v3All[key], t4 = v4All[key];
    const dead = t4?._deleted === true || S(t4?.status) === 'deleted' || !!t4?.deletedAt
      || t3?._deleted === true || S(t3?.status) === 'deleted' || !!t3?.deletedAt;
    if (!dead) return false;
    patch[`products/${key}/_deleted`] = null;
    patch[`products/${key}/deletedAt`] = null;
    patch[`products/${key}/status`] = null;
    patch[`products/${key}/revived_at`] = now;
    return true;
  };
  let revived = 0;

  for (const c of upsert.creates) {
    const key = S(c.product_code) || S(c._key);
    if (!key) continue;
    if (reviveIfTombstoned(key)) revived++;
    for (const [f, v] of Object.entries(c)) if (v !== undefined) patch[`products/${key}/${f}`] = v;
    patch[`products/${key}/_key`] = key;
    patch[`products/${key}/updatedAt`] = now;
  }
  for (const pt of upsert.patches) {
    const key = S(pt.key); if (!key) continue;
    if (reviveIfTombstoned(key)) revived++;
    for (const [f, v] of Object.entries(pt.patch)) if (v !== undefined) patch[`products/${key}/${f}`] = v;
    patch[`products/${key}/updatedAt`] = now;
  }
  if (revived) console.log(`  톰스톤 해제 ${revived}건 — 시트에 살아 있어 되살린다`);
  for (const ab of absent.patches) {
    const key = S(ab.key); if (!key) continue;
    for (const [f, v] of Object.entries(ab.patch)) if (v !== undefined) patch[`products/${key}/${f}`] = v;
    patch[`products/${key}/updatedAt`] = now;
  }
  patch[`partners/${S(p._key)}/lastSyncedAt`] = now;

  await db.ref('v4').update(patch);
  console.log(`반영 완료 — 신규 ${upsert.creates.length} · 수정 ${upsert.patches.length} · 부재차단 ${absent.patches.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
