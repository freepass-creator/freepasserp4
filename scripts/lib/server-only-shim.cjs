/**
 * Next의 `server-only` 표식 모듈을 독립 tsx 운영 스크립트에서도 읽게 하는 require hook.
 * 앱 런타임 동작은 바꾸지 않고, scripts/*에서 서버 모듈을 불러올 때만 사용한다.
 */
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};
