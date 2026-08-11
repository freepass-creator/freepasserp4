/**
 * 채팅 안내 — **당분간 카톡으로 받는다**(2026-08-11 사장님 지시).
 *
 * ★왜 한 파일에 두나
 *   같은 말을 화면마다 따로 적으면 «고쳐야 할 때» 한 군데가 남는다.
 *   개선이 끝나 안내를 내릴 때 이 파일의 스위치 하나만 끄면 된다.
 *
 * ★안내를 «보이게만» 하고 채팅을 막지는 않는다
 *   이미 진행 중인 대화가 있다. 입구를 닫으면 그 대화가 갈 곳을 잃는다.
 *   보내는 것은 그대로 두고, «지금은 카톡이 빠르다»고 알린다.
 *
 * ★관리자에게는 띄우지 않는다
 *   관리자는 «받는 쪽»이다. 자기더러 카톡으로 문의하라는 안내를 볼 이유가 없다.
 */

/** 안내를 띄울지. 채팅 개선이 끝나면 false 로 내린다. */
export const CHAT_NOTICE_ON = true;

/** 담당 연락처 — `lib/domain/faq.ts` GUIDE 의 「담당 · 상품 확인」과 같은 값을 쓴다. */
export const CHAT_NOTICE_CONTACTS = [
  { role: '담당', name: '박영협', phone: '010-6384-9260' },
  { role: '선임매니저', name: '박태윤', phone: '010-2925-1798' },
] as const;

export const CHAT_NOTICE_TITLE = '문의는 당분간 카카오톡으로 부탁드립니다';
/** 왜인지 밝힌다 — 이유 없이 딴 데로 보내면 «되는 건가» 싶어진다. */
export const CHAT_NOTICE_BODY = '채팅을 고치는 중이라 답이 늦을 수 있습니다. 급한 건은 아래로 연락 주세요.';

/** 카톡·문자 어디에 붙여도 읽히는 한 줄. 복사 버튼용. */
export function chatNoticeText(): string {
  const who = CHAT_NOTICE_CONTACTS.map((c) => `${c.name} ${c.phone}`).join(' · ');
  return `${CHAT_NOTICE_TITLE} — ${CHAT_NOTICE_BODY} ${who}`;
}

/** 이 사람에게 안내를 띄우나. 관리자는 받는 쪽이라 제외한다. */
export function showChatNotice(role: string | null | undefined): boolean {
  return CHAT_NOTICE_ON && String(role ?? '') !== 'admin';
}
