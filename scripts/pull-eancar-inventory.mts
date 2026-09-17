/**
 * **이안카(RP031) 재고를 홈페이지 API 에서 당겨온다** — 헤드리스 크롬 자동 로그인.
 *
 * ★사장님 2026-09-17 — 이안카 홈페이지(이안카.com)에 REST 재고 API 가 있다.
 *   시트 대신 이 API 를 «재고 정본»으로 쓴다(요금·정책은 시트가 계속 정본 — API 가 안 준다).
 *   「기존 이안카 당겨오는곳만 달라지는거고」·「저기 전산에 없는거는 다 출고불가」·
 *   「예약중은 그냥 우리한테는 출고 불가로 잡아주면 되고」·「렌트팡도 이안카로 같이 받는다」.
 *
 * ★API 가 «주는» 것만 담는다(실측 2026-09-17):
 *   차량번호·차명·연식·연료·외장색·주행거리·상태·차고지·사진.
 *   ⚠ «안 주는» 것 — 요금 9구간·보험·정책·소비자가격·내장색·배기량·차종분류·트림·
 *     제조사 유상옵션. 이것들은 여기서 만들지 않는다(원자화 단계에서 시트 값을 겹쳐 유지).
 *   ⚠ 옵션(가죽시트·열선 등)은 «장착사양»이라 우리 규격의 「옵션」(제조사 유상옵션)이 아니다 — 비운다.
 *
 * ★상태 규칙(원자화가 최종 판정하지만 원천 표기를 여기서 정한다):
 *   available·merchandising  → 팔 수 있는 차(가용)
 *   예약중(reservedVehicles) → 출고불가 (우리에겐 못 파는 차)
 *   API 에 아예 없는 차       → 원자화 --retire 가 출고불가로 내린다(전산에 없으면 못 판다)
 *
 * ⚠ 계정은 파일에서 읽는다(대화·코드에 비번 안 남게). 비번 바뀌면 그 파일만 갱신한다.
 *   Cloudflare 가 걸려 있어 «진짜 브라우저»(Playwright)로 로그인한다 — 서버 curl 은 막힐 수 있다.
 *
 *   node --require ./scripts/lib/server-only-shim.cjs ./node_modules/tsx/dist/cli.mjs scripts/pull-eancar-inventory.mts
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ACCOUNT_PATH = process.env.EANCAR_ACCOUNT_PATH
  || 'C:/dev/freepasserp4-rtdb-current/sonokong/lib/wonja/.이안카계정.json';
const OUT_PATH = process.env.EANCAR_DUMP_PATH
  || 'C:/dev/freepasserp4-rtdb-current/sonokong/lib/wonja/이안카차량.json';
const BASE = 'https://xn--le5bt3bwxk.com';
const QUIET = process.argv.includes('--조용');
const log = (...a: unknown[]) => { if (!QUIET) console.log(...a); };
const S = (v: unknown) => String(v ?? '').trim();

type EancarUnit = {
  차번: string; 차명: string; 연식: number | null; 연료: string; 외장: string;
  주행거리: number | null; 상태: string; 차고지: string; 소속: string;
  사진: string[]; vehicleNo: string; 예약: boolean;
};

const acc = JSON.parse(readFileSync(ACCOUNT_PATH, 'utf8')) as { id: string; pw: string };

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.fill('input[autocomplete="username"]', acc.id);
  await page.fill('input[autocomplete="current-password"]', acc.pw);
  await Promise.all([
    page.waitForResponse((r) => /\/api\/auth\/(login|signin)/.test(r.url()), { timeout: 15000 }).catch(() => null),
    page.getByRole('button', { name: '로그인' }).last().click(),
  ]);
  await page.waitForTimeout(2500);

  const raw = await page.evaluate(async () => {
    const r = await fetch('/api/inventory', { headers: { accept: 'application/json' }, credentials: 'include' });
    return { status: r.status, body: await r.json() };
  });
  if (raw.status !== 200) throw new Error(`재고 API status ${raw.status} — 로그인 실패 또는 세션 만료`);
  const inv = raw.body as {
    models?: { name?: string; units?: Record<string, unknown>[] }[];
    reservedVehicles?: { plate?: string; vehicleNo?: string; name?: string; year?: number }[];
    total?: number; fleetTotal?: number; reservedTotal?: number; syncedAt?: string;
  };

  const 가용: EancarUnit[] = (inv.models || []).flatMap((m) => (m.units || []).map((u) => ({
    차번: S(u.plate), 차명: S(u.name) || S(m.name), 연식: u.year == null ? null : Number(u.year),
    연료: S(u.fuel), 외장: S(u.color), 주행거리: u.mileage == null ? null : Number(u.mileage),
    상태: S(u.status), 차고지: S(u.dispatchLocation), 소속: S(u.affiliation),
    사진: u.thumbnail ? [S(u.thumbnail)] : [], vehicleNo: S(u.vehicleNo), 예약: false,
  })));
  const 예약: EancarUnit[] = (inv.reservedVehicles || []).map((v) => ({
    차번: S(v.plate), 차명: S(v.name), 연식: v.year == null ? null : Number(v.year),
    연료: '', 외장: '', 주행거리: null, 상태: '예약중', 차고지: '', 소속: '',
    사진: [], vehicleNo: S(v.vehicleNo), 예약: true,
  }));

  // 차번 없는 줄은 버린다(원자 키가 없다). 가용·예약 양쪽에 있으면 예약이 이긴다(못 파는 차).
  const byPlate = new Map<string, EancarUnit>();
  for (const u of 가용) if (u.차번) byPlate.set(u.차번, u);
  for (const u of 예약) if (u.차번) byPlate.set(u.차번, u);
  const 차량들 = [...byPlate.values()];

  const dump = {
    source: 'eancar-api', syncedAt: inv.syncedAt || new Date().toISOString(),
    collectedAt: new Date().toISOString(),
    counts: { 가용: 가용.length, 예약: 예약.length, 유일차번: 차량들.length, fleetTotal: inv.fleetTotal ?? null },
    차량들,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(dump, null, 1), 'utf8');

  log(`✓ 이안카 재고 — 가용 ${가용.length} · 예약 ${예약.length}(출고불가) · 유일차번 ${차량들.length} · 전체보유 ${inv.fleetTotal}`);
  log(`  ${OUT_PATH}`);
} finally {
  await browser.close();
}
