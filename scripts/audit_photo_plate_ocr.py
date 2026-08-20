# -*- coding: utf-8 -*-
"""**사진 전수검사** — 폴더 이름의 차량번호와 사진 속 번호판이 같은지 OCR 로 확인한다.

★사장님 2026-08-20 「니가 OCR 이랑 전수검사해서 사진이랑 폴더 잘못된 거 찾아낼 수 있지 않나?」

사용:
  python scripts/audit_photo_plate_ocr.py <사진루트> [--per 3] [--out tmp/photo-ocr-audit.json]
    <사진루트> 아래 「<공급사>/<차량번호 …>/<사진들>」 구조를 그대로 읽는다(tmp/pics 가 그 모양).
판정:
  맞음      — 읽힌 번호판 중 폴더 번호와 같은 것이 있다
  숫자만맞음 — 한글은 못 읽었지만 앞뒤 숫자가 같다(번호판 맞음으로 본다)
  다름      — 읽힌 번호판이 있는데 폴더 번호와 다르다  ← 사진이 남의 차
  못읽음    — 어느 장에서도 번호판을 못 읽었다(각도·가림 — 사람이 볼 것)
"""
import glob
import json
import os
import re
import sys
import warnings

warnings.filterwarnings('ignore')
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

PLATE = re.compile(r'(\d{2,3})\s*([가-힣])\s*(\d{4})')
DIGITS = re.compile(r'(\d{2,3})\s*[가-힣A-Za-z]?\s*(\d{4})')
DIGIT_FIX = str.maketrans({'O': '0', 'o': '0', 'D': '0', 'I': '1', 'l': '1', '|': '1', 'S': '5', 'B': '8', 'Z': '2'})
FOLDER_PLATE = re.compile(r'(\d{2,3}[가-힣]\d{4})')


def read_plates(text: str):
    cleaned = text.translate(DIGIT_FIX)
    full = {f'{m.group(1)}{m.group(2)}{m.group(3)}' for m in PLATE.finditer(cleaned)}
    digits = {f'{m.group(1)}-{m.group(2)}' for m in DIGITS.finditer(cleaned)}
    return full, digits


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    root = args[0] if args else 'tmp/pics'
    per = 3
    out_path = 'tmp/photo-ocr-audit.json'
    for i, a in enumerate(sys.argv):
        if a == '--per' and i + 1 < len(sys.argv):
            per = int(sys.argv[i + 1])
        if a == '--out' and i + 1 < len(sys.argv):
            out_path = sys.argv[i + 1]

    folders = [d for d in glob.glob(os.path.join(root, '*', '*')) if os.path.isdir(d)]
    print(f'■ 폴더 {len(folders)}개 · 폴더마다 사진 {per}장까지 읽는다', flush=True)

    import cv2
    import numpy as np
    import easyocr
    import torch
    reader = easyocr.Reader(['ko', 'en'], gpu=torch.cuda.is_available(), verbose=False)
    print(f'   OCR 준비됨(GPU {torch.cuda.is_available()})', flush=True)

    rows = []
    tally = {}
    for n, folder in enumerate(sorted(folders), 1):
        name = os.path.basename(folder)
        want = (FOLDER_PLATE.search(name) or [None])
        want = want.group(1) if hasattr(want, 'group') else ''
        images = sorted([p for p in glob.glob(os.path.join(folder, '*')) if p.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))])[:per]
        found, foundDigits, texts = set(), set(), []
        for path in images:
            try:
                with open(path, 'rb') as fh:
                    buf = np.frombuffer(fh.read(), dtype=np.uint8)
                img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                if img is None:
                    continue
                lines = reader.readtext(img, detail=0, paragraph=False)
                text = ' '.join(str(x) for x in lines)
                texts.append(text[:120])
                full, digits = read_plates(text)
                found |= full
                foundDigits |= digits
            except Exception as exc:
                texts.append(f'ERR {exc}'[:120])
        wantDigits = ''
        if want:
            m = FOLDER_PLATE.search(want)
            wantDigits = f'{want[:len(want) - 5]}-{want[-4:]}' if m else ''
        if not want:
            verdict = '폴더번호없음'
        elif want in found:
            verdict = '맞음'
        elif wantDigits and wantDigits in foundDigits:
            verdict = '숫자만맞음'
        elif found:
            verdict = '다름'
        else:
            verdict = '못읽음'
        tally[verdict] = tally.get(verdict, 0) + 1
        rows.append({'folder': name, 'supplier': os.path.basename(os.path.dirname(folder)), 'want': want,
                     'found': sorted(found), 'foundDigits': sorted(foundDigits), 'verdict': verdict,
                     'images': len(images), 'texts': texts})
        if n % 20 == 0 or verdict == '다름':
            print(f'   {n}/{len(folders)} {name[:28]} → {verdict} {sorted(found)[:3]}', flush=True)

    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump({'root': root, 'per': per, 'tally': tally, 'rows': rows}, fh, ensure_ascii=False, indent=1)
    print(f'\n■ 판정 {tally}')
    for r in rows:
        if r['verdict'] == '다름':
            print(f"   다름: {r['supplier']}/{r['folder']} → 사진 속 번호 {r['found']}")
    print(f'보고 {out_path}')


if __name__ == '__main__':
    main()
