/**
 * 「이미 산 것」 — 트림 값에 **이미 들어 있어 다시 팔면 안 되는** 옵션을 가려낸다.
 *
 * ★★2026-09-09 검수에서 «돈이 두 번 나가는» 자리로 잡혔다.
 *   ㉠ 제네시스 G80 을 «엔진 × 구동»으로 펴 놓고, 그 줄에 웰릭스 옵션표의
 *      「3.5 터보 +660만」·「AWD +280만」을 그대로 팔았다 — 한 줄에서 **940만원 이중계상**.
 *   ㉡ 현대 그랜저 「가솔린 3.5」 줄이 「3.5 엔진 +246만」을, 아이오닉6 AWD 줄이
 *      「HTRAC +247만」을 또 판다.
 *
 * ⚠⚠ ㉡ 가 안 잡힌 까닭은 **이 판정이 인제스터 «안»에만 있었기 때문**이다.
 *   크롤러(기아·현대)는 같은 판단을 할 길이 없어 `impliedOptions: []` 로 비워 두었다.
 *   ⇒ 판단은 한 곳에 둔다. 인제스터도 크롤러도 **여기를 부른다.**
 *
 * ⚠ 「없다」와 「모른다」를 가른다 — 연료말에 배기량이 없으면(제네시스 「가솔린」) 어떤 엔진이
 *   값에 들어 있는지 **모르는** 것이다. 모르는 것을 「이미 샀다」고 하면 진짜 옵션이 사라진다.
 */

const S = (v: unknown) => String(v ?? '').trim();

export type ImpliedOpt = { name?: string; sub?: string };

/** 연료말 — 이름에서 「가솔린/디젤/…」 한 낱말만. */
const FUEL_WORD = /(가솔린|디젤|하이브리드|전기|수소|lpg|가스)/i;
export const fuelWord = (t: string) => FUEL_WORD.exec(S(t))?.[1]?.toLowerCase() ?? '';

/** 배기량 — 「3.5」 꼴 하나. */
export const disp = (t: string) => /([1-6]\.[0-9])/.exec(S(t))?.[1] ?? '';

/**
 * «엔진 서명» — 배기량·터보·48V(슈퍼차저)·블랙. 이 넷이 같아야 «같은 엔진»이다.
 * ⚠ 배기량만 보면 G90 의 「가솔린 3.5 터보 **48V 일렉트릭 슈퍼차저** +600만」이
 *   「이미 산 엔진」으로 잘못 걸려 **진짜 옵션이 사라진다**(2026-09-09 드라이런에서 잡음).
 */
export const engineSig = (t: string) => [
  disp(t),
  /터보|turbo|t-gdi/i.test(t) ? 'T' : '',
  /48V|슈퍼차저|supercharg/i.test(t) ? 'E' : '',
  /black|블랙/i.test(t) ? 'B' : '',
].join('|');

/** 서명이 통째로 비었나 — 「엔진」이라고만 적힌 것끼리 «같다»고 하면 안 된다. */
const blank = (sig: string) => !sig.replace(/\|/g, '');

/**
 * 이 옵션이 «이미 산 엔진»인가 — 그러면 또 팔면 안 된다(엔진값 이중 계상).
 * ⚠ 양쪽 서명이 «둘 다» 있어야 같다고 말한다. 한쪽이 비면 «모른다»이지 «같다»가 아니다.
 */
export function impliedByFuel(id: string, o: ImpliedOpt, fuel: string): boolean {
  const hay = `${id} ${S(o.name)} ${S(o.sub)}`;
  if (!/엔진|engine/i.test(hay)) return false;
  const a = engineSig(hay); const b = engineSig(fuel);
  if (blank(a) || blank(b)) return false;
  return a === b;
}

/**
 * 이 옵션이 «이미 산 구동»인가 — 그러면 또 팔면 안 된다.
 *
 * ⇒ 그 줄의 «트림»(또는 파워트레인)이 곧 구동이면(2WD/AWD/HTRAC) 같은 이름의 옵션은 이미 산 것이다.
 * ⚠ 트림이 「블랙」처럼 구동이 아닌 경우에는 안 걸러야 한다 — 구동말이 «양쪽에» 있을 때만 본다.
 */
const DRIVE = /(2WD|4WD|AWD|HTRAC|H-?TRAC|후륜|전륜|사륜|e-?4WD)/i;
const driveKey = (s: string) =>
  (/AWD|4WD|HTRAC|H-?TRAC|사륜/i.test(s) ? 'awd' : /2WD|후륜|전륜/i.test(s) ? '2wd' : '');

export function impliedByTrim(id: string, o: ImpliedOpt, trim: string): boolean {
  const t = S(trim);
  if (!DRIVE.test(t)) return false;
  const hay = `${id} ${S(o.name)} ${S(o.sub)}`;
  if (!DRIVE.test(hay)) return false;
  const k = driveKey(hay);
  return k !== '' && k === driveKey(t);
}

/**
 * 한 트림에서 «이미 산» 옵션 id 들. 인제스터·크롤러가 **같이** 쓴다.
 * @param om   그 트림의 옵션 사전
 * @param fuel 파워트레인 말(「가솔린 3.5 터보」 · 「전기 롱레인지」)
 * @param trim 트림 말(「AWD」 · 「프레스티지」 · 「2WD」)
 */
export function impliedOf(
  om: Record<string, ImpliedOpt>,
  fuel: string,
  trim: string,
): string[] {
  return Object.entries(om ?? {})
    .filter(([id, o]) => impliedByFuel(id, o, fuel) || impliedByTrim(id, o, trim))
    .map(([id]) => id);
}
