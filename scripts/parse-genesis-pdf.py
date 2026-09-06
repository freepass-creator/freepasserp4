# -*- coding: utf-8 -*-
"""
제네시스 공식 가격표 PDF 텍스트(tmp/newcar-pdf/gen_*.txt) → 구조 해독. (사장님 2026-09-06 「빨리, 코덱스 합의만 확정」)
  포맷: 「기본 모델\n<price>」 · 필수 선택 사양(그룹헤더 + 옵션명 + [기본사양]|[price]) · 선택 품목(패키지 + [price]) ·
  「GENESIS X BLACK」 별도 섹션(블랙 base + 필수).
출력: {model, base, mandatory:[{group,options:[{name,add}]}], free:[{name,price}], black:{base,mandatory,...}}
  ※ 코덱스 검증용 «재료». 원단위 정확 추출이 목표. 최종 확정은 코덱스 합의 후.
사용: python scripts/parse-genesis-pdf.py           (전 모델 → tmp/genesis-pdf-parsed.json)
"""
import re, json, os

MODELS = ['gen_gv80', 'gen_gv70', 'gen_g70', 'gen_g80', 'gen_g90', 'gen_gv60', 'gen_gv70-ev', 'gen_g80-ev']
GROUP_HEADS = ['엔진', '구동 타입', '인승', '외장 컬러', '휠 & 타이어', '내장 디자인', '트림', 'PE 시스템', '스포츠', '배터리']
PRICE = re.compile(r'^\[([0-9,]+)\]$')
BASE0 = re.compile(r'^\[기본사양\]$')

def money(s):
    return int(s.replace(',', ''))

def parse_section(lines):
    """필수 선택 구간 라인들 → 그룹별 옵션. [price]/[기본사양] 앞의 «옵션명»을 붙인다."""
    groups = []
    cur_group = None
    pending = []  # 아직 가격표식 안 만난 이름 후보들
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        # 그룹 헤더?
        if s in ('엔진', '구동 타입', '인승', '외장 컬러', '휠 & 타이어', '내장 디자인', '트림', 'PE 시스템 및 성능', '스포츠', '배터리 타입'):
            cur_group = {'group': s, 'options': []}
            groups.append(cur_group)
            pending = []
            continue
        m = PRICE.match(s)
        b = BASE0.match(s)
        if m or b:
            # 직전 이름 후보 중 «※·주석·엔진분류표시»가 아닌 마지막 실명
            name = ''
            for cand in reversed(pending):
                if not cand.startswith('※') and not cand.startswith('-') and not cand.startswith('▶') and len(cand) < 60:
                    name = cand; break
            if not name and pending:
                name = pending[-1]
            add = 0 if b else money(m.group(1))
            if cur_group is None:
                cur_group = {'group': '(미분류)', 'options': []}
                groups.append(cur_group)
            cur_group['options'].append({'name': name[:50], 'add': add, 'default': bool(b)})
            pending = []
        else:
            pending.append(s)
    return groups

def parse_free(lines):
    """선택 품목 구간 → 옵션·패키지 [price]. 이름 = [price] 직전 실명(▶ 설명 제외)."""
    out = []
    pending = []
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        m = PRICE.match(s)
        if m:
            name = ''
            for cand in reversed(pending):
                if not cand.startswith('※') and not cand.startswith('▶') and not cand.startswith('-') and len(cand) < 50:
                    name = cand; break
            out.append({'name': name[:50], 'price': money(m.group(1))})
            pending = []
        else:
            pending.append(s)
    return out

def parse_model(path):
    raw = open(path, encoding='utf-8', errors='ignore').read()
    lines = raw.split('\n')
    # 블랙 섹션 분리
    black_idx = next((i for i, l in enumerate(lines) if re.search(r'GENESIS .*BLACK', l, re.I) and '모델' in ''.join(lines[i:i+3])), None)
    # base = 첫 「기본 모델」 다음 숫자
    base = None
    for i, l in enumerate(lines):
        if l.strip() == '기본 모델':
            for j in range(i + 1, min(i + 4, len(lines))):
                mm = re.match(r'^([0-9]{2,3},[0-9]{3},[0-9]{3})$', lines[j].strip())
                if mm:
                    base = money(mm.group(1)); break
            if base:
                break
    # 필수/선택 구간
    def between(startpat, endpats, region):
        s = next((i for i, l in enumerate(region) if re.search(startpat, l)), None)
        if s is None:
            return []
        e = next((i for i, l in enumerate(region) if i > s and any(re.search(p, l) for p in endpats)), len(region))
        return region[s + 1:e]
    std_region = lines[:black_idx] if black_idx else lines
    mand = parse_section(between(r'필수 선택 사양', [r'선택 품목'], std_region))
    free = parse_free(between(r'선택 품목', [r'추천 차량', r'Exterior colors', r'specification', r'GENESIS .*BLACK'], std_region))
    result = {'base': base, 'mandatory': mand, 'free': free}
    if black_idx:
        blk = lines[black_idx:]
        bbase = None
        for i, l in enumerate(blk):
            if l.strip() == '기본 모델':
                for j in range(i + 1, min(i + 4, len(blk))):
                    mm = re.match(r'^([0-9]{2,3},[0-9]{3},[0-9]{3})$', blk[j].strip())
                    if mm:
                        bbase = money(mm.group(1)); break
                break
        bmand = parse_section(between(r'필수 선택 사양', [r'선택 품목', r'WHEEL', r'specification'], blk))
        result['black'] = {'base': bbase, 'mandatory': bmand}
    return result

if __name__ == '__main__':
    out = {}
    for m in MODELS:
        p = f'tmp/newcar-pdf/{m}.txt'
        if os.path.exists(p):
            out[m] = parse_model(p)
    json.dump(out, open('tmp/genesis-pdf-parsed.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for m, r in out.items():
        nb = sum(len(g['options']) for g in r['mandatory'])
        print(f"{m}: base {r['base']} · 필수그룹 {len(r['mandatory'])}({nb}옵션) · 선택 {len(r['free'])} · 블랙 {'O base '+str(r['black']['base']) if r.get('black') else 'X'}")
