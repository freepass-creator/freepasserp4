# -*- coding: utf-8 -*-
"""
제네시스 «옵션 조합 모델» 좌표 파서 — 「필수 선택 사양」의 배타그룹(택1)을 «분류·그룹·선택지·가격»으로 복원한다.
  (사장님 2026-09-06: 각 모델의 풀옵션·배타그룹을 명확히 정의. 코덱스 청사진 반영.)

제네시스 필수선택은 3열 배타표:
  기본 분류(왼쪽 엔진/구동/외장컬러 + 가운데 휠&타이어/내장디자인) · 스포츠 분류(오른쪽).
  각 그룹 헤더(엔진·구동 타입·외장 컬러·휠 & 타이어·내장 디자인) 아래 「선택지 … [가격]/[기본사양]」.

출력 스키마(코덱스 반영):
  { model, baseOffer:{label, amountWon}, classes:['기본','스포츠'],
    groups:[ {group, class, engine?, choices:[{label, addWon, isDefault}]} ],
    freeOptions:[{name, won, group:'선택'}], rulesRaw:[...], evidence:{page} }
※ 이건 «필수선택 배타그룹»만. 선택품목(자유)은 extract-genesis 의 선택 파트를 이어 붙인다(별도).
사용: python scripts/parse-genesis-config.py tmp/newcar-pdf/gen_g80.pdf g80 out.json
"""
import fitz, sys, json, re

WON = re.compile(r'\[([\d,]+)\]')
BASIC = re.compile(r'\[기본사양\]|\[기본\]|\[추가\s*비용\s*없음\]')
GROUP_HDR = re.compile(r'^(엔진|구동\s*타입|외장\s*컬러|휠\s*&?\s*타이어|내장\s*디자인|스포츠|그래파이트)$')
# 선택지 이름 후보(그룹 헤더·가격·주석 제외)
NOISE = re.compile(r'^\[|^※|^-|기본 품목|필수 선택|판매가격|주\s*요|^\(무광|^\(유광|^\(')


def won(s):
    m = WON.search(s)
    return int(m.group(1).replace(',', '')) if m else None


def cluster_rows(words, tol=3):
    rows = {}
    for x0, y0, x1, y1, wd, *_ in words:
        rows.setdefault(round(y0 / tol) * tol, []).append((x0, wd.strip()))
    return [(yk, sorted(rows[yk])) for yk in sorted(rows)]


def band(x):
    return '기본L' if x < 180 else ('기본M' if x < 490 else '스포츠R')


def parse(pdf_path):
    d = fitz.open(pdf_path)
    result = {'baseOffer': None, 'groups': [], 'freeOptions': [], 'rulesRaw': [], 'pages': []}
    base_amount = None
    for pno in range(len(d)):
        p = d[pno]; txt = p.get_text()
        # 기본가격(판매가격 다음 큰 수) — 첫 페이지 상단
        if base_amount is None:
            mnum = re.search(r'판매가격[\s\S]{0,40}?([1-9]\d{0,2},\d{3},\d{3})', txt)
            if mnum:
                base_amount = int(mnum.group(1).replace(',', ''))
        if '필수 선택' not in txt:
            continue
        result['pages'].append(pno)
        words = p.get_text('words')
        rows = cluster_rows(words)
        # 필수선택 구역만: 「필수 선택」 이후 ~ 「선택 품목」 전
        started = False
        # 그룹 문맥: band 별로 «현재 그룹명·현재 엔진»
        ctx = {'기본L': {'group': None}, '기본M': {'group': None, 'engine': None}, '스포츠R': {'group': None, 'engine': None}}
        for yk, cells in rows:
            line = ' '.join(t for _, t in cells)
            if '필수 선택' in line:
                started = True; continue
            if not started:
                continue
            if re.search(r'선택\s*품목|선택 사양', line):
                break
            if re.search(r'중복 선택 불가|적용 시|선택 시|동시 선택|불가', line):
                result['rulesRaw'].append(line.strip()); continue
            # 각 셀을 band 로 분류
            for x, t in cells:
                b = band(x)
                # 그룹 헤더?
                hdr = GROUP_HDR.match(re.sub(r'\s+', ' ', t).strip()) or GROUP_HDR.match(t.strip())
                # 헤더는 여러 단어로 쪼개질 수 있어(구동/타입) 행 전체로도 검사
            # 행 단위: band 별 왼쪽 이름 + 그 band 우측 가격
            for b in ['기본L', '기본M', '스포츠R']:
                bc = [(x, t) for x, t in cells if band(x) == b]
                if not bc:
                    continue
                btext = ' '.join(t for _, t in bc)
                # 그룹 헤더 감지(행에 그룹명만 있거나 포함)
                gh = re.search(r'(엔진|구동\s*타입|구동|외장\s*컬러|외장|휠\s*&?\s*타이어|내장\s*디자인|스포츠\s*패키지|스포츠)', btext)
                priced = won(btext); basic = bool(BASIC.search(btext))
                if gh and not priced and not basic and len(bc) <= 3:
                    g = gh.group(1).replace(' ', '')
                    g = {'구동': '구동타입', '외장': '외장컬러'}.get(g, g)
                    ctx[b]['group'] = g
                    continue
                # 엔진 문맥(가운데·오른쪽은 엔진별 하위표)
                em = re.search(r'가솔린\s*([23]\.\d)\s*터보', btext)
                if em and b != '기본L':
                    ctx[b]['engine'] = em.group(1)
                # 선택지 = 이름 + 가격/기본
                if (priced is not None or basic):
                    # 이름 = band 셀 중 가격/주석 아닌 앞부분
                    name_parts = [t for _, t in bc if not WON.search(t) and not BASIC.search(t) and not NOISE.match(t)]
                    name = ' '.join(name_parts).strip()
                    grp = ctx[b]['group']
                    cls = '스포츠' if b == 'ㅅ스포츠R' or b == '스포츠R' else '기본'
                    if name and grp:
                        result['groups'].append({'class': cls, 'group': grp, 'engine': ctx[b].get('engine'),
                                                 'choice': name[:40], 'addWon': 0 if basic else priced, 'isDefault': basic})
    result['baseOffer'] = {'label': '스탠다드', 'amountWon': base_amount}
    # 그룹 정리: (class,group,engine,choice) 중복 제거
    seen = {}
    for g in result['groups']:
        k = (g['class'], g['group'], g.get('engine'), g['choice'], g['addWon'])
        seen[k] = g
    result['groups'] = list(seen.values())
    return result


if __name__ == '__main__':
    pdf, model, outp = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else '')
    r = parse(pdf); r['model'] = model
    payload = json.dumps(r, ensure_ascii=False, indent=1)
    if outp:
        open(outp, 'w', encoding='utf-8').write(payload)
        sys.stderr.write(f'wrote {outp}: base={r["baseOffer"]} groups={len(r["groups"])}\n')
    else:
        sys.stdout.buffer.write(payload.encode('utf-8'))
