# ERP4 Production Release / Recovery

최종: 2026-09-19  
상태: CURRENT

## 1. 왜 별도 복구 경로가 필요한가

ERP4는 기본적으로 GitHub main push → Vercel Git Integration으로 자동 배포한다.

하지만 아래 셋은 서로 다른 상태다.

1. GitHub main에 커밋이 있다.
2. Vercel deployment가 READY다.
3. `freepasserp.com`이 실제로 그 커밋을 서빙한다.

과거에도 1은 성공했지만 2가 실패해 운영이 옛 화면을 계속 서빙한 적이 있다.  
또 2가 성공해도 custom domain alias/DNS가 다른 deployment/project를 가리키면 3은 실패할 수 있다.

**운영 배포 완료 = `/api/version.sha`가 현재 main SHA와 일치할 때만.**

## 2. 기본 경로

평상시:

```
PR → CI → main merge → Vercel Git Integration → /api/version 검증
```

확인:

```bash
npm run deploy:verify
```

두 운영 주소를 모두 확인한다.

- https://freepasserp.com/api/version
- https://www.freepasserp.com/api/version

## 3. 강제 production 배포

Git 자동배포가 이상하거나 운영 SHA가 main을 못 따라올 때:

```bash
npm run deploy:prod
```

이 명령은 다음을 순서대로 수행한다.

1. 작업트리 clean 확인
2. 현재 branch가 main인지 확인
3. HEAD = origin/main 확인
4. `.vercel/project.json` 링크 확인
5. `vercel pull --environment=production`
6. `vercel build --prod`
7. `vercel deploy --prebuilt --prod`
8. 운영 `/api/version`의 SHA가 main과 일치하는지 확인

프로젝트 링크가 없으면 먼저:

```bash
npx vercel link --yes --project freepasserp4 --scope freepass-projects
```

## 4. GitHub에서 버튼으로 강제 배포

로컬 운영 PC가 없어도 GitHub Actions의 **Production Deploy Recovery** 워크플로를 수동 실행할 수 있다.

필수 repository secret:

- `VERCEL_TOKEN`

워크플로는 main을 checkout하고 `freepasserp4` Vercel 프로젝트에 명시적으로 link한 뒤,
같은 `deploy:prod` 스크립트를 실행한다. 즉 로컬 경로와 GitHub 복구 경로가 서로 다른 배포 로직을 갖지 않는다.

`repair_alias=true`는 deployment 자체가 정상인데 custom domain alias만 늦거나 잘못 붙은 것이 명확할 때만 쓴다.

## 5. deployment는 성공했는데 custom domain만 옛 화면일 때

먼저:

```bash
npx vercel alias ls
npx vercel ls freepasserp4
npx vercel inspect <deployment-url>
```

정상 deployment가 확인됐고 **alias만 잘못 붙은 것이 명확할 때만**:

```bash
npm run deploy:prod -- --repair-alias
```

이 옵션은 방금 생성한 production deployment를 다음 두 주소에 다시 연결한 뒤 SHA를 재검증한다.

- `freepasserp.com`
- `www.freepasserp.com`

DNS가 다른 프로젝트/서비스를 가리키는 경우 alias 재설정만으로 해결되지 않을 수 있다.  
그 경우 Vercel project domain 설정과 DNS를 먼저 바로잡는다.

## 6. 환경변수 문제

배포가 실패하거나 preview/production 결과가 다르면:

```bash
npm run env:diff
```

값은 출력하지 않고 production / preview / development 간 존재 여부와 로컬 차이만 보여준다.

과거 실제 장애:
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` 누락
- Git main은 최신인데 Vercel build가 실패해 운영은 이전 deployment 유지

## 7. 판정 규칙

다음 표현은 금지한다.

- "머지됐으니 배포 완료"
- "Vercel success니까 운영 반영 완료"
- "preview가 최신이니 production도 최신"

다음 증거가 있어야 완료다.

```
main SHA == freepasserp.com/api/version.sha
         == www.freepasserp.com/api/version.sha
```

## 8. AI Core와의 역할

- ERP4 저장소: 실제 배포 명령·도메인·환경·release 규칙의 정본
- AI Core: 공통 release gate / proof / rollback 원칙을 관리
- AI Core가 ERP4의 Vercel 설정을 복제해 두 번째 SSOT로 만들지 않는다
- 다른 프로젝트도 같은 패턴을 재사용하되 실제 deploy target은 각 프로젝트가 소유한다

## 한 문장

> **자동배포는 편의 기능이고, 운영 SHA 일치가 배포 완료의 증거다.**
