/**
 * 손오공(RP012)의 전자계약 임대인 법정 표시값을 v4 파트너 오버레이에 반영한다.
 *
 * 근거 원본(2026-08-14 확인)
 * - Google Drive `손오공렌터카_사업자등록증.pdf` (2025-11-26 발급)
 * - Google Drive `손오공렌터카_대여사업등록증.pdf` (2025-11-28 변경등록)
 *
 * 기본은 dry-run이며 `--apply` 때만 `v4/partners/RP012`를 PATCH한다.
 * v3 운영 노드는 읽기만 하고 수정하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, unknown>;

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PARTNER_KEY = 'RP012';
const S = (value: unknown) => String(value ?? '').trim();

const VERIFIED: Rec = {
  partner_code: PARTNER_KEY,
  name: '주식회사 손오공렌터카',
  business_number: '8828700650',
  ceo: '조규진',
  address: '서울특별시 강서구 양천로53길 30, 1205호(가양동, 서서울모터리움)',
  rental_business_no: '제 강서-68호',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const read = async (path: string): Promise<Rec | null> => {
    const response = await fetch(`${DB}/${path}.json?access_token=${token}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${path} 읽기 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return await response.json() as Rec | null;
  };

  const [legacy, overlay] = await Promise.all([
    read(`partners/${PARTNER_KEY}`),
    read(`v4/partners/${PARTNER_KEY}`),
  ]);
  const current = { ...(legacy || {}), ...(overlay || {}) };
  const currentCode = S(current.partner_code || current.provider_company_code || PARTNER_KEY).toUpperCase();
  if (currentCode !== PARTNER_KEY) throw new Error(`파트너 코드가 ${PARTNER_KEY}가 아닙니다: ${currentCode}`);

  const patch: Rec = Object.fromEntries(Object.entries(VERIFIED).filter(([key, value]) => (
    JSON.stringify(overlay?.[key] ?? legacy?.[key] ?? null) !== JSON.stringify(value)
  )));
  console.log(`\n손오공 전자계약 임대인 고정정보 ${apply ? '반영' : '미리보기(dry-run)'}`);
  for (const [key, value] of Object.entries(patch)) {
    console.log(`  ${key.padEnd(24)} ${JSON.stringify(current[key] ?? '')} -> ${JSON.stringify(value)}`);
  }
  if (!Object.keys(patch).length) {
    console.log('  변경 없음 - 이미 최신 상태입니다.\n');
    return;
  }
  if (!apply) {
    console.log('\n※ 원본 등록증 대조값입니다. --apply 때 v4 오버레이만 수정합니다.\n');
    return;
  }

  const now = Date.now();
  const response = await fetch(`${DB}/v4/partners/${PARTNER_KEY}.json?access_token=${token}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...patch, updated_at: now, updated_by: 'codex:sonogong-esign-profile' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`v4 파트너 반영 실패 ${response.status}: ${(await response.text()).slice(0, 200)}`);

  const saved = await read(`v4/partners/${PARTNER_KEY}`);
  const mismatch = Object.entries(VERIFIED).filter(([key, value]) => saved?.[key] !== value).map(([key]) => key);
  if (mismatch.length) throw new Error(`반영 후 재검증 실패: ${mismatch.join(', ')}`);
  console.log(`\n반영 완료 - ${Object.keys(VERIFIED).length}개 법정 표시값 재조회 일치\n`);
}

main().catch((error) => {
  console.error(`\n실패 - ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
