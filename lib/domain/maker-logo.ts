/**
 * **제조사 CI(로고) — 파일이 있으면 달고, 없으면 조용히 글자만 둔다.**
 *
 * 사장님 2026-09-06 「(시안 A로 하고) **밋밋하지 않게끔 제조사는 그 CI 를 달아주면** 되고」.
 * 케이카·헤이딜러가 제조사 목록에 브랜드 마크를 다는 그 자리다 — 로고 하나가 붙으면 열일곱 줄이
 * 글자 목록에서 «고르는 판»으로 바뀐다.
 *
 * ★★**여기는 «자리»만 정한다. 그림 파일은 따로 넣는다.**
 *   `public/brand/maker/{파일명}.svg` 한 장씩. 없으면 `null` 이라 화면은 글자만 그린다 —
 *   **한 장도 없어도 안 깨지고**, 한 장 넣는 순간 그 브랜드만 바로 뜬다.
 * ⚠ 이름을 파일명으로 바로 쓰지 않는다. 원천 표기가 「르노코리아(삼성)」·「쉐보레(GM대우)」처럼
 *   괄호를 달고 오기도 하고, 한글 파일명은 서버·CDN 에서 인코딩이 갈린다.
 *   ⇒ **표에 적힌 이름만** 파일로 이어 준다(아래). 표에 없으면 그림 없이 간다.
 * ⚠ 로고는 **남의 상표**다. 파일을 넣을 때는 제조사가 공개한 브랜드 자산을 쓰고,
 *   다른 회사(엔카·케이카 등) 서버의 이미지를 가져다 쓰지 않는다.
 */

/** 우리가 파는 제조사 → 파일 이름(ASCII). 실측 17곳(2026-09-06). */
const MAKER_FILE: Record<string, string> = {
  기아: 'kia',
  현대: 'hyundai',
  제네시스: 'genesis',
  르노코리아: 'renault-korea',
  르노: 'renault',
  벤츠: 'mercedes',
  KG모빌리티: 'kgm',
  쉐보레: 'chevrolet',
  BMW: 'bmw',
  테슬라: 'tesla',
  미니: 'mini',
  아우디: 'audi',
  도요타: 'toyota',
  볼보: 'volvo',
  BYD: 'byd',
  캐딜락: 'cadillac',
  포드: 'ford',
};

/**
 * 그 제조사의 마크 주소 — 없으면 `null`.
 * ★괄호 표기(「르노코리아(삼성)」)와 앞뒤 공백을 걷어 표와 맞춘다.
 */
export function makerLogoSrc(maker: string): string | null {
  const key = String(maker || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  const file = MAKER_FILE[key];
  return file ? `/brand/maker/${file}.svg` : null;
}
