function isConfigReady(config) {
  return Boolean(
    config.apiKey &&
      config.appId &&
      config.databaseURL &&
      !config.apiKey.startsWith("PASTE_") &&
      !config.appId.startsWith("PASTE_") &&
      !config.databaseURL.startsWith("PASTE_"),
  );
}

function makeConnectionId() {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${randomPart}`;
}

function makeNickname(uid) {
  return `Player-${uid.slice(0, 4).toUpperCase()}`;
}

function snapshotToLeaderboard(snapshot) {
  const rows = [];
  snapshot.forEach((child) => {
    const row = {
      uid: child.key,
      ...child.val(),
    };

    if (Number.isFinite(row.score)) {
      rows.push(row);
    }
  });

  return rows.sort((a, b) => b.score - a.score).slice(0, 10);
}

function countPresence(snapshot) {
  let count = 0;
  snapshot.forEach((userSnapshot) => {
    userSnapshot.forEach(() => {
      count += 1;
    });
  });
  return count;
}

async function createRealtimeBridge(handlers = {}) {
  const firebaseConfig = window.game2FirebaseConfig || {};
  const firebaseOptions = window.game2FirebaseOptions || {};

  if (!isConfigReady(firebaseConfig)) {
    handlers.onStatus?.("Firebase 설정 대기 중");
    return {
      enabled: false,
      recordScore() {
        return Promise.resolve();
      },
    };
  }

  const version = firebaseOptions.sdkVersion;
  const [{ initializeApp }, authModule, databaseModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-database.js`),
  ]);

  const {
    getAuth,
    onAuthStateChanged,
    signInAnonymously,
  } = authModule;
  const {
    get,
    getDatabase,
    limitToLast,
    onDisconnect,
    onValue,
    orderByChild,
    query,
    ref,
    serverTimestamp,
    set,
  } = databaseModule;

  const app = initializeApp(firebaseConfig, firebaseOptions.appName);
  const auth = getAuth(app);
  const database = getDatabase(app);
  const connectionId = makeConnectionId();

  let uid = "";
  let nickname = "";
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  async function attachPresence() {
    const userPresenceRef = ref(database, `presence/${uid}/${connectionId}`);
    await onDisconnect(userPresenceRef).remove();
    await set(userPresenceRef, {
      online: true,
      updatedAt: serverTimestamp(),
    });
  }

  function watchPresence() {
    onValue(ref(database, "presence"), (snapshot) => {
      handlers.onOnlineCount?.(countPresence(snapshot));
    });
  }

  function watchLeaderboard() {
    const leaderboardQuery = query(ref(database, "leaderboard"), orderByChild("score"), limitToLast(10));
    onValue(leaderboardQuery, (snapshot) => {
      handlers.onLeaderboard?.(snapshotToLeaderboard(snapshot), uid);
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      return;
    }

    uid = user.uid;
    nickname = makeNickname(uid);

    try {
      await attachPresence();
      watchPresence();
      watchLeaderboard();
      handlers.onStatus?.("실시간 연결됨");
      readyResolve();
    } catch (error) {
      handlers.onError?.(error);
    }
  });

  try {
    await signInAnonymously(auth);
  } catch (error) {
    handlers.onError?.(error);
  }

  return {
    enabled: true,
    async recordScore({ nickname, score, completedRounds, misses, totalTimeMs }) {
      await ready;

      const recordRef = ref(database, `leaderboard/${uid}`);
      const current = await get(recordRef);
      const previous = current.exists() ? current.val() : null;

      if (previous && previous.score >= score) {
        return;
      }

      await set(recordRef, {
        nickname: nickname || makeNickname(uid),
        score,
        completedRounds,
        misses,
        totalTimeMs,
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
  };
}

window.createRealtimeBridge = createRealtimeBridge;
