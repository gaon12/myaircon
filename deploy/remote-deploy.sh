#!/usr/bin/env bash
#
# 서버에서 도는 부분. .github/workflows/deploy.yml 이 이 파일을 ssh의 stdin으로
# 흘려보낸다. 서버에 스크립트를 미리 깔아 둘 필요가 없고, 배포 절차가 코드와
# 같은 커밋에 담긴다 -- 롤백하면 배포 방식도 함께 돌아간다.
#
# 필요한 환경변수 (워크플로가 넣어 준다)
#   DEPLOY_PATH  체크아웃해 둔 디렉터리
#   PM2_NAME     pm2 프로세스 이름
#   HEALTH_URL   배포 후 확인할 주소
#   SHA          배포할 커밋
#
# 손으로 돌려볼 수도 있다:
#   DEPLOY_PATH=/srv/myaircon PM2_NAME=myaircon \
#   HEALTH_URL=http://127.0.0.1:8080/healthz SHA=origin/main \
#     bash deploy/remote-deploy.sh

set -euo pipefail

cd "${DEPLOY_PATH}"

# 지금 떠 있는 것이 무엇인지 먼저 적어 둔다. 실패하면 여기로 돌아온다.
PREVIOUS="$(git rev-parse HEAD)"
echo "현재: ${PREVIOUS}"
echo "목표: ${SHA}"

rollback() {
  # 되돌리는 도중 무엇이 실패하든 여기로 다시 들어오면 안 된다.
  trap - ERR
  set +e
  echo "::warning::배포 실패. ${PREVIOUS} 로 되돌립니다."
  git reset --hard "${PREVIOUS}"
  npm ci --no-audit --no-fund --ignore-scripts
  npm run build
  pm2 reload "${PM2_NAME}" --update-env
  echo "::warning::되돌렸습니다: $(git rev-parse --short HEAD)"
}

git fetch --prune origin
# pull이 아니라 reset이다. pull은 서버에 남은 손댄 파일과 충돌하면 멈추고,
# 최악의 경우 머지 커밋을 만든다. 배포된 서버의 작업 트리는 커밋을 그대로
# 비추기만 하면 된다.
git reset --hard "${SHA}"
# 추적되지 않는 찌꺼기도 치우되, 실행 중 만들어지는 것은 남긴다.
#   data/         공유 온도·통계·차단 목록 (여기 지우면 서비스 상태가 날아간다)
#   node_modules/ 아래에서 npm ci가 알아서 맞춘다
git clean -fd -e data -e node_modules

trap rollback ERR

# devDependencies가 있어야 tsc가 돈다. prepare 훅이 install 도중에 빌드를
# 돌리지만, 실패 지점을 구분하려고 여기서는 끄고 아래에서 따로 부른다.
npm ci --no-audit --no-fund --ignore-scripts
npm run build

# reload는 무중단 교체, start는 처음 올릴 때. describe로 갈라 준다.
if pm2 describe "${PM2_NAME}" > /dev/null 2>&1; then
  pm2 reload "${PM2_NAME}" --update-env
else
  # npm start 로 띄우지 않는다. 그러면 prestart 훅 때문에 pm2가 재시작할
  # 때마다 tsc가 다시 돈다. 산출물은 위에서 이미 만들었다.
  pm2 start dist/server/server.js --name "${PM2_NAME}" --update-env
fi
pm2 save

# 떴다고 pm2가 말하는 것과 실제로 응답하는 것은 다르다. 확인한다.
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 3 "${HEALTH_URL}" > /dev/null; then
    trap - ERR
    echo "배포 완료: $(git rev-parse --short HEAD)"
    curl -fsS --max-time 3 "${HEALTH_URL}"
    echo
    exit 0
  fi
  echo "health check 대기 ${attempt}/20"
  sleep 2
done

echo "::error::health check가 40초 안에 통과하지 못했습니다: ${HEALTH_URL}" >&2
pm2 logs "${PM2_NAME}" --lines 50 --nostream || true
# 명시적 exit는 ERR 트랩을 태우지 않으므로 직접 부른다. 새 버전이 응답하지
# 않는 것은 롤백해야 하는 상황 그 자체다.
rollback
exit 1
