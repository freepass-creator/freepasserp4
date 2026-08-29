/**
 * 법인 계약 — 「임차인(법인)」과 「서명하는 사람(대표자)」이 다르다는 것을 지킨다.
 * 정본: docs/ESIGN-MANUAL.md §8
 *
 * ★이 sim 이 있는 이유: 손님한테 값을 «받기만 하고 버리는» 사고를 실제로 냈다(2026-08-28).
 *   FIELD_MAP 에 등록하고 제출 API 에서 저장까지 했는데, 봉인 스냅샷(esign-signed-snapshot)이
 *   그 칸을 안 실어서 계약서에는 자리표시자가 그대로 찍힐 뻔했다.
 *   FIELD_MAP 의 `from:` 은 «메타데이터»라 실제 배선을 증명하지 못한다 — 그래서 여기서 흘려본다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ESIGN_DOCUMENT_PRESETS, SIGNER_ROLES, DELEGATED_SIGNER_ROLE, applySignerRoleToDocuments,
} from '../lib/domain/esign-required-documents';
import { snapshotWithPrivateSubmission } from '../lib/domain/esign-signed-snapshot';
import { FIELD_MAP } from '../lib/domain/esign-field-map';

const template = readFileSync('public/contract-template/rental-contract.html', 'utf8');
const SIGNER_FIELDS = ['signer_name', 'signer_role'] as const;
const okAll = (label: string, fn: () => void) => { fn(); console.log(`  ✓ ${label}`); };

// ── ① 계약서 서식에 자리가 있고, 법인일 때만 보인다
okAll('서식에 서명자 칸이 있고 법인 전용이다', () => {
  for (const field of SIGNER_FIELDS) {
    assert.match(template, new RegExp(`data-field="${field}"`), `서식에 ${field} 칸이 없습니다`);
  }
  // 서명자 표·서명란 곁줄은 data-corp 로 접혔다가 법인일 때만 펴진다
  assert.match(template, /data-corp="1"/);
  assert.match(template, /querySelectorAll\('\[data-corp\]'\)/);
});

// ── ② FIELD_MAP 에 등록돼 있다 (없으면 sim-esign-field-map 이 깨진다)
okAll('FIELD_MAP 에 등록돼 있다', () => {
  for (const field of SIGNER_FIELDS) {
    assert.ok(FIELD_MAP.some((row) => row.field === field), `FIELD_MAP 에 ${field} 가 없습니다`);
  }
});

// ── ③ ★손님이 낸 값이 «봉인 스냅샷까지» 실제로 간다
okAll('제출값이 봉인 스냅샷까지 흘러간다', () => {
  const sealed = snapshotWithPrivateSubmission(
    { templateFields: {}, consentProfile: { requiredKeys: [] } },
    {
      customer_name: '주식회사 홍길동', customer_id: '110111-0000000',
      signer_name: '김철수', signer_role: '대표이사',
    },
  );
  const fields = (sealed.templateFields || {}) as Record<string, unknown>;
  assert.equal(fields.signer_name, '김철수');
  assert.equal(fields.signer_role, '대표이사');
  assert.equal(fields.signer_id, undefined, '법인 서명자 주민등록번호는 계약서에 남기지 않습니다');
  assert.equal(fields.signer_license_no, undefined, '법인 서명자 면허번호는 계약서에 남기지 않습니다');
  // 임차인은 법인 그대로다 — 서명자가 계약자를 덮어쓰지 않는다
  assert.equal(fields.customer_name, '주식회사 홍길동');
});

// ── ④ 개인 계약에는 서명자 칸이 값으로 남지 않는다
okAll('개인 계약은 서명자 칸이 빈다', () => {
  const sealed = snapshotWithPrivateSubmission(
    { templateFields: {}, consentProfile: { requiredKeys: [] } },
    { customer_name: '홍길동', customer_id: '900101-1234567' },
  );
  const fields = (sealed.templateFields || {}) as Record<string, unknown>;
  /* 빈 값은 templateFields 에 «쓰이지 않는다»(esign-signed-snapshot 의 `if (S(value))`).
     그래서 없는 것이 정상이다 — 개인 계약에서는 서식의 서명자 줄 자체가 data-corp 로 접혀 있어
     자리표시자가 보일 일도 없다. */
  for (const field of SIGNER_FIELDS) {
    assert.ok(!fields[field], `${field} 가 개인 계약에서 채워졌습니다: ${String(fields[field])}`);
  }
});

// ── ⑤ 위임 서류는 관계로 «승격»된다. 프리셋은 하나다
okAll('위임 서류가 관계에 따라 승격된다', () => {
  const corp = ESIGN_DOCUMENT_PRESETS.find((preset) => preset.key === 'corporate');
  assert.ok(corp, '법인 프리셋이 없습니다');
  assert.equal(ESIGN_DOCUMENT_PRESETS.filter((preset) => preset.key.startsWith('corporate')).length, 1,
    '법인 프리셋을 둘로 나누면 안 됩니다 — 발행 시점에는 누가 서명할지 모릅니다(§8)');

  const req = (docs: { key: string; required: boolean }[], key: string) => docs.find((d) => d.key === key)?.required;
  // 발행 시점: 위임 서류는 「해당 시」
  assert.equal(req(corp!.documents, 'delegation_letter'), false);
  assert.equal(req(corp!.documents, 'employment_certificate'), false);
  // 대표이사: 그대로
  const asCeo = applySignerRoleToDocuments(corp!.documents, '대표이사');
  assert.equal(req(asCeo, 'delegation_letter'), false);
  // 위임 임직원: 필수로 승격
  const asDelegate = applySignerRoleToDocuments(corp!.documents, DELEGATED_SIGNER_ROLE);
  assert.equal(req(asDelegate, 'delegation_letter'), true);
  assert.equal(req(asDelegate, 'employment_certificate'), true);
  // 이미 필수인 것을 «강등»하지 않는다
  assert.equal(req(asDelegate, 'business_registration'), true);
  assert.equal(req(asCeo, 'corporate_seal'), true);
});

// ── ⑥ 발행 가드는 「해당 시」 서류를 요구하지 않는다 (요구하면 법인 발행이 통째로 막힌다)
okAll('발행 가드가 「해당 시」 서류를 요구하지 않는다', () => {
  const server = readFileSync('lib/server/freepass-esign.ts', 'utf8');
  assert.match(server, /partyDocuments\.filter\(\(document\) => document\.required\)/,
    '발행 가드가 필수 서류만 확인해야 합니다 — 「해당 시」까지 요구하면 법인 계약이 발행되지 않습니다');
});

// ── ⑦ 관계는 두 값뿐이고, 화면·서버가 같은 목록을 쓴다
okAll('관계 목록이 한 곳에만 있다', () => {
  assert.deepEqual([...SIGNER_ROLES], ['대표이사', '위임받은 임직원']);
  const route = readFileSync('app/api/freepass-esign/public/[token]/route.ts', 'utf8');
  assert.match(route, /SIGNER_ROLES/, '제출 API 가 공용 목록을 써야 합니다');
  assert.doesNotMatch(route, /\['대표이사', ?'위임받은 임직원'\]/, '관계 목록을 두 번 적으면 안 됩니다');
});

console.log('✓ 법인 서명자: 서식·필드맵·봉인 배선·위임 서류 승격');
