/**
 * 공급사 시트 실측 스캔 — **읽기 전용**. 쓰지 않는다.
 *
 * **모든 시트의 모든 탭을 본다.** 탭 하나만 보면(=CSV 기본 export) 재고가 딴 탭에 있는
 * 공급사가 통째로 0대로 잡힌다. 실제로 오토플러스가 그랬다. 탭은 나중에도 늘어나므로
 * 목록을 박아두지 않고 매번 시트에서 열거한다.
 *
 * 사전: 서비스계정이 Sheets API 읽기 스코프를 받아야 한다(firebase-admin 토큰은 스코프가 다르다).
 *       시트가 "링크가 있는 모든 사용자" 공개면 별도 공유 없이 읽힌다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/scan-supplier-sheets.mts
 *   ... --csv tmp/sheet-scan.csv     탭별 결과를 파일로
 */
import { writeFileSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

/** 실번호판 — `12가3456` / `123가4567`. 헤더·안내문과 데이터를 가르는 가장 확실한 신호. */
const PLATE = /^\d{2,3}[가-힣]\d{4}$/;
const normPlate = (v: unknown) => S(v).replace(/\s/g, '');

const CSV_OUT = process.argv.includes('--csv') ? process.argv[process.argv.indexOf('--csv') + 1] : '';

async function sheetsToken(): Promise<string> {
  const key = saJson ? JSON.parse(saJson) : JSON.parse(await import('node:fs').then((m) => m.readFileSync(saPath!, 'utf8')));
  const jwt = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
  });
  const t = await jwt.getAccessToken();
  return String(t.token || '');
}

type Tab = { gid: number; title: string };

/**
 * 탭 열거 — Sheets API 를 먼저 쓰고, 안 되면 htmlview 에서 gid 를 긁는다.
 * 이 프로젝트는 Sheets API 가 비활성(2026-07-31)이라 실제로는 htmlview 경로로 돈다.
 * 활성화하면 탭 이름까지 정확히 나온다:
 *   https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=172664197996
 */
async function listTabs(id: string, tk: string): Promise<Tab[] | string> {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets(properties(sheetId,title))`, {
    headers: { Authorization: `Bearer ${tk}` },
  });
  if (r.ok) {
    const j = await r.json();
    const tabs = (j.sheets || []).map((s: any) => ({ gid: Number(s.properties?.sheetId ?? 0), title: S(s.properties?.title) }));
    if (tabs.length) return tabs;
  }
  // 폴백 — 공개 시트의 htmlview 에 `gid=NNN` 링크가 들어 있다.
  try {
    const h = await (await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`)).text();
    const gids = [...new Set([...h.matchAll(/gid=(\d+)/g)].map((m) => Number(m[1])))];
    if (gids.length) return gids.map((gid) => ({ gid, title: `gid:${gid}` }));
  } catch { /* 아래에서 기본 탭으로 */ }
  // 최후 — 첫 탭만이라도.
  return [{ gid: 0, title: '(첫 탭)' }];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** 상품상태 6종(VEHICLE_STATES). 시트값이 여기 정확히 맞으면 그대로 쓴다. */
const CANON = ['즉시출고', '출고가능', '출고협의', '상품화중', '계약중', '출고불가'];

/**
 * 시트 상태 → 상품상태. **운영 규칙(2026-07-31 확정)**
 *   · 6종에 매칭되면 그대로
 *   · '불가'가 들어 있으면 출고불가
 *   · 나머지는 전부 **출고협의** — 배차중·운행중도 올린다(반납 예정이면 협의 가능하므로 노출 우선)
 * 예전 규칙은 배차중·운행중을 유입에서 아예 걸렀다(sheet-import.isSheetExcluded). 그건 폐기.
 */
function statusOf(raw: string): string {
  const s = S(raw);
  if (!s) return '출고협의';
  const hit = CANON.find((c) => s === c);
  if (hit) return hit;
  if (/출고완|판매완료|반납|폐차|말소|sold/i.test(s)) return '출고불가';
  if (/불가/.test(s)) return '출고불가';
  if (/판매중|할인판매|promo/i.test(s)) return '출고가능';
  if (/상품화/.test(s)) return '상품화중';
  if (/^계약/.test(s)) return '계약중';
  return '출고협의';
}

/** 상태어로 보이는 칸 — 행에서 상태를 찾을 때 쓴다(공급사마다 컬럼 위치가 다르다). */
const STATUS_HINT = /출고|배차|입고|재고|계약|상품화|판매|운행|렌트|대여|반납|폐차|말소|보류|마감|종료/;

/**
 * 표 어디에 있든 실번호판을 긁고, 그 행의 상태를 판정한다.
 * 헤더 위치·컬럼 순서에 의존하지 않으려고 행 전체에서 상태어를 찾는다
 * (공급사마다 상태 컬럼 위치가 다르고, 아예 헤더가 상태값인 시트도 있다).
 */
function platesIn(table: string[][]): { live: Set<string>; out: Set<string> } {
  const live = new Set<string>(); const out = new Set<string>();
  for (const row of table) {
    const raw = row.map((c) => S(c)).find((c) => STATUS_HINT.test(c)) || '';
    const st = statusOf(raw);
    for (const cell of row) {
      const p = normPlate(cell);
      if (!PLATE.test(p)) continue;
      (st === '출고불가' ? out : live).add(p);
    }
  }
  // 같은 차가 두 행에 있으면(예: 이력행) 올라가는 쪽을 우선한다.
  for (const p of live) out.delete(p);
  return { live, out };
}

async function main() {
  const tk = await sheetsToken();
  const [pSnap, p4Snap, prodSnap] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners').get(), db.ref('v4/products').get(),
  ]);
  const partners: Rec = { ...(pSnap.val() || {}), ...(p4Snap.val() || {}) };
  const v4Plates = new Set(
    Object.values((prodSnap.val() || {}) as Rec)
      .filter((r) => isObj(r) && !dead(r))
      .map((r: any) => normPlate(r.car_number))
      .filter(Boolean),
  );

  const targets = Object.entries(partners)
    .filter(([, p]) => isObj(p) && !dead(p) && S(p.sheet_url))
    .map(([code, p]) => ({ code, name: S((p as Rec).name) || S((p as Rec).partner_name) || code, url: S((p as Rec).sheet_url) }))
    .sort((a, b) => a.code.localeCompare(b.code));

  console.log(`시트 연결 공급사 ${targets.length}곳 · v4 살아있는 매물 ${v4Plates.size}대\n`);
  const csv: string[] = ['공급사코드,공급사명,탭이름,gid,올림,출고불가,v4에없음'];
  const grand = new Set<string>();   // 판매 가능(상품이 되는 차)
  const goneAll = new Set<string>(); // 이미 나간 차 — 상품 아님. 몇 대가 걸러지는지 보이려고 센다.

  for (const t of targets) {
    const id = (t.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
    if (!id) { console.log(`${t.code} ${t.name} — ❌ URL 형식 이상`); continue; }
    const tabs = await listTabs(id, tk);
    if (typeof tabs === 'string') { console.log(`${t.code} ${t.name} — ❌ ${tabs}`); continue; }

    const all = new Set<string>();
    const lines: string[] = [];
    for (const tab of tabs) {
      let live = new Set<string>(); let gone = new Set<string>();
      try {
        const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${tab.gid}`, { redirect: 'follow' });
        if (r.ok) { const p = platesIn(parseCsv(await r.text())); live = p.live; gone = p.out; }
      } catch { /* 탭 하나 실패가 전체를 막지 않는다 */ }
      const notIn = [...live].filter((p) => !v4Plates.has(p)).length;
      live.forEach((p) => { all.add(p); grand.add(p); });
      gone.forEach((p) => goneAll.add(p));
      if (live.size || gone.size) {
        lines.push(`    올림 ${String(live.size).padStart(5)}  출고불가 ${String(gone.size).padStart(5)}  v4없음 ${String(notIn).padStart(5)}  「${tab.title}」`);
      }
      csv.push([t.code, t.name, tab.title.replace(/,/g, ' '), tab.gid, live.size, gone.size, notIn].join(','));
    }
    const notInAll = [...all].filter((p) => !v4Plates.has(p)).length;
    console.log(`${t.code} ${t.name} — 탭 ${tabs.length}개 · 올림 ${all.size}대 · v4에 없음 ${notInAll}대${all.size === 0 ? '  ⚠ 전 탭에서 차번 0' : ''}`);
    lines.forEach((l) => console.log(l));
  }

  const newCars = [...grand].filter((p) => !v4Plates.has(p)).length;
  console.log(`\n판매가능 ${grand.size}대 · 그중 v4에 없는 것 ${newCars}대 · 이미 나간 차 ${goneAll.size}대(상품 아님)`);
  if (CSV_OUT) { writeFileSync(CSV_OUT, csv.join('\n'), 'utf8'); console.log(`탭별 상세 → ${CSV_OUT}`); }
  console.log('\n※ 읽기만 했다. 적재는 diff 확인 후.');
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
