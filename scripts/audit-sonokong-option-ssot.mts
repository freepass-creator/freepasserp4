/** RP012 paid options only. Read-only audit; no cloud writes. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { normalizePlate, tcarPaidOptionNames } from '../sonokong/lib/option-normalizer.mjs';
const S = (v: unknown) => String(v ?? '').trim();
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const stable = (v: any): string => JSON.stringify(v, function (_k, value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value; });
const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = 'tmp/son-options-20260915';
mkdirSync(root, { recursive: true });
const sourcePath = arg('source') || 'sonokong/lib/wonja/손오공차량.json';
const sourceText = readFileSync(sourcePath, 'utf8');
const source = JSON.parse(sourceText);
const project = 'freepasserp5';
const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:/dev/freepasserp4-rtdb-current/tmp/firebase-auth/freepasserp5-sa.json', 'utf8'));
if (sa.project_id !== project || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Project/database boundary');
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: project }));
const get = (obj: any, path: string) => path.split('.').reduce((v, k) => v?.[k], obj);
const ownCodeHash = hash(readFileSync(new URL(import.meta.url), 'utf8'));
if (arg('apply-plan') || process.argv.includes('--apply')) throw Error('Read-only audit');
{
  const cars: any[] = source.차량 || [];
  if (!cars.length || source.규격 !== 'tcar-direct-paid-options-v3-current-identity') throw Error('Unsupported source');
  const plates = cars.map(c => normalizePlate(c.차번));
  if (plates.some(p => !p) || new Set(plates).size !== cars.length || new Set(cars.map(c => S(c.id))).size !== cars.length) throw Error('Nonunique source identity');
  const snap = await db.collection('products').where('provider_company_code', '==', 'RP012').get();
  const byPlate = new Map<string, any[]>();
  for (const doc of snap.docs) { const p = normalizePlate(doc.get('car_number')); byPlate.set(p, [...(byPlate.get(p) || []), doc]); }
  const changes: any[] = [], holds: any[] = []; let verified = 0, same = 0;
  for (const car of cars) {
    const plate = normalizePlate(car.차번), ev = car.유료옵션근거;
    if (car.유료옵션출처 !== 'tcarPaidOptions' || ev?.원천 !== 'tcar:jsonData.paidOptList' || normalizePlate(ev?.티카차번) !== plate || !Array.isArray(car.유료옵션원문)) { holds.push({ plate, reason: 'SOURCE_UNVERIFIED_PRESERVED' }); continue; }
    if (!car.상세시각 || Date.now() - car.상세시각 > 30 * 60e3) throw Error('Source detail expired');
    const docs = byPlate.get(plate) || [];
    if (docs.length !== 1) { holds.push({ plate, reason: 'DOCUMENT_NOT_UNIQUE' }); continue; }
    const doc = docs[0], data = doc.data();
    const sourceIds = [S(data.sheet_source_row), S(data.원문?.전체?.id)].filter(Boolean);
    if (!sourceIds.includes(S(car.id))) { holds.push({ plate, reason: 'SOURCE_ID_MISMATCH' }); continue; }
    if (car.유료옵션원문.some((x: any) => !S(x?.name ?? x?.PAID_OPT_NM))) { holds.push({ plate, reason: 'INVALID_OPTION_NAME' }); continue; }
    const options = tcarPaidOptionNames(car.유료옵션원문);
    if (options !== S(car.유료옵션)) throw Error('Option normalization mismatch');
    verified++;
    const desired: any = { options, '원문.옵션': options, '원문.옵션출처': 'tcarPaidOptions', '원문.티카유료옵션': car.유료옵션원문, '원문.옵션근거': ev, option_evidence_status: 'PASS', option_evidence_reason: '' };
    const patch = Object.fromEntries(Object.entries(desired).filter(([k, v]) => stable(get(data, k) ?? (v === '' ? '' : null)) !== stable(v)));
    if (!Object.keys(patch).length) { same++; continue; }
    changes.push({ id: doc.id, plate, updateTime: { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds }, before: data, patch });
  }
  const plan = { project, database: '(default)', createdAt: new Date().toISOString(), codeHash: ownCodeHash, sourceHash: hash(sourceText), sourcePath, totalSource: cars.length, totalFirestore: snap.size, verified, same, changes, holds };
  const planPath = `${root}/plan-${Date.now()}.json`; writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ planPath, totalSource: cars.length, totalFirestore: snap.size, verified, same, changes: changes.length, holds: holds.length, fields: [...new Set(changes.flatMap(x => Object.keys(x.patch)))] }));
}

