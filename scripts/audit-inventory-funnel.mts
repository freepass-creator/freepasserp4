/**
 * **공급사 시트 → 재고관리 → 상품찾기** 각 단계에서 몇 대가 새는가. 읽기 전용.
 *
 * 「시트엔 있는데 왜 상품찾기엔 이만큼이냐」에 답하는 도구다.
 *
 * ★운영 유입과 **같은 길로 읽는다**(2026-08-10에 고침). 이게 핵심이다 —
 *   · 숨김 행 제외        `visibleRowsFromGridResponse` (hiddenByFilter/hiddenByUser)
 *     공급사가 화면에서 내린 매물이 다시 세어지면 안 된다.
 *   · 공급사별 어댑터      `resolveAdapter(partner).prepareTable`
 *     오토플러스 시트는 진짜 헤더 위에 배너가 있고 요금 헤더가 두 줄이다.
 *   · 저장 매핑·보증금 규칙 파트너 레코드 그대로
 *   · 상태 판정           `canonSheetVehicleStatus`
 *
 *   전에는 raw values 를 읽고 1행을 헤더로 봤다. 그래서 오토플러스가 「못 읽음」으로 뜨고,
 *   숨긴 행이 재고로 세어졌다. 감사가 틀리면 고치는 방향도 틀린다.
 *
 * 단계
 *   ① 시트 원본        보이는 행 중 출고불가가 아닌 차(차번으로 접음)
 *   ② 재고관리(RTDB)    그 차가 살아있는 레코드로 있나
 *   ③ 출고불가 제외     ERP 상태가 출고불가가 아닌가
 *   ④ 상품찾기         대여료가 하나라도 있나  ← 여기까지 통과해야 영업자가 본다
 *
 * ⚠ 시트를 못 읽은 공급사는 **0 이 아니라 「모름」**이다. 합계에서 빼고 따로 밝힌다.
 * ⚠ 홈페이지 연동(아이언)은 시트가 정본이 아니라 여기서 세지 않는다.
 *
 *   npx tsx scripts/audit-inventory-funnel.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { resolveAdapter } from '../lib/domain/sheet-adapters';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 시트가 정본이 아닌 공급사 — 여기서 세면 「유입 안 됨」으로 잘못 잡힌다. */
const NOT_SHEET_BACKED = new Set(['RP006']);   // 아이언 = ironrentcar.com 수집

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const shT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;

/** 격자 전체를 한 번에 받는다 — 탭마다 따로 부르면 분당 읽기 한도에 걸린다. */
const GRID_FIELDS = 'sheets(properties(sheetId,title,hidden),data(rowMetadata(hiddenByFilter,hiddenByUser),rowData(values(formattedValue))))';
const grabGrid = async (id: string, tries = 4): Promise<SheetsGridResponse> => {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(GRID_FIELDS)}`;
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${shT}` } });
    const j = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return j as SheetsGridResponse;
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(10000 * (i + 1)); continue; }
    throw new Error(j?.error?.message || `HTTP ${res.status}`);
  }
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const sheets = new Map<string, Rec>();
for (const p of Object.values(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code) || S(p._key);
  if (S(p.sheet_url) && !sheets.has(c) && !NOT_SHEET_BACKED.has(c)) sheets.set(c, p);
}

const live = new Map<string, EntityRecord[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const pl = norm(p.car_number);
  if (!pl) continue;
  live.set(pl, [...(live.get(pl) || []), { ...p, _key: k, product_code: p.product_code || k } as EntityRecord]);
}

type Row = { plate: string; code: string; name: string; raw: string; tab: string };
const sheetPlates = new Map<string, Row>();
const read: { code: string; name: string; tabs: number; rows: number; hidden: number; err: string }[] = [];

for (const [code, p] of sheets) {
  const id = S(p.sheet_url).match(/\/d\/([\w-]+)/)?.[1];
  const name = S(p.partner_name || p.name || p.company_name) || code;
  if (!id) { read.push({ code, name, tabs: 0, rows: 0, hidden: 0, err: '시트 주소 없음' }); continue; }
  try {
    const grid = await grabGrid(id);
    const adapter = resolveAdapter(p as EntityRecord);
    let tabs = 0; let rows = 0; let hidden = 0; let failedTabs = 0;
    /**
     * ★**보이는 탭만** 읽는다(사장님 2026-08-10 — 「숨긴 거는 안 가져온다」).
     *
     *   그 말은 행뿐 아니라 **탭에도** 적용된다. 공급사가 안 쓰는 탭은 숨겨 둔다 —
     *   오플은 10탭 중 7개, 아이카는 8탭 중 7개가 숨겨져 있었다.
     *   숨긴 탭까지 세면 옛 탭·프로모션 사본이 「유입 안 된 차」로 잡혀 감사가 거짓말을 한다.
     *
     *   탭을 하나로 못 박지 않는다 — 오플은 「판매차량리스트」와 「전기차 프로모션」이 **둘 다** 재고고,
     *   이안카도 신차·중고 두 탭이다. 공급사가 탭을 늘리면 그대로 따라간다.
     *   `sheet_tab` 이 정해져 있으면 그건 사람이 일부러 좁힌 것이므로 그 탭만 본다.
     */
    /** `sheet_tab` 은 gid **여러 개**를 쉼표로 담을 수 있다(빌린카 = `0,1718488412,1505082236`). */
    const pinned = new Set(S(p.sheet_tab).split(',').map(S).filter(Boolean));
    for (const sh of (grid.sheets || []) as Rec[]) {
      const gid = String(sh.properties?.sheetId ?? '');
      if (pinned.size ? !pinned.has(gid) : sh.properties?.hidden === true) continue;
      const all = (sh.data?.[0]?.rowData || []).length;
      let table: string[][];
      try { table = (visibleRowsFromGridResponse(grid, gid) as Rec).rows as string[][]; } catch { continue; }
      hidden += Math.max(0, all - table.length);
      /**
       * ★탭 하나가 실패해도 그 공급사를 통째로 버리면 안 된다.
       *   전에는 바깥 try 에서 잡혀 «탭 0개»로 뜨는데 이미 담은 차는 남아,
       *   합계(①)와 공급사별 표가 서로 다른 말을 했다. 탭 단위로 막는다.
       */
      let prepared: string[][];
      try {
        // 운영과 같은 어댑터로 헤더를 고른다 — 배너·두 줄 헤더가 여기서 풀린다.
        prepared = adapter.prepareTable(table, { headerRow: Number(p.sheet_header_row) || undefined });
      } catch { failedTabs++; continue; }
      const hdr = (prepared[0] || []).map(S);
      const si = hdr.findIndex((h) => /배차상태|^상태|판매상태|재고상태|출고상태|출고현황/.test(h));
      const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
      if (pi < 0) continue;
      tabs++;
      for (const r of prepared.slice(1)) {
        const pl = norm(r[pi]);
        if (!pl || pl.length < 6) continue;
        rows++;
        const raw = si >= 0 ? S(r[si]) : '';
        if (canonSheetVehicleStatus(raw) === '출고불가') continue;
        if (!sheetPlates.has(pl)) sheetPlates.set(pl, { plate: pl, code, name, raw, tab: S(sh.properties?.title) });
      }
    }
    read.push({ code, name, tabs, rows, hidden, err: tabs ? (failedTabs ? `탭 개 헤더 못 찾음` : '') : '차번 열을 가진 탭이 없음' });
  } catch (e) {
    read.push({ code, name, tabs: 0, rows: 0, hidden: 0, err: String((e as Error).message).slice(0, 55) });
  }
}

type Step = '②재고관리에 없음' | '③출고불가로 막힘' | '④대여료 없음' | '통과';
const why = new Map<string, Step>();
const lines: string[][] = [];
for (const [pl, meta] of sheetPlates) {
  const recs = live.get(pl);
  let step: Step; let note = '';
  if (!recs?.length) step = '②재고관리에 없음';
  else {
    const open = recs.filter((r) => !isHiddenFromCatalog(r as Rec));
    if (!open.length) { step = '③출고불가로 막힘'; note = recs.map((r) => S((r as Rec).vehicle_status)).join('/'); }
    else if (!open.some((r) => priceList(r).length > 0)) { step = '④대여료 없음'; note = S((open[0] as Rec).vehicle_status); }
    else step = '통과';
  }
  why.set(pl, step);
  if (step !== '통과') lines.push([pl, meta.code, meta.name, meta.tab, meta.raw, step, note]);
}
const n = (s: Step) => [...why.values()].filter((v) => v === s).length;

console.log('■ 공급사 시트 → 재고관리 → 상품찾기   (운영과 같은 경로로 읽음)\n');
console.log(`  ① 시트 원본(보이는 행 · 출고불가 뺀 차)  ${String(sheetPlates.size).padStart(5)}대`);
console.log(`     └ ② 재고관리에 없음                 ${String(-n('②재고관리에 없음')).padStart(5)}대   유입이 안 됐다`);
console.log(`     └ ③ ERP 가 출고불가로 막음           ${String(-n('③출고불가로 막힘')).padStart(5)}대   상태가 어긋났다`);
console.log(`     └ ④ 대여료가 없음                   ${String(-n('④대여료 없음')).padStart(5)}대   가격을 못 받았다`);
console.log(`  ──────────────────────────────────────────────`);
console.log(`  시트發로 상품찾기에 서는 차               ${String(n('통과')).padStart(5)}대\n`);

console.log(`  ${'공급사'.padEnd(16)}${'코드'.padEnd(10)}${'탭'.padStart(3)}${'행'.padStart(7)}${'숨김'.padStart(7)}   비고`);
for (const r of read.sort((a, b) => b.rows - a.rows)) {
  console.log(`  ${r.name.slice(0, 15).padEnd(16)}${r.code.padEnd(10)}${String(r.tabs).padStart(3)}${String(r.rows).padStart(7)}${String(r.hidden).padStart(7)}   ${r.err ? `✗ ${r.err}` : ''}`);
}

const allLive = [...live.values()].flat();
const listable = [...live.entries()].filter(([, rs]) => rs.some((r) => !isHiddenFromCatalog(r as Rec) && priceList(r).length > 0));
console.log(`\n  ── ERP 쪽에서 직접 세면 ──`);
console.log(`   활성 레코드          ${String(allLive.length).padStart(5)}건 (차번 ${live.size}대)`);
console.log(`   상품찾기에 서는 차    ${String(listable.length).padStart(5)}대`);
console.log(`   그중 시트 밖에서 온 차 ${String(listable.filter(([pl]) => !sheetPlates.has(pl)).length).padStart(5)}대  (아이언 홈피 등)`);

mkdirSync('tmp', { recursive: true });
const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
writeFileSync('tmp/inventory-funnel.csv', `﻿${[
  ['차량번호', '공급사코드', '공급사', '탭', '시트 상태', '어디서 빠졌나', 'ERP 상태'].join(','),
  ...lines.map((l) => l.map(esc).join(',')),
].join('\r\n')}`, 'utf8');
console.log(`\n  CSV: tmp/inventory-funnel.csv (${lines.length}행)\n`);
