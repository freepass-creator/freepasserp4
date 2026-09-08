/**
 * 상품 트림 ↔ 차종마스터 정합 검사 — 「마스터에 없는 트림」(트림+옵션 뭉침·색상이 트림에·영문 등)을 잡는다.
 *
 * 사장님 2026-09-06: 「엔카엔 컬러 패키지라는 트림이 전혀 없었는데 상품엔 있다. 검수했다면서 왜 못 걸렀냐.」
 *   → 상품 트림이 «차종마스터(엔카 기준)에 실재하는 트림인지» 확인하는 게이트가 없었다. 그래서 오염이 그냥 들어왔다.
 *   이 검사가 그 자리를 메운다. ingest·정제 파이프라인에 물려 재발을 막는다.
 *
 * 판정: 상품 trim_name 이 그 모델의 마스터 트림풀에 «정확히/포함»으로 맞으면 통과, 아니면 orphan 으로 보고.
 *   이상 있으면 exit 1(게이트). --json 으로 tmp/product-trim-orphans.json.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync } from 'node:fs';

const JSON_OUT = process.argv.includes('--json');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const FS = getFirestore();
const S = (v: unknown) => String(v ?? '').trim();
// 영↔한 표기차는 오탐이 아니게 정규화(Black=블랙·Long Range=롱레인지·Premium=프리미엄·Sport=스포츠…).
const EN2KO: Record<string, string> = { black: '블랙', white: '화이트', sport: '스포츠', premium: '프리미엄', standard: '스탠다드', 'long range': '롱레인지', longrange: '롱레인지', 'standard range': '스탠다드레인지', performance: '퍼포먼스', luxury: '럭셔리', prestige: '프레스티지', signature: '시그니처', exclusive: '익스클루시브', calligraphy: '캘리그래피', rwd: 'rwd', awd: 'awd', inspiration: '인스퍼레이션', modern: '모던' };
const N = (v: unknown) => { let x = S(v).toLowerCase(); for (const [en, ko] of Object.entries(EN2KO)) x = x.replace(new RegExp(en, 'g'), ko); return x.replace(/[\s()·\-]/g, ''); };

const m = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const ent: any[] = (Array.isArray(m) ? m : m.entries) || [];

const snap = await FS.collection('products').get();
const orphans: any[] = [];
let total = 0;
for (const d of snap.docs) {
  const v = d.data();
  const tr = S(v.trim_name); if (!tr) continue; total++;
  if (v._deleted === true || S(v.status) === 'deleted') continue;
  const model = S(v.model), sub = S(v.sub_model);
  // 이 상품 모델에 맞는 마스터 엔트리 → 트림풀
  const cands = ent.filter((e) => N(e.sub_model).includes(N(model)) || N(model).includes(N(e.model || '')) || N(e.sub_model).includes(N(sub)));
  const pool = new Set<string>(); const poolRaw: string[] = [];
  cands.forEach((e) => (e.trims || []).forEach((t: string) => { pool.add(N(t)); poolRaw.push(S(t)); }));
  const ok = pool.has(N(tr)) || [...pool].some((p) => p && (N(tr).includes(p) || p.includes(N(tr))));
  if (!ok) {
    // 왜 orphan 인지 힌트 + 마스터의 그 모델 트림들(고칠 때 참고)
    const why = /패키지|팩|package/i.test(tr) ? '옵션/패키지가 트림에 섞임'
      : /black|블랙|white|화이트|red|블루|색|color/i.test(tr) ? '색상이 트림에'
      : /[a-z]/i.test(tr) && !/[가-힣]/.test(tr) ? '영문 트림(마스터와 표기 다름 가능)'
      : /스탠다드|기본형|베이스|base/i.test(tr) ? '일반명(마스터에 미등록 가능)'
      : '마스터에 없는 트림';
    orphans.push({ car: S(v.car_number), maker: S(v.maker), model, trim: tr, why, masterTrims: [...new Set(poolRaw)].slice(0, 8) });
  }
}
orphans.sort((a, b) => a.why.localeCompare(b.why) || a.model.localeCompare(b.model));
if (JSON_OUT) {
  writeFileSync('tmp/product-trim-orphans.json', JSON.stringify({ total, orphanCount: orphans.length, orphans }, null, 1));
  console.log(`tmp/product-trim-orphans.json — 트림있는 상품 ${total} · orphan ${orphans.length}`);
} else {
  console.log(`상품 트림 정합 검사 — 트림있는 상품 ${total} · 마스터에 없는 트림 ${orphans.length}`);
  let lastWhy = '';
  for (const o of orphans) {
    if (o.why !== lastWhy) { console.log(`\n[${o.why}]`); lastWhy = o.why; }
    console.log(`  ${o.car}  ${o.model} │ 「${o.trim}」  ← 마스터: ${o.masterTrims.join(', ') || '(모델 매칭 없음)'}`);
  }
  console.log(orphans.length === 0 ? '\n✅ 모든 상품 트림이 마스터에 있음' : `\n⚠ ${orphans.length}대 — 트림 표기 정정 또는 마스터 갱신 필요`);
}
process.exit(orphans.length === 0 ? 0 : 1);
