/**
 * **공급사 입력시트 13개를 한 벌로 찍는다.** 기본 dry-run, 실제 쓰기는 `--apply`.
 *
 * 대상은 우리가 만들어 공급사에게 나눠 줄 「프리패스 재고 · <공급사>」 시트다.
 * 공급사 자기 시트(아이카·이안카·오토플러스)와 홈페이지 정본(아이언)은 대상이 아니다.
 *
 * ★한 시트에 탭 둘 — 사장님 확정 2026-08-11
 *   「재고」  제조사스펙 + 대여조건. 정책은 **정책코드 한 칸으로 가리키기만** 한다.
 *   「정책」  정책코드마다 조건을 정의한다. 세로가 항목, 가로가 정책.
 *
 * ★안전 계약 — 넘으면 안 되는 선
 *   · **운영 공급사 시트에는 쓰지 않는다.** 대상 ID 가 어느 파트너의 `sheet_url` 과 같으면
 *     그 시트는 건너뛴다. 공급사 시트는 재고의 «정본»이고 이 스크립트는 탭을 갈아엎는다.
 *   · **이미 입력된 시트는 건너뛴다.** 헤더 아래 값이 한 줄이라도 있으면 손대지 않는다 —
 *     공급사가 채운 걸 덮으면 되돌릴 방법이 없다. 다시 찍으려면 `--force` 를 준다.
 *   · RTDB 는 읽기만 한다.
 *
 *   npx tsx scripts/build-supplier-sheet-set.mts
 *   npx tsx scripts/build-supplier-sheet-set.mts --apply
 *   npx tsx scripts/build-supplier-sheet-set.mts --apply --only=RP013
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import { priceList, priceVariants } from '../lib/domain/product';
import {
  POLICY_COLUMN_FIELDS, POLICY_TAB_NAME, ROW_HEADER,
  buildColumns, buildNumberFormats, buildPolicyTabFormat, buildPolicyTabValues,
  buildBanding, buildBaseFont, buildChipColors, buildRowHeights, buildTemplateFormat, buildTemplateValues, resetSheetRequests, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').map(S).filter(Boolean);
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const VEHICLE_TAB = '재고';
const ROWS = 500;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * 시트 API 한 번.
 * ★쓰기는 **분당 60회**로 막힌다(사용자 단위). 13개 시트를 한 벌로 찍으면 쉽게 넘으므로
 *   429·5xx 는 기다렸다 다시 한다 — 중간에 죽으면 어떤 시트는 표가 붙고 어떤 시트는 안 붙는다.
 */
const api = async (url: string, init?: RequestInit, tries = 5): Promise<Rec> => {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && i < tries) {
      const wait = 20000 * (i + 1);
      console.log(`     … 한도에 걸려 ${wait / 1000}초 기다립니다`);
      await sleep(wait);
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

// ── ERP 에서 읽는 것 — 공급사·정책·재고 ─────────────────────────────────────
const [prods, pol3, pol4, t3, t4] = await Promise.all(
  ['v4/products', 'policies', 'v4/policies', 'partners', 'v4/partners'].map(async (n) =>
    JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const merge = (...srcs: Rec[]) => {
  const out: Record<string, Rec> = {};
  for (const s of srcs) for (const [k, v] of Object.entries<Rec>(s)) if (v && typeof v === 'object') out[k] = { ...(out[k] || {}), ...v, _key: k };
  return out;
};
const partners = merge(t3, t4);
const policies = merge(pol3, pol4);

/** 그 공급사가 **실제로 파는 기간**과 **신차를 파는가**. 시트 열은 여기서 정해진다. */
const profile = new Map<string, { periods: Set<string>; newCars: boolean; cars: number }>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const code = S(p.provider_company_code) || S(p.partner_code);
  if (!code) continue;
  const cur = profile.get(code) || { periods: new Set<string>(), newCars: false, cars: 0 };
  cur.cars++;
  if (/^신차/.test(S(p.product_type))) cur.newCars = true;
  const rec = { ...p, product_code: p.product_code || p._key } as EntityRecord;
  // ★가격 행의 개월은 `m`, 변형은 원본 키(`24_3만`)다. 없는 필드 이름으로 읽으면
  //   전부 빈 문자열이 되어 «그 공급사가 쓰는 기간»이 통째로 사라진다 —
  //   빌린카·J&J 의 6개월 열이 그래서 안 생겼다(실측 2026-08-11).
  for (const row of priceList(rec)) cur.periods.add(String((row as Rec).m || ''));
  for (const v of priceVariants(rec)) cur.periods.add(S((v as Rec).key) || String((v as Rec).m || ''));
  profile.set(code, cur);
}

/**
 * 값 표기를 하나로 — 같은 뜻을 두 가지로 적어 놓으면 공급사가 고를 때 헷갈린다.
 * 실측(정책 32건): 「50만원」 20건 · 「500000」 5건 / 「차량가액」 23건 · 「차량가 기준」 2건.
 */
function tidyPolicyValue(v: string): string {
  const t = S(v);
  if (!t) return '';
  if (/^차량가\s*기준$/.test(t)) return '차량가액';
  // 맨숫자 금액은 «만원»으로 — 자리수를 눈으로 세지 않게.
  const n = Number(t.replace(/[,\s원]/g, ''));
  if (Number.isFinite(n) && n >= 10000 && n % 10000 === 0) return `${n / 10000}만원`;
  return t;
}

/** 그 공급사 매물이 실제로 쓰는 정책코드 — 아무도 안 쓰는 옛 정책을 시트에 내보내지 않는다. */
const usedPolicyCodes = new Map<string, Set<string>>();
for (const p of Object.values<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const c = S(p.provider_company_code) || S(p.partner_code);
  const pc = S(p.policy_code);
  if (!c || !pc) continue;
  if (!usedPolicyCodes.has(c)) usedPolicyCodes.set(c, new Set());
  usedPolicyCodes.get(c)!.add(pc);
}

/**
 * 정책탭에 미리 채워 줄 값 — **그 공급사 정책만**, 그중에서도 **쓰는 것만**.
 *
 * 소속은 이미 맞다(실측 2026-08-11 · 13곳 전부 자기 회사 코드). 문제는 옛 정책이다 —
 * 빌린카 POL-0040 처럼 아무 차도 안 쓰는 코드가 남아 있어 공급사가 «이건 뭐냐»를 묻게 된다.
 * 쓰는 게 하나도 없으면 그때는 있는 것을 다 낸다(새로 붙일 정책이 필요하므로).
 */
function policyColumnsFor(code: string): Record<string, string>[] {
  const all = Object.values<Rec>(policies).filter((x) => x && !dead(x)
    && (S(x.provider_company_code) === code || S(x.partner_code) === code));
  const used = usedPolicyCodes.get(code) || new Set<string>();
  const inUse = all.filter((x) => used.has(S(x.policy_code) || S(x._key)));
  const mine = inUse.length ? inUse : all;
  return mine.map((x) => {
    const col: Record<string, string> = { 정책코드: S(x.policy_code) || S(x._key), 정책명: S(x.policy_name) };
    for (const { name, field } of POLICY_COLUMN_FIELDS) col[name] = tidyPolicyValue(S(x[field]));
    return col;
  });
}

// ── 대상 시트 찾기 ──────────────────────────────────────────────────────────
const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '프리패스 재고'");
const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`);
const files = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: S(f.name) }));

/** 시트 이름의 공급사 → 파트너 코드. 이름이 안 붙으면 그 시트는 건드리지 않는다. */
const nameToCode = new Map<string, string>();
for (const p of Object.values<Rec>(partners)) {
  if (dead(p)) continue;
  const code = S(p.partner_code) || S(p._key);
  for (const n of [p.partner_name, p.name, p.company_name].map(S).filter(Boolean)) {
    nameToCode.set(n.replace(/\s|\(주\)|주식회사|㈜/g, ''), code);
  }
}
const codeOf = (sheetName: string): string => {
  const label = sheetName.replace('프리패스 재고 · ', '').replace(/\s/g, '');
  if (nameToCode.has(label)) return nameToCode.get(label)!;
  // 시트 이름은 줄여 쓴다(「에스에이」 ↔ 「주식회사 에스에이렌터카」). 앞뒤 어느 쪽이든 품으면 같은 곳이다.
  for (const [n, c] of nameToCode) if (n.includes(label) || label.includes(n)) return c;
  return '';
};

/** 운영 정본 시트 ID — 여기엔 절대 쓰지 않는다. */
const liveSheetIds = new Set<string>();
for (const p of Object.values<Rec>(partners)) {
  const id = (S(p.sheet_url).match(/\/spreadsheets\/d\/([\w-]+)/) || [])[1];
  if (id) liveSheetIds.add(id);
}

console.log(`■ 공급사 입력시트 한 벌 찍기 ${APPLY ? '(반영)' : '(dry-run)'}${FORCE ? ' · --force' : ''}\n`);
console.log(`  대상 후보 ${files.length}개 · 운영 정본으로 보호되는 시트 ${liveSheetIds.size}개\n`);

type Plan = { id: string; name: string; code: string; cols: string[]; policies: number; cars: number; skip: string };
const plans: Plan[] = [];

for (const f of files) {
  const code = codeOf(f.name);
  const plan: Plan = { id: f.id, name: f.name, code, cols: [], policies: 0, cars: 0, skip: '' };
  if (!code) plan.skip = '공급사를 못 찾음 — 시트 이름 확인';
  else if (ONLY.length && !ONLY.includes(code)) plan.skip = '--only 대상 아님';
  else if (liveSheetIds.has(f.id)) plan.skip = '★운영 정본 시트 — 쓰지 않는다';
  if (plan.skip) { plans.push(plan); continue; }

  const prof = profile.get(code) || { periods: new Set<string>(), newCars: false, cars: 0 };
  const cols = buildColumns([...prof.periods].filter(Boolean));
  const pols = policyColumnsFor(code);
  plan.cols = cols.map((c) => c.name);
  plan.policies = pols.length;
  plan.cars = prof.cars;

  // 이미 입력된 시트는 건드리지 않는다.
  const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?includeGridData=true&fields=sheets(properties(sheetId,title),tables(tableId,range),bandedRanges(bandedRangeId),conditionalFormats,data(rowData(values(formattedValue))))`);
  // 이미 붙어 있는 표 — `addTable` 은 그 위에 다시 못 붙는다("교차 배경 색상이 이미 있는 범위").
  // 지우고 새로 붙여야 열 구성이 바뀐 새 양식이 그대로 들어간다.
  const oldTables = ((grid.sheets || []) as Rec[]).flatMap((sh) => ((sh.tables || []) as Rec[])
    .map((tb) => ({ gid: Number(sh.properties?.sheetId ?? 0), id: S(tb.tableId) })));
  // ★조건부서식은 **쌓인다**. 지우지 않고 다시 찍으면 같은 규칙이 배로 늘어
  //   28개가 84개가 됐다(실측 2026-08-11). 시트마다 있는 것을 먼저 다 지운다.
  const oldRules = ((grid.sheets || []) as Rec[]).map((sh) => ({
    gid: Number(sh.properties?.sheetId ?? 0),
    count: ((sh.conditionalFormats || []) as Rec[]).length,
  })).filter((x) => x.count > 0);
  const sheets = ((grid.sheets || []) as Rec[]).map((sh) => ({
    gid: Number(sh.properties?.sheetId ?? 0),
    title: S(sh.properties?.title),
    filled: ((sh.data?.[0]?.rowData || []) as Rec[])
      .slice(ROW_HEADER + 1)
      .filter((r) => ((r?.values || []) as Rec[]).some((c) => S(c?.formattedValue))).length,
  }));
  const vehicle = sheets.find((s) => s.title === VEHICLE_TAB) || sheets[0];
  if (vehicle && vehicle.filled > 0 && !FORCE) {
    plan.skip = `이미 ${vehicle.filled}행 입력됨 — 덮지 않는다 (--force 로 강제)`;
    plans.push(plan);
    continue;
  }
  plans.push(plan);

  if (!APPLY) continue;

  // ★쓰기 횟수를 아낀다 — 시트당 batchUpdate 2번 + 값쓰기 1번.
  //   요청을 잘게 나누면 13개를 도는 사이 분당 한도(60)를 넘어 중간에 죽는다.
  const gid = vehicle?.gid ?? 0;
  // ★정책코드는 **그 시트 「정책」 탭에 있는 코드**만 고르게 한다.
  //   자유입력으로 두면 없는 코드를 적어 조건이 통째로 안 붙는다.
  const dropdownExtras = {
    제조사: HANDLED_MAKER_OPTIONS,
    연식: yearOptions(new Date().getFullYear()),
    정책코드: pols.map((x) => S(x['정책코드'])).filter(Boolean),
  };

  // ① 판 고르기 — 탭 이름·「정책」 탭 신설·서식 초기화(필터 제거 포함)
  const setup: Rec[] = [];
  if (vehicle && vehicle.title !== VEHICLE_TAB) {
    setup.push({ updateSheetProperties: { properties: { sheetId: gid, title: VEHICLE_TAB }, fields: 'title' } });
  }
  let polGid = sheets.find((s) => s.title === POLICY_TAB_NAME)?.gid;
  const needPolicyTab = polGid == null;
  if (needPolicyTab) setup.push({ addSheet: { properties: { title: POLICY_TAB_NAME } } });
  /**
   * ★표를 지우면 **그 표의 줄무늬도 함께** 사라진다. 같은 묶음에서 줄무늬를 또 지우면
   *   「No BandedRange with id」 로 배치 전체가 죽는다(실측 2026-08-11).
   *   그래서 표를 먼저 지우고, **다시 읽어** 남은 줄무늬만 지운다.
   */
  // ★조건부서식을 **표보다 먼저** 지운다. 표를 지우면 그 표가 들고 있던 서식이 함께 사라져
  //   번호가 밀리고, 읽어 둔 번호로 지우면 「No conditional format at index」 로 죽는다.
  //   뒤에서부터 지운다 — 앞에서 지우면 남은 규칙의 번호가 또 밀린다.
  for (const r of oldRules) for (let k = r.count - 1; k >= 0; k--) setup.push({ deleteConditionalFormatRule: { sheetId: r.gid, index: k } });
  for (const tb of oldTables) setup.push({ deleteTable: { tableId: tb.id } });
  const madeSetup = await api(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: setup }),
  });
  const after = await api(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets(properties(sheetId),bandedRanges(bandedRangeId))`);
  const leftBands = ((after.sheets || []) as Rec[]).flatMap((sh) => ((sh.bandedRanges || []) as Rec[]).map((b) => Number(b.bandedRangeId)));
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: [...leftBands.map((b) => ({ deleteBanding: { bandedRangeId: b } })), ...resetSheetRequests(gid)] }),
  });
  if (needPolicyTab) {
    const reply = ((madeSetup.replies || []) as Rec[]).find((r) => r?.addSheet);
    polGid = Number(reply?.addSheet?.properties?.sheetId ?? 0);
  }

  // ② 값 — 두 탭을 한 번에 쓴다
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: `${VEHICLE_TAB}!A1`, values: buildTemplateValues(cols) },
        { range: `${POLICY_TAB_NAME}!A1`, values: buildPolicyTabValues(pols) },
      ],
    }),
  });

  /**
   * ③ 서식 — **표(Table)는 쓰지 않는다**(사장님 확정 2026-08-11, 칩 실물을 보고 되돌림).
   *
   *   칩(알약)은 표로만 나오는데, 표를 쓰면 딸려오는 게 셋이다.
   *     ① 표 안에서는 숫자서식이 무시돼 천단위 콤마가 안 붙는다 — 금액 칸을 표 밖으로 빼야 한다.
   *     ② 그래서 생기는 표 경계선이 주행거리 앞에 남는다.
   *     ③ 칩 여백과 화살표가 자리를 먹어 칸을 계속 넓혀야 한다.
   *   드롭다운은 화살표로 두고 값마다 색을 칠한다 — 고르는 데 아무 지장이 없고 한 판이 고르다.
   */
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        ...buildBaseFont(gid, cols.length, ROWS),
        ...buildBanding(gid, cols.length, ROWS),
        ...buildTemplateFormat(gid, cols, dropdownExtras),
        ...buildChipColors(gid, cols, HANDLED_MAKER_OPTIONS, ROWS),
        ...buildNumberFormats(gid, cols, ROWS),
        ...buildRowHeights(gid, ROWS),
        ...buildBaseFont(polGid!, 8, 40),
        ...resetSheetRequests(polGid!),
        ...buildPolicyTabFormat(polGid!, pols.length),
        ...buildRowHeights(polGid!, 40),
      ],
    }),
  });

  console.log(`  ✓ ${f.name.replace('프리패스 재고 · ', '').padEnd(12)} 재고 ${cols.length}열 · 정책 ${pols.length}개`);
}

if (!APPLY) {
  console.log(`  ${'공급사'.padEnd(14)}${'코드'.padEnd(10)}${'재고열'.padStart(6)}${'정책'.padStart(6)}${'ERP재고'.padStart(8)}   비고`);
  for (const p of plans) {
    const label = p.name.replace('프리패스 재고 · ', '').slice(0, 13);
    console.log(`  ${label.padEnd(14)}${(p.code || '-').padEnd(10)}${String(p.cols.length || '-').padStart(6)}${String(p.policies || '-').padStart(6)}${String(p.cars || '-').padStart(8)}   ${p.skip}`);
  }
  const go = plans.filter((p) => !p.skip);
  console.log(`\n  찍을 시트 ${go.length}개 · 건너뛸 시트 ${plans.length - go.length}개`);
  if (go[0]) console.log(`\n  「재고」 열 (${go[0].name.replace('프리패스 재고 · ', '')}) →\n   ${go[0].cols.join(' | ')}`);
  console.log('\n※ dry-run. 실제 반영은 --apply\n');
} else {
  const done = plans.filter((p) => !p.skip).length;
  console.log(`\n  찍음 ${done}개 · 건너뜀 ${plans.length - done}개`);
  for (const p of plans.filter((x) => x.skip)) console.log(`     ${p.name.replace('프리패스 재고 · ', '').padEnd(14)}${p.skip}`);
  console.log('');
}
