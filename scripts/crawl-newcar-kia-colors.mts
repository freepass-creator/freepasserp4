/**
 * 기아 «제조사 색상» 크롤러 — 견적기(build-your-car) 위저드를 몰아 외장·내장 색을 받아 온다.
 *
 * ★★사장님 2026-09-08 「신차마스터에는 **제조사 색상 그대로** 해야지」 ·
 *   「**중고마스터 색상과 신차마스터 색상은 각각 존재**해야 함」 · 「채워」
 *
 * ★왜 브라우저인가 — 기아는 견적 데이터를 **XHR 로 안 준다**(2026-09-08 확인: 위저드가 도는 동안
 *   kia.com 으로 나가는 데이터 호출이 하나도 없다). 클라이언트가 그리고, 색상은 그린 «화면»에만 있다.
 *   PDF 도 봤는데 색상이 «그림 배치»라 줄 순서로 못 읽는다 — 열 모델 중 다섯만 맞았고,
 *   「30만 추가」가 어느 색에 붙는지 틀리면 **견적 금액이 틀린다.** 그래서 위저드를 몬다.
 *
 * ★화면 짜임(2026-09-08 실측):
 *     .btn-colour-container.exterior > .color-filter-option > label > span.color_pick > img[alt=색이름]
 *     색을 고르면  .copy-build-colour .desc(이름) · .price(원)  이 그 색으로 바뀐다
 *   ⇒ 이름·코드는 한 번에 읽고, **값은 색마다 눌러서** 읽는다.
 *
 * 실행 : npx tsx scripts/crawl-newcar-kia-colors.mts            (드라이런 · data/new-car/kia-colors.json)
 *        npx tsx scripts/crawl-newcar-kia-colors.mts --apply    (Firestore new_car_trim 에 merge)
 *        --model=sportage,seltos  로 몇 개만
 * ⚠ 제조사 서버 배려 — 모델 사이·클릭 사이에 쉰다. 하루 1회만.
 *
 * ⚠⚠ **여기 담기는 것은 「기본 트림에서 고를 수 있는 색」이다.**
 *   색은 트림에 매인다 — 스포티지 PDF 에는 외장 6·내장 4 인데 기본 트림(프레스티지)에서는 외장 5·내장 1 만
 *   고를 수 있다(「쉐도우 매트 그레이」는 X-Line 전용, 「라운지 브라운」은 상위 트림 · 2026-09-08 실측).
 *   ⇒ 빠진 것은 «못 받은» 것이 아니라 «그 트림에서 못 고르는» 것이다.
 *   ⇒ 트림마다 도는 것은 5트림×8색=40클릭이라 열여섯 모델이면 640번이다. 지금은 모델 단위로 둔다.
 *     트림별이 필요해지면 이 파일에서 트림 반복만 한 겹 더 두르면 된다.
 */
import { chromium, type Page } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--model=')) || '').split('=')[1]?.split(',').filter(Boolean) ?? [];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (v: unknown) => String(v ?? '').trim();

/** 기아 모델 슬러그 — 가격 페이지에서 `rcCode` 를 딴다. */
const MODELS = ONLY.length ? ONLY : [
  'sportage', 'seltos', 'sorento', 'carnival', 'k5', 'k8', 'k9',
  'morning', 'ray', 'niro', 'ev3', 'ev4', 'ev5', 'ev6', 'ev9', 'mohave',
];

type Color = { name: string; code?: string; price?: number; ok?: string };

/** 가격 페이지 HTML 에서 견적기 코드를 딴다 — 「견적 내기」 링크가 `build?rcCode=…` 다. */
async function rcCodeOf(model: string): Promise<string | null> {
  const r = await fetch(`https://www.kia.com/kr/vehicles/${model}/price`, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const html = await r.text();
  const m = /build\?rcCode=([A-Z0-9]+)/.exec(html);
  return m ? m[1] : null;
}

/** 한 갈래(외장/내장)의 색을 다 훑는다 — 눌러야 값이 뜬다. */
async function readColors(page: Page, kind: 'exterior' | 'interior'): Promise<Color[]> {
  const box = `.btn-colour-container.${kind}`;
  if (!(await page.locator(box).count())) return [];
  const labels = page.locator(`${box} .color-filter-option label`);
  const n = await labels.count();
  const out: Color[] = [];
  for (let i = 0; i < n; i++) {
    const label = labels.nth(i);
    const img = label.locator('img');
    const name = S(await img.getAttribute('alt').catch(() => ''));
    const src = S(await img.getAttribute('src').catch(() => ''));
    const code = (/\/([a-z0-9]+)\.(svg|png|jpg)$/i.exec(src)?.[1] || '').toUpperCase() || undefined;
    if (!name) continue;
    // 눌러서 값을 읽는다 — 안 누르면 «지금 고른 색»의 값만 보인다.
    await label.click({ timeout: 8000 }).catch(() => {});
    await sleep(420);
    const won = await page.evaluate((k) => {
      const rows = Array.from(document.querySelectorAll('.row.copy-build-colour'));
      // 외장·내장이 같은 클래스를 쓴다 — 갈래 상자를 품은 줄을 고른다.
      const row = rows.find((r) => r.querySelector(`.btn-colour-container.${k}`)) || rows[0];
      const t = row?.querySelector('.price')?.textContent || '';
      const d = row?.querySelector('.desc')?.textContent || '';
      return { price: Number(t.replace(/[^\d]/g, '')) || 0, desc: String(d).trim() };
    }, kind);
    // 눌렀는데 이름이 안 바뀌었으면 값을 못 믿는다 — 0 으로 둔다(지어내지 않는다).
    out.push({ name, code, price: won.desc === name ? won.price : 0, ok: 'Y' });
  }
  return out;
}

async function crawlModel(page: Page, model: string): Promise<{ ext: Color[]; int: Color[]; rc: string } | null> {
  const rc = await rcCodeOf(model);
  if (!rc) { console.log(`  ✗ ${model} — 견적기 코드를 못 찾았다`); return null; }
  await page.goto(`https://www.kia.com/kr/buy/build-your-car/build?rcCode=${rc}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5500);
  for (const t of ['오늘 다시 보지 않기', '창 닫기']) {
    const el = page.locator(`text="${t}"`).first();
    if (await el.count().catch(() => 0)) { await el.click({ timeout: 1500 }).catch(() => {}); await sleep(300); }
  }
  // 「외장」 → 「컬러 선택」 두 번 눌러야 색 견본이 그려진다(2026-09-08 실측 — 하나만 누르면 안 뜬다).
  const ext0 = page.locator('text="외장"').first();
  if (await ext0.count()) { await ext0.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2200); }
  const pick = page.locator('text="컬러 선택"').first();
  if (await pick.count()) { await pick.click({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2200); }
  await page.waitForSelector('.btn-colour-container', { timeout: 20000 }).catch(() => {});
  const ext = await readColors(page, 'exterior');
  // 내장은 «다른 탭»이다 — 안 누르면 지금 걸린 한 색만 보인다(2026-09-08 실측: 4색 중 1색만 잡혔다).
  const in0 = page.locator('.copy-build-sub-header:has-text("내장"), h5:has-text("내장")').first();
  if (await in0.count().catch(() => 0)) { await in0.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); }
  else { const t = page.locator('text="내장"').first(); if (await t.count()) { await t.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1500); } }
  const int = await readColors(page, 'interior');
  console.log(`  · ${model}(${rc}) — 외장 ${ext.length} · 내장 ${int.length} · 유료 ${ext.filter((c) => c.price).length}`);
  return { ext, int, rc };
}

// ── 돌린다 ────────────────────────────────────────────────────────────────
const b = await chromium.launch({ headless: true });
const page = await b.newPage({ userAgent: UA, viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30_000);

const result: Record<string, { rc: string; ext: Color[]; int: Color[] }> = {};
console.log(`기아 색상 — 모델 ${MODELS.length}개`);
for (const m of MODELS) {
  try {
    const r = await crawlModel(page, m);
    if (r && (r.ext.length || r.int.length)) result[m] = r;
  } catch (e) { console.log(`  ✗ ${m} —`, String((e as Error).message).slice(0, 60)); }
  await sleep(1200);
}
await b.close();

mkdirSync('data/new-car', { recursive: true });
writeFileSync('data/new-car/kia-colors.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), models: result }, null, 1));
console.log(`\n받은 모델 ${Object.keys(result).length} → data/new-car/kia-colors.json`);

if (!APPLY) { console.log('(드라이런 — Firestore 에 쓰려면 --apply)'); process.exit(0); }

// ── Firestore 에 넣는다 — 그 모델의 «모든 트림» 문서에 같은 색 목록을 merge ──
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const FS = getFirestore();
const snap = await FS.collection('new_car_trim').where('maker', '==', '기아').get();
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
let hit = 0;
const batch = FS.batch();
for (const doc of snap.docs) {
  const v = doc.data();
  const sub = norm(S(v.sub_model));
  const key = Object.keys(result).find((k) => sub.includes(norm(k)) || norm(k).includes(sub));
  if (!key) continue;
  batch.set(doc.ref, { extColors: result[key].ext, intColors: result[key].int, colorSource: 'kia.com/build-your-car', colorAt: new Date().toISOString().slice(0, 10) }, { merge: true });
  hit++;
}
await batch.commit();
console.log(`Firestore — 기아 트림 ${snap.size} 중 ${hit} 개에 색상을 넣었다`);
