/**
 * 공급사 «원천 직접 → Firestore 원자화» — 범용(코드만 갈아끼운다). 정제시트를 안 거친다.
 *
 * 사장님 2026-09-04 「공급사가 입력하는 곳에서 네가 직접 따서 원자화하고 상품시트에 뿌린다.
 *   차량번호로 차종마스터 한 번 학습해 박으면 틀릴 일이 없다 — 우리 것만 보면 되니까.
 *   실사용 전환하고 다른 것도 동일하게.」
 *
 * 핵심 셋:
 *  ① 원본 열 이름이 공급사마다 달라도 `MIRROR_ALIAS`(우리필드→원본열 후보)로 «자동 해석».
 *  ② 차 탭은 «헤더에 차량번호+상태가 있으면」 자동 감지 — 탭 이름을 공급사마다 안 적는다.
 *  ③ ★차번으로 «우리가 박아둔 것»을 먼저 본다. 있으면 그대로(재-snap 안 함). 없는 차번만 마스터 학습.
 *     → 아는 차는 구조적으로 동일, 세대강등 사고 0.
 *
 * 기본 = 대조(dry-run, 읽기만). --apply = Firestore products 에 씀(불변 merge + pin) · 사라진 차 listable=false.
 * 실행: GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json \
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/ingest-supplier-to-firestore.mts --code=RP004 [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listSheetTabs, readSheetGrid } from '../lib/server/google-sheets';
import { HUB_CODE_SHEET_ID } from '../lib/domain/legacy-sheets';
import { isOurNonInventoryTab } from '../lib/domain/supplier-template-sheet';
import { companyAlias } from '../lib/domain/identity';
import { pickSupplierSource, hubSourceMap, hubNameMap, myStockTabs } from '../lib/domain/supplier-source';
import { snapToMaster, makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';
import { normFuel } from '../lib/domain/vehicle-master-format';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { canonProductType } from '../lib/domain/product';
import { composeVehicleName, MIRROR_ALIAS } from '../lib/domain/mirror-sheet-mapping';
import { snapColor } from '../lib/domain/color-master';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { sheetIdFromUrl } from '../lib/domain/supplier-sheet-read';
import { FUEL_EV, rawSeats, atomViolations, type MasterIndex } from '../lib/domain/atom-invariants';

const APPLY = process.argv.includes('--apply');
const CODE = (process.argv.find((a) => a.startsWith('--code='))?.split('=')[1] || 'RP004').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const won = (v: unknown) => { const n = Number(S(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
type Price = Record<string, { rent: number; deposit: number }>;
const PERIOD_ALIAS: [string, string[]][] = [['1', ['1개월', '월렌트', '월세']], ['6', ['6개월']], ['12', ['12개월']], ['18', ['18개월']], ['24', ['24개월']], ['36', ['36개월']], ['48', ['48개월']], ['60', ['60개월']]];

// Firestore 먼저 — 원천 레지스트리(partner.sheet_url)와 원자를 여기서 읽는다.
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

// 원천 종류 셋 — 시트(공급사 구글시트) · 홈피(ironrentcar.com) · 손오공(API 덤프 JSON).
type Kind = 'sheet' | 'iron' | 'sonokong';
const SON_CODE = 'RP012';
async function srcConfig(): Promise<{ code: string; name: string; kind: Kind; from?: string; shared?: string[] }> {
  if (CODE === SON_CODE || CODE === 'SONOKONG' || CODE === '손오공') return { code: SON_CODE, name: '손오공', kind: 'sonokong' };
  const m = MIRROR_SOURCES.find((x) => x.code === CODE);
  if (m) return { code: m.code, name: m.name, kind: m.kind as Kind, from: m.from };
  /**
   * 나머지 공급사 = **문패(공급사시트정리)가 정본**. `partner.sheet_url` 은 늦는 사본이라 마지막 수단이다.
   * ⚠ 2026-09-08 — 이 자리가 `partner.sheet_url` 만 봤고, 그 값이 **폐기된 옛 시트**여서
   *   웰릭스가 24일 동안 죽은 시트를 읽었다(K8 이 「모닝」으로 들어왔다). 규칙 SSOT = `lib/domain/supplier-source`.
   */
  const snap = await fs.collection('partner').where('partner_code', '==', CODE).limit(1).get();
  const p = snap.docs[0]?.data() as { name?: string; sheet_url?: string } | undefined;
  const hubRows = (await readSheetGrid(HUB_CODE_SHEET_ID, (await listSheetTabs(HUB_CODE_SHEET_ID))[0]));
  const hub = hubSourceMap([hubRows.header, ...hubRows.rows]);
  const pick = pickSupplierSource(CODE, hub, p?.sheet_url);
  console.log(`  원천 주소 ← ${pick.from} · ${pick.id}`);
  /** ★한 시트를 «여러 회사»가 나눠 쓰는가 — 그러면 탭으로 갈라 읽어야 한다(아래 readRows). */
  const shared = [...hub].filter(([, id]) => id === pick.id).map(([c]) => c);
  /** ★이름도 문패가 정본이다 — 재고 탭을 회사별로 가를 때 「경진렌트카」·「경진카」처럼 정확해야 한다. */
  const hubName = hubNameMap([hubRows.header, ...hubRows.rows]).get(CODE.toUpperCase());
  return { code: CODE, name: S(hubName) || S(p?.name) || CODE, kind: 'sheet', from: pick.id, shared };
}
const src = await srcConfig();
const PROV = src.code;   // Firestore 태깅·pin 조회는 공급사 정식 코드로(손오공=RP012)
const SHEET = src.from || '';

// ── 마스터 ────────────────────────────────────────────────────────────────
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
const SUB = new Map<string, { maker: string; model: string; sub_model: string }>();
for (const e of MASTER) {
  const mk = S(e.maker), mo = S(e.model), sm = S(e.sub_model);
  if (!mk || !mo || !sm) continue;
  for (const a of makerGroup(N(mk))) SUB.set(`${a}|${N(mo)}|${N(sm)}`, { maker: mk, model: mo, sub_model: sm });
}
const validCanon = (maker: unknown, model: unknown, sub: unknown) => {
  const mo = N(model), sm = N(sub); if (!mo || !sm) return null;
  for (const a of makerGroup(N(maker))) { const hit = SUB.get(`${a}|${mo}|${sm}`); if (hit) return hit; }
  return null;
};
// 세부모델 → 마스터 트림 목록 (검증용). 별칭 제조사 전개.
const TRIMS = new Map<string, string[]>();
for (const e of MASTER) {
  if (!e.trims?.length) continue;
  for (const a of makerGroup(N(e.maker))) TRIMS.set(`${a}|${N(e.model)}|${N(e.sub_model)}`, e.trims);
}
const trimsFor = (maker: unknown, model: unknown, sub: unknown) => {
  for (const a of makerGroup(N(maker))) { const t = TRIMS.get(`${a}|${N(model)}|${N(sub)}`); if (t) return t; }
  return [];
};
// 불변식 게이트에 넘길 마스터 인덱스 — 원자화가 «이 규칙»으로 확정 여부를 정한다.
const IDX: MasterIndex = { validSub: (mk, mo, sm) => !!validCanon(mk, mo, sm), trimsOf: trimsFor };

// (제조사별칭|모델) → 세대들 — 수입차 세대 판별용(섀시코드·연식범위).
const GENS = new Map<string, { sub: string; gen: string; ys: number; ye: number }[]>();
for (const e of MASTER) {
  const g = N(S((e as { gen_code?: string }).gen_code)); if (!g) continue;
  const ys = Number((e as { year_start?: unknown }).year_start) || 0, ye = Number((e as { year_end?: unknown }).year_end) || 9999;
  for (const a of makerGroup(N(e.maker))) { const k = `${a}|${N(e.model)}`; if (!GENS.has(k)) GENS.set(k, []); GENS.get(k)!.push({ sub: S(e.sub_model), gen: g, ys, ye }); }
}
const regYearMonth = (s: string): [number, number] => {
  const m = S(s).match(/(20\d{2}|19\d{2})[.\-/](\d{1,2})/); if (m) return [Number(m[1]), Number(m[2])];
  const y = yearOf(s); return [Number(y) || 0, 0];
};
/**
 * ★수입차 세대 판별 — 우선순위:
 *   ① 원문에 섀시코드(W213·G30·F40…) → snap 이 이미 반영, 그대로. (가장 확실)
 *   ② 표기 없음(수입차 흔함) → 최초등록으로 신형 판별(구형 단종 뒤 신규등록=신형). E-클래스 2024=W214.
 *   국산차는 원문에 세대코드(CN7…)가 있어 ①에서 걸린다 — 최초등록 추론까지 안 간다(안전판).
 *
 * ⚠ 원문의 「N세대」 숫자는 «안» 쓴다 — 시장은 브랜드 시작(E-클래스=W124)부터 세는데 마스터는 그 이전
 *    (W123…)까지 담아 순번이 어긋난다(6세대: 시장=W214 · 마스터순번=W213). 그 숫자로 매핑하면 틀린다
 *    (사장님 2026-09-04 「6세대 214라고 확인된다」). 섀시코드·최초등록만 믿는다.
 */
function resolveGen(maker: unknown, model: unknown, curSub: string, firstReg: string, rawN: string): string {
  let gens: { sub: string; gen: string; ys: number; ye: number }[] = [];
  for (const a of makerGroup(N(maker))) { const g = GENS.get(`${a}|${N(model)}`); if (g) { gens = g; break; } }
  if (gens.length < 2) return curSub;
  if (gens.some((g) => g.gen.length >= 3 && rawN.includes(g.gen))) return curSub; // ① 원문에 섀시코드 → 그대로
  const [ry, rm] = regYearMonth(firstReg); if (!ry) return curSub;                 // ② 최초등록으로 신형 판별
  const cands = gens.filter((g) => g.ys <= ry && ry <= g.ye).sort((a, b) => b.ys - a.ys);
  if (!cands.length || N(cands[0].sub) === N(curSub)) return curSub;
  if (ry === cands[0].ys && rm && rm < 7) return curSub; // 교체연도 상반기면 애매 → snap 유지
  return cands[0].sub;
}
const yearOf = (firstReg: string) => {
  const s = S(firstReg);
  const full = s.match(/(20\d{2}|19\d{2})/); if (full) return full[1];
  const yy = s.match(/^\s*(\d{2})[.\-/]/); return yy ? `20${yy[1]}` : '';
};

// 전기차 배기량 청소 — «원천 연료»가 전기·수소면 배기량 없음. (규칙 SSOT = atom-invariants)
//   ⚠ 세부모델 «이름»(일렉트리파이드)으로는 판단 안 한다 — 이름 오매핑 위험(2026-09-05). FUEL_EV·rawSeats 도 SSOT.
const evEngineCc = (fuel: string, cc: string): string => (FUEL_EV.test(fuel) ? '' : cc);

// 상태 디테일 — mirror-to-firestore 와 «같은» 분류(한 값에 안 뭉침). status·status_kind·status_reason·listable.
const AVAIL = new Set(['즉시출고', '출고가능']);
function statusDetail(rawStatus: string, locked?: unknown) {
  const raw = S(rawStatus);
  let cur = canonSheetVehicleStatus(raw) || '차량검수';
  if (/계약중/.test(raw)) cur = '계약중';
  else if (/점검|검수|정비/.test(raw)) cur = '차량검수';
  let kind = '불가', reason = '';
  if (cur === '즉시출고' || cur === '출고가능') kind = '가용';
  else if (cur === '출고협의') { kind = '협의'; reason = '공급사협의'; }
  else if (cur === '상품화중') { kind = '준비'; reason = '상품화중'; }
  else if (cur === '차량검수') { kind = '준비'; reason = '검수대기'; }
  else if (cur === '계약중') { kind = '선점'; reason = locked ? '계약선점' : '공급사표기'; }
  else if (cur === '출고불가') { kind = '불가'; reason = (AVAIL.has(raw) || raw === '출고협의') ? '시트이탈' : (raw ? '공급사불가' : '정보없음'); }
  /**
   * ★★**상태는 «한 벌»이다** — `vehicle_status` 가 정본이고 나머지는 거기서 파생된다.
   *   ⚠ 2026-09-08 실측: 직접수집이 `status` 만 쓰고 `vehicle_status` 를 안 써서, 한 차가
   *   `status=출고가능` · `vehicle_status=출고불가` 로 **두 값을 동시에** 들고 있었다(108대).
   *   판매시트·문지기는 `vehicle_status`, ERP 일부는 `status` 를 읽어 «판 차가 목록에 다시 서는» 길이 열렸다.
   *   규칙 SSOT = `docs/원자-내려보내기-로직.md` §1.
   */
  return { vehicle_status: cur, status: cur, status_kind: kind, status_reason: reason, listable: kind !== '불가', status_label_raw: raw };
}

// ── 원본 열 자동 해석 (MIRROR_ALIAS) ───────────────────────────────────────
const aliasOf = (our: string) => MIRROR_ALIAS.find(([k]) => k === our)?.[1] || [our];
function resolveCols(hdr: string[]) {
  const H = hdr.map(N);
  const find = (cands: string[]) => { for (const c of cands) { const i = H.indexOf(N(c)); if (i >= 0) return i; } return -1; };
  return {
    status: find(aliasOf('상태')), car: find(aliasOf('차량번호')), kind: find(aliasOf('분류')),
    model: find(aliasOf('모델명')), trim: find(['트림', '세부트림']), maker: find(aliasOf('제조사')),
    vname: find(aliasOf('차명(세부모델+트림)')),   // 공급사 원본 차명 열 — iron·손오공처럼 시트도 이걸 «먼저» 본다
    fuel: find(aliasOf('연료')), ext: find(aliasOf('외부색상')), int: find(aliasOf('내부색상')),
    km: find(aliasOf('주행거리')), opt: find(aliasOf('옵션')), firstReg: find(aliasOf('최초등록일')),
    cc: find(aliasOf('배기량')), klass: find(['차급', '차종크기', '차급분류', '차종분류']),
    dep: find(['장기보증', '보증금']), periods: Object.fromEntries(PERIOD_ALIAS.map(([k, c]) => [k, find(c)])) as Record<string, number>,
  };
}
// 시트/홈피 행에서 요금 = {개월: {rent, deposit}}. rent=개월열(원화) · deposit=장기보증(무보증=0, 전 기간 공통).
function sheetPrice(get: (i: number) => string, ci: { dep: number; periods: Record<string, number> }): Price {
  const dep = won(ci.dep >= 0 ? get(ci.dep) : '');
  const price: Price = {};
  for (const [pk, idx] of Object.entries(ci.periods)) { if (idx < 0) continue; const rent = won(get(idx)); if (rent > 0) price[pk] = { rent, deposit: dep }; }
  return price;
}
/**
 * ★**보증금이 «말»로 적힌 것을 잃지 않는다** (사장님 2026-09-08 「보증금 잘 챙기고」).
 *
 * ⚠ 실측 2026-09-08 — 아이카 96대 중 **51대**가 시트에 보증금 빈칸이었다. 그런데 원천에는
 *   장기보증 칸에 **「무보증」**이라 «적혀» 있었다. `won('무보증') = 0` 이라 숫자로만 실었더니
 *   시트에서 빈칸이 됐고, 빈칸은 **「없다」가 아니라 「모른다」로 읽힌다** — 영업자가 물어봐야 한다.
 *   ⇒ 숫자가 아닌 보증금은 **그 말을 그대로** 싣는다. 오토플러스 규칙문구와 같은 결이다.
 */
const depositNote = (raw: string) => {
  const s = S(raw);
  if (!s || won(s) > 0) return '';
  /**
   * ⚠ **숫자꼴은 «말»이 아니다.** 원천이 「0」·「-」을 적어 둔 칸도 `won()`이 0 이라 여기로 온다.
   *   그대로 실으면 시트에 **「장기보증=0」**이 서는데, 0원은 사람이 쓰는 말이 아니다(실측 2026-09-08 경진 2대).
   *   ⇒ 한글·영문이 든 «말»만 싣는다 — 「무보증」·「협의」처럼 읽으면 뜻이 통하는 것.
   */
  return /[가-힣A-Za-z]/.test(s) ? s : '';
};

// ── 원천 리더 — 종류마다 «우리필드 키 행(Row)»을 낸다. 원자화는 하나로 공유한다. ──────
type Row = { car: string; status: string; kind: string; maker: string; model: string; vname: string; trim: string; fuel: string; ext: string; int: string; km: string; opt: string; firstReg: string; cc: string; klass: string; price: Price; depNote: string; tab: string; row: string };
const blank: Omit<Row, 'car' | 'tab' | 'row'> = { status: '', kind: '', maker: '', model: '', vname: '', trim: '', fuel: '', ext: '', int: '', km: '', opt: '', firstReg: '', cc: '', klass: '', price: {}, depNote: '' };

// 번호판 꼴만 차로 본다 — 헤더 밑 제목·프로모 배너·빈 행이 «차»로 새는 걸 막는다(오토플러스 실측).
const isPlate = (s: string) => /\d{2,3}\s*[가-힣]\s*\d{4}/.test(S(s));
async function readRows(): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  const push = (o: Partial<Row> & { car: string; tab: string; row: string }) => {
    if (!o.car || seen.has(o.car) || !isPlate(o.car)) return;
    /**
     * ★**우리 수수료·원가가 적힌 줄은 원자로 만들지 않는다** (사장님 2026-09-08).
     *   공급사 원본에는 「★★★ 전기차 프로모션(수수료 150만원) 페이지 참고 ★★★」 같은 배너 줄이 섞인다.
     *   차번 가드를 지나더라도 그 글자가 원자에 남으면 **영업자·영업채널 시트로 우리 몫이 새어 나간다.**
     *   실측 2026-09-08 — 오플 배너 3줄이 원자에 들어와 오플구독 탭 2행에 서 있었다.
     */
    if (/수수료|커미션|마진|원가/.test(`${o.car} ${S((o as any).vname)}`)) return;
    seen.add(o.car);
    out.push({ ...blank, ...o });
  };
  if (src.kind === 'iron') {
    const { rowsFromIronCatalog } = await import('../lib/domain/mirror-iron-source');
    const got = await rowsFromIronCatalog();
    console.log(`  원본 ironrentcar.com — 목록 ${got.listings} · 활성 ${got.active} · 판매완료 ${got.sold} · 상세실패 ${got.errors}`);
    const g = (m: Map<string, string>, col: string) => S(m.get(N(col)));
    for (const [plate, m] of got.rows) {
      const dep = won(g(m, '장기보증')); const price: Price = {};
      for (const [pk, cands] of PERIOD_ALIAS) { for (const c of cands) { const rent = won(g(m, c)); if (rent > 0) { price[pk] = { rent, deposit: dep }; break; } } }
      push({ car: g(m, '차량번호') || plate, status: g(m, '상태'), kind: g(m, '분류'), maker: g(m, '제조사'), model: g(m, '모델명'), vname: g(m, '차명(세부모델+트림)'), fuel: g(m, '연료'), ext: g(m, '외부색상'), int: g(m, '내부색상'), km: g(m, '주행거리'), opt: g(m, '옵션'), firstReg: g(m, '최초등록일') || g(m, '연식'), cc: g(m, '배기량'), klass: g(m, '분류'), price, tab: 'ironrentcar.com', row: plate });
    }
    return out;
  }
  if (src.kind === 'sonokong') {
    const dump = JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 차량?: Record<string, unknown>[] };
    const cars = dump.차량 || [];
    console.log(`  원본 손오공 API 덤프 — ${cars.length}대`);
    for (const c of cars) {
      const car = S(c.차번); if (!car) continue;
      const status = c.계약중 ? '계약중' : (S(c.계약가능) === 'Y' ? '출고가능' : '출고협의');
      // 요금 = 저신용월납. RETURN=반납형(개월키) · BUYOUT=인수형(개월_인수형). deposit=(개월/12)×rent(현행 규칙).
      const price: Price = {};
      const low = (c.저신용월납 || {}) as { SUBSCRIBE_RETURN?: Record<string, number>; SUBSCRIBE_BUYOUT?: Record<string, number> };
      for (const [p, rent] of Object.entries(low.SUBSCRIBE_RETURN || {})) { const r = won(rent); if (r > 0) price[p] = { rent: r, deposit: Math.round((Number(p) / 12) * r) }; }
      for (const [p, rent] of Object.entries(low.SUBSCRIBE_BUYOUT || {})) { const r = won(rent); if (r > 0) price[`${p}_인수형`] = { rent: r, deposit: Math.round((Number(p) / 12) * r) }; }
      /**
       * ★★**손오공 상품구분은 «버킷»이 말해 준다** — 원천이 진작 주고 있었는데 안 읽었다.
       * ```
       *   TCAR_EXTERNAL  227대  →  픽업구독   (티카에서 온 차)
       *   SON_NO_KONG     64대  →  오공구독   (손오공 제 물건)
       * ```
       * ⚠ 2026-09-08 실측 — 여기서 「중고면 중고구독, 아니면 «빈칸»」으로 읽고 있었다. 그 빈칸이
       *   merge 로 나가 **이미 알던 픽업구독·오공구독을 246대나 지웠다**(상품구분 빈 차 4 → 312).
       *   탭 가르기가 이 칸을 보므로, 비면 그 차가 통째로 상품리스트로 흘러가 시트 넉 장이 뒤섞인다.
       * ★「오공구독」은 7캐논에 이미 있다 — 손오공 제 물건을 「중고구독」이라 부르던 옛 표기를 여기서 끝낸다.
       */
      const 버킷 = S(c.버킷);
      const kind = 버킷 === 'TCAR_EXTERNAL' ? '픽업구독' : (버킷 === 'SON_NO_KONG' ? '오공구독' : (c.중고 ? '중고구독' : ''));
      push({ car, status, kind, maker: S(c.제조사), model: S(c.모델), vname: S(c.차명) || S(c.세부), fuel: S(c.연료), ext: S(c.외장), int: S(c.내장), km: c.주행거리 == null ? '' : String(c.주행거리), opt: S(c.옵션), firstReg: S(c.최초등록) || S(c.연식), cc: c.배기량 == null ? '' : String(c.배기량), klass: '', price, tab: '손오공API', row: S(c.id) });
    }
    return out;
  }
  // 시트형 — 탭·머리행 자동탐지 후 MIRROR_ALIAS 로 열 해석.
  /**
   * ★**재고가 아닌 탭은 읽지 않는다** (규칙 SSOT = `isOurNonInventoryTab`).
   *   ⚠ 2026-09-08 — 여기가 «모든 탭»을 읽어서 오토플러스의
   *   「★★★ … 프로모션(수수료 150만원) ★★★」 탭이 재고로 들어왔다. 배너 줄이 차가 됐고,
   *   그 탭 열 이름이 달라 기간키가 두 벌(`12_3만` 옆에 `12_20000`)이 되어 시트 칸이 갈렸다.
   *   발행기는 진작 이 규칙을 썼는데 수집기만 안 썼다 — 같은 규칙을 양쪽이 쓴다.
   */
  const allTabs = await listSheetTabs(SHEET);
  let tabs = allTabs.filter((t) => !isOurNonInventoryTab(t));
  const 뺀탭 = allTabs.filter((t) => isOurNonInventoryTab(t));
  if (뺀탭.length) console.log(`  재고 아닌 탭 ${뺀탭.length}장 건너뜀 — ${뺀탭.map((t) => t.slice(0, 24)).join(' · ')}`);

  /**
   * ★★**한 시트를 여러 회사가 나눠 쓰면 «제 탭»만 읽는다.**
   *
   * ⚠⚠ 2026-09-08 실측 사고 — 스타(RP018)와 스카이(RP033)가 시트 하나를 「스타재고」·「스카이재고」
   *   두 탭으로 나눠 쓴다. 경진렌트(RP015)·경진카(RP016)도 마찬가지다. 그런데 여기서 **모든 탭을 읽고
   *   `--code` 하나로 통째 태그**해서, 스카이 차 10대가 스타 것이 되고 경진카 3대가 경진렌트 것이 됐다.
   *   ★공급사 코드는 **정산이 매달리는 열쇠**다 — 남의 차를 우리 회사 것으로 적으면 돈이 어긋난다.
   *   (문지기가 「공급사가 통째로 0대 — RP033 10→0」으로 잡아 회차를 막았다. 그래서 알았다.)
   *
   * ⇒ 문패에 같은 주소를 쓰는 코드가 둘 이상이면, **회사 이름이 든 탭만** 읽는다.
   *   ⚠ 짝이 하나도 없으면 «전부 읽는» 쪽으로 돌아가지 않는다 — **아무것도 안 읽고 멈춘다.**
   *     남의 차를 우리 것으로 적느니 그 회차를 거르는 게 낫다.
   */
  if ((src.shared?.length || 0) > 1) {
    const 나 = S(src.name);
    const 내탭 = myStockTabs(tabs, 나);
    /**
     * ★★**탭이 둘이라고 회사가 둘인 게 아니다** (사장님 2026-09-08 「스카이랑 스타가 같은 계열이라서 …
     *   공급사도 탭 2개로 관리하나?? 잘봐봐」 — 보니 **아니었다**).
     *   우리가 관계사마다 재고 탭을 둘 만들어 줬는데, 실제로 둘 다 쓰는 곳은 «경진» 하나뿐이다:
     * ```
     *   스타·스카이   회사정보 「(주) 스타스카이」 · 사업자번호 하나 · 정산 탭도 하나
     *                 스타재고 25줄 · 스카이재고 0줄     → 한 회사, 탭 하나만 쓴다
     *   경진          경진카재고 3 · 경진렌트재고 3      → 진짜 둘 다 쓴다
     *   빌린카·엘씨   빌린카재고 48 · 엘씨재고 0         → 재고는 한 탭, 정산은 둘로 갈려 있다
     * ```
     * ★그래도 **읽는 규칙은 하나로 단순하게** — «내 이름이 든 탭»만 읽는다.
     *   내 탭이 비었으면 그건 «내 재고가 없다»는 뜻이지, 남의 탭을 읽을 이유가 아니다.
     *   (한 계열을 한 덩이로 보여 주는 것은 발행 쪽 몫이다 — `build-channel-supplier-sheet` 의 FAMILY.)
     */
    if (!내탭.length) {
      console.error(`\n✗ ${PROV}(${src.name}): 이 시트는 ${src.shared!.join('·')} 가 나눠 쓴다.`);
      console.error(`  그런데 「${나}」 이름이 든 탭이 없다 — 탭 ${tabs.join(' · ')}`);
      console.error(`  전부 읽으면 남의 차를 우리 코드로 적게 된다(정산이 어긋난다). 아무것도 안 읽고 멈춘다.`);
      process.exit(1);
    } else {
      console.log(`  ★시트를 ${src.shared!.length}곳이 나눠 쓴다 — 「${나}」 탭만 읽는다: ${내탭.join(' · ')}`);
      tabs = 내탭;
    }
  }
  for (const tab of tabs) {
    const grid = await readSheetGrid(SHEET, tab);
    const allRows = [grid.header, ...grid.rows];
    let hi = -1;
    for (let k = 0; k < Math.min(allRows.length, 8); k++) { const c = resolveCols(allRows[k]); if (c.car >= 0 && c.status >= 0) { hi = k; break; } }
    if (hi < 0) continue;
    const ci = resolveCols(allRows[hi]);
    let rowNo = hi + 1;
    for (const r of allRows.slice(hi + 1)) {
      rowNo += 1;
      const car = S(r[ci.car]); if (!car) continue;
      const model = ci.model >= 0 ? S(r[ci.model]) : '';
      const trim = ci.trim >= 0 ? S(r[ci.trim]) : '';
      const maker0 = ci.maker >= 0 ? S(r[ci.maker]) : '';
      // ★공급사 원문 차명 — 「어떤 형태로든지」 준 것을 다 훑는다(사장님 2026-09-05):
      //   원본 차명 열 → (없으면) 모델+트림 합성 → (그것도 없으면) 제조사+모델+트림. 빈 채로 굳지 않게.
      // ⚠★**제조사 한 마디만 남으면 차명이 아니다 — 비운다.**
      //   실측 2026-09-08: 웰릭스가 옆 시트의 「차명(트림)」 열을 못 읽어 vname이 「기아」가 됐고,
      //   매칭기가 그걸 보고 K8을 **모닝**으로, 카니발을 **스포티지**로 붙였다.
      //   「모른다」는 빈 칸으로 남기는 게 맞다 — 그래야 「원문없음」으로 잡혀 검수 목록에 오른다.
      const rawVname = ci.vname >= 0 ? S(r[ci.vname]) : '';
      const composed = rawVname || composeVehicleName(model, trim) || [maker0, model, trim].filter(Boolean).join(' ');
      const vname = N(composed) === N(maker0) ? '' : composed;
      const price = sheetPrice((i) => S(r[i]), ci);
      const depNote = depositNote(ci.dep >= 0 ? S(r[ci.dep]) : '');
      push({ car, status: S(r[ci.status]), kind: ci.kind >= 0 ? S(r[ci.kind]) : '', maker: maker0, model, vname, trim, fuel: ci.fuel >= 0 ? S(r[ci.fuel]) : '', ext: ci.ext >= 0 ? S(r[ci.ext]) : '', int: ci.int >= 0 ? S(r[ci.int]) : '', km: ci.km >= 0 ? S(r[ci.km]) : '', opt: ci.opt >= 0 ? S(r[ci.opt]) : '', firstReg: ci.firstReg >= 0 ? S(r[ci.firstReg]) : '', cc: ci.cc >= 0 ? S(r[ci.cc]) : '', klass: ci.klass >= 0 ? S(r[ci.klass]) : '', price, depNote, tab, row: String(rowNo) });
    }
  }
  return out;
}

/**
 * ★★**빈 값으로 «아는 값»을 덮지 않는다.**
 *
 * ⚠⚠ 2026-09-08 실측 — 손오공을 다시 당겼더니 **상품구분이 빈 차가 4대 → 312대**로 뛰었다.
 *   손오공 원천은 「중고」가 아닌 차의 분류를 안 준다(`kind: ''`). 그 빈 값이 merge 로 나가면서
 *   **이미 알고 있던 「픽업구독」·「오공구독」을 지워 버렸다.** 탭 가르기가 이 칸을 보므로,
 *   비면 그 차가 통째로 상품리스트로 흘러간다 — 회차 한 번으로 시트 넉 장이 뒤섞인다.
 *
 * ★원천이 «말 안 한 것»은 «없다」가 아니라 «모른다»다. 모르는 것으로 아는 것을 지우지 않는다.
 *   (규칙 SSOT = `docs/원자-내려보내기-로직.md` §1)
 * ★단 하나 예외 = `engine_cc` — 전기·수소차는 배기량이 «없는 것»이 맞다(evEngineCc 가 일부러 비운다).
 */
const CLEARABLE = new Set(['engine_cc']);
const strip = (doc: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === '' && !CLEARABLE.has(k)) continue;   // 빈 문자열 = 「모른다」 → 안 쓴다
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
};

// ── 원자화 (pin: 차번으로 박은 것 지킴) — 원천 종류 무관하게 하나로 ────────────
type Atom = Record<string, unknown> & { car_number: string };
function atomize(row: Row, pinned: Map<string, Record<string, unknown>>): Atom {
  const car = row.car, vname = row.vname;
  const pin = pinned.get(car);
  const pinConfirmed = !!pin && !!S(pin.sub_model) && (pin.확정 === true || S(pin.검수상태) === '확정');
  let identity: { maker: string; model: string; sub_model: string; trim_name: string; origin: string };
  let confirmed: boolean;
  let state: 'pinned' | 'new-high' | 'new-review';
  let spec: Record<string, string>;
  if (pinConfirmed && pin) {
    identity = { maker: S(pin.maker), model: S(pin.model), sub_model: S(pin.sub_model), trim_name: S(pin.trim_name), origin: S(pin.origin) };
    confirmed = true; state = 'pinned';
    spec = { ext_color: S(pin.ext_color), int_color: S(pin.int_color), year: S(pin.year), fuel_type: S(pin.fuel_type), engine_cc: S(pin.engine_cc), vehicle_class: S(pin.vehicle_class), first_registration_date: S(pin.first_registration_date) };
  } else {
    const snap = snapToMaster({ maker: row.maker, model: row.model, vehicle_name: vname, sub_model: vname, fuel_type: row.fuel, year: yearOf(row.firstReg) } as EntityRecord, MASTER) as
      { maker?: string; model?: string; sub_model?: string; trim_name?: string; origin?: string; confidence?: string } | null;
    const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
    const conf = snap?.confidence || 'none';
    confirmed = !!canon && conf === 'high';
    identity = canon
      /**
       * ★**세부트림이 비면 「기본형」** (`docs/차종명명-정제-매뉴얼` §3 · 사장님 2026-09-04
       *   「티카는 옵션이 없는 게 기본형이어서 없는 건가?」 — 그렇다. 옵션 없는 차가 기본형이다).
       *   ⚠ 실측 2026-09-08 — 이 규칙이 «치유기»에만 있고 수집기엔 없어서, 세부모델이 확정된 차 16대가
       *   트림 빈칸으로 남았다. 규칙이 한 곳에만 있으면 다른 길로 들어온 차는 그 규칙을 못 받는다.
       *   ★세부모델이 마스터에 «있는» 차에만 붙인다 — 모르는 차에 기본형을 찍으면 그게 지어낸 값이다.
       */
      ? { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, trim_name: S(snap?.trim_name) || S(row.trim) || '기본형', origin: S(snap?.origin) }
      : { maker: row.maker, model: row.model, sub_model: '', trim_name: row.trim, origin: '' };
    // ★세대 판별 — 원문의 「N세대」·섀시코드가 답, 없으면 최초등록으로 신형.
    if (canon) identity.sub_model = resolveGen(identity.maker, identity.model, identity.sub_model, row.firstReg, N(vname));
    state = confirmed ? 'new-high' : 'new-review';
    spec = {
      ext_color: snapColor(row.ext, 'ext'), int_color: snapColor(row.int, 'int'),
      year: yearOf(row.firstReg), fuel_type: normFuel(row.fuel),
      engine_cc: row.cc, vehicle_class: row.klass, first_registration_date: row.firstReg,
    };
  }
  const atom: Atom = {
    car_number: car,
    maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name: identity.trim_name, origin: identity.origin, ...spec, engine_cc: evEngineCc(S(spec.fuel_type), S(spec.engine_cc)),
    product_type: canonProductType(row.kind),
    ...statusDetail(row.status, pin?.locked_by_contract), mileage: row.km, options: row.opt,
    ...(rawSeats(vname) ? { seats: rawSeats(vname) } : null),   // 원문에 인승 있으면만
    ...(Object.keys(row.price).length ? { price: row.price } : null),
    ...(row.depNote ? { deposit_note: row.depNote } : null),   // 「무보증」처럼 «말»로 적힌 보증금 — 빈칸으로 두지 않는다
    _pin_state: state,
    원문: { 차명: vname, ...(row.opt ? { 옵션: row.opt } : null) },
    /**
     * ★★**코드만 박지 말고 «이름»을 같이 박는다** (사장님 2026-09-08 「이제 절대 코드명으로 공급사 취급 안 할 거야」).
     *   ⚠ 실측 2026-09-08 — 여기가 코드만 써서, 직접수집으로 «새로 들어온» 차 20대가 시트에
     *   「RP012」·「RP006」으로 섰다. 이름은 옛 미러가 얹어 주던 것이라, 미러가 안 도는 차는 이름이 없다.
     *   ★이름 정본은 **문패**다(`src.name` = 문패 「공급사명」). 못 찾으면 «비운다» — 코드로 때우지 않는다.
     */
    provider_company_code: PROV, partner_code: PROV,
    ...(S(src.name) && S(src.name) !== PROV ? { provider_name: S(src.name) } : null),
    source: src.kind, source_schema: PROV, sheet_source_tab: row.tab, sheet_source_row: row.row,
  };
  // ★불변식 게이트 — block 위반이 있으면 «확정될 수 없다»(검수대기). 모순이 확정된 채 존재하는 게 구조적으로 불가능.
  const vio = atomViolations(atom, IDX);
  const blocks = vio.filter((x) => x.severity === 'block');
  const ok = confirmed && blocks.length === 0;
  atom.확정 = ok;
  atom.검수상태 = ok ? '확정' : (blocks.length ? `검수(${blocks[0].code})` : (identity.sub_model ? '검수대기' : (vname ? '매칭실패' : '원문없음')));
  if (vio.length) atom._violations = vio.map((x) => `${x.severity[0]}:${x.code}`).join(' ');
  return atom;
}

async function ingest(pinned: Map<string, Record<string, unknown>>): Promise<Atom[]> {
  const rows = await readRows();
  return rows.map((r) => atomize(r, pinned));
}

// ── 현행 원자(우리 것) — 차번별 pin 정본 ───────────────────────────────────
const cur = new Map<string, Record<string, unknown>>();
{
  const snap = await fs.collection('products').where('provider_company_code', '==', PROV).get();
  for (const d of snap.docs) cur.set(S((d.data() as { car_number?: unknown }).car_number), d.data() as Record<string, unknown>);
}

const now = await ingest(cur);
console.log(`\n■ ${PROV}(${src.name}) 원천 직접 수집 — ${now.length}대 (정제시트 안 거침 · 우리 것 ${cur.size}대 참조)`);
const n = now.length || 1;
const pctOf = (x: number) => `${x}/${now.length} (${Math.round((x / n) * 100)}%)`;
const has = (f: string) => now.filter((a) => S(a[f])).length;
const byPin: Record<string, number> = {};
for (const a of now) byPin[S(a._pin_state)] = (byPin[S(a._pin_state)] || 0) + 1;
console.log(`  정체 출처: 박은 것 그대로 ${byPin.pinned || 0} · 새 차 자동확정 ${byPin['new-high'] || 0} · 새 차 검수필요 ${byPin['new-review'] || 0}`);
console.log(`  세부모델 ${pctOf(has('sub_model'))} · 세부트림 ${pctOf(has('trim_name'))} · 제조사 ${pctOf(has('maker'))} · 연식 ${pctOf(has('year'))} · 연료 ${pctOf(has('fuel_type'))}`);
console.log(`  외장색 ${pctOf(has('ext_color'))} · 내장색 ${pctOf(has('int_color'))} · 배기량 ${pctOf(has('engine_cc'))} · 상태 ${pctOf(has('status'))} · 주행 ${pctOf(has('mileage'))}`);

// 대조 (아는 차 = 우리 것과 같아야)
const IDF = ['maker', 'model', 'sub_model', 'trim_name', 'ext_color', 'int_color', 'year', 'fuel_type'] as const;
const ingestedCars = new Set(now.map((a) => a.car_number));
let both = 0, idSame = 0, priceSame = 0, priceBoth = 0;
// 깊은 정렬 JSON — 안쪽 {rent,deposit} 키 순서 차이로 «다르다」 오판하지 않게(현행은 {deposit,rent}).
const jsonP = (o: unknown) => JSON.stringify(o ?? {}, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v);
for (const a of now) {
  const c = cur.get(a.car_number); if (!c) continue; both++;
  if (IDF.every((f) => N(a[f]) === N(c[f]))) idSame++;
  /**
   * ⚠ **요금이 «없는» 차가 있다** — 출고불가·상품화중이거나 공급사가 아직 값을 안 적은 차다.
   *   `a.price` 는 값이 있을 때만 붙는 칸이라 없으면 `undefined` 인데, 그대로 `Object.keys` 를 부르면 죽는다.
   *   실측 2026-09-08 — 웰릭스(RP013)가 매 회차 여기서 터져 **원자가 통째로 안 들어왔다**.
   *   그 집 차 여섯 대가 시트엔 41~44칸이 차 있는데 원자엔 12~14칸뿐이던 것이 이 한 줄 때문이다.
   *   ★대조 «통계»를 내다가 유입 전체를 죽이면 안 된다 — 통계는 못 내도 원자는 들어와야 한다.
   */
  if (a.price && Object.keys(a.price).length && c.price) { priceBoth++; if (jsonP(a.price) === jsonP(c.price)) priceSame++; }
}
const gone = [...cur.keys()].filter((k) => !ingestedCars.has(k)); // 우리 것엔 있는데 원천에서 사라진 차
const fresh = now.filter((a) => !cur.has(a.car_number)).length; // 원천엔 있는데 우리 것에 없던 새 차
console.log(`  대조: 아는 차 불변일치 ${both ? Math.round((idSame / both) * 100) : 0}% (${idSame}/${both}) · 새 차 ${fresh} · 사라진 차(정리대상) ${gone.length}`);
console.log(`  요금 일치: ${priceBoth ? Math.round((priceSame / priceBoth) * 100) : 0}% (${priceSame}/${priceBoth}, 양쪽에 요금 있는 차)`);

const VARIABLE = process.argv.includes('--variable');
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$[\]]/g, '_');
/**
 * ★**변동 폴링이 만지는 칸** — 「자주 바뀌는 것」만.
 *   ⚠ 2026-09-08 — 여기에 `vehicle_status` 가 빠져 있었다. 그래서 변동만 돌린 차는 `status` 만 바뀌고
 *   `vehicle_status` 는 옛 값에 머물러 **상태가 두 벌**이 됐다(시트·손님 면은 `vehicle_status` 를 읽는다).
 */
const VAR_FIELDS = ['vehicle_status', 'status', 'status_kind', 'status_reason', 'listable', 'status_label_raw', 'mileage', 'price'] as const;

// ── 검증(--verify) — 원자를 «차종마스터 ↔ 원문»과 대조. 제대로 당겼나 한 번 본다. ──
if (process.argv.includes('--verify')) {
  let mValid = 0, mOut = 0, tMatch = 0, tOut = 0, tEmpty = 0, rawMiss = 0;
  const outL: string[] = [], tOutL: string[] = [], rawL: string[] = [];
  for (const a of now) {
    const raw = S((a.원문 as { 차명?: string })?.차명);
    const label = `${a.car_number} 「${raw.slice(0, 30)}」 → ${a.maker} ${a.model}/${a.sub_model}/${S(a.trim_name) || '(트림공백)'}`;
    const valid = !!validCanon(a.maker, a.model, a.sub_model);
    if (valid) mValid++; else { mOut++; if (outL.length < 15) outL.push('  ✗마스터밖 ' + label); }
    const trims = trimsFor(a.maker, a.model, a.sub_model);
    const t = S(a.trim_name);
    if (!t) tEmpty++;
    else if (trims.some((x) => N(x) === N(t))) tMatch++;
    else { tOut++; if (tOutL.length < 15) tOutL.push(`  ✗트림밖 ${a.car_number} 트림「${t}」 ∉ [${trims.slice(0, 6).join('·') || '마스터 트림없음'}]`); }
    // 원문 대조 — 세부모델의 마스터 표기 핵심 글자가 원문에 없으면 오매칭 의심.
    if (valid && N(a.model) && raw && !N(raw).includes(N(a.model))) { rawMiss++; if (rawL.length < 15) rawL.push('  ?원문불일치 ' + label); }
  }
  console.log(`\n■ 검증 (차종마스터 ↔ 원문) — ${PROV}(${src.name}) ${now.length}대`);
  console.log(`  마스터 유효: ${mValid}/${now.length} (${Math.round((mValid / (now.length || 1)) * 100)}%) · 마스터 밖 ${mOut}`);
  console.log(`  트림: 마스터트림 일치 ${tMatch} · 트림있는데 마스터밖 ${tOut} · 트림공백 ${tEmpty}`);
  console.log(`  원문에 모델글자 없음(오매칭 의심) ${rawMiss}`);
  for (const l of outL) console.log(l);
  for (const l of tOutL) console.log(l);
  for (const l of rawL) console.log(l);
  process.exit(0);
}

/**
 * ★★**요금을 «한 대도» 못 읽었으면 쓰지 않는다.**
 *
 * ⚠ 2026-09-08 실측 — 오토플러스 원본의 요금 머리글은 **두 줄**이다(윗줄 「12개월」·아랫줄 「2만km」).
 *   범용 해석기는 한 줄만 보므로 요금 열을 하나도 못 찾고, 그런데도 차 71대를 «요금 없이» 써 넣었다.
 *   그 8대가 시트에서 대여료 빈칸으로 섰다 — **요금 없는 차는 영업자가 못 파는 차**다.
 *   ⇒ 차는 있는데 요금이 0대면 그건 «무보증 상품»이 아니라 **열을 못 읽은 것**이다. 멈춘다.
 *   (오토플러스처럼 두 줄 머리글인 곳은 정제시트를 거쳐 들어온다 — 그 길이 이미 있다.)
 */
{
  const 요금있는차 = now.filter((a) => a.price && typeof a.price === 'object' && Object.keys(a.price as object).length).length;
  if (now.length >= 3 && 요금있는차 === 0) {
    console.error(`\n✗ ${PROV}: 차 ${now.length}대를 읽었는데 **요금이 한 대도 없다** — 요금 열을 못 읽은 것이다.`);
    console.error(`  원천 머리글이 두 줄이거나 열 이름이 별칭에 없다. 쓰지 않고 멈춘다(요금 없는 차는 못 판다).`);
    process.exit(1);
  }
}
if (!APPLY) { console.log(`\n미리보기 — Firestore 안 씀. 쓰려면 --apply${VARIABLE ? '(변동만)' : ''}.`); process.exit(0); }

// ── 변동 폴링(--variable) — 아는 차의 상태·주행만 delta. 불변은 «절대» 안 건드린다. ──
//   사장님 「한 번 정확히 가져오면 그 다음은 상태값만 읽어 바뀐 거 체크. 제일 바뀌는 게 차량상태.」
if (VARIABLE) {
  const items = now.filter((a) => cur.has(a.car_number)); // 아는 차만(새 차는 --apply 몫)
  let changed = 0, sChg = 0, mChg = 0, pChg = 0;
  for (let i = 0; i < items.length; i += 400) {
    const batch = fs.batch(); let any = false;
    for (const a of items.slice(i, i + 400)) {
      const c = cur.get(a.car_number)!;
      const jsonSorted = (o: unknown) => JSON.stringify(o ?? {}, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v);
      /** ⚠ 상태는 `vehicle_status` 가 정본 — 그것도 같이 견줘야 한 벌로 따라간다. */
      const sMoved = S(a.vehicle_status) !== S(c.vehicle_status) || S(a.status) !== S(c.status)
        || a.listable !== c.listable || S(a.status_kind) !== S(c.status_kind);
      const mMoved = S(a.mileage) !== S(c.mileage);
      /** ⚠ 요금 없는 차가 있다 — `Object.keys(undefined)` 로 회차가 통째로 죽는다(웰릭스와 같은 꼴). */
      const ap = (a.price && typeof a.price === 'object' ? a.price : {}) as Record<string, unknown>;
      const pMoved = Object.keys(ap).length > 0 && jsonSorted(ap) !== jsonSorted(c.price);
      if (!sMoved && !mMoved && !pMoved) continue;
      const upd: Record<string, unknown> = { _var_polled_at: Date.now() };
      for (const f of VAR_FIELDS) if (a[f] !== undefined) upd[f] = a[f];
      batch.set(fs.collection('products').doc(docId(a.car_number)), upd, { merge: true });
      changed++; if (sMoved) sChg++; if (mMoved) mChg++; if (pMoved) pChg++; any = true;
    }
    if (any) await batch.commit();
  }
  console.log(`\n변동 폴링 완료 — ${PROV} 아는 차 ${items.length} 중 바뀐 ${changed} 씀 (상태 ${sChg} · 주행 ${mChg} · 요금 ${pChg}). 불변 안 건드림.`);

  /**
   * ★★**없는 차는 «등록»이다 — 자동으로 밀어 넣지 않는다.**
   *
   * > 사장님 2026-09-08 「우리는 **상태값만 바꾸고** 없는 거 추가는 **등록하는 개념**으로 가는 거지.
   * >  나중에 **등록을 손으로 할 수 있어야** 하는 거고」
   *
   * 자동 회차가 하는 일은 **아는 차의 상태를 따라가는 것**뿐이다. 원천에 새 차번이 뜨면 그건
   * 「고칠 것」이 아니라 «들일 것»이다 — 값이 제대로 왔는지, 우리가 팔 차가 맞는지 사람이 본다.
   * ⚠ 자동으로 들이면 원천의 실수(시험 줄·남의 차·오타 차번)가 그대로 상품이 된다.
   *   실제로 오플 배너 줄이 «차»가 되어 채널 시트까지 나갔던 것이 그런 꼴이다.
   *
   * ⇒ 여기서는 **적어만 둔다**(`tmp/등록대기.json`). 들이는 것은 사람의 한 수다:
   * ```
   *   npx tsx … scripts/ingest-supplier-to-firestore.mts --code=RP004 --apply     ← 원천에 있는 새 차를 전부 등록
   *   npx tsx … scripts/register-car.mts 109호1234 [--code=RP004]                 ← 한 대만 손으로 등록
   * ```
   */
  const 새차 = now.filter((a) => !cur.has(a.car_number));
  const WAIT = 'tmp/등록대기.json';
  let 대기: Record<string, unknown[]> = {};
  try { 대기 = JSON.parse(readFileSync(WAIT, 'utf8')) as Record<string, unknown[]>; } catch { /* 첫 회차 */ }
  대기[PROV] = 새차.map((a) => ({
    차번: S(a.car_number), 이름: `${S(a.maker)} ${S(a.model)} ${S(a.sub_model)}`.trim(),
    상태: S(a.vehicle_status), 구분: S(a.product_type),
    원문: S((a['원문'] as { 차명?: string } | undefined)?.차명),
    본때: new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 16).replace('T', ' '),
  }));
  mkdirSync('tmp', { recursive: true });
  writeFileSync(WAIT, JSON.stringify(대기, null, 1), 'utf8');
  if (새차.length) {
    console.log(`\n▲ 원천에 «새 차» ${새차.length}대 — 자동으로 안 들인다(등록은 사람의 한 수).`);
    for (const a of 새차.slice(0, 8)) console.log(`   ${S(a.car_number).padEnd(11)} ${S(a.maker)} ${S(a.model)} ${S(a.sub_model)}  「${S((a['원문'] as { 차명?: string } | undefined)?.차명).slice(0, 30)}」`);
    console.log(`   들이려면 — --apply(전부) 또는 scripts/register-car.mts <차번>(한 대)`);
  }
  process.exit(0);
}

// ── 전체 반영(불변+상태) = «한 번 정확히» + (--retire 일 때만) 사라진 차 listable=false ──
// ⚠ 사라진-차 마킹은 오탐이 곧 «차가 사라져 보임»이라 별도 플래그(--retire)로만. 안전판도 함께:
//   수집분이 우리 것의 절반도 안 되면(원천 읽기 실패 의심) 마킹하지 않는다.
const RETIRE = process.argv.includes('--retire');
/**
 * ★**안전판은 «지금 세워 둔 차»와 견준다** — 한 번이라도 본 차 «전부»가 아니다.
 *   ⚠ 실측 2026-09-08 — 손오공은 원천 291대인데 우리 원자가 630대(대부분 이미 출고불가로 쌓인 옛 차)라,
 *   「절반도 못 읽었다」로 판정돼 **내리기가 영원히 안 걸렸다.** 그 사이 원천에 없는 차 9대가
 *   「출고가능」으로 서 있었다. 잣대가 너무 세면 안전판이 아니라 «자물쇠»가 된다.
 *   ⇒ 견줄 대상 = `listable === true` 인 차(=지금 목록에 세운 것). 291 vs 354 → 통과, 630 vs 291 → 막힘.
 * ★뜻은 그대로다 — 「우리가 «보여 주고 있던» 것의 절반도 못 읽었으면 원천 읽기를 의심한다」.
 */
const 세운차 = [...cur.values()].filter((v) => (v as { listable?: unknown }).listable === true).length;
const safeToRetire = RETIRE && (세운차 === 0 || now.length >= 세운차 * 0.5);
let wrote = 0, retired = 0;
for (let i = 0; i < now.length; i += 400) {
  const batch = fs.batch();
  for (const a of now.slice(i, i + 400)) {
    const { _pin_state, ...doc } = a; void _pin_state;
    batch.set(fs.collection('products').doc(docId(a.car_number)), { ...strip(doc), _direct_ingest_at: Date.now() }, { merge: true });
    wrote++;
  }
  await batch.commit();
}
if (safeToRetire && gone.length) {
  // ★계약중(락 걸린) 차는 «안» 내린다 — 원천에서 잠깐 빠져도 진행 중인 거래를 숨기면 안 된다.
  /**
   * ★★**「팔 수 있다」던 차만 내린다.** 원천에 없다는 것이 «사라졌다»의 증거가 되려면,
   *   원천이 그 상태의 차를 «보여 주기는 했어야» 한다.
   *   ⚠ 실측 2026-09-08 — 손오공 API 는 `계약가능=Y` 인 차만 준다(291대 전부). 그러니 협의·준비·검수 중인
   *   차가 목록에 없는 것은 «빠진 것»이 아니라 **원래 안 보여 주는 것**이다. 그걸 내리면 멀쩡한 차를 숨긴다.
   *   ⇒ 지금 「출고가능·즉시출고」인 차만 내린다. 계약중(락)·출고협의·상품화중·차량검수는 그대로 둔다.
   * ★내리는 쪽이 조심스러워야 한다 — **팔 수 있는 차를 숨기는 것**이 여기서 가장 나쁜 결과다.
   */
  const 지킴 = (c: Record<string, unknown>) => {
    const st = S(c.vehicle_status) || S(c.status);
    return st !== '출고가능' && st !== '즉시출고';
  };
  const locked = gone.filter((car) => 지킴(cur.get(car) || {}) || !!S((cur.get(car) || {}).locked_by_contract));
  const toRetire = gone.filter((car) => !locked.includes(car));
  for (let i = 0; i < toRetire.length; i += 400) {
    const batch = fs.batch();
    /**
     * ★**내릴 때는 «상태»도 같이 바꾼다** — `listable` 만 내리면 `vehicle_status` 는 「출고가능」인 채라
     *   읽는 곳마다 다른 말을 한다(상태 두 벌). 규격은 「기계는 줄을 지우지 않는다 — 안 파는 차는
     *   상태만 출고불가」(`ai-touch-rules`)다. 원천이 더 이상 주지 않는 차는 «출고불가»가 맞다.
     *   ⚠ 계약중(락)은 위에서 이미 뺐다 — 진행 중인 거래를 숨기지 않는다.
     */
    for (const car of toRetire.slice(i, i + 400)) { batch.set(fs.collection('products').doc(docId(car)), { listable: false, vehicle_status: '출고불가', status: '출고불가', status_kind: '불가', status_reason: '원천 이탈(직접수집)', _direct_ingest_at: Date.now() }, { merge: true }); retired++; }
    await batch.commit();
  }
  if (locked.length) console.log(`  · 사라진 차 중 ${locked.length}건은 안 내림 — 계약중(락)이거나 「출고가능」이 아니던 차(원천이 원래 안 보여 주는 상태).`);
} else if (gone.length) {
  console.log(`  · 사라진 차 ${gone.length}건 마킹 안 함 — ${RETIRE ? `안전판(수집 ${now.length} < 세워 둔 ${세운차}의 절반, 원천 읽기 의심)` : '--retire 없음(오탐 방지, 기본 끔)'}.`);
}
console.log(`\n반영 완료 — ${PROV} 직접 원자 ${wrote}건 merge(불변+상태) · 사라진 차 listable=false ${retired}건. 요금은 별도(가격블록).`);
process.exit(0);
