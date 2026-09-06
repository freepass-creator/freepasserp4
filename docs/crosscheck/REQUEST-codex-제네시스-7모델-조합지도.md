# 코덱스 교차검증 요청 — 제네시스 7모델 조합지도 (2026-09-06)

## 검증 대상
`data/new-car/genesis-config.json` (models 7: gv80-coupe, gv80, gv70, g70, g80, g90, gv60)

## 무엇을 만들었나 (클로드)
mtops 가격표(`tmp/mtops/{Model}.html`)의 「기본 모델」 가격행이 옵션명과 1:1로 남김없이
맞아떨어지는지 기계검증(`scripts/split-genesis-options.py`, mapOk). 남는 숫자 0 = 완전배정.
→ `scripts/splits-to-genesis-config.mjs` 로 config 엔트리 생성. GV80/쿠페는 손검증 정밀본.

## 검증해 달라 (검사만 · 고치지 마라 — 어긋난 것을 보고하면 클로드가 고친다)
1. **가격행 완전배정 재현** — 각 모델 mtops HTML을 «독립»으로 파싱해, config 의
   exclusiveGroups + freeOptions 의 addWon/price 집합이 「기본 모델」 가격행(base offset 제외)과
   순서·개수·값이 일치하는가. 특히:
   - GV70 base offset=1 (개소세 단일) · GV60 EV base offset=4 (세제혜택 전/후 × 개소세 2단, base=세제혜택 후 59,900,000) 가 맞나.
   - 이름조각 잘림(예 G80 「인」=스탠다드 디자인, 「드 디자인」=스포츠 스탠다드)이 «가격»에는 영향 없는지.
2. **min~max 정직성** — min=base 맞나. maxCandidate=배타상한+자유합이 «단순합»이라
   패키지 포함중복(파퓰러 등)·상호배제로 과대인 것을 config 가 명시(maxStatus)하는가.
   G90 max후보 198,550,000 이 롱휠베이스/리무진 옵션 중복인지 확인.
3. **엔진분기 휠** — 휠&타이어가 엔진별로 기본휠이 갈리는데(2.5T 19인치 vs 3.5T 20인치),
   배타상한 계산이 엔진을 이중계상하지 않는지.
4. **표본 역산** — 각 모델 추천구성/실제 견적 예가 있으면 config 로 재계산해 대조.

## 판정
`tmp/codex-genesis7-verdict.md` 에 모델별 적합/부적합 + 어긋난 값(있으면)만.
