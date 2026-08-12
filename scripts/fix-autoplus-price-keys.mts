/**
 * **오토플러스 요금·보증금을 시트대로 다시 넣는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★무엇이 틀렸나(2026-08-12 · 강지수 팀장 제보)
 *   오플 시트 요금 열은 「12개월3만 · 18개월2만 · 24개월2만 · 36개월2만」인데,
 *   옛 어댑터가 **열 이름을 안 읽고 자리 순서로** 12·24·36·48 에 갖다 붙였다.
 *   그래서 18개월 요금이 24개월로, 24개월이 36개월로 올라가고 **없는 48개월이 생겼다.**
 *   제보 예시 311저1956 — 시트에 48개월이 없는데 ERP 에 750,000 으로 떠 있었다.
 *
 * ★고치는 법 — 유입과 **같은 함수**(`parsePriceColumns`)로 다시 읽는다.
 *   여기서 규칙을 새로 짜면 화면·계약서와 또 갈라진다. 읽는 법은 한 곳에만 있어야 한다.
 *     요금    열 이름이 키다. 「18개월2만」 → `18_2만`. 맨숫자 키(12·24·36·48)는 지운다.
 *     보증금  **오플 시트에는 보증금 열이 없다.** 파트너의 `deposit_rule = rent_multiple`,
 *             즉 **대여료 × 배율(국산 2 · 수입 3)** 로 계산한다. 옛 보증금을 옮겨오지 않는다 —
 *             그 값은 «틀린 기간에 붙은 대여료»로 계산된 것이라 같이 틀렸다.
 *
 * ⚠ 제조사를 못 정한 차는 배율이 안 나온다(fail-closed). 그런 차는 **손대지 않고 이름만 남긴다** —
 *   보증금을 지어내느니 옛 값을 두는 게 낫다.
 * ⚠ 시트에 없는 차, 시트에서 요금을 못 읽은 차도 손대지 않는다. 못 읽은 것과 «없는 것»은 다르다.
 *
 *   npx tsx scripts/fix-autoplus-price-keys.mts
 *   npx tsx scripts/fix-autoplus-price-keys.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { parseDepositRule, parsePriceColumns, unambiguousMasterOrigin } from '../lib/domain/sheet-import';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
type Price = Record<string, { rent: number; deposit: number }>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const won = (n: number) => n.toLocaleString('ko-KR');
const APPLY = process.argv.includes('--apply');
const CODE = 'RP023';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/** 차종마스터 — 국산/수입 만장일치 판정에 쓴다(저장하지 않는다). */
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as Rec;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];


const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

const [prods, t3, t4] = await Promise.all(['v4/products', 'partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const partner = Object.values<Rec>(partners).find((x) => !dead(x) && S(x.partner_code) === CODE && S(x.sheet_url));
const id = (S(partner?.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
if (!id) { console.log('■ 오토플러스 시트 주소가 없다\n'); process.exit(1); }
const rule = parseDepositRule(partner?.deposit_rule);

const grid = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`,
  { headers: { Authorization: `Bearer ${gT}` } })).json();
const read = readSupplierSheet(grid as never, partner as EntityRecord);
/** 차번 → 그 줄(헤더+셀). 요금 해석은 유입과 같은 함수에 맡긴다. */
const rows = new Map<string, { tab: string; hdr: string[]; cells: string[] }>();
for (const t of read.tabs) {
  const hdr = (t.table[0] || []).map(S);
  const pi = hdr.findIndex((h) => /차량번호|차번/.test(h));
  if (pi < 0) continue;
  for (const cells of t.table.slice(1)) {
    const pl = norm(cells[pi]);
    if (pl && !rows.has(pl)) rows.set(pl, { tab: t.title, hdr, cells: cells.map(S) });
  }
}
console.log(`■ 오토플러스 요금·보증금 바로잡기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  보증금 규칙 ${rule || '(없음)'} — 대여료 × 배율(국산 2 · 수입 3)`);
console.log(`  시트에서 읽은 차 ${rows.size}대${read.failures.length ? ` · 못 읽은 탭 ${read.failures.map((f) => `「${S((f as Rec).title)}」`).join(' ')}` : ''}\n`);

/**
 * 보증금 배율 판정용 **임시** 레코드. 유입(`sheet-import` 의 priceRecord)이 하는 것과 같다.
 * ★국산/수입은 저장하지 않는다 — 여기서 만들어 이 한 번의 계산에만 쓰고 버린다.
 *   매물에 써 넣으면 마스터가 바뀔 때 기존 재고 보증금이 조용히 흔들린다
 *   (`sim-sheet-price` 의 MASTER-ORIGIN 항목이 그걸 막는다).
 * ★제조사 원문이 없으면 «같은 모델명 후보들의 만장일치»만 믿는다. 갈리면 공란 = fail-closed.
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
    // 스냅된 maker 를 배율 판정에 쓰지 않는다 — 낮은 확신도가 금액을 흔든다. 시트 원문만 쓴다.
    _snapped: true,
    _raw_vehicle: { maker: rawMaker, model: rawModel, sub_model: '' },
    origin: consensus,
    _deposit_origin_trusted: !!consensus,
  } as EntityRecord;
};

type Fix = { key: string; plate: string; name: string; now: Price; want: Price };
const fixes: Fix[] = [];
const noMult: string[] = [];      // 제조사를 못 정해 배율이 안 나온 차
let same = 0;
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  if ((S(p.provider_company_code) || S(p.partner_code)) !== CODE) continue;
  const row = rows.get(norm(p.car_number));
  if (!row) continue;
  // ★유입과 같은 함수·같은 규칙. 보증금은 이 안에서 대여료×배율로 계산된다.
  const want = parsePriceColumns(row.hdr, row.cells, priceRecordFor(p, row.hdr, row.cells), rule);
  const label = `${norm(p.car_number)} ${S(p.maker)} ${S(p.model)}`.trim();
  if (!want) { noMult.push(label); continue; }
  const now = (p.price || {}) as Price;
  const eq = Object.keys(want).length === Object.keys(now).length
    && Object.entries(want).every(([kk, v]) => Number(now[kk]?.rent) === v.rent && Number(now[kk]?.deposit) === v.deposit);
  if (eq) { same++; continue; }
  fixes.push({ key: k, plate: norm(p.car_number), name: `${S(p.maker)} ${S(p.model)}`.trim(), now, want });
}
const show = (m: Price) => Object.entries(m).map(([kk, v]) => `${kk} ${won(Number(v?.rent) || 0)}/${won(Number(v?.deposit) || 0)}`).join(' · ');
console.log(`  고칠 차 ${fixes.length}대 · 이미 맞는 차 ${same}대${noMult.length ? ` · 배율 미확정으로 건너뛴 차 ${noMult.length}대` : ''}\n`);
for (const f of fixes.slice(0, 5)) {
  console.log(`   ${f.plate} ${f.name}`);
  console.log(`     지금 ${show(f.now)}`);
  console.log(`     시트 ${show(f.want)}`);
}
if (fixes.length > 5) console.log(`   … 외 ${fixes.length - 5}대`);
if (noMult.length) {
  console.log(`\n  △ 제조사를 못 정해 보증금 배율이 안 나온 차 ${noMult.length}대 — 손대지 않았다`);
  for (const n of noMult.slice(0, 10)) console.log(`     ${n}`);
}

mkdirSync('tmp', { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/autoplus-price-backup-${stamp}.json`;
writeFileSync(backup, JSON.stringify(Object.fromEntries(fixes.map((f) => [f.key, f.now])), null, 1), 'utf8');
console.log(`\n  되돌리기용 백업: ${backup}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
/**
 * ★시트에 없어 못 맞춘 차의 «옛 키»만 걷어낸다.
 *   차번이 없거나(번호미정 신차) 시트에서 빠진 차는 위에서 손대지 못한다. 그런데 그 차들도
 *   **옳은 꼬리표 키(`12_3만`·`18_2만`…)를 이미 갖고 있고**, 그 위에 자리로 박힌 맨숫자 키가
 *   중복으로 얹혀 있다. 그 중복이 「없는 48개월」의 정체다.
 *   숫자를 새로 만들지 않고 **중복만 지운다** — 꼬리표 키가 있는 차에 한해서다.
 */
let stripped = 0;
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  if ((S(p.provider_company_code) || S(p.partner_code)) !== CODE) continue;
  if (fixes.some((f) => f.key === k)) continue;      // 위에서 통째로 갈아 끼운 차는 대상 아님
  const now = (p.price || {}) as Price;
  const keys = Object.keys(now);
  const legacy = keys.filter((kk) => /^\d+$/.test(kk));
  const tails = keys.filter((kk) => kk.includes('_'));
  if (!legacy.length || !tails.length) continue;     // 꼬리표가 없으면 그게 유일한 요금이다 — 못 지운다
  const next: Price = {};
  for (const kk of tails) next[kk] = now[kk];
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(k)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: next, updatedAt: at }),
  });
  if (res.ok) stripped++; else console.log(`  △ ${norm(p.car_number) || k} — ${res.status}`);
}
if (stripped) console.log(`
  시트에 없어 옛 키만 걷어낸 차 ${stripped}대`);
let done = 0;
for (const f of fixes) {
  // price 를 통째로 갈아 끼운다 — 맨숫자 키를 남기면 그게 다시 이긴다.
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(f.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: f.want, updatedAt: at }),
  });
  if (res.ok) done++; else console.log(`  △ ${f.plate} — ${res.status}`);
}
console.log(`\n  고침 ${done}대\n`);
