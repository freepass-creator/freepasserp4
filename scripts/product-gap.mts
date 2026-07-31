/**
 * 매물 격차 분석 — 브리지를 끄면 목록에서 사라질 차가 무엇인지.
 *
 * 매물은 이관하지 않기로 했다(v4에 시트 동기화분이 이미 있어 실물 중복·이중판매 위험).
 * 그 전제는 "v3의 살아있는 매물이 v4에도 있다"인데, 실제로 그런지 차량번호로 확인한다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/product-gap.mts
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB_URL });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const plate = (r: Rec) => S(r.car_number).replace(/\s/g, '');
const isDead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';

async function main() {
  const [s3, s4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const v3 = Object.entries((s3.val() || {}) as Rec).filter(([, r]) => isObj(r) && !isDead(r));
  const v4 = Object.entries((s4.val() || {}) as Rec).filter(([, r]) => isObj(r) && !isDead(r));

  const v4Plates = new Set(v4.map(([, r]) => plate(r as Rec)).filter(Boolean));
  const gap = v3.filter(([, r]) => { const p = plate(r as Rec); return p && !v4Plates.has(p); });

  console.log(`v3 살아있는 매물 ${v3.length} · v4 ${v4.length} · v3에만 ${gap.length}\n`);

  // 상태별
  const byStatus: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const [, r] of gap) {
    const rec = r as Rec;
    byStatus[S(rec.vehicle_status) || '(없음)'] = (byStatus[S(rec.vehicle_status) || '(없음)'] || 0) + 1;
    byProvider[S(rec.provider_company_code) || '(없음)'] = (byProvider[S(rec.provider_company_code) || '(없음)'] || 0) + 1;
    byType[S(rec.product_type) || '(없음)'] = (byType[S(rec.product_type) || '(없음)'] || 0) + 1;
  }
  const dump = (title: string, o: Record<string, number>) => {
    console.log(title);
    for (const [k, n] of Object.entries(o).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
    console.log('');
  };
  dump('상태별(v3에만 있는 매물)', byStatus);
  dump('공급사별', byProvider);
  dump('상품구분별', byType);

  // 실제로 팔리는 상태만 추림 — 이게 "브리지 끄면 손해 보는" 진짜 숫자다
  const SELLABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);
  const live = gap.filter(([, r]) => SELLABLE.has(S((r as Rec).vehicle_status)));
  console.log(`판매 가능 상태인데 v4에 없는 차: ${live.length}대`);
  for (const [k, r] of live.slice(0, 15)) {
    const rec = r as Rec;
    console.log(`  ${plate(rec).padEnd(10)} ${S(rec.maker)} ${S(rec.sub_model) || S(rec.model)} · ${S(rec.vehicle_status)} · ${S(rec.provider_company_code)}  (${k})`);
  }
  if (live.length > 15) console.log(`  … 외 ${live.length - 15}대`);

  console.log('\n판정:');
  console.log(live.length === 0
    ? '  ✅ v3에만 있는 매물은 전부 비판매 상태 — 매물 브리지를 꺼도 목록 손실 없음'
    : `  ⛔ ${live.length}대가 사라진다 — 시트 동기화로 v4에 채운 뒤에 꺼야 한다`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
