/** Firestore 판매 원자를 한 번 읽어 F01·F86·사후검사가 함께 쓸 불변 스냅샷을 만든다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { captureSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';
import { hasInventoryPublicationViolations } from '../lib/domain/inventory-contract';

const S = (v: unknown) => String(v ?? '').trim();
const arg = (name: string) => (process.argv.find((value) => value.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });

const snapshot = await captureSalesPublishSnapshot(getFirestore());
const output = arg('out') || `tmp/sales-publish-snapshots/${snapshot.snapshotId}.json`;
if (hasInventoryPublicationViolations(snapshot.inventory)) {
  throw new Error(`재고 계약 위반 — listable 드리프트 ${snapshot.inventory.listableDrift} · status_kind 드리프트 ${snapshot.inventory.statusKindDrift} · 원천 식별자 누락 ${snapshot.inventory.sourceIdentityViolations} · 삭제표식 ${snapshot.inventory.deletedMarkerViolations} · 빈 차량번호 ${snapshot.inventory.blankPlateViolations} · 잘못된 차량번호 ${snapshot.inventory.invalidPlateViolations} · 중복 차량번호 ${snapshot.inventory.duplicatePlateViolations}`);
}
mkdirSync(dirname(output), { recursive: true });
// 목적지는 한 번만 만들 수 있다. 같은 경로를 재사용해 F01과 F86 사이 내용을 바꾸는 일을 막는다.
writeFileSync(output, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
console.log(`✓ 판매 스냅샷 ${snapshot.snapshotId} · 등록 ${snapshot.inventory.registered} · 출고불가 ${snapshot.inventory.unavailable} · 현재 재고 ${snapshot.inventory.open} · ${output}`);
