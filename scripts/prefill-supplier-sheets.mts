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
import { periodColumnName } from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').map(S).filter(Boolean);
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
const codeOf = (label: string): string => {
  const l = label.replace(/\s/g, '');
  if (nameToCode.has(l)) return nameToCode.get(l)!;
  for (const [n, c] of nameToCode) if (n.includes(l) || l.includes(n)) return c;
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

  const cars = (byCode.get(code) || []).slice()
    .sort((a, b) => Number(isListableProduct(b)) - Number(isListableProduct(a))
      || S(a.car_number).localeCompare(S(b.car_number)));
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
    put('연식', Number(rec.year) || '');
    put('연료', S(rec.fuel_type));
    put('주행거리', Number(rec.mileage) || '');
    put('배기량', Number(rec.engine_cc) || '');
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
  console.log(`  ${label.padEnd(12)} ${String(cars.length).padStart(4)}대${orphan ? `  △ 열이 없는 요금 ${orphan}건 — ${[...orphanNames].map(([k, v]) => `${k}(${v})`).join(' · ')}` : ''}`);
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
