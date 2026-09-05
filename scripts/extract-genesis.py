# -*- coding: utf-8 -*-
"""
제네시스 가격표 PDF → «기본모델 가격 + 옵션(필수/선택) 가격». 제네시스는 트림계층이 아니라
  «기본모델 + 구성»이라 현대/기아와 데이터 모양이 다르다.
  - 기본가 = 「판매가격」 다음 「NN,NNN,NNN」(변형=엔진별 여러 개일 수 있음).
  - 옵션 = 「옵션명」 다음/같은 줄 「[6,600,000]」(원). 「[기본사양]」=필수인데 기본 포함(0).
  - 「필수 선택 사양」 이후 = mandatory(엔진/구동/컬러/휠·내장), 「선택 사양」 이후 = optional.
출력 JSON: {model, basePrices:[..], options:[{name, price, group:'필수'|'선택'}]}
사용: python scripts/extract-genesis.py tmp/newcar-pdf/gen_g80.pdf G80 out.json
"""
import fitz, sys, json, re

BR = re.compile(r'\[([\d,]+)\]')              # [6,600,000]
BASIC = re.compile(r'\[기본사양\]|\[기본\]')
CARPRICE = re.compile(r'^([1-9]\d?,\d{3},\d{3})$')   # 60,630,000 (천만~억)
NOISE = re.compile(r'공급가액|부가세|주요\s*사양|파워트레인|외관|내장|안전|편의|시트|인포테인먼트|'
                   r'개별\s*소비세|최종|견적|PRICE|GENESIS|Genesis|단위|^모델$|^엔진$|^구동|^외장|^내장|^휠')
# 옵션명 후보 — 너무 길거나 설명문(쉼표 많음)은 제외
OPTNAME = re.compile(r'^[가-힣A-Za-z0-9][가-힣A-Za-z0-9 ·&/\-\+()]{1,28}$')


def won(s):
    m = BR.search(s)
    return int(m.group(1).replace(',', '')) if m else None


def extract(pdf_path):
    d = fitz.open(pdf_path)
    lines = []
    for p in d:
        lines += [l.strip() for l in p.get_text().split('\n')]
    base = []
    options = []
    group = '기본'
    for i, L in enumerate(lines):
        if '필수 선택' in L:
            group = '필수'; continue
        if re.search(r'^선택\s*사양|선택 품목', L):
            group = '선택'; continue
        # 기본 차량가
        cm = CARPRICE.match(L)
        if cm and int(cm.group(1).replace(',', '')) >= 20_000_000:
            v = int(cm.group(1).replace(',', ''))
            if v not in base:
                base.append(v)
            continue
        # 옵션: 이름 줄 다음 3줄 안에 [가격] 또는 [기본사양]
        if OPTNAME.match(L) and not NOISE.search(L) and not CARPRICE.match(L):
            price = None
            for j in range(i + 1, min(i + 4, len(lines))):
                if OPTNAME.match(lines[j]) and not BR.search(lines[j]) and '[' not in lines[j]:
                    break
                if BASIC.search(lines[j]):
                    price = 0; break
                p = won(lines[j])
                if p is not None:
                    price = p; break
            if price is not None and 0 <= price <= 30_000_000:
                nm = L.strip()
                options.append({'name': nm, 'price': price, 'group': group})
    # 옵션 이름 중복 제거(같은 이름·가격)
    seen = {}
    for o in options:
        seen[f"{o['name']}|{o['price']}"] = o
    return {'basePrices': base, 'options': list(seen.values())}


if __name__ == '__main__':
    pdf, model, outp = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
    r = extract(pdf)
    payload = json.dumps({'model': model, **r}, ensure_ascii=False, indent=1)
    if outp:
        open(outp, 'w', encoding='utf-8').write(payload)
        sys.stderr.write(f'wrote {outp}: base={r["basePrices"]} opts={len(r["options"])}\n')
    else:
        sys.stdout.buffer.write(payload.encode('utf-8'))
