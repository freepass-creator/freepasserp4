/**
 * **정산서 링크의 열쇠** — 사업자번호 하나로 그 상대의 정산서 주소를 만든다.
 *
 * ★★★사장님 2026-09-10
 *   「이제 **채널에 링크로 보내서 확인**하라고 할 거야 **pdf 안 주고**」
 *   「시트랑 동일하게 그 링크는 **그 영업채널 정산서**인 거야 —
 *    **각각 사업자번호 누르면 그 링크가 열리는** 거지」
 *
 * ⚠⚠ **사업자번호를 주소에 «그대로» 쓰지 않는다.**
 *   사업자번호는 열 자리 숫자이고 **공개 정보**다. 주소에 그대로 넣으면
 *   남의 번호를 아는 사람이(또는 열 자리를 훑는 기계가) **남의 정산서를 연다.**
 *   정산서에는 임차인 이름·차량번호·금액이 다 있다. 한 번 새면 못 주워 담는다.
 *
 * ⇒ **사업자번호 + 서버만 아는 소금**을 섞어 되돌릴 수 없는 열쇠를 만든다.
 *   · 관리자는 사업자번호만 알면 «같은 링크»를 다시 만들 수 있다(사장님 요구 그대로)
 *   · 링크를 받은 사람은 열 수 있다
 *   · 링크가 없으면 못 연다 — 번호를 알아도 소금을 모르면 못 만든다
 *
 * ★소금은 `SETTLEMENT_LINK_SALT` 환경변수다. **없으면 링크를 만들지 않는다** —
 *   빈 소금으로 만들면 그 열쇠는 «사업자번호만으로 계산되는» 것이라 잠금이 아니다.
 */
import { createHash } from 'node:crypto';

const 숫자만 = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** 링크 열쇠를 만들 수 있나 — 소금이 있어야 한다. */
export const canMakeSettlementKey = (): boolean => !!String(process.env.SETTLEMENT_LINK_SALT || '').trim();

/**
 * 사업자번호 → 링크 열쇠(24자리 16진수).
 * ⚠ 소금이 없으면 **빈 문자열**을 준다. 부르는 쪽은 빈 값이면 링크를 만들지 않는다.
 * ⚠ 번호가 열 자리가 아니면 빈 문자열 — 짐작으로 만들지 않는다.
 */
export function settlementKeyOf(bizNo: unknown): string {
  /**
   * ★★★**2026-09-10 코덱스 검증 P0 — 이 방식은 «쓰지 않는다».**
   *   사업자번호는 안 바뀌므로 이 열쇠도 영원히 같다. 만료도, 개별 폐기도, 범위 제한도 없다.
   *   링크 하나가 새면 그 거래처의 «모든 월»이 지속 노출된다. 끊을 손잡이가 없는 열쇠는 열쇠가 아니다.
   *   ⇒ 다시 낼 때는 **발행된 정산서 스냅샷마다 무작위 토큰 + 만료 + 개별 폐기 + 그 달 한 장 범위**.
   *   ★그때까지 이 함수는 아무것도 만들지 않는다. 지우지 않고 남기는 까닭은
   *     다음 사람이 같은 설계를 다시 지어내지 않게 하려는 것이다.
   */
  if (true as boolean) return '';
  const d = 숫자만(bizNo);
  const salt = String(process.env.SETTLEMENT_LINK_SALT || '').trim();
  if (d.length !== 10 || !salt) return '';
  return createHash('sha256').update(`${salt}|정산서|${d}`).digest('hex').slice(0, 24);
}

/**
 * 열쇠 ↔ 사업자번호 — **되돌릴 수 없으므로 «맞춰 본다».**
 * 아는 번호 목록을 받아 하나씩 만들어 보고 같은 것을 찾는다.
 * ★그래서 «우리가 아는 거래처»만 열린다 — 모르는 번호로는 아무 링크도 안 열린다.
 */
export function bizOfSettlementKey(key: unknown, 아는번호: readonly unknown[]): string {
  const k = String(key ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(k)) return '';
  for (const b of 아는번호) {
    const d = 숫자만(b);
    if (d.length === 10 && settlementKeyOf(d) === k) return d;
  }
  return '';
}

/** 링크 한 줄 — 관리자 화면이 복사해서 보낸다. */
export function settlementLinkOf(bizNo: unknown, origin = ''): string {
  const k = settlementKeyOf(bizNo);
  if (!k) return '';
  return `${origin}/settlement/s/${k}`;
}
