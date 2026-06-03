# game2 Firebase setup

Project: `game2-6c82e`

## Console setup

1. Firebase Console에서 `game2-6c82e` 프로젝트를 엽니다.
2. Build > Authentication > Sign-in method에서 `Anonymous` 제공자를 켭니다.
3. Build > Realtime Database에서 데이터베이스를 만듭니다.
4. Realtime Database URL을 복사해서 `firebase-config.js`의 `databaseURL`에 넣습니다.
5. Project settings > General > Your apps에서 Web app을 등록하고 Firebase config 값을 `firebase-config.js`에 채웁니다.

`databaseURL`은 프로젝트/지역에 따라 아래 둘 중 하나처럼 생길 수 있습니다. 콘솔에 표시되는 값을 그대로 사용하세요.

```js
databaseURL: "https://game2-6c82e-default-rtdb.firebaseio.com"
databaseURL: "https://game2-6c82e-default-rtdb.asia-southeast1.firebasedatabase.app"
```

## Deploy

```powershell
cd "C:\Users\sam\Documents\New project\game2"
firebase deploy --only hosting,database
```

## Data paths

- `presence/{uid}/{connectionId}`: 현재 접속 세션입니다. 접속이 끊기면 `onDisconnect`로 제거됩니다.
- `leaderboard/{uid}`: 익명 사용자의 최고 점수 1개입니다. 더 높은 점수만 덮어쓸 수 있습니다.
- 기록창은 `score` 기준으로 최대 10순위까지 표시합니다.

## Notes

- 이미지는 Firebase Storage에 저장하지 않습니다. 앱은 Picsum URL을 사용하므로 Hosting 배포 용량이 작습니다.
- Firebase config의 `apiKey`는 일반적인 웹 앱 식별 값이며 비밀번호가 아닙니다. 그래도 운영 시 Firebase Console에서 승인된 도메인을 확인하세요.
- 공개 게임에서 완전한 남용 방지가 필요해지면 App Check나 Cloud Functions를 추가하는 편이 좋습니다.
