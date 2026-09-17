/**
 * 우리가 제공한 공급사 시트를 **표준양식 탭으로 옮긴다.** 기본 dry-run, 반영은 --apply.
 *
 * 방식: 손으로 열을 옮기지 않는다. **기존 탭을 파서에 통과시킨 결과**를 표준 표로 다시 쓴다.
 * 파서가 이미 아는 것(별칭·보증금 블록 스코프·상태 정규화·차종마스터 스냅)을 그대로 쓰므로
 * 열 이름이 제각각이어도 결과가 흔들리지 않는다. 쓰고 나서 **되읽어 대조**한다(왕복 검증).
 *
 * ★안전 계약
 *   · **공급사 자체 시트에는 절대 쓰지 않는다.** 오플·이안카·아이카는 코드에서 막는다.
 *     (이안카는 우리에게 편집 권한이 «있어서» 실수로 덮을 수 있다 — 실측 2026-08-08)
 *   · **기존 탭을 건드리지 않는다.** 새 탭을 맨 왼쪽에 만들 뿐이다. 되돌리기 = 새 탭 삭제.
 *   · 쓰기 전 원본 그리드를 파일로 백업한다.
 *   · 보증금이 기간마다 다르면 **중단한다** — 표준은 단기/장기 두 칸이라 담을 수 없고,
 *     보증금은 계약·정산 금액이라 임의로 뭉개면 안 된다.
 *
 * 쓰는 곳은 둘 중 하나다.
 *   · 기본        — 기존 시트에 「표준」 탭을 맨 왼쪽에 만든다(기존 탭은 그대로).
 *   · --target    — **새로 내줄 시트**에 쓴다. `config/supplier-sheet-targets.json` 의 sheet_id
 *                   를 쓰며, 시트 주인이 pyh@teamjpk.com 이라 서비스계정은 편집자로만 붙는다
 *                   (서비스계정은 저장용량 limit=0 이라 파일을 «소유»할 수 없다 — 실측 2026-08-08).
 *                   원본이 읽기전용이어도 이 경로는 쓸 수 있다(렌트존·센트로).
 *
 *   npx tsx scripts/migrate-supplier-sheet.mts --code=RP013
 *   npx tsx scripts/migrate-supplier-sheet.mts --code=RP013 --apply
 *   npx tsx scripts/migrate-supplier-sheet.mts --code=RP013 --target --apply
 *   npx tsx scripts/migrate-supplier-sheet.mts --all --target            (전 공급사 dry-run)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { partnerSheetOpts, resolveAdapter } from '../lib/domain/sheet-adapters';
import {
  importSheetTable, parseDepositRule, parseMappingHeaderSignature, parseMappingProfile,
} from '../lib/domain/sheet-import';
import { extractGoogleSheetId } from '../lib/domain/sheet-url';
import { visibleRowsFromGridResponse, type SheetsGridResponse } from '../lib/domain/sheet-visible-grid';
import {
  POLICY_COLUMN_FIELDS, POLICY_TAB_NAME, ROW_HEADER, buildColumns, buildNumberFormats, buildTableRequest,
  buildPolicyTabFormat, buildPolicyTabValues, buildTemplateFormat, periodColumnName,
  resetSheetRequests,
  yearOptions,
} from '../lib/domain/supplier-template-sheet';
import { canonProductType } from '../lib/domain/product';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import { makerDisplay } from '../lib/domain/vehicle-master-format';
import { composeVehicleName, driveValue, seatsForName, seatsValue } from '../lib/domain/vehicle-defaults';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
/** 표에서는 열 타입만 표시를 정한다 — 쉼표는 우리가 «값에» 넣어 준다. */
const comma = (n: number) => (n ? n.toLocaleString('ko-KR') : '');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const arg = (n: string, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;

/** 공급사가 직접 만들어 쓰는 시트 — 우리 표준을 밀어 넣으면 안 된다. */
const SUPPLIER_OWNED = new Set(['RP004', 'RP023', 'RP031']);
/**
 * 공급사 시트의 상품 탭 이름은 **「재고」**다.
 * 「상품리스트」는 프리패스 쪽 이름이다 — 그건 상품찾기와 연동되는 «읽기 전용» 목록이라
 * 방향도 주인도 다르다. 같은 말을 쓰면 어느 쪽을 고쳐야 하는지 헷갈린다.
 */
const TAB_NAME = '재고';
/** 번호미정 신차에 붙는 ERP 내부 임시번호 — 공급사 시트에 나가면 안 되는 값. */
const TEMP_PLATE = /^\d{3}신\d{4}$/;
/** 보증금이 «값»이 아니라 «규칙»인 공급사(손오공 등) — 정책 블록에 문장으로 적는다. */
// 값은 정책 블록 드롭다운 선택지와 **글자까지 같아야** 한다 — 다르면 목록 밖 값으로 보인다.
const DEPOSIT_RULE_TEXT: Record<string, string> = {
  months_per_year: '대여료 × 약정연수 (12개월=1개월치)',
  rent_multiple: '대여료 × 배율 (국산 2 · 수입 3)',
};

type Target = {
  code: string; name: string; title: string; sheet_id: string;
  /** input = 공급사가 직접 쓰는 시트 · mirror = 우리가 연동해 모아두는 보관용(공급사는 안 본다) */
  mode?: 'input' | 'mirror';
  source_label?: string;
};
const TARGETS_PATH = 'config/supplier-sheet-targets.json';

function loadTargets(): Target[] {
  try {
    return (JSON.parse(readFileSync(TARGETS_PATH, 'utf8')).targets || []) as Target[];
  } catch { return []; }
}

async function migrateOne(code: string, o: { apply: boolean; useTarget: boolean }) {
  const { apply, useTarget } = o;
  // 공급사 자체 시트(오플·이안카·아이카)는 **그 시트에 쓰는 것**만 막는다.
  // 우리 새 시트에 «거울»로 모아 두는 건 원본을 안 건드리므로 안전하고, 그러려고 만든 길이다.
  if (SUPPLIER_OWNED.has(code) && !useTarget) {
    throw new Error(`중단 — ${code} 는 공급사가 직접 만드는 시트입니다. 그들 시트에는 쓰지 않습니다.\n        우리 시트로 모아 두려면 --target 을 쓰세요.`);
  }

  const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/firebase.database',
    'https://www.googleapis.com/auth/userinfo.email',
  ]});
  const token = (await jwt.getAccessToken()).token as string;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const db = async (node: string) => {
    const r = await fetch(`${DB}/${node}.json?access_token=${token}`);
    if (!r.ok) throw new Error(`${node} ${r.status}`);
    return (JSON.parse(await r.text()) || {}) as Record<string, Rec>;
  };
  const [live, over, pol3, pol4] = await Promise.all([
    db('partners'), db('v4/partners'), db('policies'), db('v4/policies'),
  ]);
  // 정책은 v3·v4 양쪽에 있다(재고와 달리 «절연» 대상이 아니다 — 정책 54건 중 v3 가 다수).
  const policies: Record<string, Rec> = { ...pol3, ...pol4 };
  const policyByCode = new Map<string, Rec>();
  for (const [k, p] of Object.entries(policies)) {
    if (!p || typeof p !== 'object') continue;
    for (const id of [k, S(p.policy_code), S(p.code)]) if (id) policyByCode.set(id, p);
  }
  const merged: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(live), ...Object.keys(over)])) {
    merged[k] = { ...(live[k] || {}), ...(over[k] || {}), _key: k };
  }
  // ⚠ 같은 공급사가 두 키로 있는 경우가 있다 — 제이앤제이는 `partners/PT-0012`(구 v3, URL 빈칸)와
  //   `v4/partners/RP030`(진짜 URL) 로 갈려 있었다. 먼저 걸린 쪽을 집으면 시트가 없다고 나온다.
  //   **시트가 있는 레코드를 우선**한다.
  const candidates = Object.values(merged).filter((p) => S(p.partner_code) === code || S(p._key) === code);
  const partner = candidates.find((p) => S(p.sheet_url)) || candidates[0];
  if (!partner) throw new Error(`공급사 ${code} 를 찾을 수 없습니다.`);
  if (candidates.length > 1) {
    console.log(`  ⚠ ${code} 레코드가 ${candidates.length}개 (${candidates.map((p) => S(p._key)).join(' · ')}) — 시트 있는 쪽을 씁니다.`);
  }
  const name = S(partner.partner_name) || S(partner.company_name) || S(partner.name) || code;
  const opts = partnerSheetOpts(partner);
  const adapter = resolveAdapter(partner);
  const sheetId = extractGoogleSheetId(opts.url);

  // ── 쓸 곳 정하기 ────────────────────────────────────────────────
  let writeId = sheetId;                       // 기본: 원본 시트에 새 탭
  let where = '기존 시트에 「표준」 탭';
  if (useTarget) {
    const t = loadTargets().find((x) => x.code === code);
    if (!t) throw new Error(`${TARGETS_PATH} 에 ${code} 가 없습니다.`);
    if (!S(t.sheet_id)) {
      throw new Error(`${code} ${t.name} — 아직 새 시트가 없습니다.\n        「${t.title}」 를 만들어 ${sa.client_email} 를 편집자로 공유한 뒤 ${TARGETS_PATH} 의 sheet_id 를 채우세요.`);
    }
    writeId = S(t.sheet_id);
    where = `새 시트 ${writeId}`;
    if (writeId === sheetId) throw new Error(`${code} — 새 시트 ID 가 원본과 같습니다. 확인하세요.`);
    // ★진짜 방벽 — 쓸 곳이 «누구의» 정본이어도 안 된다. 코드가 아니라 대상으로 막는다.
    const owner = Object.values(merged).find((p) => extractGoogleSheetId(S(p.sheet_url)) === writeId);
    if (owner) {
      throw new Error(`중단 — 쓸 곳이 «${S(owner.partner_name) || S(owner.name) || S(owner._key)}» 의 정본 재고시트입니다. 덮으면 원본이 사라집니다.`);
    }
  }

  console.log(`\n══ ${code} ${name} — 표준양식 이관 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  원본 ${sheetId} · 어댑터 ${adapter.id} · 설정탭 ${opts.gids.join(',') || '(없음)'}`);
  console.log(`  쓸 곳 ${where}`);

  // 이 시트를 «고쳐도 되는가»를 시트 안에 박아 둔다. 보관용을 입력용으로 착각해 손대면
  // 반영은 안 되고 원본과만 어긋난다.
  const target = loadTargets().find((t) => t.code === code);
  const sourceLabel = S(target?.source_label) || '공급사 입력(수기)';
  const isMirror = target?.mode === 'mirror';
  console.log(`  재고 출처 «${sourceLabel}»${isMirror ? ' — 보관용(공급사 입력 아님)' : ''}`);

  const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as { entries?: MasterEntry[] } | MasterEntry[];
  const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];

  const makers = [...HANDLED_MAKER_OPTIONS];   // 취급 브랜드만 · 짧은 표기 · 흔한 순서
  const dropdownExtras = { 제조사: makers, 연식: yearOptions(new Date().getFullYear()) };

  const api = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const call = async (url: string, init?: RequestInit) => {
    const r = await fetch(url, { ...init, headers: H, signal: AbortSignal.timeout(150_000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`Sheets ${r.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : {};
  };

  const metaAll = await call(`${api}?fields=${encodeURIComponent('sheets(properties(sheetId,title,hidden))')}`) as SheetsGridResponse;
  const tabs = (metaAll.sheets || []).map((s: any) => ({
    gid: String(s.properties?.sheetId ?? ''), title: S(s.properties?.title), hidden: !!s.properties?.hidden,
  }));

  // ── 기존 탭들을 파서에 통과시킨다 ────────────────────────────────
  const products: Rec[] = [];
  const backup: Rec = {};

  /**
   * 새 시트는 **ERP 재고를 깔고 시작한다** — 공급사 원본을 다시 파싱하지 않는다.
   *
   * 방향이 중요하다. 시트→재고가 아니라 **재고→시트**다. 시트는 재고관리와 연동하고
   * 그 결과가 상품찾기에 반영되는 구조이므로, 새 시트의 출발점도 «재고가 아는 것»이어야 한다.
   * ERP 값은 이미 각 어댑터(오플 본탭+프로모탭, 이안카 헤더행 등)를 통과해 대사까지 끝난 결과다.
   * 여기서 원본을 다시 파싱하면 그 특성을 두 벌로 구현하게 되고 정본이 갈린다.
   *
   * 공급사는 이 시트를 받아 **빠진 차를 추가하고 상태를 고친다.** 출고불가도 함께 깔아 준다 —
   * 안 보이면 되살릴 수도 없다.
   */
  if (useTarget || isMirror) {
    const prods = await db('v4/products');
    const deadRec = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
    for (const p of Object.values(prods)) {
      if (!p || typeof p !== 'object' || deadRec(p)) continue;
      if ((S(p.provider_company_code) || S(p.partner_code)) !== code) continue;
      products.push(p);
    }
    console.log(`  [ERP 스냅샷] v4/products 에서 ${products.length}대`);
  }
  // 탭 설정이 아예 없는 공급사가 있다(렌트존). 읽을 탭이 없어 0대가 되는데, 시트에는 데이터가
  // 멀쩡히 있다. 표시 탭이 하나뿐이면 그걸 쓴다 — 여럿이면 어느 것인지 사람이 정해야 한다.
  let gids = (useTarget || isMirror) ? [] : opts.gids;
  if (!useTarget && !isMirror && !gids.length) {
    const visible = tabs.filter((t) => !t.hidden);
    if (visible.length !== 1) {
      throw new Error(`연동 탭이 설정돼 있지 않고 표시 탭이 ${visible.length}개입니다 — sheet_tab 을 먼저 정하세요: ${visible.map((t) => `${t.title}(${t.gid})`).join(' · ')}`);
    }
    gids = [visible[0].gid];
    console.log(`  ⚠ 연동 탭 미설정 — 표시 탭이 하나뿐이라 「${visible[0].title}」(${visible[0].gid}) 를 씁니다.`);
  }
  for (const gid of gids) {
    const t = tabs.find((x) => x.gid === gid);
    if (!t) { console.log(`  ⚠ 탭 없음 gid=${gid}`); continue; }
    const a1 = `'${t.title.replace(/'/g, "''")}'`;
    const fields = [
      'sheets(properties(sheetId,title,hidden)',
      'data(startRow,rowData(values(formattedValue,effectiveValue,hyperlink,chipRuns(chip(richLinkProperties(uri))))),rowMetadata(hiddenByFilter,hiddenByUser)))',
    ].join(',');
    const body = await call(`${api}?ranges=${encodeURIComponent(a1)}&includeGridData=true&fields=${encodeURIComponent(fields)}`) as SheetsGridResponse;
    const grid = visibleRowsFromGridResponse(body, gid);
    backup[`${t.title}|${gid}`] = grid.rows;
    const prepared = adapter.prepareTable(grid.rows, { headerRow: opts.headerRow });
    const r = importSheetTable(prepared, {
      providerCode: code, entries: master,
      profile: parseMappingProfile(partner.mapping_profile),
      profileHeaders: parseMappingHeaderSignature(partner.mapping_header_signature),
      depositRule: parseDepositRule(partner.deposit_rule),
      photoByPlate: grid.photoByPlate,
    });
    console.log(`  [${t.title}|${gid}] 원본 ${grid.rows.length}행 → 매물 ${r.imported} · 제외 ${r.excludedCount} · 셀링크 ${Object.keys(grid.photoByPlate || {}).length}`);
    products.push(...r.products);
  }
  if (!products.length) throw new Error('매물이 0대입니다 — 원본을 먼저 확인하세요.');

  // ── 표준 표로 변환 ────────────────────────────────────────────
  // 이 공급사가 실제로 쓰는 price 키를 모아 기간 열을 정한다 — 표준 6종 + 그들만의 기간.
  const usedKeys = [...new Set(products.flatMap((p) => Object.keys(p.price || {})))];
  const TEMPLATE_COLUMNS = buildColumns(usedKeys);
  const PERIODS = [...new Set(usedKeys.map((k) => k.split('_')[0]))];
  console.log(`  기간 열 ${usedKeys.length ? usedKeys.sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0])).join(' · ') : '(없음)'}`);
  /** price 키는 `24` 또는 `24_3만`(주행 변형)이다. 표준은 개월 단위라 같은 개월끼리 모은다. */
  /** price 키 하나 = 열 하나. 같은 개월의 주행 변형(24_2만·24_3만)도 각자 제 열에 간다. */
  const cellByKey = (p: Rec, key: string) => ((p.price || {}) as Record<string, Rec>)[key] || null;
  const cell = (p: Rec, period: string) => {
    const price = (p.price || {}) as Record<string, Rec>;
    const key = Object.keys(price).find((k) => k === period || k.startsWith(`${period}_`));
    return key ? price[key] : null;
  };
  const idx = (n: string) => TEMPLATE_COLUMNS.findIndex((c) => c.name === n);

  const depositRule = parseDepositRule(partner.deposit_rule);
  const ruleText = depositRule ? (DEPOSIT_RULE_TEXT[depositRule] || S(depositRule)) : '';
  if (ruleText) console.log(`  보증금 규칙 «${ruleText}» — 보증금 칸은 비우고 정책 블록에 적는다`);

  let policySeeded = 0;
  const usedPolicies = new Map<string, Rec>();
  let depositConflict = 0;
  let mileageVariant = 0;
  const rows: string[][] = [];
  for (const p of products) {
    const r = Array(TEMPLATE_COLUMNS.length).fill('');
    const set = (n: string, v: unknown) => { const i = idx(n); if (i >= 0) r[i] = S(v); };
    // 번호미정 신차의 임시번호(100신0001)는 **ERP 내부 값**이다. 공급사 시트에 적으면
    // 진짜 번호판인 줄 알고 그대로 굳는다. 빈칸으로 두고 차대번호로 붙잡게 한다 —
    // 표준양식에 차대번호 열을 세운 이유가 정확히 이것이다.
    set('차량번호', TEMP_PLATE.test(S(p.car_number)) ? '' : p.car_number);
    set('상태', p.vehicle_status);
    // ERP 에는 옛 표기가 남아 있다(재렌트·재구독). 그대로 내보내면 드롭다운 목록 밖 값이라
    // 시트가 칸마다 「잘못됨」 경고를 띄운다 — 규격 표기로 바꿔 내보낸다.
    set('분류', canonProductType(p.product_type) || S(p.product_type));
    // 시트에는 짧은 표기로 — 르노코리아→르노 · KG모빌리티→KGM.
    set('제조사', makerDisplay(p.maker) || S(p.maker));
    /**
     * 차명 = **차종마스터 세 조각을 붙인 것.** 그 이상도 이하도 아니다.
     *
     *   세부모델  +  파워트레인(인승)  +  세부트림
     *   더 뉴 카니발 KA4   디젤 2.2 9인승   프레스티지
     *
     * ⚠ `vehicle-name.ts` 의 T2 full 을 쓰면 안 된다. 그건 «화면용»이라 원문 잔여물까지 끌어와
     *   「쏘나타 디 엣지 DN8 LPG 2.0 디 엣지 사업용 (렌트) 비즈니스 2」·「5인승 7인승」 같은
     *   겹말을 만든다(전 차량 701대 실측: 28건). 시트는 마스터 값만 붙인다.
     * ⚠ `trim_extra` 는 트림이 아니라 원본 문장이므로 넣지 않는다.
     *
     * 인승은 파워트레인에 딸린다. 5인승은 붙이지 않는다 — 당연한 값이라 이름만 길어진다.
     * 카니발 9인승·팰리세이드 7인승처럼 인승이 곧 다른 상품인 것만 드러낸다.
     */
    // 차명 조립은 `vehicle-defaults.composeVehicleName` 하나만 쓴다 —
    // 스크립트마다 따로 이으면 같은 차가 곳곳에서 다르게 보인다.
    set('차명(세부모델+트림)', composeVehicleName(p as never, master as never[]));
    set('연식', p.year);
    set('최초등록일', p.first_registration_date);
    set('연료', p.fuel_type);
    set('배기량', comma(N(p.engine_cc)));
    set('인승', seatsValue(p.seats, p.sub_model, master as never[]) || seatsForName(p.seats, p.sub_model, master as never[]));
    set('구동', driveValue(p.drive_type, p.sub_model, master as never[]));
    set('주행거리', comma(N(p.mileage)));
    set('외부색상', p.ext_color);
    set('내부색상', p.int_color);
    set('옵션', p.options);
    set('사진링크', p.photo_link);
    set('차대번호', p.vin);
    set('비고', p.partner_memo);

    // 정책 열은 **재고에 붙은 정책에서 미리 채운다** — 공급사가 칠 일을 없앤다.
    // 붙은 정책이 없으면 비워 둔다. 짐작해서 채우면 없던 조건을 만들어 내는 셈이다.
    // 상품 행은 정책을 «가리키기만» 한다. 내용은 「정책」 탭이 정의한다.
    set('정책코드', p.policy_code);
    const pol = policyByCode.get(S(p.policy_code));
    if (pol) {
      policySeeded++;
      if (!usedPolicies.has(S(p.policy_code))) usedPolicies.set(S(p.policy_code), pol);
    }

    const price = (p.price || {}) as Record<string, Rec>;
    if (Object.keys(price).some((k) => k.includes('_'))) mileageVariant++;

    // 대여료는 키마다 제 열에. 보증금은 단기(<24)·장기(>=24) 두 무리로 모은다.
    const shortDeps = new Set<number>();
    const longDeps = new Set<number>();
    for (const key of Object.keys(price)) {
      const c = cellByKey(p, key);
      if (!c) continue;
      set(periodColumnName(key), comma(N(c.rent)));
      const d = N(c.deposit);
      if (d) (Number(key.split('_')[0]) < 24 ? shortDeps : longDeps).add(d);
    }
    if (!ruleText && shortDeps.size >= 1) set('단기보증', comma([...shortDeps][0]));
    if (!ruleText && shortDeps.size > 1) depositConflict++;
    // 보증금이 규칙으로 정해지는 공급사는 칸을 «비운다». 값을 박으면 규칙과 두 벌이 되고,
    // 기간마다 다른 금액을 두 칸에 뭉개려다 없던 보증금을 만들어낸다.
    if (!ruleText) {
      if (longDeps.size > 1) depositConflict++;
      if (longDeps.size >= 1) set('장기보증', comma([...longDeps][0]));
    }
    rows.push(r);
  }

  console.log(`\n  표준 표: ${rows.length}행 · ${TEMPLATE_COLUMNS.length}열`);
  const filled = (n: string) => rows.filter((r) => S(r[idx(n)])).length;
  console.log('  채워진 칸 — ' + ['차량번호','상태','분류','제조사','차명(세부모델+트림)','옵션','외부색상','내부색상','연식','주행거리','연료','배기량','인승','구동','정책코드','사진링크','차대번호']
    .map((n) => `${n} ${filled(n)}`).join(' · '));
  console.log(`  정책 — 연결된 매물 ${policySeeded}/${products.length} · 쓰는 정책 ${usedPolicies.size}종`);
  console.log('  요금     — ' + TEMPLATE_COLUMNS.filter((c) => /보증|개월|기타기간/.test(c.name))
    .map((c) => `${c.name} ${filled(c.name)}`).join(' · '));
  if (mileageVariant) console.log(`  ※ 주행 변형 요금(24개월_3만 등)을 쓰는 매물 ${mileageVariant}대 — 표준은 개월 단위라 같은 개월끼리 모았다.`);
  if (depositConflict) {
    throw new Error(
      `중단 — 장기 보증금이 기간마다 다른 매물 ${depositConflict}대. 표준은 단기/장기 두 칸이라 담을 수 없습니다.\n` +
      `        보증금은 계약·정산 금액이라 임의로 뭉개면 안 됩니다. 양식에 기간별 보증금 열을 추가할지 결정이 필요합니다.`,
    );
  }

  // ── 표: 첫 줄 헤더, 둘째 줄부터 상품 ──────────────────────────────
  const width = TEMPLATE_COLUMNS.length;
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill('')];
  const values: string[][] = [pad(TEMPLATE_COLUMNS.map((c) => c.name)), ...rows.map(pad)];

  // ── 왕복 검증은 **쓰기 전에** 한다. 쓰고 나서 확인하면 이미 늦다. ──────────
  const back = importSheetTable(
    resolveAdapter('generic').prepareTable(values.map((r) => [...r])),
    { providerCode: code, entries: master, depositRule },   // 보증금 규칙을 빼면 규칙제 공급사가 통째로 어긋난다
  );
  // 임시번호 차는 표준표에 차번이 없으므로 되읽을 때 «새» 임시번호를 받는다. 차번 대조에서 빼고
  // 총 대수로만 확인한다 — 그걸 유실로 세면 고칠 수 없는 거짓 경보가 된다.
  const real = (xs: Rec[]) => new Set(xs.map((p) => S(p.car_number)).filter((x) => x && !TEMP_PLATE.test(x)));
  // 출고불가는 파서가 **일부러** 유입에서 거른다(`isSheetExcluded`). 거울 스냅샷에는 그 차도 담기므로
  // 되읽으면 당연히 빠진다 — 그걸 유실로 세면 안 된다. 대조는 «올라갈 수 있는 차»끼리 한다.
  //
  // 계약중도 같다. `canonSheetVehicleStatus` 는 시트의 계약 표기를 **일부러** 출고불가로 내린다 —
  // ERP 의 계약중은 계약금 확인 엔진만 설정하는 내부 상태라서다. 그래서 시트를 거치면 안 돌아온다.
  // ⚠ 이 시트가 정본이 되면 계약중이던 차가 유입 때 출고불가로 바뀐다는 뜻이기도 하다.
  const contracted = products.filter((p) => S(p.vehicle_status) === '계약중');
  const offerable = products.filter((p) => !['출고불가', '계약중'].includes(S(p.vehicle_status)));
  const dropped = products.filter((p) => S(p.vehicle_status) === '출고불가').length;
  if (dropped) console.log(`  ※ 출고불가 ${dropped}대 — 시트에는 적히되 유입에서는 걸러진다(정상)`);
  if (contracted.length) {
    console.log(`  ⚠ 계약중 ${contracted.length}대(${contracted.map((p) => S(p.car_number)).join(' · ')})`
      + ` — 시트를 거치면 출고불가가 된다. 연동을 이 시트로 옮기기 전에 계약 상태를 확인할 것.`);
  }
  const before = real(offerable);
  const after = real(back.products);
  const lost = [...before].filter((x) => !after.has(x));
  const tempBefore = offerable.length - before.size;
  console.log(`\n  왕복 검증 — 원본 ${products.length}대(실차번 ${before.size}${tempBefore ? ` · 번호미정 ${tempBefore}` : ''})`
    + ` → 되읽기 ${back.products.length}대 · 실차번 유실 ${lost.length}`);
  if (lost.length) {
    throw new Error(`중단 — 표준표로 옮기면 ${lost.length}대가 유실됩니다: ${lost.slice(0, 20).join(' · ')}`);
  }
  if (back.products.length !== offerable.length) {
    throw new Error(`중단 — 올릴 수 있는 대수가 ${offerable.length} → ${back.products.length} 로 바뀝니다.`);
  }
  // 금액도 대조한다 — 차번만 맞고 요금이 틀리면 더 나쁘다.
  /** 키 단위로 본다. 개월 단위로 뭉치면 24_2만/24_3만 중 하나가 사라져도 못 잡는다. */
  const rentOf = (p: Rec, key: string) => N(((p.price || {}) as Record<string, Rec>)[key]?.rent);
  const byPlate = new Map(back.products.map((p) => [S(p.car_number), p]));
  const priceDiff: string[] = [];
  const depositFreeLost: string[] = [];
  let tempSkipped = 0;
  for (const p of offerable) {
    // 번호미정 차는 시트에 차번이 빈칸으로 나가고 되읽을 때 «새» 임시번호를 받는다.
    // 그 번호로 짝을 찾으면 하필 같은 번호를 받은 남의 차와 비교하게 된다(아이언 실측).
    if (TEMP_PLATE.test(S(p.car_number))) { tempSkipped++; continue; }
    const q = byPlate.get(S(p.car_number));
    if (!q) continue;
    for (const key of usedKeys) {
      if (rentOf(p, key) === rentOf(q, key)) continue;
      // 무보증(deposit 0)은 시트로 표현할 수 없다 — 파서가 «보증금을 말할 수 없는 기간»으로 보고
      // 통째로 뺀다(sheet-import 586~594). 형식의 한계이지 우리가 값을 잘못 옮긴 게 아니다.
      // 막지 않고 세어서 알린다 — 조용히 지나가면 요금이 사라진 줄 모른다.
      const dep = N(((p.price || {}) as Record<string, Rec>)[key]?.deposit);
      if (!dep && rentOf(q, key) === 0) { depositFreeLost.push(`${S(p.car_number)} ${periodColumnName(key)}`); continue; }
      priceDiff.push(`${S(p.car_number)} ${periodColumnName(key)} ${rentOf(p, key)}→${rentOf(q, key)}`);
    }
  }
  console.log(`  요금 대조 — 어긋난 칸 ${priceDiff.length}`
    + (tempSkipped ? ` · 번호미정이라 대조 못 함 ${tempSkipped}대` : '')
    + (depositFreeLost.length ? ` · 무보증이라 시트로 못 담는 칸 ${depositFreeLost.length} (${depositFreeLost.slice(0, 3).join(' · ')}${depositFreeLost.length > 3 ? ' …' : ''})` : ''));
  if (priceDiff.length) {
    throw new Error(`중단 — 요금이 바뀝니다(${priceDiff.length}칸): ${priceDiff.slice(0, 10).join(' · ')}`);
  }

  if (!apply) {
    console.log(`\n  새 탭 「${TAB_NAME}」 을 맨 왼쪽에 만든다. 기존 탭(${tabs.map((t) => t.title).join(' · ')})은 그대로 둔다.`);
    console.log('\n※ dry-run. 반영은 --apply\n');
    return;
  }

  const dir = `tmp/migration-backups/supplier-sheet/${code}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/original-grid.json`, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n  원본 백업 ${dir}/original-grid.json`);

  const wApi = `https://sheets.googleapis.com/v4/spreadsheets/${writeId}`;
  const wCall = async (url: string, init?: RequestInit) => {
    const r = await fetch(url, { ...init, headers: H, signal: AbortSignal.timeout(150_000) });
    const t = await r.text();
    if (!r.ok) {
      if (r.status === 403) throw new Error(`쓰기 권한 없음 — ${writeId} 에 ${sa.client_email} 를 편집자로 공유하세요.`);
      throw new Error(`Sheets ${r.status} ${t.slice(0, 800)}`);
    }
    return t ? JSON.parse(t) : {};
  };

  const wTables = (await wCall(`${wApi}?fields=${encodeURIComponent('sheets(properties(sheetId),tables(tableId,range))')}`) as any).sheets || [];
  const wMeta = useTarget
    ? (await wCall(`${wApi}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`) as any).sheets
        .map((s: any) => ({ gid: String(s.properties.sheetId), title: S(s.properties.title) }))
    : tabs.map((t) => ({ gid: t.gid, title: t.title }));

  // --gid 를 주면 그 탭을 갈아엎는다. 양식이 바뀌었을 때 옛 탭이 둘로 남지 않게 하는 길이다.
  const gidArg = arg('gid');
  let title: string; let gid: number;
  if (gidArg) {
    const found = wMeta.find((t: any) => String(t.gid) === gidArg);
    if (!found) throw new Error(`gid ${gidArg} 탭이 없습니다.`);
    title = found.title; gid = Number(gidArg);
    await wCall(`${wApi}/values/${encodeURIComponent(title)}!A:BZ:clear`, { method: 'POST', body: '{}' });
    // 값만 지우면 옛 서식·드롭다운·셀메모가 남아 데이터 줄이 헤더처럼 보인다.
    await wCall(`${wApi}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: resetSheetRequests(gid) }) });
    // 표가 남아 있으면 열 타입이 값·서식·규칙을 붙잡아 다시 못 쓴다. 먼저 푼다.
    const olds = (wTables.find((x: any) => x.properties?.sheetId === gid)?.tables || []) as { tableId: string }[];
    if (olds.length) {
      await wCall(`${wApi}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: olds.map((t) => ({ deleteTable: { tableId: t.tableId } })) }),
      });
      console.log(`  기존 표 ${olds.length}개 해제`);
    }
    console.log(`  기존 탭 「${title}」(${gid}) 를 서식까지 갈아엎는다`);
  } else {
    title = TAB_NAME;
    for (let i = 2; wMeta.some((t: any) => t.title === title); i++) title = `${TAB_NAME} (${i})`;
    const added = await wCall(`${wApi}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index: 0 } } }] }),
    }) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    gid = added.replies[0].addSheet.properties.sheetId;
  }

  await wCall(`${wApi}/values/${encodeURIComponent(title)}!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values }),
  });
  await wCall(`${wApi}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: buildTemplateFormat(gid, TEMPLATE_COLUMNS, dropdownExtras, { asTable: true }) }) });
  // 표로 만들어야 드롭다운이 «칩»으로 뜬다. 이미 표면 그대로 두고, 실패해도 표만 없을 뿐 값은 멀쩡하다.
  try {
    await wCall(`${wApi}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [
        { clearBasicFilter: { sheetId: gid } },     // 남아 있는 필터가 표 변환을 막는다
        buildTableRequest(gid, TEMPLATE_COLUMNS, dropdownExtras, Math.max(50, rows.length + 30)),
        // 필터는 «표를 만든 뒤에» 건다. 먼저 걸면 표 변환이 거부되고,
        // 표만 만들면 머리행에 필터 단추가 없다. 순서가 곧 기능이다(실측 2026-08-08).
        { setBasicFilter: { filter: { range: {
          sheetId: gid, startRowIndex: ROW_HEADER, endRowIndex: Math.max(50, rows.length + 30),
          startColumnIndex: 0, endColumnIndex: TEMPLATE_COLUMNS.length,
        } } } },
      ] }),
    });
    // 정렬은 표를 만든 뒤에 — 숫자 칸이 우측으로 떨어져야 자리수가 세로로 맞는다.
    await wCall(`${wApi}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: buildNumberFormats(gid, TEMPLATE_COLUMNS, Math.max(50, rows.length + 30)) }),
    });
    console.log('  표(Table) 적용 — 칩 + 머리행 필터 + 천단위 + 우측정렬');
  } catch (e) {
    console.log(`  ⚠ 표 적용 실패 — ${String((e as Error)?.message || e).replace(/\s+/g, ' ').slice(0, 600)}`);
  }
  console.log(`  탭 「${title}」(gid ${gid}) 생성 완료 — 검증은 쓰기 전에 이미 통과했다`);

  // ── 「정책」 탭 — 상품리스트가 가리키는 코드의 «뜻»을 여기서 정의한다 ────────
  const polRows = [...usedPolicies.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([polCode, pol]) => {
      const row: Record<string, string> = { 정책코드: polCode, 정책명: S(pol.policy_name) || S(pol.name) || '' };
      for (const { name, field } of POLICY_COLUMN_FIELDS) row[name] = S(pol[field]);
      row['특이사항'] = S(pol.memo) || S(pol.note) || '';
      return row;
    });
  const polExisting = wMeta.find((t: any) => t.title === POLICY_TAB_NAME);
  let polGid: number;
  if (polExisting) {
    polGid = Number(polExisting.gid);
    await wCall(`${wApi}/values/${encodeURIComponent(POLICY_TAB_NAME)}!A:BZ:clear`, { method: 'POST', body: '{}' });
    await wCall(`${wApi}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: resetSheetRequests(polGid) }) });
  } else {
    const addedPol = await wCall(`${wApi}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: POLICY_TAB_NAME } } }] }),
    }) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
    polGid = addedPol.replies[0].addSheet.properties.sheetId;
  }
  await wCall(`${wApi}/values/${encodeURIComponent(POLICY_TAB_NAME)}!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: buildPolicyTabValues(polRows) }),
  });
  await wCall(`${wApi}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: buildPolicyTabFormat(polGid, polRows.length) }) });
  console.log(`  탭 「${POLICY_TAB_NAME}」(gid ${polGid}) — 정책 ${polRows.length}종 (세로 항목 · 가로 정책)`);
  console.log(`\n  https://docs.google.com/spreadsheets/d/${writeId}/edit#gid=${gid}`);
  console.log(`  ※ 연동 대상을 옮기려면 partner.sheet_url·sheet_tab 을 고쳐야 한다(아직 안 바꿨다).\n`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const useTarget = process.argv.includes('--target');
  const all = process.argv.includes('--all');
  const one = arg('code').toUpperCase();
  if (!one && !all) throw new Error('--code=RP013 또는 --all 을 주세요.');

  // 공급사 자체 시트라도 --target 이면 «우리 시트에 모아 두는» 것이라 대상이다.
  const codes = all
    ? loadTargets().map((t) => t.code).filter((c) => useTarget || !SUPPLIER_OWNED.has(c))
    : [one];

  const failed: string[] = [];
  for (const code of codes) {
    try {
      await migrateOne(code, { apply, useTarget });
    } catch (e) {
      console.error(`\n✗ ${code} — ${String((e as Error)?.message || e)}\n`);
      failed.push(code);
    }
  }
  if (codes.length > 1) {
    console.log(`\n══ 전체 ${codes.length}곳 · 성공 ${codes.length - failed.length} · 실패 ${failed.length}${failed.length ? ` (${failed.join(' · ')})` : ''} ══\n`);
  }
  if (failed.length && codes.length === 1) process.exit(1);
}

main().catch((e) => { console.error(`\n${String(e?.message || e)}\n`); process.exit(1); });
