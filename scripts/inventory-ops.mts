/**
 * **재고 작업 통합 실행기 — 한 프로세스에서 전 공급사를 순회한다.**
 *
 * 왜 통합했나: 공급사별 스크립트를 `for c in ...; do npx tsx ...; done` 으로 돌리면
 * 공급사 수만큼 `npx → node → tsx` 체인이 새로 뜨고, 그때마다 RTDB 전체를 다시 받는다.
 * Git Bash 의 fork 흉내가 그 압력에 먼저 무너져 PC 가 멈췄다
 * (`cygheap read copy failed` · `Win32 error 1455` = ERROR_COMMITMENT_LIMIT).
 *
 * 그래서 **프로세스 하나 · 다운로드 한 번**으로 바꾼다. DB 는 `lib/db-snapshot` 이 캐시한다.
 *
 *   npx tsx scripts/inventory-ops.mts count            상품 실수량
 *   npx tsx scripts/inventory-ops.mts reconcile        실제 대수 대비 차이
 *   npx tsx scripts/inventory-ops.mts audit            공급사별 요약(신원·트윈·계약)
 *   ... --refresh    캐시 무시하고 새로 받는다
 */
import { snapshot, mergeNodes, liveProducts, type Rec } from './lib/db-snapshot.mts';
import { dedupeProductsByVehicle } from '../lib/firebase/rtdb-products';
import { isOfferableProduct, vehicleIdentity } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const CMD = process.argv[2] || 'count';
const REFRESH = process.argv.includes('--refresh');
const S = (v: unknown) => String(v ?? '').trim();

/** 사장님·태윤 매니저 실측 대수 (2026-08-05). 대조 기준. */
const EXPECTED: Record<string, { name: string; n: number }> = {
  RP022: { name: '퍼시픽', n: 1 }, RP008: { name: '리더스', n: 3 }, RP010: { name: 'KH', n: 11 },
  RP018: { name: '스타', n: 19 }, RP030: { name: '제이앤제이', n: 7 }, 'PT-0001': { name: '렌트존', n: 6 },
  'PT-0023': { name: '에스에이', n: 30 }, RP013: { name: '웰릭스', n: 17 }, RP012: { name: '손오공', n: 32 },
  RP015: { name: '경진렌트카', n: 1 }, RP017: { name: '센트로', n: 2 }, RP016: { name: '경진카', n: 0 },
  RP020: { name: '우리캐피탈', n: 19 }, RP021: { name: '빌린카', n: 47 }, RP023: { name: '오토플러스', n: 91 },
  RP006: { name: '아이언', n: 27 }, RP004: { name: '아이카', n: 50 },
};

const ofProvider = (x: Rec, code: string) => S(x.provider_company_code) === code || S(x._key).startsWith(`${code}_`);
const bar = (n: number, max: number) => '█'.repeat(Math.max(0, Math.round((n / Math.max(1, max)) * 26)));

async function main() {
  const s = await snapshot({ refresh: REFRESH });
  const live = liveProducts(s);
  const shown = dedupeProductsByVehicle(live as EntityRecord[]).filter(isOfferableProduct);
  const partners = mergeNodes(s.partners, s.v4Partners);
  const nameOf = (code: string) => {
    const p = partners[code] || Object.values(partners).find((x) => S(x.partner_code) === code);
    return S(p?.name) || S(p?.partner_name) || code;
  };

  if (CMD === 'count') {
    console.log(`\n══ 상품 차량 실수량 ══\n`);
    console.log(`  살아있는 매물 ${live.length}  →  게시 가능 ${shown.length}\n`);
    const byProv = new Map<string, number>();
    for (const x of shown) { const c = S(x.provider_company_code) || '(없음)'; byProv.set(c, (byProv.get(c) || 0) + 1); }
    const rows = [...byProv.entries()].sort((a, b) => b[1] - a[1]);
    const top = rows[0]?.[1] || 1;
    for (const [c, n] of rows) console.log(`  ${c.padEnd(11)} ${String(n).padStart(4)}대  ${bar(n, top)}  ${nameOf(c)}`);
    console.log(`\n  합계 ${shown.length}대\n`);
    return;
  }

  if (CMD === 'reconcile') {
    console.log('\n공급사        실제  우리  차이');
    console.log('─'.repeat(46));
    let se = 0, so = 0;
    for (const [code, exp] of Object.entries(EXPECTED)) {
      const n = shown.filter((x) => ofProvider(x, code)).length;
      se += exp.n; so += n;
      const d = n - exp.n;
      console.log(`${(exp.name + '(' + code + ')').padEnd(20)} ${String(exp.n).padStart(4)} ${String(n).padStart(5)} ${String(d > 0 ? '+' + d : d === 0 ? '✓' : d).padStart(6)}`);
    }
    console.log('─'.repeat(46));
    console.log(`${'합계'.padEnd(20)} ${String(se).padStart(4)} ${String(so).padStart(5)} ${String(so - se > 0 ? '+' + (so - se) : so - se).padStart(6)}\n`);
    return;
  }

  if (CMD === 'audit') {
    const contracts = Object.values(mergeNodes(s.contracts, s.v4Contracts))
      .filter((c) => c && c._deleted !== true && S(c.contract_status) !== '계약취소');
    console.log('\n공급사        보유  게시  신원없음  트윈  계약  매핑');
    console.log('─'.repeat(60));
    for (const code of Object.keys(EXPECTED)) {
      const mine = live.filter((x) => ofProvider(x, code));
      const sh = shown.filter((x) => ofProvider(x, code));
      const noId = mine.filter((x) => !vehicleIdentity(x as EntityRecord)).length;
      const byId = new Map<string, number>();
      for (const x of mine) { const id = vehicleIdentity(x as EntityRecord); if (id) byId.set(id, (byId.get(id) || 0) + 1); }
      const twins = [...byId.values()].filter((v) => v > 1).length;
      const codes = new Set(mine.map((x) => S(x.product_code) || S(x._key)));
      const cn = contracts.filter((c) => codes.has(S(c.product_code))).length;
      const p = partners[code] || Object.values(partners).find((x) => S(x.partner_code) === code);
      const pinned = p?.mapping_profile ? '✓' : '❌';
      const mark = (n: number) => n ? String(n).padStart(4) : '   ·';
      console.log(`${(EXPECTED[code].name + '(' + code + ')').padEnd(20)} ${String(mine.length).padStart(4)} ${String(sh.length).padStart(5)} ${mark(noId)}${mark(twins)}${mark(cn)}    ${pinned}`);
    }
    console.log('');
    return;
  }

  console.log('명령: count | reconcile | audit   (--refresh 로 캐시 갱신)');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
