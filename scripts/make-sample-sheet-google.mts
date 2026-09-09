/**
 * Firestore 원자 → «기존 판매시트와 동일한」 샘플 구글시트 (사장님 2026-09-03 「기존 시트 동일하게」).
 *   ★열은 기존 판매시트(1Y1Mx…)의 각 탭 헤더를 «런타임에 읽어» 그대로 쓴다(열 이름·순서 100% 동일).
 *   값 = Firestore 원자(products + policy + partner). 구독 요금은 원자 price 의 반납/인수/km 키로.
 *   올릴 수 있는(listable=출고불가 아님) 것만. 집안 서식(Roboto·배차상태색). 고정 시트 제자리 갱신(링크 안 바뀜).
 * 읽기(Firestore·기존시트 헤더)전용 + 고정 샘플시트 쓰기.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { JWT } from 'google-auth-library';
import { buildSalesFormatRequests, columnWidths } from '../lib/domain/sales-sheet-format';
import { makeCell, tabOf, TAB_ORDER, loadSalesRowContext, compareSalesRows } from '../lib/domain/sales-atom-row';
import { companyAlias } from '../lib/domain/identity';
import { isPlate } from '../lib/domain/plate-registry';

const S = (v: unknown) => String(v ?? '').trim();
const SRC_SHEET = '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs';   // 기존 판매시트 = 본시트(영업자가 보는 곳). 헤더를 여기서 읽는다.
// ★--main = «본시트»(영업자가 보는 판매시트)에 직접 발행. 기본은 샘플(실수로 운영을 덮지 않게).
//   본시트에 쓸 때도 4개 상품탭만 rename·clear·재작성한다(AI 인계·차종사전 등 참조탭은 안 건드린다).
const TO_MAIN = process.argv.includes('--main');
const SAMPLE_SHEET_ID = TO_MAIN ? SRC_SHEET : (S(process.env.SAMPLE_SHEET_ID) || '1J7dcGCTI0hiHBSdbHx0SqKJKrBg57xkgsX-I8qyfv3c');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (url: string, init?: RequestInit): Promise<any> => {
  for (let attempt = 1; ; attempt++) {
    const tok = (await jwt.getAccessToken()).token;
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const txt = await res.text();
    if (res.ok) return txt ? JSON.parse(txt) : {};
    if ((res.status === 429 || res.status >= 500) && attempt <= 6) { console.warn(`  ${res.status} 재시도 ${attempt}/6…`); await sleep(3000 * attempt); continue; }
    throw new Error(`${res.status} ${url}\n${txt.slice(0, 300)}`);
  }
};

// ── 데이터 ──
const firestore = getFirestore();
const docs = (await firestore.collection('products').get()).docs.map((d) => d.data());
const listable = docs.filter((v) => v.listable === true);

// ★전용계좌·공급사명 = 공급사(파트너) 정보(사장님 2026-09-03·09-04 「계좌·공급사명도 원자화된 거 갖고 와야지」).
//   provider_company_code → 은행·계좌·예금주 · 회사명.
/** 이름을 못 찾은 공급사 코드 — 코드로 때우지 않고 세어서 화면에 알린다. */
/** 차번이 아니라 안 실은 줄 — 조용히 빼지 않고 목록으로 찍는다. */
/**
 * ★★**인기순 = «실제로 나간 것»(계약 실적)이다** (사장님 2026-09-08 「상품 많은 순은 별도고 인기순은 별도야」).
 *   ERP 의 `popular` 은 라벨이 「상품 많은 순」이고 셈도 **재고 대수**라 «손님이 많이 찾는 차»가 아니다.
 *   ⇒ 인기는 정산원장 계약 실적으로 센다(`scripts/build-model-popularity.mts` → `public/data/model-popularity.json`).
 * ⚠ 실적 파일이 없으면 인기 축은 «없는 셈» 치고 넘어간다 — 재고 대수로 몰래 대신하지 않는다.
 *   그렇게 대신하면 사장님이 갈라 놓으라 한 두 축이 다시 한 칸으로 뭉친다.
 */
const modelSold = new Map<string, number>();
try {
  const j = JSON.parse(readFileSync('public/data/model-popularity.json', 'utf8')) as { 순위?: Record<string, number> };
  for (const [m, n] of Object.entries(j.순위 || {})) modelSold.set(S(m), Number(n) || 0);
  console.log(`인기순(계약 실적) ${modelSold.size}가지 로드`);
} catch { console.warn('인기순 파일 없음 — 인기 축은 건너뛴다(build-model-popularity 로 만든다)'); }
/** 같은 실적이면 재고가 많은 모델을 위로 — 「상품 많은 순」은 «보조»축이다. */
const modelCount = new Map<string, number>();
const skippedNotPlate: string[] = [];
/**
 * ★★**정책·공급사명·전용계좌·티카링크 = 공용 문맥**(`lib/domain/sales-atom-row`).
 *   ⚠ 여기서 따로 모으면 F86 과 갈린다 — 실제로 갈려서 「(공급사 없음)」 탭이 채널에 나갔다.
 */
const rowCtx = await loadSalesRowContext({
  policies: (await firestore.collection('policy').get()).docs.map((d) => ({ _key: d.id, ...d.data() })),
  partners: (await firestore.collection('partner').get()).docs.map((d) => ({ _key: d.id, ...d.data() })),
  companyAlias,
});
const { unnamedProviders } = rowCtx;
const cell = makeCell(rowCtx);
const groups: Record<string, any[]> = {};
for (const v of listable) { const t = tabOf(v); (groups[t] = groups[t] || []).push(v); }

// 운영 시트를 비우기 전에 Firestore 원자만으로 전 행을 만들 수 있는지 확정한다.
const invalidCars = listable.filter((v) => !isPlate(S(v.car_number)));
for (const v of listable) cell('공급사', v);
if (invalidCars.length || unnamedProviders.size) {
  for (const [code, count] of unnamedProviders) console.error(`  ⛔ 공급사명 없음 ${code}: ${count}대`);
  for (const v of invalidCars.slice(0, 10)) console.error(`  ⛔ 차번 아님: ${S(v.car_number)}`);
  console.error('  본시트를 건드리기 전에 중단한다.');
  process.exit(1);
}



// ── 기존 판매시트에서 각 탭 헤더를 읽는다(열 100% 동일) ──
const srcMeta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC_SHEET}?fields=sheets.properties(title)`);
const srcTitle = (want: string) => (srcMeta.sheets || []).map((s: any) => s.properties.title).find((t: string) => t.startsWith(want)) || want;
const headerCache: Record<string, string[]> = {};
for (const t of TAB_ORDER) {
  const title = srcTitle(t);
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${SRC_SHEET}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1:BZ1`)}`);
  headerCache[t] = ((v.values || [[]])[0] as string[]).map(S).filter(Boolean);
}
// ★픽업구독 보증금 열 이름 = 「반납형보증금/인수형보증금」(사장님 2026-09-04). 값(대여료×연수 최대3배)은 그대로.
if (headerCache['픽업구독']) headerCache['픽업구독'] = headerCache['픽업구독'].map((h) => h === '보증금 반납형' ? '반납형보증금' : h === '보증금 인수형' ? '인수형보증금' : h);


// ── 고정 시트 제자리 갱신 · 탭 이름 = 「base 업데이트시각 · N대」(기존 판매시트처럼) ──
const kstNow = (() => { const d = new Date(Date.now() + 9 * 3600e3); const p = (n: number) => String(n).padStart(2, '0'); return `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; })();
for (const list of Object.values(groups)) for (const v of (list as any[])) {
  const m = S((v as any).model); if (m) modelCount.set(m, (modelCount.get(m) || 0) + 1);
}
const titleOf = (base: string) => `${base} ${kstNow} · ${(groups[base] || []).length}대`;

let sheetId = SAMPLE_SHEET_ID, fresh = false;
/**
 * ★★**메타를 «못 읽은 것»과 «시트가 없는 것»은 다르다.**
 *
 * ⚠⚠ 2026-09-08(적대 검토가 잡았다) — 여기서 `.catch(() => null)` 로 삼켰다. 그래서 그 GET 한 번이
 *   5xx·403(도메인 위임 일시 실패 등)으로 실패하면 「시트가 없다」로 보고 **새 스프레드시트를 만들고
 *   `type:'anyone'` 으로 전체공개**했다. 본시트는 갱신이 안 된 채 옛 값으로 남고, 대신 전 재고가 담긴
 *   **아무나 읽는 새 문서**가 생긴다 — 로그는 「새로 만들었다」며 성공으로 찍힌다.
 * ⇒ **주소가 자리표(placeholder)일 때만** 새로 만든다. 진짜 주소인데 못 읽으면 **멈춘다** —
 *   새 문서를 만드는 것보다 그 회차를 거르는 게 낫다.
 */
const PLACEHOLDER = SAMPLE_SHEET_ID.startsWith('1FZ8placeholder');
const meta = PLACEHOLDER ? null : await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`).catch((e: unknown) => {
  console.error(`\n✗ 본시트(${sheetId}) 메타를 못 읽었다 — ${(e as Error).message.slice(0, 140)}`);
  console.error('  «시트가 없다»가 아니라 «못 읽었다»다. 새로 만들지 않고 멈춘다(전체공개 새 문서가 생기는 사고를 막는다).');
  process.exit(1);
});
const gidByBase: Record<string, number> = {};
if (!meta) {
  const created = await api('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title: '프리패스 — 상품리스트(영업자용)' }, sheets: TAB_ORDER.map((t, i) => ({ properties: { sheetId: i, title: titleOf(t) } })) }) });
  sheetId = created.spreadsheetId; fresh = true;
  TAB_ORDER.forEach((t, i) => { gidByBase[t] = i; });
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions?sendNotificationEmail=false`, { method: 'POST', body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: 'jpkpyh@gmail.com' }) }).catch(() => {});
  await api(`https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`, { method: 'POST', body: JSON.stringify({ role: 'reader', type: 'anyone' }) }).catch(() => {});
} else {
  // 기존 탭을 «base 이름」으로 찾아 새 제목(시각·대수)으로 rename. 없으면 추가.
  const existing = (meta.sheets || []).map((s: any) => ({ title: S(s.properties.title), gid: s.properties.sheetId }));
  const reqs: any[] = []; let nid = Math.max(0, ...existing.map((e: any) => e.gid)) + 1;
  for (const base of TAB_ORDER) {
    const found = existing.find((e: any) => e.title === base || e.title.startsWith(base + ' '));
    const nt = titleOf(base);
    const rowCount = 1 + (groups[base]?.length || 0) + 20;   // 밑 여유 20줄만(사장님 2026-09-04) — 쓰기 전에 그리드 맞춤
    if (found) { gidByBase[base] = found.gid; reqs.push({ updateSheetProperties: { properties: { sheetId: found.gid, title: nt, gridProperties: { rowCount } }, fields: 'title,gridProperties.rowCount' } }); }
    else { gidByBase[base] = nid; reqs.push({ addSheet: { properties: { sheetId: nid, title: nt, gridProperties: { rowCount } } } }); nid++; }
  }
  if (reqs.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: TAB_ORDER.map((t) => `'${titleOf(t).replace(/'/g, "''")}'`) }) });
}

const bodies: Record<string, string[][]> = {};
const data = TAB_ORDER.map((t) => {
  const HEAD = headerCache[t];
  /**
   * ★★**차번이 아니면 싣지 않는다** (사장님 2026-09-08 「차량번호 없으면 당기면 안 되지」).
   *   발행기 ⑥ 에는 이 가드가 있었는데(`REAL_PLATE`) 여기엔 없었다. 그래서 오플 원본 시트의
   *   **배너 줄이 «차»가 되어 실렸다** — 「★★★ 전기차 프로모션(**수수료 150만원**) 페이지 참고 ★★★」.
   *   차번 칸에 우리 수수료가 적힌 채 영업자·채널 시트로 나갔다(실측 2026-09-08 · 원자 3건).
   * ⚠ 차번 없는 신차(선출고)는 «차대번호»로 싣는 길이 따로 있다 — 그건 여기서 막지 않는다.
   */
  const rows = (groups[t] || [])
    .filter((v) => {
      const car = S(v.car_number);
      if (!car) return false;
      if (isPlate(car)) return true;
      skippedNotPlate.push(`${S(v.provider_company_code)} 「${car.slice(0, 40)}」`);
      return false;
    })
    /**
     * ★★**시트 기본 정렬 — 어떤 리스트도 같다** (사장님 2026-09-08).
     *   매뉴얼 = `docs/영업자시트-매뉴얼.md` 「기본 정렬」. 새 시트를 만들면 여기 규칙을 그대로 쓴다.
     *
     * ```
     * ① 신차가 맨 위               상품구분에 「신차」가 들면 먼저
     * ② 모델별로 «묶는다»           신차는 인기순(계약 실적)으로 · 같은 실적이면 상품 많은 순 → 모델명
     * ③ 묶음 «안»에서
     *      신차 → 싼 대여료         새 차는 연식이 다 같아서 값이 갈림의 전부다
     *      중고 → 최신 연식 먼저     같은 모델이면 연식이 값보다 먼저다(사장님 2026-09-08)
     *                              연식이 같으면 그 다음이 싼 대여료
     * ④ 공급사 · 차번               눈이 안 헤매게 고정 차례
     * ```
     * ★**「인기순」과 「상품 많은 순」은 다른 축이다** — 인기는 «팔린 것»(정산원장 계약 실적),
     *   상품 많은 순은 «들고 있는 것»(재고 대수). ERP 는 둘을 `popular` 한 칸에 뭉쳐 두었는데
     *   그건 고쳐야 할 자리라, 시트가 그 오류를 베끼지 않는다(사장님 2026-09-08 「ERP 정본이 잘못된 거야」).
     * ⚠ 정렬은 «보는 차례»만 바꾼다. 한 줄의 값은 손대지 않는다.
     */
    .sort(compareSalesRows(modelSold, modelCount))
    .map((v) => HEAD.map((c) => cell(c, v)));
  bodies[t] = rows;
  console.log(`  ${titleOf(t)} · ${HEAD.length}열`);
  return { range: `'${titleOf(t).replace(/'/g, "''")}'!A1`, values: [HEAD, ...rows] };
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });

const fmt: Record<string, unknown>[] = [];
for (const t of TAB_ORDER) {
  const gid = gidByBase[t], HEAD = headerCache[t];
  fmt.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  fmt.push(...buildSalesFormatRequests({ gid, columns: HEAD, widths: columnWidths(HEAD, bodies[t]), tabTitle: t, body: bodies[t] }));
}
for (let i = 0; i < fmt.length; i += 200) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fmt.slice(i, i + 200) }) });

const total = TAB_ORDER.reduce((a, t) => a + (groups[t]?.length || 0), 0);
console.log(`\n★ ${TO_MAIN ? '본시트 반영 완료' : (fresh ? '새로 만든' : '제자리 갱신')} 상품시트(${total}대 · 기존시트 동일열):\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit`);
if (fresh) console.log(`\n※ 이 ID 를 SAMPLE_SHEET_ID 에 박으면 고정: ${sheetId}`);
process.exit(0);
