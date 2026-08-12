/**
 * **공급사 시트 ↔ ERP ↔ 우리 시트 삼자 대조.** 읽기 전용 — 아무것도 고치지 않는다.
 *
 * 시트에 적힌 요금·보증금이 ERP 에 그대로 들어갔는지 차 한 대씩 맞춰 본다.
 * 시트를 «학습»해서 ERP·판매시트에 반영하는 게 목적이니, 그 반영이 실제로 맞는지
 * 사람 눈 대신 여기서 센다.
 *
 * ★읽는 법은 `readSupplierSheet` + `parsePriceColumns` — **유입과 같은 함수**를 쓴다.
 *   여기서 따로 파싱하면 «감사 도구만 맞는» 숫자가 나온다(실측: 예전 감사가 오플을 «못 읽음»으로,
 *   아이카를 227행으로 셌다).
 * ★보증금은 시트 칸이 우선, 없으면 파트너의 `deposit_rule`. 규칙도 없으면 그 기간을 버린다 —
 *   0원(무보증)과 «말할 수 없음»은 다르다.
 * ★셋을 같이 센다 — **어느 하나만 봐서는 어긋난 걸 못 본다**(사장님 2026-08-12
 *   「공급사제공시트랑 erp랑 우리 시트랑 안맞는데」).
 *     공급사 시트  정본. 공급사가 파는 차
 *     ERP          우리가 읽어 접어 둔 것. 영업자 화면·판매시트의 근거
 *     우리 시트    「프리패스 재고 · …」. 배포용으로 우리가 만든 표
 *   우리 시트가 없는 공급사(오플·아이카·이안카)는 그 칸이 «—» 다 — 빠진 게 아니다.
 *
 *   npx tsx scripts/audit-sheet-vs-erp.mts
 *   npx tsx scripts/audit-sheet-vs-erp.mts --only=아이카 --detail
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { isVehicleTab } from '../lib/domain/supplier-template-sheet';
import { parseDepositRule, parsePriceColumns, unambiguousMasterOrigin } from '../lib/domain/sheet-import';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
type Price = Record<string, { rent: number; deposit: number }>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const won = (n: number) => n.toLocaleString('ko-KR');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3).trim();
const ONLY = arg('only');
const DETAIL = process.argv.includes('--detail');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 차종마스터 — 국산/수입 만장일치 판정에 쓴다(저장하지 않는다). */
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];


const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

/** 코드별로 한 장의 파트너로 접는다 — v3·v4 두 벌이 같은 코드를 쓴다. */
const byCode = new Map<string, Rec>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const c = S(p.partner_code);
  if (!c) continue;
  const cur = byCode.get(c);
  byCode.set(c, { ...(cur || {}), ...p, sheet_url: S(p.sheet_url) || S(cur?.sheet_url) });
}
const erpBy = new Map<string, Rec[]>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const c = S(p.provider_company_code) || S(p.partner_code);
  if (!c) continue;
  const arr = erpBy.get(c) || [];
  arr.push(p);
  erpBy.set(c, arr);
}

/**
 * 보증금 배율 판정용 **임시** 레코드. 유입(`sheet-import` 의 priceRecord)이 하는 것과 같다.
 * ★국산/수입은 저장하지 않는다 — 여기서 만들어 이 한 번의 계산에만 쓰고 버린다.
 *   매물에 써 넣으면 마스터가 바뀔 때 기존 재고 보증금이 조용히 흔들린다
 *   (`sim-sheet-price` 의 MASTER-ORIGIN 항목이 그걸 막는다. 2026-08-12에 모르고 546대에
 *    써 넣었다가 `unset-product-origin` 으로 걷어냈다).
 * ★제조사 원문이 없으면 «같은 모델명 후보들의 만장일치»만 믿는다. 갈리면 공란 = fail-closed.
 *   스냅된 maker 는 쓰지 않는다 — 낮은 확신도가 배율을, 곧 금액을 바꾼다.
 */
const priceRecordFor = (p: Rec, hdr: string[], cells: string[]): EntityRecord => {
  const at = (re: RegExp) => { const i = hdr.findIndex((h) => re.test(h)); return i >= 0 ? S(cells[i]) : ''; };
  const rawMaker = at(/^제조사|^메이커/);
  const rawModel = at(/^차종|^모델명|^차명/);
  /**
   * ★제조사 원문이 없을 땐 **스냅된 모델명**으로 판정한다 — 유입이 그렇게 한다.
   *   시트 원문은 「그랜저 HEV」·「K8 HEV」처럼 마스터에 없는 이름이라 그대로 대면 판정이 안 되고,
   *   보증금을 못 구해 그 차의 요금이 통째로 빠진다(실측 2026-08-12 · 오플 14대).
   *   스냅된 이름(「그랜저」)은 마스터 노드 자체라 만장일치 판정이 성립한다.
   */
  const consensus = rawMaker ? '' : unambiguousMasterOrigin({ model: S(p.model) || rawModel } as EntityRecord, MASTER);
  return {
    ...p,
    _snapped: true,
    _raw_vehicle: { maker: rawMaker, model: rawModel, sub_model: '' },
    origin: consensus,
    _deposit_origin_trusted: !!consensus,
  } as EntityRecord;
};

/** 우리가 만든 배포용 시트 목록 — 한 번만 훑는다. */
const oursQ = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const OURS = ((await api(`https://www.googleapis.com/drive/v3/files?q=${oursQ}&pageSize=100&fields=files(id,name)`)).files || []) as Rec[];

console.log('■ 공급사 시트 ↔ ERP ↔ 우리 시트 대조 (읽기 전용)\n');
for (const [code, partner] of [...byCode].sort((a, b) => a[0].localeCompare(b[0]))) {
  const name = S(partner.partner_name || partner.name || partner.company_name) || code;
  if (ONLY && !name.includes(ONLY) && code !== ONLY) continue;
  const erp = erpBy.get(code) || [];
  if (!erp.length && !S(partner.sheet_url)) continue;
  // 아이언은 홈페이지(ironrentcar.com) 수집이다. 시트가 없는 게 정상이니 «빠뜨렸다»고 하면 안 된다.
  if (NOT_SHEET_BACKED.has(code)) {
    console.log(`  ${name}(${code})  ERP ${erp.length}대 — 시트가 정본이 아닌 공급사(홈페이지 수집). 대조 대상 아님.\n`);
    continue;
  }
  const id = (S(partner.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
  if (!id) {
    console.log(`  ${name}(${code})  ERP ${erp.length}대 — ★시트가 연결돼 있지 않다. 시트로 갱신되지 않는 재고다.\n`);
    continue;
  }

  let rule: ReturnType<typeof parseDepositRule> = '';
  try { rule = parseDepositRule(partner.deposit_rule); } catch { rule = ''; }
  let grid: Rec;
  try {
    grid = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`,
      { headers: { Authorization: `Bearer ${gT}` } })).json() as Rec;
  } catch (e) {
    console.log(`  ${name}(${code})  시트를 못 읽었다 — ${String(e)}\n`);
    continue;
  }
  if (grid?.error) { console.log(`  ${name}(${code})  시트를 못 읽었다 — ${S(grid.error.message)}\n`); continue; }
  const read = readSupplierSheet(grid as never, partner as EntityRecord);

  const rows = new Map<string, { hdr: string[]; cells: string[] }>();
  let sheetRows = 0;
  for (const t of read.tabs) {
    const hdr = (t.table[0] || []).map(S);
    const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
    if (pi < 0) continue;
    for (const cells of t.table.slice(1)) {
      const pl = norm(cells[pi]);
      if (!pl) continue;
      sheetRows++;
      if (!rows.has(pl)) rows.set(pl, { hdr, cells: cells.map(S) });
    }
  }

  /** 우리가 만든 배포용 시트(있으면). 없다고 문제인 건 아니다 — 아직 안 만든 공급사가 있다. */
  const short = name.replace(/\(주\)|주식회사|㈜/g, '').replace(/\s/g, '');
  const mine = OURS.find((f) => {
    const lab = S(f.name).replace('프리패스 재고 · ', '').replace(/\s/g, '');
    return lab === short || short.includes(lab) || lab.includes(short);
  });
  const minePlates = new Set<string>();
  if (mine) {
    const m2 = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(mine.id)}?fields=sheets.properties.title`);
    for (const t of ((m2.sheets || []) as Rec[]).map((sh) => S(sh.properties?.title)).filter(isVehicleTab)) {
      const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${S(mine.id)}/values/${encodeURIComponent(`${t}!A1:BZ600`)}`);
      const rr = ((v.values || []) as string[][]);
      const hh = (rr[0] || []).map(S);
      const ip = hh.indexOf('차량번호');
      if (ip < 0) continue;
      for (const r of rr.slice(1)) { const pl = norm(r[ip]); if (pl) minePlates.add(pl); }
    }
  }

  let ok = 0;
  const rentBad: string[] = []; const depBad: string[] = []; const noPrice: string[] = [];
  const notInSheet: string[] = []; const notInErp: string[] = [];
  const seen = new Set<string>();
  for (const p of erp) {
    const pl = norm(p.car_number);
    const row = pl ? rows.get(pl) : undefined;
    if (!row) { notInSheet.push(`${pl || '(번호없음)'} ${S(p.maker)} ${S(p.model)}`.trim()); continue; }
    seen.add(pl);
    const want = parsePriceColumns(row.hdr, row.cells, priceRecordFor(p, row.hdr, row.cells), rule);
    if (!want) { noPrice.push(`${pl} ${S(p.maker)} ${S(p.model)}`.trim()); continue; }
    const now = (p.price || {}) as Price;
    const rentDiff = Object.entries(want).filter(([k, v]) => Number(now[k]?.rent) !== v.rent);
    const depDiff = Object.entries(want).filter(([k, v]) => Number(now[k]?.rent) === v.rent && Number(now[k]?.deposit) !== v.deposit);
    const extra = Object.keys(now).filter((k) => !(k in want));
    if (rentDiff.length || extra.length) {
      const head = rentDiff.slice(0, 2).map(([k, v]) => `${k} 시트 ${won(v.rent)} vs ERP ${won(Number(now[k]?.rent) || 0)}`).join(' · ');
      rentBad.push(`${pl} ${S(p.model)} — ${head}${extra.length ? ` · 시트에 없는 기간 ${extra.join(',')}` : ''}`);
    } else if (depDiff.length) {
      rentDiff.length = 0;
      depBad.push(`${pl} ${S(p.model)} — ${depDiff.slice(0, 2).map(([k, v]) => `${k} 시트 ${won(v.deposit)} vs ERP ${won(Number(now[k]?.deposit) || 0)}`).join(' · ')}`);
    } else ok++;
  }
  for (const pl of rows.keys()) if (!seen.has(pl)) notInErp.push(pl);

  const flag = (n: number) => (n ? '★' : ' ');
  console.log(`  ${name}(${code})  보증금규칙 ${rule || '시트 칸에서 읽음'}`);
  console.log(`    공급사시트 ${rows.size}대(줄 ${sheetRows})${read.failures.length ? ` · 못 읽은 탭 ${read.failures.map((f) => `「${S((f as Rec).title)}」`).join(' ')}` : ''} · ERP ${erp.length}대 · 우리시트 ${mine ? `${minePlates.size}대` : '—(안 만듦)'}`);
  if (mine) {
    // 셋의 차집합 — 어디에 있고 어디에 없는지가 «안 맞는다»의 실체다.
    const onlyMine = [...minePlates].filter((pl) => !rows.has(pl));
    const notMine = [...rows.keys()].filter((pl) => !minePlates.has(pl));
    if (onlyMine.length || notMine.length) {
      console.log(`     ★우리시트에만 ${onlyMine.length}대 · 공급사시트에만 ${notMine.length}대`);
      if (onlyMine.length) console.log(`       우리시트에만: ${onlyMine.slice(0, DETAIL ? 40 : 6).join(' · ')}${onlyMine.length > (DETAIL ? 40 : 6) ? ` … 외 ${onlyMine.length - (DETAIL ? 40 : 6)}대` : ''}`);
      if (notMine.length) console.log(`       공급사시트에만: ${notMine.slice(0, DETAIL ? 40 : 6).join(' · ')}${notMine.length > (DETAIL ? 40 : 6) ? ` … 외 ${notMine.length - (DETAIL ? 40 : 6)}대` : ''}`);
    }
  }
  console.log(`     맞음 ${ok}대 ${flag(rentBad.length)}요금 다름 ${rentBad.length}대 ${flag(depBad.length)}보증금만 다름 ${depBad.length}대 ${flag(noPrice.length)}시트에서 요금 못 구함 ${noPrice.length}대`);
  console.log(`     ${flag(notInSheet.length)}ERP에만 있음 ${notInSheet.length}대 ${flag(notInErp.length)}시트에만 있음 ${notInErp.length}대`);
  const dump = (label: string, xs: string[], n = DETAIL ? 40 : 4) => {
    if (!xs.length) return;
    console.log(`       ${label}`);
    for (const x of xs.slice(0, n)) console.log(`         ${x}`);
    if (xs.length > n) console.log(`         … 외 ${xs.length - n}대`);
  };
  dump('요금 다름', rentBad);
  dump('보증금만 다름', depBad);
  dump('요금 못 구함', noPrice);
  dump('ERP에만', notInSheet);
  dump('시트에만', notInErp);
  console.log('');
}
