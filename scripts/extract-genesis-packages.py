# -*- coding: utf-8 -*-
"""
mtops 제네시스 «패키지 선택 품목» 상세행 → data/new-car/genesis-pkg-includes.json.
  (정밀 max 재료 — 패키지가 어떤 «포함품»을 담는지. 할인번들 판별에 씀.)
  splits-to-genesis-config.mjs 가 이 파일을 읽어 «번들(다른 유료옵션 2개↑ 포함)»을 골라
  풀옵션 max 에서 번들을 빼고 개별을 다 더한다(개별합 ≥ 번들가).
사용: python scripts/extract-genesis-packages.py   (tmp/mtops/*.html 를 읽어 저장소에 씀)
"""
import re, html, json, os

MODELS = ['GV80', 'GV70', 'G70', 'G80', 'G90', 'GV60', 'GV80-Coupe']

def cells(tr):
    return [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip()
            for c in re.findall(r'<t[dh][\s\S]*?</t[dh]>', tr)]

def parse(path):
    raw = open(path, encoding='utf-8', errors='ignore').read()
    rows = re.findall(r'<tr[\s\S]*?</tr>', raw)
    pkgs, in_sec = [], False
    for tr in rows:
        cs = [c for c in cells(tr) if c]
        if not cs:
            continue
        if '패키지 선택 품목' in cs[0]:
            in_sec = True; continue
        if len(cs) == 1 and '기타' in cs[0]:
            in_sec = False
        if in_sec and len(cs) == 2 and re.search(r'패키지|셀렉션|디자인', cs[0]) and len(cs[0]) < 30:
            pkgs.append({'name': cs[0], 'includes': cs[1][:300]})
    return pkgs

if __name__ == '__main__':
    out = {}
    for m in MODELS:
        p = f'tmp/mtops/{m}.html'
        out[m] = parse(p) if os.path.exists(p) else []
    dest = 'data/new-car/genesis-pkg-includes.json'
    json.dump(out, open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for m, v in out.items():
        print(f'{m}: {len(v)} 패키지/디자인 상세행')
    print('wrote', dest)
