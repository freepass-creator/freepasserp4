/** 차종마스터 시트 매칭 «정제» — 손오공 전용이 아니라 **모든 공급사 공용 엔진**.
 *
 *  ★여기가 정제 «방법»의 정본이다(축 2 = 방법 통일). 손오공이든 공급사든 어느 경로도 이 함수를 쓴다.
 *   경로가 달라도 같은 규칙이라야 «방법이 갈려서» 오류 나는 걸 막는다.
 *  ★정본 마스터 = 차종마스터_신규 구글시트(1oMB9eo). 구글시트 기반(사장님 2026-08-27).
 *
 *  입력:
 *    차량[]     — { 제조사, 모델, 세부, 차명, 연식, 연료, 차번, 버킷?, 정제?{세부트림} }
 *    cmValues   — 차종마스터 시트 2D 배열(0행=헤더). ★헤더 이름으로 읽는다(열 순서 바뀌어도 안 깨짐).
 *  출력:
 *    { 결과[{차번,버킷,제조사,모델,세부모델,세부트림,원산지}], 미스{모델없음[],트림연식없음[]} }
 *
 *  ★모델·세부모델·세부트림·원산지는 «시트 행»에서만 온다. 없는 걸 짐작해 만들지 않는다(없으면 미스).
 */

export const 연월 = (s) => { const m = String(s || '').match(/(\d{4})[-.]?(\d{1,2})?/); return m ? Number(m[1]) * 100 + Number(m[2] || 1) : null; };

// 모델명 → 차종마스터 모델 매칭키 정규화(영문→한글·세대/연료 꼬리 제거·오타).
const 영한 = { NIRO: '니로', RAY: '레이', SOUL: '쏘울', SPORTAGE: '스포티지', SONATA: '쏘나타', AVANTE: '아반떼', GRANDEUR: '그랜저', SANTAFE: '싼타페', TUCSON: '투싼', PALISADE: '팰리세이드', SELTOS: '셀토스', CARNIVAL: '카니발', SORENTO: '쏘렌토', MORNING: '모닝', VENUE: '베뉴', KONA: '코나' };
export function 모델정규(m) {
  let s = String(m ?? '');
  for (const [e, k] of Object.entries(영한)) s = s.replace(new RegExp(e, 'ig'), k);
  return s
    .replace(/디\s?올\s?뉴|더\s?올\s?뉴|더\s?뉴|올\s?뉴|신형|the\s?new/gi, '')
    .replace(/하이브리드|HEV|가솔린|디젤|휘발유|경유|LPG|플러그인|전기|EV\b/gi, '')
    .replace(/\b(IG|TM|DN8|CN7|NX4|MX5|LX2|SG2|DL3|GL3|RG3|JK1|MQ4|KA4|AD|QM6|SM6)\b/gi, '')
    .replace(/\d\s?세대|F\/?L|풀체인지|페이스리프트|N\s?라인|N\s?Line/gi, '')
    .replace(/플러스|부스터|어반|더\s?볼드|더\s?마스터|프리미어/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/그랜져/g, '그랜저')
    .replace(/[^가-힣A-Za-z0-9]/g, '').replace(/\s+/g, '').trim();
}
const N = (x) => 모델정규(x);
const NN = (x) => String(x ?? '').replace(/\s/g, '');

// 제조사 리브랜드/표기 별칭 — 시트와 소스가 다르게 적어도 같은 메이커로 본다(팩트).
const 메이커별칭 = [
  [/KG모빌리티|KGM|쌍용/i, '쌍용'], [/르노|삼성/i, '르노'], [/제네시스/i, '제네시스'], [/^MINI$|미니/i, '미니'],
  // 수입 — 원문 표기와 시트를 같은 메이커로.
  [/벤츠|메르세데스|Mercedes/i, '벤츠'], [/BMW|비엠/i, 'BMW'], [/아우디|Audi/i, '아우디'], [/볼보|Volvo/i, '볼보'],
  [/테슬라|Tesla/i, '테슬라'], [/토요타|도요타|Toyota/i, '토요타'], [/포드|Ford/i, '포드'], [/폭스바겐|폭바|Volkswagen|^VW$/i, '폭스바겐'], [/지프|Jeep/i, '지프'],
];
const 메이커키 = (x) => { for (const [re, k] of 메이커별칭) if (re.test(String(x ?? ''))) return k; return N(x); };

export function 정제(차량, cmValues) {
  const H = cmValues[0] || []; const ix = (n) => H.indexOf(n);
  const CI = { 원산지: ix('원산지'), 제조사: ix('제조사'), 모델: ix('모델'), 세부모델: ix('세부모델'), 세부트림: ix('세부트림'), 시작: ix('생산시작'), 종료: ix('생산종료') };

  const idx = new Map();
  const makerRows = new Map(); // 메이커키(제조사) → rows[]  (세부모델 회수용)
  for (const r of cmValues.slice(1)) {
    const 제조사 = r[CI.제조사], 모델 = r[CI.모델];
    if (!제조사 || !모델) continue;
    const row = { 원산지: r[CI.원산지], 제조사, 모델, 세부모델: r[CI.세부모델], 세부트림: r[CI.세부트림], 시작: 연월(r[CI.시작]), 종료: /현재|판매/.test(r[CI.종료]) ? 999912 : 연월(r[CI.종료]) };
    const k = 메이커키(제조사) + '|' + N(모델);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(row);
    const mk = 메이커키(제조사);
    if (!makerRows.has(mk)) makerRows.set(mk, []);
    makerRows.get(mk).push(row);
  }

  // 현대 제네시스 G80/GV80 → 제네시스 브랜드 보정.
  const 브랜드제조사 = (c) => {
    const blob = `${c.모델 ?? ''} ${c.세부 ?? ''} ${c.차명 ?? ''}`;
    const gm = blob.match(/\b(GV\d0|G\d0|G70|GV60|GV90)\b/i);
    return gm ? '제네시스' : c.제조사; // G70·G80·G90·GV60/70/80 은 제네시스 전용 코드 → 제조사 표기가 현대여도 보정
  };

  // 세대 별칭 — 소스는 마케팅명(디 올 뉴 스포티지), 시트는 코드명(스포티지 NQ5). 검증된 세대 사실만.
  //   blob 에 «시트 세부모델과 같은 토큰»을 덧붙일 뿐, 실제 판정은 연식·연료 게이트가 한다.
  const 세대별칭 = [
    [/스포티지/, /디올뉴|올뉴/, '스포티지NQ5'],
    [/투싼/, /디올뉴|더올뉴/, '투싼NX4'],
    [/그랜저/, /더뉴/, '그랜저IG'],
    [/G80/i, /3세대|뉴/, 'G80RG3'],
    [/QM6/i, /new|뉴/i, '더뉴QM6'],
    [/쏘나타/, /DN8/i, '쏘나타디엣지DN8'],
    [/아반떼/, /NLine|N라인/i, '아반떼CN7'],
  ];
  // 세부모델 회수용 blob — 코드 보존(CN7·DN8·G80 안 지운다), 공백만 제거 + 세대 별칭 토큰.
  const blobN = (c) => {
    const base = NN(`${c.모델 ?? ''}${c.세부 ?? ''}${String(c.차명 ?? '').split('/')[0]}`);
    let extra = '';
    for (const [m, mk, add] of 세대별칭) if (m.test(base) && mk.test(base)) extra += add;
    return base + extra;
  };
  // 연료 충돌 — 시트 세부모델의 명시적 연료 표식과 차 연료가 어긋나면 제외.
  const fuelClash = (cf, s) => {
    const carHyb = /하이브리드|HEV/i.test(cf), carEv = /전기/i.test(cf) && !carHyb, carGas = !carHyb && !carEv;
    const subHyb = /하이브리드|HEV/i.test(s), subEv = /일렉트릭|EV|electric/i.test(s);
    if (subHyb && !carHyb) return true;
    if (!subHyb && carHyb) return true;
    if (subEv && carGas) return true;
    return false;
  };
  // ★회수 매처: 제조사 안에서 «시트 세부모델»이 차 이름 blob 에 통째로 든 행. 연식 맞는 것 우선(트림>길이),
  //   연식 맞는 게 없으면 세대 별칭이 이미 세대를 고정했으므로 연식 완화해 최선을 고른다.
  //  개발코드·마케팅접두까지 뗀 «코어»(카니발 KA4→카니발, 더 뉴 K8 GL3→K8). 국산 세대명↔코드명 갭용.
  const 코어정규 = (s) => String(s || '')
    .replace(/하이브리드|HEV|일렉트릭|EV|전기/gi, '')
    .replace(/디\s?올\s?뉴|더\s?올\s?뉴|더\s?뉴|올\s?뉴|베리\s?뉴/gi, '')
    .replace(/\s+[A-Z]{1,3}\d{0,3}(\s+FL)?\s*$/i, '').trim();
  const 회수 = (c, y, 트림) => {
    const rows = makerRows.get(메이커키(브랜드제조사(c))) || [];
    const blob = blobN(c);
    const gather = (getKey, minLen, yearStrict) => {
      const cand = [];
      for (const r of rows) {
        const k = NN(getKey(r.세부모델));
        if (k.length < minLen || !blob.includes(k)) continue;
        if (fuelClash(c.연료 || '', r.세부모델)) continue;
        const inYear = !y || !r.시작 || (y >= r.시작 && y <= r.종료);
        if (yearStrict && !inYear) continue;
        const trimOK = !!(트림 && NN(r.세부트림) && (NN(r.세부트림) === NN(트림) || NN(r.세부트림).includes(NN(트림)) || NN(트림).includes(NN(r.세부트림))));
        cand.push({ r, len: k.length, inYear, trimOK });
      }
      return cand;
    };
    // 1차: 연료만 뗀 코어(연식 완화 허용) — 기존 동작 그대로(손오공 100% 유지).
    let cand = gather((s) => String(s || '').replace(/하이브리드|HEV|일렉트릭|EV|전기/gi, ''), 3, false);
    // 2차(1차 비었을 때만): 개발코드·마케팅접두 뗀 코어. 세대 오배정 막으려 연식 엄격.
    if (!cand.length) cand = gather(코어정규, 2, true);
    if (!cand.length) return null;
    const pool = cand.some((x) => x.inYear) ? cand.filter((x) => x.inYear) : cand;
    pool.sort((a, b) => (b.trimOK - a.trimOK) || (b.len - a.len));
    return pool[0].r;
  };
  // 세부트림 추출 — 원본 형식 공용: 정제(롯데) 우선, 없으면 차명의 마지막 '/' 뒷조각.
  const 트림뽑기 = (c) => c.정제?.세부트림 || (() => { const p = String(c.차명 || '').split('/'); return p.length > 1 ? p.pop().trim() : ''; })();

  const 결과 = [];
  const 미스 = { 모델없음: [], 트림연식없음: [] };
  for (const c of 차량) {
    const 트림 = 트림뽑기(c);
    const y = 연월(c.연식);
    const cands = idx.get(메이커키(c.제조사) + '|' + N(c.모델));
    let hit = null;
    if (cands) {
      let pool = cands.filter((x) => !y || !x.시작 || (y >= x.시작 && y <= x.종료));
      if (!pool.length) pool = cands;
      hit = pool.find((x) => NN(x.세부트림) === NN(트림))
        || pool.find((x) => 트림 && (NN(x.세부트림).includes(NN(트림)) || NN(트림).includes(NN(x.세부트림))))
        || (new Set(pool.map((x) => x.세부모델)).size === 1 ? pool[0] : null);
    }
    if (!hit) hit = 회수(c, y, 트림); // ★세부모델 기반 회수(짐작 아님 — 실제 시트 행에만)
    if (!hit) {
      const hasMaker = (makerRows.get(메이커키(브랜드제조사(c))) || []).length > 0;
      if (cands || hasMaker) 미스.트림연식없음.push(`${c.차번} ${c.제조사} ${c.모델} [트림 ${트림 || '?'} · ${c.연식}]`);
      else 미스.모델없음.push(`${c.차번} ${c.제조사} ${c.모델}`);
      continue;
    }
    // 모델·세부모델·세부트림은 차종마스터 행의 값을 그대로 복사한다. 마스터 행의
    // 트림이 빈칸이면 빈칸이 정답이며, 원문 트림을 되살려 새 이름을 만들지 않는다.
    결과.push({ 차번: c.차번, 버킷: c.버킷, 제조사: hit.제조사, 모델: hit.모델, 세부모델: hit.세부모델, 세부트림: hit.세부트림, 원산지: hit.원산지 });
  }
  return { 결과, 미스 };
}
