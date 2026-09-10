/**
 * **판매 4탭 → 공급사별 탭 하나짜리 시트** (사장님 2026-09-08 「지금 시트를 공급사별로만 분리해서 데이터 완벽하게」).
 *
 * ★규칙
 *   · 열은 판매시트 «그대로» — 한 칸도 빼지 않는다(「데이터 완벽하게」). 탭마다 열이 달라 «합집합»으로 세운다.
 *   · **한 회사 = 한 탭.** 손오공은 오공구독·픽업구독·자체렌트가 한 탭에 모인다(공급사가 같으니 저절로).
 *     어느 갈래인지 알아야 하므로 맨 앞에 「갈래」 한 칸을 세운다.
 *   · 탭 차례 = 상품 많은 순.
 *   · 공급사 칸에 «코드»(RP031·PT-0023…)가 든 줄은 회사 이름으로 바꿔 모은다 —
 *     실측 2026-09-08 시트에 코드로 든 줄이 310대라, 그대로 두면 한 회사가 두 탭으로 갈린다.
 *
 * ⚠ 영업채널에 주는 것이라 **원가·수수료는 한 칸도 넣지 않는다.** 판매시트 열에는 원래 없다.
 * ⚠ 판매시트(본시트)는 **읽기만** 한다. 쓰는 곳은 이 채널 문서뿐이다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/build-channel-supplier-sheet.mts --채널=하허호 [--apply]
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { companyAlias } from '../lib/domain/identity';
import { channelCompanyOf } from '../lib/domain/channel-company';
import { isPlate } from '../lib/domain/plate-registry';
import { hasInventoryPublicationViolations, inventoryCountSnapshot, isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import { captureSalesPublishSnapshot, readSalesPublishSnapshot, salesPublishMark } from '../lib/server/sales-publish-snapshot';
import { loadSalesRowContext, makeCell, tabOf, TAB_ORDER, compareSalesRows } from '../lib/domain/sales-atom-row';
import { buildSalesFormatRequests, columnWidths, isMoneyColumn } from '../lib/domain/sales-sheet-format';
import { HAHUHO_PRODUCT_SHEET_ID } from '../lib/domain/legacy-sheets';
import { ensureNoticeTab } from '../lib/server/channel-sheet-tabs';
import { channelColumnName, salesPublishedColumns } from '../lib/domain/sales-published-tab-columns';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const channel = S(arg('채널')) || '하허호';
const snapshotPath = arg('snapshot');
if (APPLY && !snapshotPath) throw new Error('채널시트 발행은 --snapshot=<회차별 고정 스냅샷>이 필요하다. 먼저 capture:sales-publish를 실행하라.');
/**
 * ★문서 이름 = 「[F코드 사용중] 프리패스x<채널> 전용 상품시트」 (사장님 2026-09-08).
 *   F코드 정본은 `lib/server/channel-sheet-tabs` 의 `CHANNEL_F_CODE`(영업채널 = F80번대)와
 *   지도 `aiops/docs/SHEET_MAP.md` 다. 정산시트가 F80~F85 를 쓰므로 «전용 상품시트»는 F86번대로 뗀다.
 * ⚠ 새 채널을 더하면 여기와 지도를 «둘 다» 고친다.
 */
const CHANNEL_PRODUCT_F: Record<string, string> = { 하허호: 'F86' };
const DOC_NAME = `[${CHANNEL_PRODUCT_F[channel] || 'F8?'} 사용중] 프리패스x${channel} 전용 상품시트`;
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }),
});
const firestore = getFirestore();
const publishSnapshot = snapshotPath ? readSalesPublishSnapshot(snapshotPath) : await captureSalesPublishSnapshot(firestore);
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
/**
 * ★**얼마나 두드렸나를 센다.** 구글 시트는 «분당» 한도가 있어, 한도를 넘으면 그 회차가 통째로 죽는다.
 *   실측 2026-09-08 — 회차 여럿이 429 로 죽었다. 세지 않으면 어디가 무거운지 짐작만 하게 된다.
 */
const 셈 = { 읽기: 0, 쓰기: 0, 재시도: 0, 시작: Date.now() };
const api = async (u: string, init?: RequestInit): Promise<any> => {
  if (String(init?.method || 'GET').toUpperCase() === 'GET') 셈.읽기++; else 셈.쓰기++;
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) { 셈.재시도++; await new Promise((k) => setTimeout(k, 4000 * (n + 1))); continue; }
    throw new Error(`${r.status} ${t.slice(0, 200)}`);
  }
};

/**
 * ★★**줄은 «원자»에서 만든다 — 판매시트를 다시 읽지 않는다.**
 *
 * > 사장님 2026-09-09 「당겨오는 거는 **원자 쪽에서** 당겨오는 거고 …
 * >  네가 **시트까지 원자가 갖고 왔다고 가정하고 그 갖고 온 원자에서 다 주는** 거잖아」
 *
 * ⚠⚠ 실측 2026-09-09 — 여기가 F01 의 네 탭을 `values/'탭'!A1:CZ3000` 으로 **통째로 다시 읽어**
 *   줄을 만들고 있었다. 원자 → F01 시트 → F86 시트로 다리가 하나 더 있었던 것이다. 그래서
 *   ㉠ F01 발행이 실패한 회차엔 **옛 시트를 베끼고**(그런데 로그는 성공으로 찍힌다),
 *   ㉡ F01 이 잘못 실은 값을 그대로 물려받고,
 *   ㉢ 열값·정렬 규칙이 **두 벌**로 적혀 있어 한쪽만 고치면 갈렸다(공급사명이 실제로 갈렸다).
 *
 * ⇒ 원자에서 만든다. 줄 만드는 법·문맥·차례는 전부 `lib/domain/sales-atom-row` 한 벌이다.
 * ★**시트에서 읽는 것은 «머리글 한 줄»뿐**이다 — 열 이름은 여전히 판매시트가 정한다
 *   (사장님 「이미 정답이 있는데」). 값은 원자가 준다.
 */
const rowCtx = await loadSalesRowContext({
  policies: publishSnapshot.policies,
  partners: publishSnapshot.partners,
  companyAlias,
});
const cell = makeCell(rowCtx);
const nameOf = rowCtx.nameByProvider;
console.log(`  공급사 이름 ${nameOf.size}개 · 전용계좌 ${rowCtx.acctByProvider.size}개 (공용 문맥)`);

/**
 * ★★**같은 식구는 한 탭으로 모은다** (사장님 2026-09-08 「경진렌트 경진카는 같은 식구니까 한 탭으로」 ·
 *   「한 줄에도 어차피 회사명 들어가니까」).
 *   한 문서를 나눠 쓰는 관계사다 — 정책 탭도 2026-08-21 에 「운영정책」 한 장으로 합쳤다.
 *   ⇒ 탭은 식구 이름 하나로 모으고, 어느 법인인지는 줄의 「공급사」 칸이 말한다.
 * ★★**스타·스카이 = 「스타스카이」 한 회사**(사장님 2026-09-08 「스카이랑 스타가 같은 계열이라서」).
 *   실측으로도 그렇다 — 그 시트 「회사정보」 탭의 상호가 **「(주) 스타스카이」** 하나고, 사업자등록번호도
 *   하나(206-86-09184)이며, 정산 탭도 회사별로 안 갈려 있다. 「스카이재고」 탭은 **빈 껍데기**(0줄)다.
 *   ⇒ 탭이 둘이라고 회사가 둘인 게 아니다. 이름도 상호 그대로 「스타스카이」로 세운다.
 * ⚠ 빌린카↔엘씨는 아직 안 묶는다 — 재고는 빌린카 탭 하나만 쓰지만 **정산 탭이 둘로 갈려 있다**
 *   (「26년08월 정산 · 빌린카」 · 「26년08월 정산 · 엘씨렌트」). 돈이 갈리는 곳은 사장님이 정한다.
 */
const companyOf = (v: string) => channelCompanyOf(v, nameOf);

/**
 * ★**열 = 판매시트 «그대로»** — 한 칸도 빼지 않는다(「데이터 완벽하게」). 탭마다 열이 달라 «합집합»으로 세운다.
 * ⚠ 픽업구독 탭만 「반납형보증금 / 인수형보증금」을 쓰고, 상품리스트·손오공구독은 「보증금 반납형 / 보증금 인수형」이다
 *   (2026-09-04 픽업 탭 지시). 한 회사(손오공)를 한 탭에 모으면 그 둘이 **두 벌로 선다** — 실측 요금 칸 18개.
 *   ⇒ 판매시트 다수 표기로 통일한다. 값은 그대로, 이름만 한 벌.
 */
const COLUMNS: string[] = [];
const headOf: Record<string, string[]> = {};
for (const prefix of TAB_ORDER) {
  headOf[prefix] = salesPublishedColumns(prefix);
  for (const h of headOf[prefix]) { const n = channelColumnName(h); if (n && !COLUMNS.includes(n)) COLUMNS.push(n); }
}

type Row = { company: string; kind: string; atom: any; cells: Record<string, string> };
const rowsAll: Row[] = [];
{
  const docs = publishSnapshot.products as any[];
  const inventory = inventoryCountSnapshot(docs);
  const listable = docs.filter(isOpenInventoryAtom);
  if (hasInventoryPublicationViolations(inventory)) {
    console.error(`  ⛔ 재고 계약 위반 — listable ${inventory.listableDrift} · status_kind ${inventory.statusKindDrift} · 원천 식별자 ${inventory.sourceIdentityViolations} · 삭제표식 ${inventory.deletedMarkerViolations} · 차량번호 ${inventory.blankPlateViolations}/${inventory.invalidPlateViolations}/${inventory.duplicatePlateViolations}`);
    process.exit(1);
  }
  const invalidCars = listable.filter((v) => !isPlate(S(v.car_number)));
  if (invalidCars.length) {
    for (const v of invalidCars.slice(0, 10)) console.error(`  ⛔ 차번 아님: ${S(v.car_number)}`);
    console.error('  채널시트를 건드리기 전에 중단한다.');
    process.exit(1);
  }
  const 탭수: Record<string, number> = {};
  for (const v of listable) {
    const kind = tabOf(v);
    const HEAD = headOf[kind]; if (!HEAD) continue;
    /**
     * ★★**차번이 아니면 싣지 않는다** — F01 과 «같은 가드»(사장님 2026-09-08 「차량번호 없으면 당기면 안 되지」).
     *   오플 원본 시트의 배너 줄이 «차»가 되어 실린 적이 있다(「★★★ … 수수료 150만원 … ★★★」).
     */
    const car = S(v.car_number);
    const cells: Record<string, string> = {};
    for (const h of HEAD) cells[channelColumnName(h)] = cell(h, v);
    rowsAll.push({ company: companyOf(cells['공급사'] || ''), kind, atom: v, cells });
    탭수[kind] = (탭수[kind] || 0) + 1;
  }
  console.log(`  원자에서 만든 줄 ${rowsAll.length} — ${TAB_ORDER.map((t) => `${t} ${탭수[t] || 0}`).join(' · ')}`);
}

/**
 * 열 = 판매시트 «그대로». 「갈래」 같은 우리 칸을 덧붙이지 않는다(사장님 2026-09-08 「갈래라는 항목은 필요없음」).
 * ★한 회사가 여러 갈래를 갖더라도(손오공 = 오공구독·픽업구독·자체렌트) 줄의 「구분」 칸이 이미 말한다.
 */
const OUT_COLS = [...COLUMNS];
const by = new Map<string, Row[]>();
/**
 * ★★**공급사를 모르는 차는 채널에 안 내보낸다.**
 *   ⚠ 2026-09-08(적대 검토가 잡았다) — F01 은 이름을 못 찾으면 「공급사」 칸을 **일부러 비운다**
 *   (코드로 때우지 않는다는 규칙). 그 빈칸을 여기서 「(공급사 없음)」 탭으로 묶어 내보내고 있었다 —
 *   영업채널이 «공급사 모르는 차 목록»을 받는 꼴이다. 지운 그 탭을 이번 회차가 다시 만들던 자리다.
 *   ⇒ 빼고, 몇 대인지 알린다. 고칠 곳은 **문패의 공급사명**이지 이 시트가 아니다.
 */
const 이름없음: Row[] = [];
for (const x of rowsAll) {
  if (!x.company) { 이름없음.push(x); continue; }
  const l = by.get(x.company) || []; l.push(x); by.set(x.company, l);
}
if (이름없음.length) console.log(`  ⚠ 공급사 이름을 모르는 차 ${이름없음.length}대 — 채널에 안 내보낸다(문패 「공급사명」을 채워라): ${이름없음.slice(0, 6).map((x) => S(x.cells['차량번호'])).join(' · ')}`);
if (APPLY && 이름없음.length) {
  console.error('  ⛔ 공급사명이 없는 차를 누락한 채 운영 채널시트를 덮지 않는다.');
  process.exit(1);
}
/**
 * ★**줄 차례 = 판매시트와 «같은 규칙»** — 이제 «같은 함수»(`compareSalesRows`)를 쓴다.
 *   ⚠ 예전엔 같은 규칙이 여기 따로 적혀 있었고, 시트 «칸»(글자)으로 견주느라 F01(원자로 견줌)과
 *     미묘하게 달랐다. 시트마다 차례가 다르면 같은 재고가 두 차례로 보인다 — 「왜 또 바뀌었냐」의 자리다.
 */
const modelSold = new Map<string, number>();
try {
  const j = JSON.parse(readFileSync('public/data/model-popularity.json', 'utf8')) as { 순위?: Record<string, number> };
  for (const [m, n] of Object.entries(j.순위 || {})) modelSold.set(S(m), Number(n) || 0);
  console.log(`  인기순(계약 실적) ${modelSold.size}가지 로드`);
} catch { console.warn('  인기순 파일 없음 — 인기 축은 건너뛴다'); }
/**
 * ⚠⚠ **보조축(재고 대수)은 «F01 전체»로 센다 — 회사별로 세지 않는다.**
 *   F01 은 탭 전체에서 모델을 세는데 여기서 회사 안에서만 세면 같은 모델의 차례가 시트마다 달라진다.
 */
const modelCount = new Map<string, number>();
for (const r of rowsAll) { const m = S(r.atom.model); if (m) modelCount.set(m, (modelCount.get(m) || 0) + 1); }
const cmp = compareSalesRows(modelSold, modelCount);
for (const list of by.values()) list.sort((a, b) => cmp(a.atom, b.atom));
const order = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`\n■ ${DOC_NAME} — 회사 ${order.length}곳 · 총 ${rowsAll.length}대 · 열 ${OUT_COLS.length}`);
for (const [k, list] of order) {
  const g = new Map<string, number>(); for (const x of list) g.set(x.kind, (g.get(x.kind) || 0) + 1);
  const fee = COLUMNS.filter((c) => isMoneyColumn(c) && !/가격/.test(c) && list.some((x) => { const v = S(x.cells[c]); return !!v && v !== '-'; }));
  console.log(`   ${String(list.length).padStart(4)}  ${k.padEnd(10)} 요금 ${String(fee.length).padStart(2)}칸  ${fee.slice(0, 7).join(' · ')}${fee.length > 7 ? ' …' : ''}`);
}
if (!APPLY) { console.log('\n※ dry-run — --apply 로 만든다.\n'); process.exit(0); }

// 준비 시간이 길었어도 실제 운영 시트를 건드리기 직전에 신선도와 해시를 다시 확인한다.
readSalesPublishSnapshot(snapshotPath);

// ── 채널 문서. 운영 중인 하허호 F86은 이름이 아니라 불변 ID로 고정한다. ──
const fixedId = channel === '하허호' ? HAHUHO_PRODUCT_SHEET_ID : '';
let id = fixedId;
if (id) {
  const fixedMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title`);
  if (S(fixedMeta?.properties?.title) !== DOC_NAME) {
    throw new Error(`F86 불변 ID의 문서명이 다르다: ${S(fixedMeta?.properties?.title)} (${id})`);
  }
} else {
  const q = encodeURIComponent(`name = '${DOC_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  id = (found.files || [])[0]?.id || '';
}
if (!id) {
  const made = await api('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST', body: JSON.stringify({ properties: { title: DOC_NAME, locale: 'ko_KR', timeZone: 'Asia/Seoul' } }),
  });
  id = made.spreadsheetId;
  await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false`, {
    method: 'POST', body: JSON.stringify({ type: 'domain', domain: 'teamjpk.com', role: 'writer' }),
  });
  console.log('   ✓ 새로 만들었다 · 회사(teamjpk.com)에만 열었다 — 채널에 주는 것은 사람이 누른다');
}
/**
 * ★**공지사항은 채널 정산시트와 «같은 것»을 세운다** (사장님 2026-09-08 「공지사항 동일하게 박아주고」).
 *   같은 함수(`ensureNoticeTab`)를 부르므로 열·서식·안내 문구가 문서마다 갈리지 않는다.
 * ⚠ 이미 있으면 손대지 않는다 — 적어 둔 공지가 날아간다.
 */
{
  const tok = async () => (await jwt.getAccessToken()).token;
  const made = await ensureNoticeTab(tok, id);
  console.log(`   ${made ? '+ 「공지사항」 만듦' : '○ 「공지사항」 있음 — 손대지 않음'}`);
}
const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(sheetId,title)`);
const have: [string, any][] = (cur.sheets || []).map((s: any) => [S(s.properties.title), s.properties]);
const mark = salesPublishMark(publishSnapshot);

const reqs: any[] = [];
/** ★차번 셀 링크 요청 — 값 쓰기 «뒤»에 따로 보낸다(먼저 보내면 값 쓰기가 지운다). */
const 링크요청: any[] = [];
const puts: { range: string; values: string[][] }[] = [];
/** 이번 회차에 실제로 채운 탭 — 여기 없는 회사 탭은 묵은 것이라 지운다(아래). */
const 쓴탭 = new Set<number>();
let index = 1;   // 0 = 공지사항
for (const [company, list] of order) {
  /**
   * ★탭 이름 = 「회사 N대」 (사장님 2026-09-08 「그냥 손오공 몇 대만 탭으로 남겨줘」).
   *   판매시트는 탭 이름에 시각을 박지만(발행 시각이 곧 신선도라서), 채널이 보는 이 문서는
   *   회사·같은 스냅샷의 시각·대수를 함께 보여 준다.
   */
  /**
   * ★★**F01(판매시트)을 그대로 회사별로만 쪼갠다** (사장님 2026-09-08 「F01을 토대로 그냥 회사별로만
   *   쪼개 놓으면 되는 건데」 · 「상품리스트에 있는 거를 공급사별로만 탭해서 넣는 건데」).
   *   ⚠ **여기서 열을 새로 정하지 않는다.** 요금 규격(단기/장기보증·반납형/인수형·2만/3만km)은
   *     F01 이 이미 탭마다 정해 두었다 — 그 답을 옮기기만 한다.
   *     내가 규격을 다시 짜다가 오플 탭 열을 두 벌로 만들어 시트를 깨뜨렸다(2026-09-08). 되풀이하지 않는다.
   *   ★그 회사 줄에 «값이 하나라도 있는» 요금 칸만 남긴다 — 안 파는 기간을 빈 칸으로 이지 않기 위해서다.
   *     이건 «열을 만드는» 것이 아니라 «F01 열 중에서 고르는» 것이다.
   */
  const 요금칸 = (c: string) => isMoneyColumn(c) && !/가격/.test(c);
  const 쓴다 = (c: string) => list.some((x) => { const v = S(x.cells[c]); return !!v && v !== '-'; });
  const 앞 = COLUMNS.indexOf('차명(원문)');
  /** ★F01 의 열 차례를 «그대로» 지킨다 — 다시 정렬하지 않는다(그러다 12·24 인수형이 끝으로 밀렸었다). */
  const cols = COLUMNS.filter((c, i) => (요금칸(c) ? 쓴다(c) : true));
  const title = `${company} ${mark} · ${list.length}대`;
  const old = have.find(([t]) => t.startsWith(`${company} `));
  let gid: number;
  if (old) {
    gid = Number(old[1].sheetId);
    reqs.push({ updateSheetProperties: { properties: { sheetId: gid, title, index }, fields: 'title,index' } });
  } else {
    const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, index, gridProperties: { rowCount: list.length + 30, columnCount: cols.length } } } }] }),
    });
    gid = Number(made.replies[0].addSheet.properties.sheetId);
  }
  reqs.push({ updateCells: { range: { sheetId: gid }, fields: 'userEnteredValue' } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, rowCount: list.length + 30, columnCount: cols.length } }, fields: 'gridProperties(frozenRowCount,rowCount,columnCount)' } });
  /**
   * ★★**서식은 판매시트와 «같은 한 벌»이다** (사장님 2026-09-08 「어떤 시트에 나가든지 규격이나 정책 기능 동일해야지」).
   *   손으로 색·글꼴을 다시 정하지 않고 `buildSalesFormatRequests` 를 그대로 부른다 —
   *   금액 우측정렬·굵기, 기간 배경색, 구분·배차상태 값별 색, 머리글 메모, 차번 셀 링크까지 전부 따라온다.
   *   ⇒ 영업자가 판매시트를 보다 이 시트를 봐도 «같은 문서»로 읽힌다.
   */
  /** 본문 — 열너비를 재고 차번 셀 링크를 거는 데 쓴다(서식보다 «먼저» 있어야 한다). */
  const body = list.map((x) => cols.map((c) => S(x.cells[c])));
  /**
   * ★★**차번 셀 링크는 «값을 쓴 뒤»에 건다** — 아래 `링크요청` 으로 따로 받아 둔다.
   *   ⚠⚠ 실측 2026-09-09 — 여기서 링크까지 `reqs` 에 담아 «먼저» 보내고 값을 나중에 썼더니,
   *   그 값 쓰기가 차번 셀을 덮으면서 링크가 같이 죽었다 — **703대 중 링크가 «한 대도» 없었다.**
   *   서식(색·글꼴)은 멀쩡해서 눈으로는 안 띈다. 채널이 차번을 눌러도 사진이 안 열리는 채로 나갔다.
   */
  reqs.push(...buildSalesFormatRequests({
    gid, columns: cols, headerAt: 0, widths: columnWidths(cols, body),
    columnCountNow: cols.length, tabTitle: title, body, linkOut: 링크요청,
  }) as any[]);
  /**
   * ★**탭 색은 회사마다 다르게** (사장님 2026-09-08 「각 회사별 탭 다르게 해주고」).
   *   차례대로 도는 색표라 회사가 늘어도 안 겹쳐 보인다. 서식(글꼴·값 색)은 위에서 이미 한 벌로 맞췄다.
   */
  const TAB_HUES = [
    { red: 0.10, green: 0.24, blue: 0.47 }, { red: 0.65, green: 0.20, blue: 0.20 },
    { red: 0.16, green: 0.44, blue: 0.30 }, { red: 0.50, green: 0.35, blue: 0.06 },
    { red: 0.38, green: 0.24, blue: 0.53 }, { red: 0.13, green: 0.42, blue: 0.47 },
    { red: 0.58, green: 0.30, blue: 0.12 }, { red: 0.30, green: 0.30, blue: 0.30 },
  ];
  reqs.push({ updateSheetProperties: { properties: { sheetId: gid, tabColor: TAB_HUES[index % TAB_HUES.length] }, fields: 'tabColor' } });
  reqs.push({ setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: list.length + 1, startColumnIndex: 0, endColumnIndex: cols.length } } } });
  puts.push({ range: `'${title}'!A1`, values: [cols, ...body] });
  쓴탭.add(gid);
  index++;
}

/**
 * ★★**이번에 안 쓴 회사 탭은 지운다.**
 *
 * ⚠ 2026-09-08 실측 — F86 에 「(공급사 없음) 84대」·「KH 09.08 11:56 · 11대」 같은 **묵은 탭**이 남아 있었다.
 *   옛 회차가 만든 것인데, 지우지 않으니 채널은 **이미 사라진 재고를 계속 보고 있었다.**
 *   시트에 서 있는 차는 「팔 수 있다」는 뜻이라 — 묵은 탭은 «덜 새로운 표»가 아니라 **틀린 표**다.
 * ★공지사항·안내 탭은 남긴다(사람이 적는 것). 우리가 만든 «회사 탭»만 거둔다.
 */
{
  const 지킴 = /공지|안내|이 시트|시트 지도/;
  /**
   * ⚠⚠ **읽은 게 없으면 아무것도 지우지 않는다** (2026-09-08 적대 검토가 잡았다).
   *   F01 탭 이름이 안 걸리거나 그 시트가 비어 있으면 `order` 가 빈다 → `쓴탭` 도 빈다 →
   *   **공지사항만 빼고 회사 탭을 전부 지우고** 값은 하나도 안 쓴다. 채널이 재고 0을 본다.
   *   ★지우는 일은 «채운 회차»만의 몫이다 — 못 읽은 회차는 옛 표를 그대로 두는 게 낫다.
   */
  const 버릴 = 쓴탭.size === 0 ? [] : have.filter(([t, p]) => !지킴.test(t) && !쓴탭.has(Number(p.sheetId)));
  if (!쓴탭.size) console.log('   ⚠ 이번 회차에 채운 탭이 없다 — 묵은 탭 정리를 «건너뛴다»(못 읽은 회차일 수 있다).');
  if (버릴.length) {
    console.log(`   ○ 묵은 탭 ${버릴.length}장 지움 — ${버릴.map(([t]) => t).join(' · ')}`);
    for (const [, p] of 버릴) reqs.push({ deleteSheet: { sheetId: Number(p.sheetId) } });
  }
}

/**
 * ★**서식 요청은 크게 묶어 보낸다.**
 *   ⚠ 2026-09-08 실측 — 60개씩 쪼개 보내느라 쓰기가 **83번**, 112초였다. 구글은 «분당» 한도라
 *   두드림 수가 곧 죽을 확률이다(같은 날 회차 여럿이 429 로 죽었다). 값은 같은데 두드림만 많았다.
 *   ⇒ 300개씩. 묶음이 크면 실패도 «한 번»이라 반쪽 서식이 남을 자리도 줄어든다.
 */
for (let i = 0; i < reqs.length; i += 300) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs.slice(i, i + 300) }) });
}
/**
 * ★**탭 열여덟 장을 «한 번»에 쓴다** (`values:batchUpdate`).
 *   ⚠ 2026-09-08 까지 탭마다 PUT 을 따로 날렸다 — 열여덟 번. 값은 같은데 두드림만 열여덟 배였고,
 *   구글 «분당» 한도를 그만큼 빨리 먹었다(실측 회차 여럿이 429 로 죽었다).
 *   ★한 번에 쓰면 실패도 «한 번»이라, 절반만 쓰이고 멈춘 «반쪽 시트»가 안 남는다.
 */
for (let i = 0; i < puts.length; i += 40) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: puts.slice(i, i + 40).map((p) => ({ range: p.range, values: p.values })) }),
  });
}
/**
 * ★★**마지막 — 차번 셀 링크.** 값 쓰기가 끝난 «뒤»여야 한다.
 *   매뉴얼 「사진링크는 맨 끝」의 «끝»은 요청 배열의 끝이 아니라 **쓰기 차례의 끝**이다.
 *   (F01 은 값을 먼저 쓰고 서식을 나중에 하므로 그 길에선 저절로 맞는다.)
 */
for (let i = 0; i < 링크요청.length; i += 300) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: 링크요청.slice(i, i + 300) }) });
}
console.log(`   ○ 구글 두드림 — 읽기 ${셈.읽기} · 쓰기 ${셈.쓰기} · 재시도 ${셈.재시도} · 서식요청 ${reqs.length} · 차번링크 ${링크요청.length} · ${Math.round((Date.now() - 셈.시작) / 1000)}초`);
console.log(`\n✓ 반영 완료 — 탭 ${order.length}장 · ${rowsAll.length}대 · 열 ${OUT_COLS.length}`);
console.log(`   https://docs.google.com/spreadsheets/d/${id}/edit`);
console.log(`   스냅샷 ${publishSnapshot.snapshotId} · ${publishSnapshot.capturedAt}`);
process.exit(0);
