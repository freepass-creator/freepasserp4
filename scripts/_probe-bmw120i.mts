import { writeFileSync, readFileSync } from 'node:fs';
import { normalizeVehicleIdentity } from '../lib/domain/vehicle-master-normalize';
import { snapToMaster } from '../lib/domain/vehicle-master-match';

const master = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const entries = master.entries || master;
const raw = { fuel_type: '가솔린', model: 'BMW 120i', year: '2021' };
// peek via snap only
const snap = snapToMaster(raw as any, entries);
writeFileSync('tmp/bmw120i-snap.json', `${JSON.stringify({ snap, raw }, null, 2)}\n`);
console.log('conf', snap?.confidence, 'model', (snap as any)?.model, 'sub', (snap as any)?.sub_model);
