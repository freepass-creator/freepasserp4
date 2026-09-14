import assert from 'node:assert/strict';
import { sonokongSelectedOptionsFromDescription as pick } from '../lib/option-normalizer.mjs';

assert.equal(
  pick('스포티지 2.0 디젤 시그니처 그래비티 2WD A/T\n프리미엄 옵션-빌트인 캠, 모니터링, 프리미엄'),
  '빌트인 캠, 모니터링, 프리미엄',
);
assert.equal(
  pick('카니발 자가용 9인승 디젤 2.2 노블레스 A/T\r\n기본형-듀얼 선루프, 모니터링팩, 스타일, 내비게이션'),
  '듀얼 선루프, 모니터링팩, 스타일, 내비게이션',
);
assert.equal(pick('팰리세이드 LX2 F/L 가솔린 3.8 2WD 7인승 프레스티지 컴포트퀼팅나파'), '');
assert.equal(pick(null), '');

console.log('손오공 설명 선택옵션 규격화: 4/4 PASS');
