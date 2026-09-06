# -*- coding: utf-8 -*-
"""
mtops 제네시스 가격표(HTML) → 옵션 조합 데이터. (사장님 2026-09-06 · GV80 쿠페 코덱스 교차검증 방식 확장)
  mtops.hmc.co.kr/contents/html/{Model}_price.html 는 필수선택(배타)+선택품목(패키지·개별)+추천구성을 담는다.
  ★가격 정렬은 코덱스가 GV80쿠페로 검증한 대로: «기본 모델» 행에 옵션가가 순서대로 한 줄. 그 순서를 옵션명과 맞댄다.
출력 JSON: {model, basePrice, priceRow[...], packages[{name, includes[]}], recommended[{items, total}], rawOptionNames[...]}
  ※ 옵션명↔가격 «최종 정렬»은 모델마다 코덱스 교차검증(추천구성 합계로 역산). 이 파서는 «재료»를 정확히 뽑는다.
사용: python scripts/parse-mtops-genesis.py tmp/mtops/GV80-Coupe.html GV80-Coupe out.json
"""
import re, sys, json, html

def cells_of(tr):
    return [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip()
            for c in re.findall(r'<t[dh][\s\S]*?</t[dh]>', tr)]

def parse(path):
    raw = open(path, encoding='utf-8', errors='ignore').read()
    rows = re.findall(r'<tr[\s\S]*?</tr>', raw)
    price_row = []          # 「기본 모델 …」 행의 가격 순서
    base = None
    packages = []           # {name, includes}
    recommended = []        # {items, total}
    opt_names = []          # 필수/선택 옵션명(순서)
    for tr in rows:
        cs = [c for c in cells_of(tr) if c]
        if not cs:
            continue
        j = ' | '.join(cs)
        # 가격행: 「기본 모델」로 시작하고 큰 숫자 여럿
        prices = re.findall(r'([1-9]\d{0,2}(?:,\d{3})+)', j)
        if ('기본 모델' in cs[0] if cs else False) and len(prices) >= 5:
            price_row = [int(p.replace(',', '')) for p in prices]
            base = price_row[0]
        # 패키지 포함관계: 「XX 패키지 | 내용물…」
        m = re.match(r'^(.{2,20}?패키지)$', cs[0])
        if m and len(cs) >= 2 and '포함' not in cs[0]:
            includes = [x.strip() for x in re.split(r'[,·]', cs[1]) if x.strip() and '패키지' in x or ''][:8]
            inc = [x.strip() for x in re.split(r'[,]', cs[1]) if x.strip()][:10]
            packages.append({'name': cs[0], 'includes_raw': cs[1][:200]})
        # 추천구성: 선택목록 + 합계(마지막 큰 숫자)
        if len(cs) >= 2 and re.search(r'파퓰러|파노라마|선택|추천', j):
            tot = re.findall(r'([1-9]\d{0,2}(?:,\d{3})+)', cs[-1])
            if tot and ('패키지' in j or '선루프' in j):
                recommended.append({'items': cs[:-1] if tot else cs, 'total': int(tot[-1].replace(',', ''))})
        # 옵션명 후보
        for c in cs:
            if re.match(r'^[가-힣A-Za-z0-9][가-힣A-Za-z0-9 &·\-/()]{1,26}$', c) and re.search(r'터보|48V|인치|컬러|글로시|매트|셀렉션|패키지|선루프|사운드|캠|스텝|필름|매트|디스플레이|AWD|인승', c):
                if c not in opt_names:
                    opt_names.append(c)
    return {'basePrice': base, 'priceRow': price_row, 'packages': packages,
            'recommended': recommended[:6], 'optionNames': opt_names[:40]}


if __name__ == '__main__':
    path, model, outp = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
    r = parse(path); r['model'] = model
    payload = json.dumps(r, ensure_ascii=False, indent=1)
    if outp:
        open(outp, 'w', encoding='utf-8').write(payload)
        sys.stderr.write(f'wrote {outp}: base={r["basePrice"]} prices={len(r["priceRow"])} opts={len(r["optionNames"])} rec={len(r["recommended"])}\n')
    else:
        sys.stdout.buffer.write(payload.encode('utf-8'))
