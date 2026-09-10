/**
 * ★대수 «단일 카운터» — SSOT(Firestore products 원자) 하나에서 «한 정의»로 읽는다.
 *   Claude·Codex·누구든 이 스크립트를 돌리면 «같은 숫자»가 나온다. 각자 세지 않는다(CLAUDE.md).
 *
 *   정의(고정):
 *     화면(listable)   = product.listable === true            ← 계약중 «포함»(선점 표시)
 *     ERP              = listable − 계약중                     ← 손오공 API가 계약중을 안 줘 공급사시트엔 없음
 *     계약중           = vehicle_status(또는 status) === '계약중'
 *     버킷(tabOf)      = make-sample-sheet 와 «같은» 분류
 *
 *   npx tsx scripts/count-daesu-atom.mts          (읽기 전용, 쓰기 없음)
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
const K = (v: unknown) => S(v).replace(/\s/g, '');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

/** make-sample-sheet-google 와 동일한 tabOf(= lib/domain/sales-atom-row). 한 벌만 쓴다. */
const tabOf = (v: Record<string, unknown>): string => {
  const prov = S(v.provider_company_code), pt = S(v.product_type);
  if (prov === 'RP012' && pt === '픽업구독') return '픽업구독';
  if (prov === 'RP012' && pt.includes('구독')) return '손오공구독';
  if (prov === 'RP023') return '오플구독';
  return '상품리스트';
};
const TABS = ['상품리스트', '손오공구독', '픽업구독', '오플구독'];

const snap = await fs.collection('products').get();
const bucket: Record<string, { listable: number; 계약중: number }> = {};
for (const t of TABS) bucket[t] = { listable: 0, 계약중: 0 };
let total = 0, listable = 0, 계약중 = 0;
const plates = new Set<string>(); let dup = 0;
snap.forEach((d) => {
  const v = d.data() as Record<string, unknown>;
  total++;
  if (v.listable !== true) return;
  listable++;
  const t = tabOf(v); bucket[t] = bucket[t] || { listable: 0, 계약중: 0 }; bucket[t].listable++;
  const k = K(v.car_number); if (k) { if (plates.has(k)) dup++; else plates.add(k); }
  if ((S(v.vehicle_status) || S(v.status)) === '계약중') { 계약중++; bucket[t].계약중++; }
});

const at = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 19).replace('T', ' ');
console.log(`\n■ 대수 단일 카운터 — SSOT(원자) · ${at} (KST)`);
console.log(`  전체 원자        ${total}`);
console.log(`  화면(listable)    ${listable}   · 차번유니크 ${plates.size} (중복 ${dup})`);
console.log(`  계약중           ${계약중}`);
console.log(`  ERP(=화면−계약중)  ${listable - 계약중}`);
console.log(`  ── 버킷별(make-sample tabOf) ──`);
for (const t of TABS) console.log(`    ${t.padEnd(6)} 화면 ${String(bucket[t].listable).padStart(4)} (계약중 ${bucket[t].계약중})`);
console.log(`  ★규칙: ERP + 계약중 = 화면  →  ${listable - 계약중} + ${계약중} = ${listable}\n`);
process.exit(0);
