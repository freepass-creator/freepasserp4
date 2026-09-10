/** Firestore 원자에서 ERP 사진 원천과 Google Sheet 차량번호 링크의 분리를 읽기 전용 검사한다. */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import { erpPhotoSource, isDirectPhotoUrl, isPickupPhotoAtom, isServerPhotoSource, photoProjectionViolations, sheetPlateLink } from '../lib/domain/photo-projection';
import { readSalesPublishSnapshot } from '../lib/server/sales-publish-snapshot';

type Rec = Record<string, unknown>;
const S = (value: unknown): string => String(value ?? '').trim();
const snapshotPath = (process.argv.find((value) => value.startsWith('--snapshot=')) || '').slice('--snapshot='.length);
let source = 'Firestore live';
let allAtoms: Rec[];
if (snapshotPath) {
  const snapshot = readSalesPublishSnapshot(snapshotPath);
  allAtoms = snapshot.products;
  source = `snapshot ${snapshot.snapshotId}`;
} else {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
  const snap = await getFirestore().collection('products').get();
  allAtoms = snap.docs.map((doc) => ({ _key: doc.id, ...doc.data() } as Rec));
}
const atoms = allAtoms.filter(isOpenInventoryAtom);
let pickup = 0, pickupSheet = 0, normalSheet = 0, erpSource = 0;
const sheetHosts = new Map<string, number>();
const erpHosts = new Map<string, number>();
const erpKinds = new Map<string, number>();
const hostOf = (value: string): string => { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return '(없음)'; } };
const bad: { plate: string; provider: string; host: string; reason: string }[] = [];
for (const atom of atoms) {
  if (isPickupPhotoAtom(atom)) pickup++;
  if (erpPhotoSource(atom)) {
    erpSource++;
    const first = erpPhotoSource(atom).split(/[\n,]/)[0]?.trim() || '';
    const host = hostOf(first);
    erpHosts.set(host, (erpHosts.get(host) || 0) + 1);
    const kind = isDirectPhotoUrl(first) ? '직접사진'
      : isServerPhotoSource(first) ? '서버해석'
        : '사진해석규칙없음';
    erpKinds.set(kind, (erpKinds.get(kind) || 0) + 1);
  }
  if (sheetPlateLink(atom)) isPickupPhotoAtom(atom) ? pickupSheet++ : normalSheet++;
  if (sheetPlateLink(atom)) {
    const host = hostOf(sheetPlateLink(atom));
    sheetHosts.set(host, (sheetHosts.get(host) || 0) + 1);
  }
  for (const reason of photoProjectionViolations(atom)) bad.push({
    plate: S(atom.car_number) || S(atom._key), provider: S(atom.provider_company_code) || '(공급사없음)',
    host: hostOf(sheetPlateLink(atom)), reason,
  });
}
console.log(`사진 투영 ${new Date().toISOString()} · ${source} · 재고 ${atoms.length}대`);
console.log(`ERP 사진 원천 ${erpSource}대 · 픽업 ${pickup}대 중 T카 시트링크 ${pickupSheet}대 · 일반 시트링크 ${normalSheet}대`);
console.log(`ERP 사진 출처 · ${[...erpHosts].sort((a, b) => b[1] - a[1]).map(([host, count]) => `${host} ${count}`).join(' · ')}`);
console.log(`ERP 사진 방식 · ${[...erpKinds].map(([kind, count]) => `${kind} ${count}`).join(' · ')}`);
console.log(`시트 링크 출처 · ${[...sheetHosts].sort((a, b) => b[1] - a[1]).map(([host, count]) => `${host} ${count}`).join(' · ')}`);
if (bad.length) {
  console.error(`⛔ 사진 투영 위반 ${bad.length}대 · ${bad.slice(0, 10).map((x) => `${x.plate}(${x.reason})`).join(' · ')}`);
  const groups = new Map<string, number>();
  for (const row of bad) {
    const key = `${row.reason} | ${row.provider} | ${row.host}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  for (const [key, count] of [...groups].sort((a, b) => b[1] - a[1])) console.error(`  ${String(count).padStart(3)}대 | ${key}`);
  process.exit(1);
}
console.log('✓ ERP 사진과 Google Sheet 링크가 분리 규칙을 지킨다');
