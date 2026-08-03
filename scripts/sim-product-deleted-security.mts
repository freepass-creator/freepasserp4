import assert from 'node:assert/strict';
import { setSession, type Session } from '../lib/auth-session';
import { RtdbAdapter } from '../lib/firebase/rtdb-adapter';
import type { EntityRecord } from '../lib/intake/entities';

function session(role: Session['role'], company = ''): Session {
  return {
    uid: `${role}-uid`,
    email: `${role}@example.com`,
    role,
    rawRole: role,
    name: role,
    code: company || `${role}-code`,
    company_code: company,
    agent_channel_code: role === 'agent' ? 'CH-1' : '',
    user_code: role === 'agent' ? 'AG-1' : '',
  };
}

const rows: EntityRecord[] = [{
  _key: 'P-DELETED',
  product_code: 'P-DELETED',
  provider_company_code: 'RP-OWN',
  _deleted: true,
  vehicle_price: 30_000_000,
  vin: 'SECRET-VIN',
  price: { '36': { rent: 800_000, fee: 90_000, commission: 12_000 } },
}];

const adapter = new RtdbAdapter();
(adapter as unknown as { merged: (entity: string, companyId: string) => Promise<EntityRecord[]> }).merged = async () => rows;

setSession(session('agent'));
const agentRow = (await adapter.listDeleted('product', 'freepass'))[0];
assert.equal(agentRow.vehicle_price, undefined, '영업자 삭제매물 원가 마스킹');
assert.equal(agentRow.vin, undefined, '영업자 삭제매물 VIN 마스킹');
assert.equal((agentRow.price as Record<string, Record<string, unknown>>)['36'].fee, undefined, '영업자 삭제매물 수수료 마스킹');
assert.equal((agentRow.price as Record<string, Record<string, unknown>>)['36'].rent, 800_000, '판매가격은 유지');

setSession(session('provider', 'RP-OTHER'));
const otherProviderRow = (await adapter.listDeleted('product', 'freepass'))[0];
assert.equal(otherProviderRow.vehicle_price, undefined, '타 공급사 삭제매물 원가 마스킹');
assert.equal(otherProviderRow.vin, undefined, '타 공급사 삭제매물 VIN 마스킹');

setSession(session('provider', 'RP-OWN'));
const ownerRow = (await adapter.listDeleted('product', 'freepass'))[0];
assert.equal(ownerRow.vehicle_price, 30_000_000, '소유 공급사 원가 유지');
assert.equal(ownerRow.vin, 'SECRET-VIN', '소유 공급사 VIN 유지');

setSession(session('admin'));
const adminRow = (await adapter.listDeleted('product', 'freepass'))[0];
assert.equal(adminRow.vehicle_price, 30_000_000, '관리자 원가 유지');
assert.equal(adminRow.vin, 'SECRET-VIN', '관리자 VIN 유지');

setSession(null);
console.log('deleted product security simulation: 10/10 PASS');
