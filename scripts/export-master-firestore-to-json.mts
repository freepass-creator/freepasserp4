/**
 * 차종마스터 «Firestore → JSON» 내보내기 — Firestore `vehicle_master` 가 «단일정본».
 *
 * ★사장님 2026-09-08 — 「알티디비 삭제하고 파이어스토어로 다 옮겨」·「알티디비 안 쓰고 파이어스토어 기준으로 원자들을 세팅」.
 *   RTDB `/vehicle_master` 는 폐기(삭제)했다. 이제 마스터의 정본은 **Firestore `vehicle_master` 컬렉션**이다.
 *   파일 사본(public/data/vehicle-master.json)을 읽는 소비처(carmaster API·mirror-to-firestore·fix-atoms)가
 *   여전히 있으므로, 이 잡이 **Firestore → JSON** 으로 사본을 «Firestore 진실에서» 재생성한다.
 *   ⇒ 옛 `publish-master-to-rtdb.mts`(시트→RTDB) 를 대체한다. 마스터를 고치면 Firestore 를 고치고 이 잡을 돌린다.
 *
 *   npx tsx scripts/export-master-firestore-to-json.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const db = getFirestore();

const docs = (await db.collection('vehicle_master').get()).docs;
// ★안정 정렬 = `id`(불변키). 실행마다 같은 순서라 «Firestore 진짜 변경만» diff 로 뜬다(재정렬 churn 없음).
const entries = docs
  .map((d) => { const x = { ...(d.data() as Record<string, unknown>) }; delete x._built_at; return x; })
  .sort((a, b) => S(a.id).localeCompare(S(b.id)));

// 원형 = { entries: [...] } · 2-space (carmaster route·mirror 가 raw.entries 로 읽음).
const out = join(process.cwd(), 'public/data/vehicle-master.json');
writeFileSync(out, JSON.stringify({ entries }, null, 2), 'utf8');
console.log(`■ Firestore vehicle_master ${entries.length}개 → ${out}`);
console.log('  정본 = Firestore. 파일은 Firestore 에서 재생성된 사본이다. RTDB 는 폐기됨.');
