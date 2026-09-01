/**
 * **폐기.** 세부모델에서 개발코드를 떼지 않는다 (08-23 오후 · K5 DL3 · 싼타페 MX5).
 *
 * 정본 = 모델+코드. `디 올 뉴`만 aliases.
 * 옛 「AI 정제」 떨기 줄은 `npx tsx tmp/revert-submodel-code-strip.mts --apply` 로 지운다.
 *
 *   npx tsx scripts/add-submodel-code-strip-rules.mts   # 거부만 한다
 */
console.error('거부: 세부모델 개발코드는 떼지 않는다 (SUBMODEL_NAME_RULE = model+gen_code).');
console.error('  K5 DL3 · 싼타페 MX5 · 그랜저 GN7 을 다시 깎지 마라.');
console.error('  되돌리려면 npx tsx tmp/revert-submodel-code-strip.mts --apply');
process.exit(1);
