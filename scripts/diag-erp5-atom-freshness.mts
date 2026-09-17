/**
 * **재고 원자가 «언제 것»인지 — 원자에 직접 물어본다.** 읽기 전용 · 아무것도 안 쓴다.
 *
 * 사장님 2026-09-17 「그 파이프라인 네가 여기서 직접 설정해도 되지 · 여기서 역으로 한번 그쪽으로 파봐」.
 *
 * ## 왜 만드나
 *
 * 가게 머리띠의 「⟳ 9. 14. 02:01」이 **엉뚱한 파이프라인**을 가리키고 있었다.
 *   · 화면이 읽는 시각 = erp4 파이어스토어 `v4/system_status/sheet_daily_sync` · `v4/ops/pipeline`
 *   · 화면이 그리는 재고 = **freepasserp5** 파이어스토어 `products` (`readWhitelabelCatalogFromErp5`)
 * 둘은 서로 다른 연동이 채운다. 그래서 재고가 어제 것이어도 시각은 나흘 전을 가리킬 수 있고,
 * 거꾸로 재고가 묵어도 시각만 오늘일 수 있다. **2026-09-10 에 한 번 겪은 사고와 같은 종류다**
 * (그때는 `ops/pipeline` 을 읽다가 `sheet_daily_sync` 를 «하나 더» 보게 고쳤다 — 출처를 바꾼 게
 * 아니라 늘린 것이라, 원장이 ERP5 로 옮겨 가자 같은 자리에서 또 어긋났다).
 *
 * ⇒ 정직한 답은 **원자 자신**이다. 수집기가 차 한 대를 쓸 때마다 시각을 같이 찍는다:
 *     `_var_polled_at`     — 가변값(요금·상태)을 다시 물어본 시각
 *     `_direct_ingest_at`  — 원천에서 직접 받아 쓴 시각
 *   이 진단은 그 칸이 **운영에 실제로 있는지 · 몇 대에 있는지 · 얼마나 묵었는지**를 센다.
 *   여기서 「있다」가 확인되면 가게 시각의 출처를 이 칸으로 옮긴다 — 그러면 화면이 그리는 그 데이터가
 *   스스로 나이를 말하므로 **다시는 엉뚱한 파이프라인을 가리킬 수 없다.**
 *
 * ## 쓰는 법
 *   .github/workflows/diag-erp5-freshness.yml (수동) — ADC 로 freepasserp5 를 읽는다.
 */
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'freepasserp5';
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT }, 'diag');
const db = getFirestore(app);

const ko = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().replace('T', ' ').slice(0, 16);
const hours = (ms: number) => ((Date.now() - ms) / 3_600_000);

const snap = await db.collection('products').get();
console.log(`\n  freepasserp5/products — ${snap.size}건\n`);

/* ① 시각으로 «보이는» 칸을 전부 훑는다 — 이름을 미리 정해 놓고 세면 못 보는 칸이 생긴다. */
const tally = new Map<string, { n: number; max: number; min: number }>();
type Row = { key: string; best: number; status: string };
const rows: Row[] = [];
const CANDIDATE = /_at$|_at_|polled|ingest|updated|synced|refresh/i;

snap.forEach((doc) => {
  const d = doc.data() as Record<string, unknown>;
  let best = 0;
  for (const [k, v] of Object.entries(d)) {
    if (!CANDIDATE.test(k)) continue;
    const ms = typeof v === 'number' ? v : Date.parse(String(v));
    if (!Number.isFinite(ms) || ms < 1_600_000_000_000 || ms > Date.now() + 86_400_000) continue;
    const t = tally.get(k) || { n: 0, max: 0, min: Number.MAX_SAFE_INTEGER };
    t.n += 1; t.max = Math.max(t.max, ms); t.min = Math.min(t.min, ms);
    tally.set(k, t);
    best = Math.max(best, ms);
  }
  rows.push({ key: doc.id, best, status: String(d.vehicle_status ?? '') });
});

console.log('  ── 시각이 찍힌 칸 ─────────────────────────────');
for (const [k, t] of [...tally].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`   ${k.padEnd(22)} ${String(t.n).padStart(5)}대  최신 ${ko(t.max)}  가장 묵은 ${ko(t.min)}`);
}
if (!tally.size) console.log('   (없다 — 원자에 시각 칸이 하나도 없다)');

/* ② 「재고가 언제 것인가」 = 원자마다 가장 최근 시각을 잡고, 그 분포를 본다. */
const dated = rows.filter((r) => r.best > 0);
const newest = dated.reduce((m, r) => Math.max(m, r.best), 0);
const sorted = dated.map((r) => r.best).sort((a, b) => a - b);
const pct = (p: number) => (sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : 0);

console.log('\n  ── 재고 나이 ─────────────────────────────────');
console.log(`   시각 있는 차   ${dated.length} / ${rows.length}대 (${Math.round(dated.length / Math.max(rows.length, 1) * 100)}%)`);
if (dated.length) {
  console.log(`   제일 최근      ${ko(newest)}  (${hours(newest).toFixed(1)}시간 전)`);
  console.log(`   중간값         ${ko(pct(0.5))}  (${hours(pct(0.5)).toFixed(1)}시간 전)`);
  console.log(`   제일 묵은      ${ko(pct(0))}  (${hours(pct(0)).toFixed(1)}시간 전)`);
  for (const h of [3, 12, 24, 72]) {
    console.log(`   ${String(h).padStart(3)}시간 넘게 안 갱신  ${dated.filter((r) => hours(r.best) > h).length}대`);
  }
}

/* ③ 화면이 보는 시각과 맞대 본다 — 이게 이 진단의 목적이다. */
try {
  const res = await fetch('https://www.freepasserp.com/api/shop/status');
  const j = await res.json() as { updated?: { ms?: number; at?: string } | null };
  const shown = Number(j?.updated?.ms);
  console.log('\n  ── 화면이 보여 주는 시각과 대조 ─────────────────');
  console.log(`   가게 머리띠    ${j?.updated?.at ?? '(없음)'}`);
  if (Number.isFinite(shown) && shown > 0 && newest > 0) {
    const gapH = (newest - shown) / 3_600_000;
    console.log(`   원자 최신      ${ko(newest)}`);
    console.log(`   차이           ${gapH.toFixed(1)}시간 ${gapH > 1 ? '← 화면이 실제보다 «묵었다»고 말하고 있다' : gapH < -1 ? '← 화면이 실제보다 «싱싱하다»고 말하고 있다' : '(맞다)'}`);
  }
} catch { console.log('\n  (운영 시각을 못 읽었다 — 대조는 건너뛴다)'); }

console.log('\n  ※ 읽기만 했다. 아무것도 쓰지 않았다.\n');
