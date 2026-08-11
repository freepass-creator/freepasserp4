/**
 * **새 공급사 시트에 지금 재고를 채워 넣는다.** 기본 dry-run, 실제 쓰기는 `--apply`.
 *
 * 빈 양식만 주면 공급사가 수십 대를 처음부터 다시 쳐야 한다. ERP 가 이미 그 업체 시트를
 * 읽어 정규화해 둔 값이 있으므로 그대로 옮겨 준다 — 공급사는 **틀린 것만 고치면** 된다.
 *
 * ★ERP 에서 옮긴다(공급사 원본 시트가 아니라).
 *   원본은 회사마다 열 이름·순서가 다르고 숨긴 행·중복이 섞여 있다. ERP 는 그걸 규격대로
 *   읽어 접어 둔 결과고, 오늘 「시트 = ERP = 화면」을 맞춰 놨다. 그러니 ERP 가 옮길 원본이다.
 *
 * ★안전 계약
 *   · 운영 정본 시트(파트너 `sheet_url`)에는 쓰지 않는다.
 *   · **이미 입력된 시트는 건너뛴다** — 공급사가 손댄 뒤에 덮으면 되돌릴 수 없다(`--force` 로 강제).
 *   · 헤더는 손대지 않는다. 그 시트의 헤더를 읽어 **이름으로** 칸을 맞춘다 —
 *     열 순서가 바뀌어도 값이 엉뚱한 칸에 들어가지 않는다.
 *
 *   npx tsx scripts/prefill-supplier-sheets.mts
 *   npx tsx scripts/prefill-supplier-sheets.mts --apply
 *   npx tsx scripts/prefill-supplier-sheets.mts --apply --only=RP013
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { canonProductType, isListableProduct, priceList, priceVariants } from '../lib/domain/product';
import { autoMapHeaders, canonSheetVehicleStatus, parsePriceColumns } from '../lib/domain/sheet-import';
import { NOT_SHEET_BACKED, SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { periodColumnName } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
/** 차번 대조용 — 공백을 걷어 「12가 3456」과 「12가3456」을 같게 본다. */
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').map(S).filter(Boolean);
/** 공급사 자기 시트에만 있는 차도 함께 싣는다. 끄려면 `--erp-only`. */
const WITH_ORIGIN = !process.argv.includes('--erp-only');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const VEHICLE_TAB = '재고';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (url: string, init?: RequestInit, tries = 5): Promise<Rec> => {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && i < tries) { await sleep(20000 * (i + 1)); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };

/** 공급사별 재고 — 목록에 서는 차가 위로 오게 둔다. */
const byCode = new Map<string, EntityRecord[]>();
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  if (!code) continue;
  byCode.set(code, [...(byCode.get(code) || []), { ...p, _key: k, product_code: p.product_code || k } as EntityRecord]);
}

/**
 * 숫자 칸 — ERP 에는 **콤마 붙은 글자**로 들어 있는 값이 많다(`"311,000"`).
 * `Number()` 로 바로 읽으면 NaN 이라 통째로 빠진다 — 빌린카 47대 주행거리가 그래서 비었다(2026-08-11).
 */
function numOf(v: unknown): number | '' {
  const n = Number(S(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : '';
}

/**
 * 연식 — 없으면 **최초등록일의 연도**를 쓴다(사장님 확정 2026-08-11).
 * 「2024-03-15」도 「16-12」도 온다. 두 자리면 2000년대로 본다.
 */
function yearOf(rec: Rec): number | '' {
  const y = numOf(rec.year);
  if (y) return y;
  const first = S(rec.first_registration_date);
  const m = first.match(/^(\d{4})/) || first.match(/^(\d{2})[-./]/);
  if (!m) return '';
  const n = Number(m[1]);
  return n >= 1000 ? n : 2000 + n;
}

/** 차명(트림) — 한 칸에 이어 쓴다. 파서가 문장 전체를 보고 세대·사양까지 잡는다. */
function carName(p: Rec): string {
  const parts = [S(p.sub_model) || S(p.model), S(p.variant), S(p.trim_name)].map(S).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) if (!out.some((x) => x.includes(part))) out.push(part);
  return out.join(' ').trim();
}

/** 그 차의 기간별 대여료와 보증금. 단기(1·12)와 장기(24~60)의 보증금은 따로 관할한다. */
function moneyOf(p: EntityRecord): { rent: Map<string, number>; shortDep: number; longDep: number } {
  const rent = new Map<string, number>();
  let shortDep = 0; let longDep = 0;
  const rows = [...priceList(p), ...priceVariants(p)];
  for (const row of rows) {
    const key = 'key' in row ? S((row as Rec).key) : String((row as Rec).m);
    const name = periodColumnName(key);
    const r = Number((row as Rec).rent) || 0;
    if (r > 0 && !rent.has(name)) rent.set(name, r);
    const d = Number((row as Rec).deposit) || 0;
    const m = Number((row as Rec).m) || 0;
    if (d > 0) {
      if (m <= 12 && !shortDep) shortDep = d;
      if (m >= 24 && !longDep) longDep = d;
    }
  }
  return { rent, shortDep, longDep };
}

console.log(`■ 새 공급사 시트에 지금 재고를 채운다 ${APPLY ? '(반영)' : '(dry-run)'}${FORCE ? ' · --force' : ''}\n`);

const liveSheetIds = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1];
  if (id) liveSheetIds.add(id);
}
const nameToCode = new Map<string, string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  for (const n of [p.partner_name, p.name, p.company_name].map(S).filter(Boolean)) nameToCode.set(n.replace(/\s|\(주\)|주식회사|㈜/g, ''), code);
}
/**
 * 시트 이름의 공급사 → 파트너 코드.
 *
 * ★«품기»만으로 고르면 안 된다(실측 2026-08-11). 「경진」이 「경진카 주식회사」에 먼저 걸려
 *   경진렌트카(RP015) 시트에 경진카(RP016) 차 3대가 실렸다. 순서를 세운다.
 *     ① 똑같은 이름  ② 그 이름으로 시작하는 것  ③ 그래도 여럿이면 «가장 짧은 이름»
 *   ③은 「경진」이 「경진렌트카」와 「경진카주식회사」에 다 걸릴 때 더 가까운 쪽을 고르게 한다.
 */
const codeOf = (label: string): string => {
  const l = label.replace(/\s/g, '');
  if (nameToCode.has(l)) return nameToCode.get(l)!;
  const starts = [...nameToCode].filter(([n]) => n.startsWith(l));
  if (starts.length === 1) return starts[0][1];
  const holds = [...nameToCode].filter(([n]) => n.includes(l) || l.includes(n));
  if (holds.length === 1) return holds[0][1];
  // ★여럿에 걸리면 고르지 않는다 — 찍으면 남의 회사 차가 실린다.
  return '';
};

const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`);

let filledSheets = 0; let filledCars = 0;
for (const f of ((found.files || []) as Rec[])) {
  const id = S(f.id);
  const label = S(f.name).replace('프리패스 재고 · ', '');
  const code = codeOf(label);
  if (!code) { console.log(`  △ ${label.padEnd(12)} 공급사를 못 찾음`); continue; }
  if (ONLY.length && !ONLY.includes(code)) continue;
  if (liveSheetIds.has(id)) { console.log(`  △ ${label.padEnd(12)} ★운영 정본 시트 — 쓰지 않는다`); continue; }

  /**
   * ★**아무 정보도 없는 행은 옮기지 않는다**(사장님 지적 2026-08-11).
   *   차명도 대여료도 없는 껍데기를 옮기면 공급사 시트에 빈 줄만 늘고,
   *   상태 칸만 「출고불가」로 떠서 «이게 뭐냐»가 된다. ERP 에는 그대로 둔다 —
   *   여기서 안 보여 줄 뿐이지 지우는 게 아니다.
   */
  /**
   * ★ERP 에 아직 없는 차도 싣는다(사장님 지적 2026-08-11).
   *   웰릭스가 자기 시트에 두 대를 더 넣었는데 둘 다 「출고불가」라 유입이 안 만들었고,
   *   우리 시트는 ERP 만 보고 있어 그 두 대가 통째로 빠졌다.
   *   우리 시트는 «그 공급사가 지금 가진 것»을 보여야 하므로 원본 시트도 함께 읽는다.
   */
  const fromOrigin: EntityRecord[] = [];
  const partner = Object.values<Rec>(partners).find((x) => !dead(x) && S(x.partner_code) === code && S(x.sheet_url));
  const originId = (S(partner?.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
  if (WITH_ORIGIN && originId && originId !== id && !NOT_SHEET_BACKED.has(code)) {
    try {
      const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${originId}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
      for (const t of readSupplierSheet(grid as never, partner as EntityRecord).tabs) {
        try {
          const hdr = (t.table[0] || []).map(S);
          const prof = autoMapHeaders(hdr) as Record<string, number | undefined>;
          if (prof.car_number === undefined) continue;
          /**
           * ★유입(`importSheetTable`)을 쓰지 않는다 — 그건 **출고불가 행을 버린다**.
           *   버리는 게 맞다(팔 수 없는 차를 ERP 에 올리면 안 되니까). 하지만 우리 시트는
           *   «그 공급사가 지금 가진 것»을 보여 주는 자리라 출고불가도 실려야 한다.
           *   웰릭스가 넣은 두 대가 둘 다 출고불가라 통째로 빠졌다(실측 2026-08-11).
           *   그래서 열 지도만 빌려 쓰고 행은 직접 읽는다.
           */
          const pick = (row: string[], key: string) => {
            const i = prof[key];
            return typeof i === 'number' && i >= 0 ? S(row[i]) : '';
          };
          for (const row of t.table.slice(1)) {
            const plate = norm(pick(row, 'car_number'));
            if (!plate) continue;
            fromOrigin.push({
              car_number: plate,
              vehicle_status: canonSheetVehicleStatus(pick(row, 'vehicle_status')),
              product_type: pick(row, 'product_type'),
              maker: pick(row, 'maker'),
              model: pick(row, 'model'),
              sub_model: pick(row, 'sub_model'),
              trim_name: pick(row, 'trim_name'),
              options: pick(row, 'options'),
              ext_color: pick(row, 'ext_color'),
              int_color: pick(row, 'int_color'),
              year: pick(row, 'year'),
              fuel_type: pick(row, 'fuel_type'),
              mileage: pick(row, 'mileage'),
              engine_cc: pick(row, 'engine_cc'),
              first_registration_date: pick(row, 'first_registration_date'),
              photo_link: S(t.photoByPlate[plate]) || pick(row, 'photo_link'),
              /**
               * ★요금도 함께 옮긴다. 스펙 칸만 옮겼더니 원본에만 있던 차가
               *   대여료 없이 실려 그대로 «팔 수 없는 차»가 됐다 —
               *   리더스 34호9093·34호9182 가 그랬다(실측 2026-08-11).
               *   보증금 블록 스코프까지 원본 파서(`parsePriceColumns`)에 맡긴다.
               */
              price: parsePriceColumns(hdr, row, {} as EntityRecord, partner?.deposit_rule) || undefined,
            } as EntityRecord);
          }
        } catch { /* 탭 하나가 안 읽혀도 나머지는 싣는다 */ }
      }
    } catch { console.log(`  △ ${label.padEnd(12)} 공급사 원본을 못 읽음 — ERP 것만 싣는다`); }
  }

  const all = byCode.get(code) || [];
  const erpPlates = new Set(all.map((p) => norm((p as Rec).car_number)).filter(Boolean));
  const extra = fromOrigin.filter((p) => {
    const pl = norm((p as Rec).car_number);
    return pl && !erpPlates.has(pl);
  });
  const cars = [...all, ...extra].filter((p) => {
    const rec = p as Rec;
    const hasName = [S(rec.sub_model), S(rec.model), S(rec.trim_name)].some(Boolean);
    return S(rec.car_number) && (hasName || priceList(p).length > 0);
  }).slice()
    .sort((a, b) => Number(isListableProduct(b)) - Number(isListableProduct(a))
      || S(a.car_number).localeCompare(S(b.car_number)));
  const dropped = all.length + extra.length - cars.length;
  if (!cars.length) { console.log(`  · ${label.padEnd(12)} ERP 재고 없음 — 빈 양식 그대로`); continue; }

  // 헤더를 읽어 **이름으로** 칸을 맞춘다.
  const head = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${VEHICLE_TAB}!A1:BZ2`)}`);
  const header = ((head.values || [])[0] || []).map(S) as string[];
  const already = ((head.values || [])[1] || []).some((c: unknown) => S(c));
  if (!header.length) { console.log(`  △ ${label.padEnd(12)} 헤더가 없다 — 먼저 양식을 찍어라`); continue; }
  if (already && !FORCE) { console.log(`  △ ${label.padEnd(12)} 이미 입력돼 있다 — 덮지 않는다 (--force)`); continue; }

  const at = (name: string) => header.indexOf(name);
  const rows = cars.map((p) => {
    const row: (string | number)[] = Array(header.length).fill('');
    const put = (name: string, v: string | number) => { const i = at(name); if (i >= 0 && v !== '' && v != null) row[i] = v; };
    const rec = p as Rec;
    put('차량번호', S(rec.car_number));
    put('상태', S(rec.vehicle_status));
    // ★분류는 **드롭다운 4종**으로 정규화해서 넣는다. ERP 에는 옛말(「재렌트」·「재구독」)이
    //   남아 있는데 그대로 내보내면 공급사 시트에 목록 밖 값이 박힌다.
    put('분류', S(canonProductType(rec.product_type)) || S(rec.product_type));
    put('제조사', S(rec.maker));
    put('차명(트림)', carName(rec));
    put('옵션', S(rec.options));
    put('외부색상', S(rec.ext_color));
    put('내부색상', S(rec.int_color));
    put('연식', yearOf(rec));
    put('연료', S(rec.fuel_type));
    // 주행거리·배기량도 표 밖이라 숫자 그대로 둔다 — 서식이 콤마를 붙인다.
    put('주행거리', numOf(rec.mileage));
    put('배기량', numOf(rec.engine_cc));
    put('정책코드', S(rec.policy_code));
    put('최초등록일', S(rec.first_registration_date));
    put('사진링크', S(rec.photo_link));
    const { rent, shortDep, longDep } = moneyOf(p);
    if (shortDep) put('단기보증', shortDep);
    if (longDep) put('장기보증', longDep);
    for (const [name, amount] of rent) put(name, amount);
    return row;
  });

  // 기간 열에 없는 요금(기타기간)은 버려지면 안 된다 — 몇 대가 그런지 세어 보인다.
  const known = new Set(header);
  const orphanNames = new Map<string, number>();
  for (const p of cars) for (const k of moneyOf(p).rent.keys()) if (!known.has(k)) orphanNames.set(k, (orphanNames.get(k) || 0) + 1);
  const orphan = [...orphanNames.values()].reduce((n, v) => n + v, 0);
  console.log(`  ${label.padEnd(12)} ${String(cars.length).padStart(4)}대${extra.length ? `  (공급사 시트에만 있는 ${extra.length}대 포함)` : ''}${dropped ? `  (정보 없는 ${dropped}대 제외)` : ''}${orphan ? `  △ 열이 없는 요금 ${orphan}건 — ${[...orphanNames].map(([k, v]) => `${k}(${v})`).join(' · ')}` : ''}`);
  filledSheets++; filledCars += cars.length;

  if (!APPLY) continue;
  const lastCol = String.fromCharCode(64 + Math.ceil(header.length / 26)) + String.fromCharCode(65 + ((header.length - 1) % 26));
  const range = `${VEHICLE_TAB}!A2:${header.length > 26 ? lastCol : String.fromCharCode(65 + header.length - 1)}${rows.length + 1}`;
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: rows }),
  });
}

console.log(`\n  시트 ${filledSheets}개 · 차 ${filledCars}대${APPLY ? ' 채움' : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
