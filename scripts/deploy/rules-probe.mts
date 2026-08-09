/**
 * 보안규칙 실사격 — 「막힌다고 적어 놓은 것이 정말 막히는가」를 라이브 규칙에 물어본다.
 *
 *   tsx scripts/deploy/rules-probe.mts
 *
 * ★ 왜 필요한가
 *   sim-* 스위트는 LocalAdapter 위에서 돈다. 거기엔 RTDB 규칙이라는 것이 없어서
 *   **규칙 위반을 한 건도 못 잡는다** — 전부 초록불이지만 아무것도 보장하지 않는다.
 *   규칙을 고쳐 놓고 「게이트 통과」로 끝내면, 실제로 뚫려 있는지는 아무도 모른다.
 *
 * ★ 어떻게 진짜로 묻는가
 *   서비스계정으로 실제 사용자 uid 의 커스텀 토큰을 발급 → ID 토큰으로 교환 →
 *   RTDB REST 에 `?auth=<idToken>` 으로 직접 쏜다. 이 경로는 admin SDK 우회가 없어서
 *   **라이브 규칙이 그대로 판정한다.**
 *
 * ★ 실데이터를 건드리지 않는다
 *   판정 대상은 이 스크립트가 만들고 끝나면 지우는 `is_test` 계약 하나뿐이다.
 *   실계약·실정산에는 쓰기를 시도하지 않는다. 읽기 검사만 기존 노드를 본다.
 *   만에 하나 «막혀야 할 쓰기»가 통과하면 그 흔적도 이 테스트 계약 안에만 남는다.
 */
import { readFileSync } from 'node:fs';
import { DATABASE_URL, SA_PATH, die } from './_ctx.mts';

type Role = 'agent' | 'provider' | 'admin';
type Probe = {
  name: string;
  as: Role;
  method: 'GET' | 'PUT';
  path: string;
  body?: unknown;
  expect: 'allow' | 'deny';
};

const apiKey = (() => {
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('NEXT_PUBLIC_FIREBASE_API_KEY='));
  const value = (line || '').split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  if (!value) die('.env.local 에 NEXT_PUBLIC_FIREBASE_API_KEY 가 없다');
  return value;
})();

async function idTokenFor(uid: string): Promise<string> {
  const { initializeApp, cert, getApps, getApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(sa), databaseURL: DATABASE_URL });
  const custom = await getAuth(app).createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const payload = await res.json() as { idToken?: string; error?: { message?: string } };
  if (!payload.idToken) die(`ID 토큰 교환 실패(${uid}): ${payload.error?.message || res.status}`);
  return payload.idToken;
}

async function db() {
  const { initializeApp, cert, getApps, getApp } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'));
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(sa), databaseURL: DATABASE_URL });
  return getDatabase(app);
}

/** 규칙 판정만 받는다. 403/401 = 거부, 2xx = 허용. */
async function hit(method: 'GET' | 'PUT', path: string, token: string, body?: unknown): Promise<'allow' | 'deny'> {
  const res = await fetch(`${DATABASE_URL}/${path}.json?auth=${token}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (res.status === 401 || res.status === 403) return 'deny';
  if (res.ok) return 'allow';
  die(`예상 못 한 응답 ${res.status} — ${method} ${path}\n    ${(await res.text()).slice(0, 300)}`);
}

/** 실제로 살아 있는 계정을 역할별로 하나씩 고른다 — 가짜 사용자를 만들어 실목록을 더럽히지 않는다. */
async function pickUsers(): Promise<Record<Role, { uid: string; label: string }>> {
  const users = ((await (await db()).ref('users').get()).val() || {}) as Record<string, any>;
  const found: Partial<Record<Role, { uid: string; label: string }>> = {};
  for (const [uid, u] of Object.entries(users)) {
    const role = String(u?.role || '');
    const alive = u?.status !== 'pending' && u?.status !== 'deleted' && u?.status !== 'rejected'
      && u?.is_active !== false && u?.is_active !== '아니오';
    if (!alive) continue;
    if (role === 'agent' && !found.agent) found.agent = { uid, label: String(u.name || u.user_code || uid) };
    if (role === 'admin' && !found.admin) found.admin = { uid, label: String(u.name || u.user_code || uid) };
    if ((role === 'provider' || role === 'provider_admin') && !found.provider) {
      found.provider = { uid, label: String(u.name || u.company_code || uid) };
    }
  }
  if (!found.agent || !found.provider || !found.admin) die('활성 영업자·공급사·관리자 계정을 못 찾았다 — 검사할 세션이 없다');
  return found as Record<Role, { uid: string; label: string }>;
}

async function main() {
  const users = await pickUsers();
  const database = await db();
  const tokens: Record<Role, string> = {
    agent: await idTokenFor(users.agent.uid),
    provider: await idTokenFor(users.provider.uid),
    admin: await idTokenFor(users.admin.uid),
  };
  console.log(`\n  영업자 ${users.agent.label} · 공급사 ${users.provider.label} · 관리자 ${users.admin.label} 세션으로 라이브 규칙에 질의한다.`);

  // 거부되어야 할 쓰기의 과녁. 규칙이 맞으면 아무것도 안 남고, 틀리면 여기에만 남는다.
  const PROBE_KEY = `_RULES_PROBE_${Date.now()}`;
  const code = `TEST-RULES-${Date.now()}`;
  const ref = database.ref(`v4/contracts/${code}`);
  const agentUser = ((await database.ref(`users/${users.agent.uid}`).get()).val() || {}) as Record<string, any>;
  const providerUser = ((await database.ref(`users/${users.provider.uid}`).get()).val() || {}) as Record<string, any>;

  // 검사용 계약 — is_test 로 실계약과 갈린다(isTestContract SSOT와 같은 표식).
  await ref.set({
    contract_code: code,
    is_test: true,
    contract_status: '계약요청',
    contract_date: '2026-08-09',
    car_number_snapshot: '00테0000',
    maker_snapshot: '기아',
    memo_agent: '', memo_provider: '',
    customer_name: '규칙검사', customer_id: '',
    sign_token: 'probe-token',
    agent_uid: users.agent.uid,
    agent_code: agentUser.user_code || users.agent.uid,
    agent_channel_code: agentUser.agent_channel_code || '',
    provider_company_code: providerUser.company_code || '',
    product_code: '',
  });

  // 출고까지 끝난 계약 — 「정상 정산이 여전히 만들어지는가」를 묻기 위한 것.
  // ★이 검사가 제일 중요하다. 정산 생성 규칙이 조금이라도 빡빡하면 계약완료가 통째로 막히는데,
  //  그건 «막혀야 할 것이 막힌다»만 봐서는 절대 안 잡힌다.
  //  실제 순서를 그대로 흉내낸다 — createSettlement 는 계약완료를 **찍기 전에** 실행된다.
  const doneCode = `TEST-RULES-DONE-${Date.now()}`;
  const doneRef = database.ref(`v4/contracts/${doneCode}`);
  const party = {
    agent_uid: users.agent.uid,
    agent_code: String(agentUser.user_code || users.agent.uid),
    agent_channel_code: String(agentUser.agent_channel_code || 'PROBE-CH'),
    provider_company_code: String(providerUser.company_code || 'PROBE-CO'),
  };
  await doneRef.set({
    // ★product_code 를 빼면 부모 .validate 의 hasChildren 에 걸려 **규칙 탓처럼 보인다**.
    //  실제로 한 번 그렇게 오진했다 — 계약 필수 6필드는 씨앗에 반드시 넣는다.
    contract_code: doneCode, is_test: true, contract_status: '계약요청', product_code: 'PROBE-VEH', ...party,
    agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
    agent_docs_submitted: 'yes', provider_docs_review: '승인',
    provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
    agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
    agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
    rent_amount_snapshot: 690000, rent_month_snapshot: 36,
  });
  const settlementBody = {
    settlement_code: `ST_${doneCode}`, contract_code: doneCode, settlement_status: '정산대기',
    ...party, rent_amount: 690000,
  };

  const base = `v4/contracts/${code}`;
  const probes: Probe[] = [
    // ── 오늘 막은 것들이 정말 막히는가 ──
    { name: '차량번호 스냅샷 변경(영업자)', as: 'agent', method: 'PUT', path: `${base}/car_number_snapshot`, body: '99바9999', expect: 'deny' },
    { name: '계약일 변경(영업자)', as: 'agent', method: 'PUT', path: `${base}/contract_date`, body: '2020-01-01', expect: 'deny' },
    { name: '공급사 메모를 영업자가 수정', as: 'agent', method: 'PUT', path: `${base}/memo_provider`, body: '침범', expect: 'deny' },
    { name: '고객 주민번호를 공급사가 수정', as: 'provider', method: 'PUT', path: `${base}/customer_id`, body: '900101-1234567', expect: 'deny' },
    { name: '서명 토큰을 공급사가 교체', as: 'provider', method: 'PUT', path: `${base}/sign_token`, body: 'stolen', expect: 'deny' },
    { name: '거절 없이 공급사가 계약취소', as: 'provider', method: 'PUT', path: `${base}/contract_status`, body: '계약취소', expect: 'deny' },
    { name: '계약 없는 정산 레코드 생성(영업자)', as: 'agent', method: 'PUT', path: 'v4/settlements/ST_NOPE-9999', body: {
      settlement_code: 'ST_NOPE-9999', contract_code: 'NOPE-9999', settlement_status: '정산대기',
      provider_company_code: providerUser.company_code || '', agent_code: agentUser.user_code || users.agent.uid,
      agent_channel_code: agentUser.agent_channel_code || '', fee_amount: 9990000,
    }, expect: 'deny' },

    // ── 막으면 안 되는 것들 (오늘 푼 것 포함) ──
    { name: '자기 메모 수정(영업자)', as: 'agent', method: 'PUT', path: `${base}/memo_agent`, body: '정상', expect: 'allow' },
    { name: '빈 금액칸 채우기 — 약정 동결(영업자)', as: 'agent', method: 'PUT', path: `${base}/rent_amount_snapshot`, body: 690000, expect: 'allow' },
    { name: '자기 메모 수정(공급사)', as: 'provider', method: 'PUT', path: `${base}/memo_provider`, body: '정상', expect: 'allow' },
    { name: '견적 전체 목록 긁기', as: 'agent', method: 'GET', path: 'proposals', expect: 'deny' },
    // 출고 끝난 계약의 정산 — 이게 막히면 계약완료가 통째로 멈춘다.
    { name: '끝난 계약의 정산 생성(영업자)', as: 'agent', method: 'PUT', path: `v4/settlements/ST_${doneCode}`, body: settlementBody, expect: 'allow' },
    { name: '끝난 계약의 공급사 private(R1)', as: 'agent', method: 'PUT', path: `v4/settlements_provider_private/ST_${doneCode}`, body: {
      settlement_code: `ST_${doneCode}`, contract_code: doneCode, ...party, fee_rate: 0.1, fee_amount: 69000,
    }, expect: 'allow' },
    { name: '끝난 계약의 영업자 private(R2)', as: 'agent', method: 'PUT', path: `v4/settlements_agent_private/ST_${doneCode}`, body: {
      settlement_code: `ST_${doneCode}`, contract_code: doneCode, ...party, payout_rate: 0.04, agent_payout: 27600,
    }, expect: 'allow' },
    { name: '출고완료로 계약완료 전이(공급사)', as: 'provider', method: 'PUT', path: `v4/contracts/${doneCode}/contract_status`, body: '계약완료', expect: 'allow' },
    // v3 상품 원문 — 원가 2001건·계좌 548건이 들어 있는 노드. 관리자만 통째로 볼 수 있어야 한다.
    // ★관리자까지 막히면 erp3 가 죽는다. 그래서 «막힌다»와 «열린다»를 같이 묻는다.
    { name: 'v3 상품 원문 통째로 읽기(영업자)', as: 'agent', method: 'GET', path: 'products', expect: 'deny' },
    { name: 'v3 상품 원문 통째로 읽기(공급사)', as: 'provider', method: 'GET', path: 'products', expect: 'deny' },
    { name: 'v3 상품 원문 통째로 읽기(관리자)', as: 'admin', method: 'GET', path: 'products', expect: 'allow' },
    // v3 운영 노드 직접 쓰기 — erp4 는 v4 로만 쓴다(rtdb-adapter). 여기로 오는 건 우회뿐이다.
    { name: 'v3 상품에 직접 쓰기(영업자)', as: 'agent', method: 'PUT', path: `products/${PROBE_KEY}/_probe`, body: 1, expect: 'deny' },
    { name: 'v3 파트너에 직접 쓰기(공급사)', as: 'provider', method: 'PUT', path: `partners/${PROBE_KEY}/_probe`, body: 1, expect: 'deny' },
    { name: 'v3 정책에 직접 쓰기(공급사)', as: 'provider', method: 'PUT', path: `policies/${PROBE_KEY}/_probe`, body: 1, expect: 'deny' },
  ];

  let failed = 0;
  try {
    for (const probe of probes) {
      const got = await hit(probe.method, probe.path, tokens[probe.as], probe.body);
      const ok = got === probe.expect;
      if (!ok) failed++;
      const mark = ok ? '✔' : '✖';
      const want = probe.expect === 'deny' ? '막혀야' : '통과해야';
      console.log(`  ${mark} ${probe.name.padEnd(34)} ${want} 함 → ${got === 'deny' ? '막힘' : '통과'}`);
    }
  } finally {
    await ref.remove();
    await doneRef.remove();
    for (const node of ['settlements', 'settlements_provider_private', 'settlements_agent_private']) {
      await database.ref(`v4/${node}/ST_NOPE-9999`).remove();
      await database.ref(`v4/${node}/ST_${doneCode}`).remove();
    }
    for (const node of ['products', 'partners', 'policies']) await database.ref(`${node}/${PROBE_KEY}`).remove();
    console.log(`\n  검사용 계약·정산(${code} · ${doneCode}) 삭제 완료.`);
  }

  console.log(failed ? `\n  ✖ ${failed}건이 규칙과 다르게 동작한다.\n` : `\n  ✔ ${probes.length}건 전부 규칙대로 동작한다.\n`);
  // admin SDK 가 RTDB 연결을 물고 있어 그냥 두면 프로세스가 안 끝난다.
  // 끝나지 않으면 출력이 버퍼에 갇혀 «아무 일도 없었던 것»처럼 보인다 — 명시적으로 나간다.
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
