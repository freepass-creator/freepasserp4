/**
 * 공급사 1곳 전수 검수 — 시트 설정부터 앱 데이터까지 한 화면에.
 *
 * 「연동」이 아니라 «우리 데이터화»가 제대로 됐는지 보는 도구다. 순서대로 —
 *   설정 → 시트에서 읽히는 것 → 우리가 갖고 있는 것 → 신원 → 상태 → 계약 → 판정
 *
 * 읽기 전용. 아무것도 쓰지 않는다.
 *   npx tsx scripts/audit-supplier.mts --code=RP006
 *   npx tsx scripts/audit-supplier.mts --list        공급사 목록만
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { importSheetTable, parseMappingProfile, parseMappingHeaderSignature } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { vehicleIdentity } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

const CODE = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const LIST = process.argv.includes('--list');
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let f = '', r: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};
const line = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

async function main() {
  const [t3, t4, p3, p4, c3, c4, m3, m4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('vehicle_master').get(), db.ref('v4/vehicle_master').get(),
  ]);
  const partners = mergeNodes(t3.val(), t4.val());
  const products = mergeNodes(p3.val(), p4.val());
  const contracts = mergeNodes(c3.val(), c4.val());
  const master = Object.values(mergeNodes(m3.val(), m4.val())).filter(Boolean);

  const withSheet = Object.values(partners).filter((p) => p && p._deleted !== true && S(p.sheet_url));
  if (LIST || !CODE) {
    console.log('시트 연결 공급사:');
    withSheet.sort((a, b) => S(a.partner_code).localeCompare(S(b.partner_code)))
      .forEach((p) => console.log(`  ${S(p.partner_code).padEnd(10)} ${S(p.name) || S(p.partner_name)}`));
    console.log('\n  npx tsx scripts/audit-supplier.mts --code=<코드>');
    return;
  }

  const p = withSheet.find((x) => S(x.partner_code) === CODE) || partners[CODE];
  if (!p) { console.log(`공급사 ${CODE} 없음`); return; }
  const name = S(p.name) || S(p.partner_name) || CODE;
  console.log(`\n══ ${CODE} ${name} ══`);

  // ── 1. 설정
  line('1. 시트 설정');
  const adapter = resolveAdapter(p);
  const prof = parseMappingProfile(p.mapping_profile);
  const sheetId = (S(p.sheet_url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
  const gids = (S(p.sheet_gid) || S(p.sheet_tab) || '').split(/[,\s|]+/).filter(Boolean);
  console.log(`  어댑터        ${adapter.id}`);
  console.log(`  탭            ${gids.length ? gids.join(', ') : '(기본 1개)'}`);
  console.log(`  매핑 고정     ${prof ? `${Object.keys(prof).length}필드 ✓` : '❌ 없음 — 매번 추측한다'}`);
  console.log(`  헤더 서명     ${p.mapping_header_signature ? '✓ 드리프트 감지 ON' : '❌ 없음'}`);
  console.log(`  보증금 규칙   ${S(p.deposit_rule) || '(없음)'}`);
  console.log(`  헤더 행       ${Number(p.header_row) ? Number(p.header_row) + 1 : 1}행`);

  // ── 2. 시트에서 읽히는 것
  line('2. 시트에서 읽히는 것');
  let imported = 0, excluded = 0, noPrice = 0, invalid = 0, dup = 0, srcRows = 0;
  const issues: string[] = [];
  for (const gid of (gids.length ? gids : [''])) {
    try {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
      if (!res.ok) { console.log(`  gid ${gid || '기본'}: ❌ CSV ${res.status}`); continue; }
      const table = adapter.prepareTable(parseCsv(await res.text()), { headerRow: Math.max(0, Number(p.header_row) || 0) });
      if (table.length < 2) { console.log(`  gid ${gid || '기본'}: 데이터 없음`); continue; }
      const r = importSheetTable(table, {
        providerCode: CODE, entries: master as never,
        profile: prof, profileHeaders: parseMappingHeaderSignature(p.mapping_header_signature),
      });
      srcRows += r.total; imported += r.imported; excluded += r.excludedCount;
      noPrice += r.noPriceCount; invalid += r.invalidCount; dup += r.duplicateCount;
      r.issueSamples.forEach((s) => { if (issues.length < 10) issues.push(`${gid ? `gid ${gid} · ` : ''}${s}`); });
    } catch (e) { console.log(`  gid ${gid || '기본'}: ❌ ${String((e as Error).message || e)}`); }
  }
  console.log(`  원본 행 ${srcRows} → 올림 ${imported}`);
  console.log(`     출고불가 제외 ${excluded} · 가격없어 제외 ${noPrice} · 무효 ${invalid} · 중복 ${dup}`);
  if (issues.length) { console.log('  미게시 사유 표본:'); issues.forEach((s) => console.log(`     ${s}`)); }

  // ── 3. 우리가 갖고 있는 것
  line('3. 우리 데이터');
  const mine = Object.values(products).filter((x) => x && x._deleted !== true && S(x.status) !== 'deleted'
    && (S(x.provider_company_code) === CODE || S(x._key).startsWith(`${CODE}_`)));
  const byStatus = new Map<string, number>();
  for (const x of mine) byStatus.set(S(x.vehicle_status) || '(빈값)', (byStatus.get(S(x.vehicle_status) || '(빈값)') || 0) + 1);
  console.log(`  보유 ${mine.length}대`);
  [...byStatus.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`     ${k.padEnd(10)} ${v}`));
  const keyKinds = new Map<string, number>();
  for (const x of mine) { const k = S(x._key).startsWith('EXT_') ? 'EXT_(웹·외부)' : S(x._key).startsWith(`${CODE}_`) ? `${CODE}_(시트)` : '기타'; keyKinds.set(k, (keyKinds.get(k) || 0) + 1); }
  console.log(`  키 종류: ${[...keyKinds.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  // ── 4. 신원
  line('4. 차량 신원 (트윈·선점의 근거)');
  const noId = mine.filter((x) => !vehicleIdentity(x));
  const byId = new Map<string, EntityRecord[]>();
  for (const x of mine) { const id = vehicleIdentity(x); if (!id) continue; if (!byId.has(id)) byId.set(id, []); byId.get(id)!.push(x); }
  const twins = [...byId.entries()].filter(([, v]) => v.length > 1);
  console.log(`  신원 없음(번호판·VIN 둘 다 없음)  ${noId.length}${noId.length ? '   ← 원자 선점 거부됨' : ''}`);
  console.log(`  같은 실물이 복수 레코드           ${twins.length}그룹`);
  twins.slice(0, 6).forEach(([id, v]) => {
    console.log(`     ${id}`);
    v.forEach((x) => console.log(`        ${S(x._key).padEnd(24)} [${S(x.vehicle_status) || '빈값'}] ${S(x.maker)} ${S(x.sub_model) || S(x.model)}`));
  });
  if (twins.length > 6) console.log(`     … 외 ${twins.length - 6}그룹`);
  noId.slice(0, 5).forEach((x) => console.log(`     신원없음: ${S(x._key).padEnd(24)} 번호"${S(x.car_number)}" ${S(x.maker)} ${S(x.sub_model) || S(x.model)}`));

  // ── 5. 계약
  line('5. 계약이 걸린 매물');
  const codes = new Set(mine.map((x) => S(x.product_code) || S(x._key)));
  const live = Object.values(contracts).filter((c) => c && c._deleted !== true
    && S(c.contract_status) !== '계약취소' && codes.has(S(c.product_code)));
  console.log(`  진행/완료 계약 ${live.length}건`);
  live.slice(0, 8).forEach((c) => console.log(`     ${S(c.contract_code).padEnd(20)} ${S(c.contract_status) || '진행중'} · ${S(c.car_number_snapshot)} · ${S(c.customer_name)}`));
  const locked = mine.filter((x) => S(x.locked_by_contract));
  console.log(`  락이 찍힌 매물 ${locked.length}대`);

  // ── 6. 판정
  line('6. 판정');
  const verdict: string[] = [];
  if (!prof) verdict.push('❌ 매핑 미고정 — 동기화가 매번 추측한다. learn-sheet-mapping 으로 박을 것');
  if (noId.length) verdict.push(`❌ 신원 없는 매물 ${noId.length}대 — 계약 시 원자 선점 거부. 번호판 백필 필요`);
  if (twins.length) verdict.push(`⚠ 트윈 ${twins.length}그룹 — 목록 중복·이중판매 소지. 어느 키를 남길지 사람 판단`);
  if (noPrice) verdict.push(`⚠ 가격 없어 미게시 ${noPrice}대 — 공급사에 회신하면 줄어든다`);
  if (invalid) verdict.push(`⚠ 차번 무효 ${invalid}건 — 시트 원본 수정 대상`);
  if (!verdict.length) verdict.push('✓ 특이사항 없음');
  verdict.forEach((v) => console.log(`  ${v}`));
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
