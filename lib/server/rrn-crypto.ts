import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 주민등록번호 저장용 암·복호 — **서버 전용**.
 *
 * ★왜 필요한가: 개인정보 보호법 시행령 제21조의2 는 주민등록번호를 **암호화하여 저장**하도록
 *   정한다. 화면 마스킹(identity-mask)·접근통제·감사로그로는 대체되지 않는다.
 *   예전에는 손님이 넣은 13자리가 RTDB 에 그대로 들어갔다(2026-08-21 실측).
 *
 * 붙는 자리는 둘뿐이다 — 그래서 이 파일이 작다.
 *   저장: app/api/freepass-esign/public/[token]/route.ts  (손님 제출)
 *   해제: app/api/freepass-esign/contracts/[contractCode]/route.ts (봉인본 만들 때)
 *   그 밖의 코드는 원문을 볼 일이 없다 — `residentIdInfo` 도 생년월일만 돌려준다.
 *
 * ⚠ 키(`FREEPASS_RRN_KEY`)가 없으면 **저장이 실패한다.** 일부러 그렇게 뒀다 —
 *   키가 없을 때 평문으로 떨어뜨리면 «되긴 되는데 법을 어기는» 상태가 조용히 굳는다.
 */

/** 저장된 값 앞에 붙는 표식. 13자리 평문과 겹치지 않아 «이미 암호화됐나»를 바로 안다. */
const PREFIX = 'enc.v1.';

function key(): Buffer {
  const raw = String(process.env.FREEPASS_RRN_KEY || '').trim();
  if (!raw) {
    throw new Error('FREEPASS_RRN_KEY 가 없습니다 — 주민등록번호를 암호화할 수 없어 저장을 멈춥니다');
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('FREEPASS_RRN_KEY 는 32바이트여야 합니다 (hex 64자 또는 base64)');
  }
  return buf;
}

export function isEncryptedRrn(value: unknown): boolean {
  return String(value ?? '').startsWith(PREFIX);
}

/**
 * 저장 직전에 부른다. 빈 값은 빈 값 그대로 둔다(안 적은 것과 암호화 실패를 섞지 않는다).
 * 이미 암호문이면 두 번 감싸지 않는다.
 */
export function encryptRrn(value: unknown): string {
  const plain = String(value ?? '').trim();
  if (!plain) return '';
  if (isEncryptedRrn(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

/**
 * 봉인본을 만들 때만 부른다.
 * 암호문이 아니면 그대로 돌려준다 — 암호화 이전에 저장된 계약이 남아 있기 때문이다.
 * 복호에 실패하면 던지지 않고 빈 값을 돌려준다: 키를 바꾼 뒤 옛 계약을 열었을 때
 * 계약서 전체가 안 나오는 것보다, 그 칸만 비고 나머지가 나오는 편이 낫다.
 */
export function decryptRrn(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!isEncryptedRrn(raw)) return raw;
  try {
    const [ivB64, tagB64, ctB64] = raw.slice(PREFIX.length).split('.');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
