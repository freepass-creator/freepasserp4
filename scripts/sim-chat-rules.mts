import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Role = 'admin' | 'provider' | 'agent';
type User = {
  uid: string;
  role: Role;
  company_code?: string;
  agent_channel_code?: string;
  pending?: boolean;
  anonymous?: boolean;
};
type Room = {
  agent_uid?: string;
  provider_company_code?: string;
  agent_channel_code?: string;
};

const canReadRoom = (user: User, room: Room) =>
  !user.pending && !user.anonymous && (
    user.role === 'admin'
    || (user.role === 'provider'
      && !!user.company_code
      && room.provider_company_code === user.company_code)
    || (user.role !== 'provider' && room.agent_uid === user.uid)
    || (user.role !== 'provider'
      && !!user.agent_channel_code
      && room.agent_channel_code === user.agent_channel_code)
  );

let passed = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected, name);
  passed += 1;
};

const admin: User = { uid: 'admin-1', role: 'admin' };
const provider: User = { uid: 'provider-1', role: 'provider', company_code: 'P-100' };
const agent: User = { uid: 'agent-1', role: 'agent', agent_channel_code: 'A-100' };
const own: Room = { agent_uid: 'agent-1', provider_company_code: 'P-100', agent_channel_code: 'A-100' };
const other: Room = { agent_uid: 'agent-2', provider_company_code: 'P-200', agent_channel_code: 'A-200' };

check('admin can read any room', canReadRoom(admin, other), true);
check('provider can read own-company room', canReadRoom(provider, own), true);
check('provider cannot read another company room', canReadRoom(provider, other), false);
check('provider cannot borrow matching agent uid', canReadRoom({ ...provider, uid: 'agent-2' }, other), false);
check('agent can read own uid room', canReadRoom(agent, { ...other, agent_uid: agent.uid }), true);
check('agent can read channel room', canReadRoom(agent, { ...other, agent_channel_code: 'A-100' }), true);
check('agent cannot read unrelated room', canReadRoom(agent, other), false);
check('pending user is denied', canReadRoom({ ...agent, pending: true }, own), false);
check('anonymous user is denied', canReadRoom({ ...agent, anonymous: true }, own), false);
check('empty channel cannot match an unowned room', canReadRoom({ ...agent, agent_channel_code: '' }, { agent_channel_code: '' }), false);

const cwd = process.cwd();
const rulesText = fs.readFileSync(path.join(cwd, 'database.rules.json'), 'utf8');
const rules = JSON.parse(rulesText).rules;
const adapter = fs.readFileSync(path.join(cwd, 'lib/firebase/rtdb-adapter.ts'), 'utf8');

check('v3 room reads require a scoped query', rules.rooms['.read'].includes('query.orderByChild'), true);
check('v3 message bulk read is absent', rules.messages['.read'], undefined);
check('v3 messages are guarded per room', typeof rules.messages.$room_id['.read'], 'string');
check('v4 room reads require a scoped query', rules.v4.rooms['.read'].includes('query.orderByChild'), true);
check('v4 messages require room_id query', rules.v4.messages['.read'].includes("query.orderByChild === 'room_id'"), true);
check('v4 messages reject an omitted equalTo', rules.v4.messages['.read'].includes('query.equalTo !== null'), true);
check('adapter queries v4 messages by room_id', adapter.includes("orderByChild('room_id'), equalTo(roomId)"), true);
check('adapter reads v3 messages by room node', adapter.includes('`messages/${roomId}`'), true);
check('adapter queries provider rooms by company', adapter.includes("orderByChild('provider_company_code'), equalTo(company)"), true);
check('adapter queries agent rooms by uid', adapter.includes("orderByChild('agent_uid'), equalTo(auth.uid)"), true);
check('adapter queries agent rooms by channel', adapter.includes("orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code)"), true);

console.log(`chat rules simulation: ${passed}/${passed} PASS`);
