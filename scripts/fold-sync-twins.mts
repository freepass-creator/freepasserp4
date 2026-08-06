/**
 * **동기화를 막는 «같은 차 두 벌»을 접는다. 기본 미리보기, `--apply` 로 실행.**
 *
 * 연동이 어려웠던 이유는 시트 판독이 아니다(1관문은 통과한다 — diagnose-sync-blocks 참고).
 * 막는 건 전부 기존 DB 에 남은 중복이다:
 *   · 같은 공급사 안에서 같은 차번이 두 레코드 — 옛 `EXT_…` 사본과 지금 키(`{공급사}_{차번}`)
 *   · 같은 차가 두 공급사에 — 한 회사를 파트너 레코드 두 벌로 쓰던 흔적(엘씨 ↔ 빌린카)
 * 충돌 게이트는 이걸 「사람이 판단할 일」로 보고 커밋을 막는다. 옳은 게이트다 —
 * 다만 원인이 **한 번 청소하면 끝나는 옛 데이터**라, 매번 막히는 게 아니라 지금 한 번 막힌 것이다.
 *
 * 남길 쪽은 «동기화가 앞으로 갱신할» 레코드다. `planProductUpsert` 는 키를 먼저 맞추고
 * 없으면 `공급사|차번` 으로 맞춘다. 그래서 `{공급사}_{차번}` 형태 키가 있으면 그쪽이 정본이고,
 * 없으면 남은 하나가 정본이다. 반대로 접으면 다음 동기화가 «접힌 쪽»을 되살린다.
 *
 * 안전장치: 계약이 걸린 레코드는 접지 않는다 · v3 원본은 그대로 두고 v4 오버레이에만 쓴다 ·
 * 접기 전 원본을 파일로 남긴다 · 접히는 쪽에만 있는 값(사진·옵션·정책 등)은 남는 쪽으로 옮긴다.
 *
 *   npx tsx scripts/fold-sync-twins.mts              # 미리보기
 *   npx tsx scripts/fold-sync-twins.mts --apply
 *   npx tsx scripts/fold-sync-twins.mts --cross      # 공급사 간 중복까지 포함
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const CROSS = process.argv.includes('--cross');
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, Rec> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, Rec>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, Rec>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};
/**
 * ⚠ 임시번호(`100신…`)는 실물 차번이 아니다. 번호미정 신차에 순번으로 붙인 자리표시자라
 *   공급사가 다르면 «서로 다른 차»가 같은 문자열을 갖는다. 실제로 100신0009 는 연카 싼타페와
 *   우리캐피탈 그랑 콜레오스가 같이 물고 있었다 — 차번이 같다고 접으면 다른 차 둘이 합쳐진다.
 */
const isPending = (r: Rec): boolean => Boolean(r.is_pending_plate) || /^100신\d{4,}$/.test(S(r.car_number).replace(/\s/g, ''));
const plateOf = (r: Rec): string => {
  if (isPending(r)) return '';
  const c = S(r.car_number).replace(/\s/g, '');
  if (c && PLATE.test(c)) return c;
  const m = S(r._key).match(/([0-9]{2,3}[가-힣][0-9]{4})$/);
  if (!m) return '';
  return /^100신/.test(m[1]) ? '' : m[1];
};
const priceCount = (r: Rec) => (r.price && typeof r.price === 'object' ? Object.keys(r.price).length : 0);
const dead = (r: Rec) => r._deleted === true || !!r.deletedAt || S(r.status) === 'deleted';

/** 접히는 쪽에만 있는 값은 남는 쪽으로 옮긴다 — 덮어쓰지 않는다. */
const CARRY = [
  'car_number', 'vehicle_status', 'photo_link', 'options', 'policy_code',
  'first_registration_date', 'mileage', 'ext_color', 'int_color', 'fuel_type',
] as const;

async function main() {
  const db = getDatabase();
  const [p3, p4, c3, c4, t3, t4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const products = mergeNodes(p3.val(), p4.val());
  const contracts = mergeNodes(c3.val(), c4.val());
  const partners = mergeNodes(t3.val(), t4.val());
  const partnerName = new Map<string, string>();
  for (const p of Object.values(partners)) {
    const code = S(p.partner_code) || S(p._key);
    if (code && !partnerName.get(code)) partnerName.set(code, S(p.name || p.partner_name) || code);
  }
  // ⚠ 빈 문자열을 넣으면 안 된다 — product_code 가 빈 계약 하나가 전체를 «계약 걸림»으로 만든다.
  const referenced = new Set(Object.values(contracts)
    .filter((c) => !dead(c) && S(c.contract_status) !== '계약취소')
    .map((c) => S(c.product_code)).filter(Boolean));
  // 시트가 붙어 있는 공급사 = 앞으로 동기화가 갱신할 주인. 공급사 간 중복에서 이쪽을 남긴다.
  const hasSheet = new Set(Object.values(partners)
    .filter((p) => S(p.sheet_url) && !dead(p))
    .map((p) => S(p.partner_code) || S(p._key)));

  const live = Object.values(products).filter((r) => !dead(r) && !r._merged_into);

  type Group = { label: string; keep: Rec; fold: Rec[]; kind: '공급사 내' | '공급사 간' };
  const plan: Group[] = [];
  const blocked: string[] = [];

  /**
   * 남길 쪽 = 동기화가 앞으로 갱신할 레코드. `{공급사}_{차번}` 키가 있으면 그쪽이다
   * (`planProductUpsert` 가 키를 먼저 맞춘다). 없으면 «지금 팔 수 있는 쪽»을 남긴다 —
   * 어느 쪽을 남기든 다음 동기화가 상태를 덮어쓰지만, 그 전까지 목록에 뜨는 건 남은 쪽이다.
   */
  const SELLABLE = /즉시출고|출고가능|출고협의/;
  /**
   * 계약이 «이 레코드를 직접» 가리키는가 — 키 기준.
   *
   * product_code 로 보면 안 된다. 옛 EXT_ 사본은 자기 키가 아니라 정본 키를 product_code 로
   * 들고 있어서(EXT_06eb… → product_code RP023_195주5304), product_code 로 재면 사본까지
   * «계약 걸림»이 돼 정작 접어야 할 중복이 영영 안 접힌다. 계약이 가리키는 건 정본 키다.
   */
  const isHeld = (r: Rec) => referenced.has(S(r._key));
  const pickKeep = (rows: Rec[]): Rec => {
    // 계약이 가리키는 레코드가 있으면 «그것»을 남긴다 — 계약 링크를 그대로 두고 사본만 접는다.
    const held = rows.filter(isHeld);
    if (held.length >= 1) return held[0];
    const canonical = rows.find((r) => {
      const prov = S(r.provider_company_code);
      return prov && S(r._key) === `${prov}_${plateOf(r)}`;
    });
    if (canonical) return canonical;
    const score = (r: Rec) => (SELLABLE.test(S(r.vehicle_status)) ? 1 : 0);
    return [...rows].sort((a, b) =>
      score(b) - score(a) || priceCount(b) - priceCount(a) || S(a._key).localeCompare(S(b._key)))[0];
  };

  // ① 같은 공급사 안에서 같은 차번
  const inProvider = new Map<string, Rec[]>();
  for (const r of live) {
    const prov = S(r.provider_company_code);
    const plate = plateOf(r);
    if (!prov || !plate) continue;
    const k = `${prov}|${plate}`;
    inProvider.set(k, [...(inProvider.get(k) || []), r]);
  }
  for (const [k, rows] of inProvider) {
    if (rows.length < 2) continue;
    const keep = pickKeep(rows);
    const fold = rows.filter((r) => r !== keep);
    const held = fold.filter(isHeld);
    if (held.length) { blocked.push(`${k} — 접힐 쪽에도 계약 ${held.map((h) => S(h._key)).join(', ')}`); continue; }
    plan.push({ label: k, keep, fold, kind: '공급사 내' });
  }

  // ② 같은 차가 두 공급사에 (--cross)
  if (CROSS) {
    // ①에서 접힌 것은 이미 없는 셈 치고, «살아남을» 레코드끼리만 다시 본다.
    // 접힌 걸 빼지 않으면 공급사 내 중복이 공급사 간 판정을 가려 한 번에 정리되지 않는다.
    const foldedKeys = new Set(plan.flatMap((g) => g.fold.map((f) => S(f._key))));
    const survivors = live.filter((r) => !foldedKeys.has(S(r._key)));
    const byPlate = new Map<string, Rec[]>();
    for (const r of survivors) {
      const plate = plateOf(r);
      if (!plate) continue;
      byPlate.set(plate, [...(byPlate.get(plate) || []), r]);
    }
    for (const [plate, rows] of byPlate) {
      const provs = new Set(rows.map((r) => S(r.provider_company_code)).filter(Boolean));
      if (provs.size < 2) continue;
      // 시트를 가진 공급사가 정확히 하나일 때만 자동으로 정한다 — 둘 다 시트가 있으면 사람이 판단할 일이다.
      const sheeted = [...provs].filter((p) => hasSheet.has(p));
      if (sheeted.length !== 1) { blocked.push(`${plate} — 시트 보유 공급사가 ${sheeted.length}곳 (${[...provs].join(' ↔ ')})`); continue; }
      const heldRows = rows.filter(isHeld);
      const keep = heldRows.length === 1
        ? heldRows[0]
        : pickKeep(rows.filter((r) => S(r.provider_company_code) === sheeted[0]));
      const fold = rows.filter((r) => r !== keep);
      if (!fold.length) continue;
      const held = fold.filter(isHeld);
      if (held.length) { blocked.push(`${plate} — 접힐 쪽에도 계약 ${held.map((h) => S(h._key)).join(', ')}`); continue; }
      plan.push({ label: `${plate} (${[...provs].join(' ↔ ')})`, keep, fold, kind: '공급사 간' });
    }
  }

  console.log(`\n══ 같은 차 두 벌 접기 ${APPLY ? '(실행)' : '(미리보기)'}${CROSS ? ' · 공급사 간 포함' : ''} ══\n`);
  console.log(`  살아있는 매물 ${live.length}대 · 접을 그룹 ${plan.length} · 사람이 봐야 할 것 ${blocked.length}\n`);
  for (const g of plan) {
    const nm = (r: Rec) => `${S(r.maker)} ${S(r.model)}`.trim();
    console.log(`  [${g.kind}] ${g.label}`);
    console.log(`     남김 ${S(g.keep._key).padEnd(24)} ${partnerName.get(S(g.keep.provider_company_code))?.slice(0, 10).padEnd(10) || ''} 가격${priceCount(g.keep)} [${S(g.keep.vehicle_status) || '빈값'}] ${nm(g.keep)}`);
    for (const f of g.fold) {
      console.log(`     접음 ${S(f._key).padEnd(24)} ${partnerName.get(S(f.provider_company_code))?.slice(0, 10).padEnd(10) || ''} 가격${priceCount(f)} [${S(f.vehicle_status) || '빈값'}] ${nm(f)}`);
    }
  }
  if (blocked.length) {
    console.log('\n  ⏸ 자동으로 정하지 않은 것:');
    for (const b of blocked) console.log(`     ${b}`);
  }
  if (!plan.length) { console.log('\n  접을 것 없음\n'); return; }

  // 옮길 값 계산 — 남는 쪽이 비어 있고 접히는 쪽에 있는 필드만.
  const carry: Record<string, unknown> = {};
  let carried = 0;
  for (const g of plan) {
    for (const f of CARRY) {
      if (S(g.keep[f])) continue;
      const donor = g.fold.find((r) => S(r[f]));
      if (!donor) continue;
      carry[`products/${S(g.keep._key)}/${f}`] = donor[f];
      carried++;
    }
  }
  console.log(`\n  빈 필드 이관 ${carried}건 (${CARRY.join(' · ')})`);

  if (!APPLY) { console.log('\n  ※ 위 «남김/접음» 이 맞는지 확인한 뒤 --apply\n'); return; }

  mkdirSync('tmp/backup', { recursive: true });
  const backup: Record<string, unknown> = {};
  for (const g of plan) for (const f of g.fold) {
    backup[S(f._key)] = { v3: (p3.val() || {})[S(f._key)] ?? null, v4: (p4.val() || {})[S(f._key)] ?? null };
  }
  const file = `tmp/backup/fold-twins-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`  원본 백업 ${file}`);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...carry };
  for (const g of plan) for (const f of g.fold) {
    const k = S(f._key);
    patch[`products/${k}/_deleted`] = true;
    patch[`products/${k}/_merged_into`] = S(g.keep._key);
    patch[`products/${k}/_merged_reason`] = `동기화 중복 정리 — ${g.label}`;
    patch[`products/${k}/updatedAt`] = now;
  }
  await db.ref('v4').update(patch);
  const folded = plan.reduce((a, g) => a + g.fold.length, 0);
  console.log(`  ✅ ${plan.length}그룹 ${folded}대 접음\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
