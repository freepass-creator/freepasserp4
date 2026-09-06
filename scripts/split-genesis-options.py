# -*- coding: utf-8 -*-
"""
mtops 제네시스 «선택품목» 셀을 구조분해한다 (사장님 2026-09-06 · GV80 문법 일반화).
  가격행(32개 등)이 옵션명과 1:1로 남김없이 맞아떨어지는지 «완전배정»을 자동검증한다 —
  이 완전배정이 GV80쿠페(코덱스 22개 일치)와 같은 급의 교차검증이다.
문법: 셀 안이 「섹션헤더 … 옵션명 기본사양|가격 … 옵션명 기본사양|가격」 흐름.
  섹션헤더 = 「필수 선택 사양_X」 「필수 선택 품목_X」 「선택 품목」 「Genuine Parts」.
  옵션 = «이름» + 「기본사양」(=0) 또는 «이름» + 가격.  ※ 뒤 각주는 이름/가격에서 떼어낸다.
출력: {sections:[{header, options:[{name, addWon, isDefault}]}], flatPrices:[...], priceRow:[...], mapOk}
사용: python scripts/split-genesis-options.py tmp/mtops/GV70.html GV70 tmp/gv70-split.json
"""
import re, sys, json, html

PRICE = r'([1-9]\d{0,2}(?:,\d{3})+)'
HEADERS = ['필수 선택 사양_', '필수 선택 품목_', '선택 품목', 'Genuine Parts', '기본 품목', '기본품목']

def cells_of(tr):
    return [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip()
            for c in re.findall(r'<t[dh][\s\S]*?</t[dh]>', tr)]

def strip_note(s):
    # ※ 각주, [엔진분기] 대괄호 안내를 이름에서 떼어낸다
    s = re.split(r'※', s)[0]
    return s.strip(' ,·-')

HEADER_RE = re.compile(r'(필수 선택 사양_[가-힣A-Za-z /&]{1,10}?(?= 기본사양|[가-힣]{2,} (?:2\.|3\.|가솔린|디젤|전기|2WD|후륜|5인승|글로시|스탠다드|\d{3}/))'
                       r'|필수 선택 품목_[가-힣A-Za-z /&]{1,12}?(?= 기본사양|[가-힣\[])'
                       r'|선택 품목(?= )|Genuine Parts(?= )|패키지 선택 품목)')

def split_cell(text):
    """선택품목 셀 텍스트 → «가격 앞 텍스트=이름» 평면정렬. 헤더는 태그로만.
       가격/기본사양을 구분점으로 잘라, 각 조각의 «마지막 옵션명»을 붙인다(mapOk 순서 그대로)."""
    opts = []
    parts = re.findall(r'(.*?)(기본사양|' + PRICE + r')', text, re.S)
    for chunk, marker, price in parts:
        # 이 조각에서 섹션 헤더가 나오면 그 앞을 버리고 헤더 이후만 이름으로
        seg = chunk
        section = None
        for m in re.finditer(r'(필수 선택 사양_[가-힣A-Za-z /&]{1,10}|필수 선택 품목_[가-힣A-Za-z /&]{1,14}|선택 품목|Genuine Parts|패키지 선택 품목)', chunk):
            section = m.group(1)
            seg = chunk[m.end():]
        nm = strip_note(seg)
        nm = re.sub(r'^[\s,·:]+', '', nm)
        nm = re.sub(r'\s+', ' ', nm).strip(' ,·-:')
        if len(nm) > 70:
            nm = nm[-70:]
        row = {'name': nm}
        if section:
            row['section'] = section.strip()
        if marker == '기본사양':
            row['addWon'] = 0; row['isDefault'] = True
        else:
            row['addWon'] = int(price.replace(',', ''))
        opts.append(row)
    return opts

def parse(path):
    raw = open(path, encoding='utf-8', errors='ignore').read()
    rows = re.findall(r'<tr[\s\S]*?</tr>', raw)
    price_row, base, base35, sel_text, base_offset = [], None, None, '', 2
    for tr in rows:
        cs = [c for c in cells_of(tr) if c]
        if not cs:
            continue
        j = ' | '.join(cs)
        prices = re.findall(PRICE, j)
        if '기본 모델' in cs[0] and len(prices) >= 5:
            price_row = [int(p.replace(',', '')) for p in prices]
            base_cell = cs[0]
            # base 셀 안의 가격 토큰 수 = base 변형 개수(개소세 5%/3.5%, EV는 세제혜택 전/후까지 4개)
            base_prices = re.findall(PRICE, base_cell)
            base_offset = len(base_prices)
            is_ev = '세제혜택' in base_cell
            if is_ev:
                # EV: «세제혜택 후» 값을 base로. (개소세 5% 후) 첫 값.
                after = re.findall(r'세제혜택\s*(?:적용\s*)?후[^0-9]*' + PRICE, base_cell)
                base = int(after[0].replace(',', '')) if after else int(base_prices[1].replace(',', ''))
                base35 = int(after[1].replace(',', '')) if len(after) > 1 else None
            else:
                b5 = re.findall(r'개별소비세\s*5%[^0-9]*' + PRICE, base_cell)
                b35 = re.findall(r'개별소비세\s*3\.5%[^0-9]*' + PRICE, base_cell)
                base = int(b5[0].replace(',', '')) if b5 else price_row[0]
                base35 = int(b35[0].replace(',', '')) if b35 else (price_row[1] if len(price_row) > 1 else None)
            sel_text = cs[-1] if len(cs) >= 2 else ''
    opts = split_cell(sel_text)
    flat = [o['addWon'] for o in opts if o['addWon'] > 0]
    tail = price_row[base_offset:] if price_row else []
    map_ok = (flat == tail)
    return {'basePrice': base, 'basePriceTax35': base35, 'priceRow': price_row, 'baseOffset': base_offset,
            'flatPrices': flat, 'tail': tail, 'mapOk': map_ok, 'options': opts}


if __name__ == '__main__':
    path, model, outp = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
    r = parse(path); r['model'] = model
    payload = json.dumps(r, ensure_ascii=False, indent=1)
    if outp:
        open(outp, 'w', encoding='utf-8').write(payload)
        sys.stderr.write(f'{model}: base={r["basePrice"]} tail={len(r["tail"])} flat={len(r["flatPrices"])} mapOk={r["mapOk"]}\n')
    else:
        sys.stdout.buffer.write(payload.encode('utf-8'))
