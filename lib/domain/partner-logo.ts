/**
 * **회원사 로고 — 생성되는 파일이다. 손으로 고치지 마라.**
 *
 * 만드는 법
 * ```
 * assets/partner-logo/<별칭>.png|jpg|svg   에 파일을 둔다
 * npx tsx scripts/embed-partner-logos.mts  돌리면 이 파일이 다시 써진다
 * ```
 *
 * ★값은 **data URI** 다. 정산서는 «혼자서» 열려야 한다 —
 *   바깥 주소를 걸면 메일로 보낸 뒤 상대 화면에서 그림이 안 뜬다.
 *
 * ★없으면 **아무것도 안 그린다.** 깨진 그림 상자가 뜨느니 상호 글자만 반듯한 게 낫다.
 *
 * ⚠ 남의 상표다. 사장님이 2026-08-27 「다 허락받았으니까」라고 하셨다 —
 *   허락받지 않은 회사 로고를 여기 넣지 마라.
 */

const KEY = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 별칭 → data URI. 비어 있는 게 정상이다 — 파일을 넣으면 채워진다. */
export const PARTNER_LOGO: Record<string, string> = {
  // 아직 없다 — assets/partner-logo/ 에 파일을 두고 이 스크립트를 돌린다
};

export const logoOf = (alias: unknown): string => PARTNER_LOGO[KEY(alias)] ?? '';
