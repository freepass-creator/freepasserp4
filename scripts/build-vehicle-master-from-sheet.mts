/**
 * 자체 차종마스터 구축 — 시트 정본(`vehicle-trim-master.json`) → RTDB `vehicle_master`.
 *
 * ★왜: 지금 RTDB `vehicle_master`(1106)는 «엔카/재고 역산 덤프»(source=encar/from_products)로
 *   시트 정본(세부모델 205)과 거의 안 겹치고, 세부트림·생산기간 필드도 없다. 게다가 이 노드를
 *   읽는 앱/도메인/정제 코드가 «하나도 없다»(감사 스크립트만). 즉 죽은 덤프다.
 *
 * ★구조(임기응변 아님):
 *   1) 정본은 하나 = 시트 「차종마스터」(1T_RrE) → 이미 `public/data/vehicle-trim-master.json`(records 2086·세부모델 205).
 *   2) 이 빌더는 그 정본을 «세부모델 원자»(master_id 키)로 그룹핑해 RTDB `vehicle_master`에 그대로 세운다.
 *   3) 엔카/재고 덤프는 걷어낸다(대체). 원자 스키마 = 시트 7열 + 트림/생산기간/제원 요약.
 *   4) hourly-sync 가 trim-json 을 새로 만든 «뒤»에 이 빌더를 돌리면(단계 편입) 시트가 바뀌어도 자동 반영.
 *   5) 감사 = 시트(records) ↔ RTDB vehicle_master 드리프트 0 (별도 audit).
 *
 * 기본 dry-run(무엇이 바뀌는지만). 실제 반영은 --apply (반영 전 현재 노드를 tmp 에 백업).
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/build-vehicle-master-from-sheet.mts
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/build-vehicle-master-from-sheet.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

type Rec = Record<string, any>;
const master = JSON.parse(readFileSync('public/data/vehicle-trim-master.json', 'utf8')) as { data_as_of?: string; records: Rec[] };
const records = master.records || [];

// 세부모델 원자로 그룹핑 (master_id 키). 트림·파워트레인은 목록으로 접는다.
const atoms = new Map<string, Rec>();
for (const r of records) {
  const id = S(r.master_id);
  if (!id || !S(r.maker) || !S(r.model)) continue;
  let a = atoms.get(id);
  if (!a) {
    a = {
      master_id: id, origin: S(r.origin), maker: S(r.maker), model: S(r.model), sub_model: S(r.sub_model),
      generation_name: S(r.generation_name), development_code: S(r.development_code),
      production_start: S(r.production_start), production_end: S(r.production_end),
      trims: [] as string[], powertrains: [] as string[],
      source: 'sheet_master', data_as_of: S(master.data_as_of) || S(r.data_as_of), updated_at: Date.now(),
    };
    atoms.set(id, a);
  }
  const tr = S(r.trim); if (tr && !a.trims.includes(tr)) a.trims.push(tr);
  const pw = S(r.powertrain); if (pw && !a.powertrains.includes(pw)) a.powertrains.push(pw);
}
const built = Object.fromEntries([...atoms].map(([id, a]) => [id.replace(/[.#$/\[\]]/g, '_'), a]));

const cur = (await db.ref('vehicle_master').get()).val() as Rec || {};
const curRows = Object.values(cur).filter((x) => x && typeof x === 'object');
const curSrc: Record<string, number> = {};
for (const a of curRows) curSrc[a.source || '?'] = (curSrc[a.source || '?'] || 0) + 1;

console.log(`정본 records ${records.length} → 세부모델 원자 ${atoms.size}`);
console.log(`현재 RTDB vehicle_master ${curRows.length} · source=${JSON.stringify(curSrc)}`);
const totalTrims = [...atoms.values()].reduce((n, a) => n + a.trims.length, 0);
console.log(`새 원자 스키마: origin·maker·model·sub_model·development_code·generation_name·production_start/end·trims[]·powertrains[] · 트림합 ${totalTrims}`);
console.log('샘플 3:');
for (const a of [...atoms.values()].slice(0, 3)) console.log(`  ${a.maker} ${a.model} ${a.sub_model} [${a.development_code}] ${a.production_start}~${a.production_end} · 트림 ${a.trims.length} · ${a.powertrains.length}PT`);

if (!APPLY) {
  console.log(`\n미리보기 — 반영하면 vehicle_master 를 «시트 정본 ${atoms.size}원자»로 «통째 교체»한다(엔카/재고 ${curRows.length} 폐기).`);
  console.log('실제 반영: --apply (반영 전 현재 노드를 tmp/vehicle_master-backup-*.json 에 백업)');
  process.exit(0);
}

mkdirSync('tmp', { recursive: true });
const backupPath = `tmp/vehicle_master-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backupPath, JSON.stringify(cur, null, 1));
console.log(`\n백업 → ${backupPath} (${curRows.length}원자)`);
await db.ref('vehicle_master').set(built);
console.log(`반영 완료 — vehicle_master = 시트 정본 ${atoms.size}원자.`);
process.exit(0);
