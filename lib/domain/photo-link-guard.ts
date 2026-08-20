/**
 * **사진링크 문지기 — 그 차 사진이 아니면 걸지 않는다.**
 *
 * ★사장님 2026-08-20 「우리 차량번호에 맞는 사진이 링크가 되어야 한다 · 없으면 매칭을 안 해야 한다 ·
 *   혹시나 폴더명을 차량번호랑 안 맞게 해놨을 수도 있으니 그것도 확인해라」.
 *
 * 실측 2026-08-20 — 링크가 걸린 430대 중 86대가 남의 차였다. 스타는 줄이 밀려 쏘렌토 줄에 GV70
 * 폴더가, 이안카는 「137 2027 토레스」 폴더 하나를 12대가 같이 쓰고 있었다.
 *
 * 판정 규칙(세 도구가 **같은 규칙**을 쓴다 — 규칙이 갈리면 한쪽이 떼고 다음 시각에 다른 쪽이 다시 건다):
 *   ① 드라이브 폴더·파일 «이름»이 차번을 말해 주면 그게 답이다 — 같으면 걸고, 다르면 안 건다.
 *      남이 같이 쓰든 말든 「125호5168 …」 폴더는 125호5168 것이다.
 *   ② 이름이 차번을 말해 주지 않으면(모델·날짜 묶음 폴더·공급사 상세페이지) «혼자 쓰는가»로 가른다 —
 *      서로 다른 차가 같은 주소를 쓰면 그건 한 차 사진이 아니다.
 *   ③ 열리지 않는(지워졌거나 권한 없는) 드라이브 주소는 안 건다.
 *
 * ⚠ 폴더 «이름»은 사람이 붙인 것이라 틀릴 수 있다. 이름이 맞아도 사진 속 번호판이 다른 경우가
 *   실제로 있었다(스타 「101호5187 카니발」 폴더 사진의 번호판은 125호5187). 그건 이 함수가 못 잡는다 —
 *   사람이 사진을 보고 가른 뒤 `tmp/unlink-plates.mts` 로 떼고, 이관은 `--skip=` 으로 뺀다.
 */

const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');

/** 우리가 쓰는 번호판 꼴 — 「125호5168」·「10하8210」. */
export const PLATE_IN_NAME = /(\d{2,3}[가-힣]\d{4})/;

export const isPhotoUrl = (v: unknown) => /^https?:\/\//i.test(S(v));

/** 드라이브 주소에서 파일·폴더 id. 폴더(`/folders/…`)·파일(`/d/…`)·`?id=` 세 꼴을 본다. */
export const driveIdOf = (u: unknown): string => {
  const s = S(u);
  if (!/drive\.google\.com|docs\.google\.com/i.test(s)) return '';
  return (s.match(/\/(?:folders|d)\/([\w-]{15,})/) || s.match(/[?&]id=([\w-]{15,})/) || [])[1] || '';
};

/** 폴더·파일 이름이 말하는 차번(없으면 빈 문자열). */
export const plateInName = (name: unknown): string => (S(name).match(PLATE_IN_NAME) || [])[1] || '';

export type PhotoTarget = {
  /** 드라이브에서 읽은 이름. 드라이브가 아닌 주소면 빈 문자열. */
  name: string;
  /** 열리는가(지워졌거나 권한이 없으면 false). 드라이브가 아닌 주소면 true. */
  ok: boolean;
};

export type PhotoVerdict = {
  /** 걸어도 되나. */
  fit: boolean;
  /** 안 되는 이유(걸어도 되면 빈 문자열). */
  why: string;
};

/**
 * 이 주소를 이 차에 걸어도 되나.
 * @param plate  그 줄의 차량번호
 * @param url    사진링크
 * @param target 드라이브에서 읽은 대상(드라이브가 아니면 `{ name: '', ok: true }`)
 * @param sharedWith 같은 주소를 쓰는 «서로 다른 차번»의 수(자기 자신 포함)
 */
export function judgePhotoLink(plate: string, url: string, target: PhotoTarget, sharedWith: number): PhotoVerdict {
  if (!isPhotoUrl(url)) return { fit: false, why: '주소가 아님' };
  const id = driveIdOf(url);
  if (id && !target.ok) return { fit: false, why: '열리지 않는 폴더' };
  const inName = plateInName(target.name);
  if (inName) {
    return norm(inName) === norm(plate)
      ? { fit: true, why: '' }
      : { fit: false, why: `다른 차 폴더(${S(target.name).slice(0, 20)})` };
  }
  if (sharedWith > 1) return { fit: false, why: '여러 차가 같이 쓰는 주소' };
  return { fit: true, why: '' };
}

/** 주소별로 «서로 다른 차번이 몇이나 쓰는가»를 센다. */
export function countPlatesByUrl(rows: { plate: string; urls: (string | undefined)[] }[]): Map<string, number> {
  const byUrl = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const u of r.urls) {
      if (!isPhotoUrl(u)) continue;
      const key = S(u);
      (byUrl.get(key) || byUrl.set(key, new Set()).get(key)!).add(norm(r.plate));
    }
  }
  const out = new Map<string, number>();
  for (const [u, set] of byUrl) out.set(u, set.size);
  return out;
}
