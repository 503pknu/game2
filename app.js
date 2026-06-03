const TOTAL_SPOTS = 5;
const MAX_MISSES = 10;
const IMAGE_COUNT = 100;
const NEXT_ROUND_DELAY_MS = 950;
const RECENT_HISTORY_LIMIT = 14;
const HISTORY_KEY = "game2-recent-images";
const NAME_KEY = "game2-player-name";

const IMAGE_SEEDS = Array.from({ length: IMAGE_COUNT }, (_, index) => {
  return `game2-spot-${String(index + 1).padStart(3, "0")}`;
});

const VISUAL_TYPES = ["shift", "bright", "soft", "warm", "zoom"];

const state = {
  imageIndex: 0,
  spots: [],
  found: new Set(),
  isComplete: false,
  isGameOver: false,
  loadToken: 0,
  sessionStartedAt: 0,
  roundStartedAt: 0,
  timerId: 0,
  transitionId: 0,
  misses: 0,
  roundMisses: 0,
  completedRounds: 0,
  totalScore: 0,
};

let realtimeBridge = {
  enabled: false,
  recordScore() {},
};
let pendingScore = null;

const els = {
  board: document.getElementById("gameBoard"),
  leftImage: document.getElementById("leftImage"),
  rightImage: document.getElementById("rightImage"),
  differenceLayer: document.getElementById("differenceLayer"),
  leftMarkers: document.getElementById("leftMarkers"),
  rightMarkers: document.getElementById("rightMarkers"),
  remainingCount: document.getElementById("remainingCount"),
  foundCount: document.getElementById("foundCount"),
  missChanceCount: document.getElementById("missChanceCount"),
  roundCount: document.getElementById("roundCount"),
  scoreText: document.getElementById("scoreText"),
  timerText: document.getElementById("timerText"),
  onlineCount: document.getElementById("onlineCount"),
  spotDots: document.getElementById("spotDots"),
  newGameButton: document.getElementById("newGameButton"),
  statusMessage: document.getElementById("statusMessage"),
  firebaseStatus: document.getElementById("firebaseStatus"),
  leaderboardList: document.getElementById("leaderboardList"),
  playerNameInput: document.getElementById("playerNameInput"),
  imageNumberLeft: document.getElementById("imageNumberLeft"),
  imageNumberRight: document.getElementById("imageNumberRight"),
};

function buildImageUrl(seed) {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/900/600`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function formatDuration(durationMs) {
  const safeMs = Math.max(0, durationMs);
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const tenths = Math.floor((safeMs % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function formatScore(score) {
  return Math.max(0, Math.round(score)).toLocaleString("ko-KR");
}

function sanitizeName(name) {
  const cleanName = String(name || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);
  return cleanName || "Player";
}

function getPlayerName() {
  return sanitizeName(els.playerNameInput.value);
}

function calculateRoundScore(durationMs, roundMisses) {
  const speedScore = Math.max(500, 6000 - Math.floor(durationMs / 18));
  const missPenalty = roundMisses * 150;
  return Math.max(100, speedScore - missPenalty);
}

function getSpotFilter(type) {
  const filters = {
    shift: "contrast(1.04) saturate(1.04)",
    bright: "brightness(1.18) saturate(0.96)",
    soft: "blur(1.8px) brightness(1.08)",
    warm: "sepia(0.18) saturate(1.18) brightness(1.04)",
    zoom: "contrast(1.08) saturate(1.08)",
  };

  return filters[type] || filters.shift;
}

function readRecentHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function saveRecentHistory(imageIndex) {
  const recent = readRecentHistory().filter((item) => item !== imageIndex);
  recent.unshift(imageIndex);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(recent.slice(0, RECENT_HISTORY_LIMIT)));
}

function chooseImageIndex() {
  const recent = new Set(readRecentHistory());
  const freshPool = IMAGE_SEEDS.map((_, index) => index).filter((index) => !recent.has(index));
  const pool = freshPool.length ? freshPool : IMAGE_SEEDS.map((_, index) => index);
  return pool[Math.floor(Math.random() * pool.length)];
}

function generateSpots() {
  const spots = [];
  let attempts = 0;
  const typeOffset = Math.floor(Math.random() * VISUAL_TYPES.length);

  while (spots.length < TOTAL_SPOTS && attempts < 500) {
    attempts += 1;
    const size = randomBetween(8.4, 12.6);
    const type = VISUAL_TYPES[(spots.length + typeOffset) % VISUAL_TYPES.length];
    const candidate = {
      id: `spot-${spots.length + 1}`,
      x: randomBetween(12, 88),
      y: randomBetween(13, 84),
      size,
      hitRadius: size + 4.2,
      type,
      radiusX: size * randomBetween(0.5, 0.72),
      radiusY: size * randomBetween(0.38, 0.58),
      shiftX: randomBetween(-2.8, 2.8),
      shiftY: randomBetween(-2.2, 2.2),
      scale: type === "zoom" ? randomBetween(1.07, 1.13) : randomBetween(1.01, 1.05),
      filter: getSpotFilter(type),
      opacity: type === "soft" ? 0.84 : randomBetween(0.9, 0.98),
    };

    if (Math.abs(candidate.shiftX) < 1.1) {
      candidate.shiftX += candidate.shiftX < 0 ? -1.1 : 1.1;
    }

    if (Math.abs(candidate.shiftY) < 0.8) {
      candidate.shiftY += candidate.shiftY < 0 ? -0.8 : 0.8;
    }

    const overlaps = spots.some((spot) => {
      const dx = (candidate.x - spot.x) * 1.35;
      const dy = candidate.y - spot.y;
      return Math.hypot(dx, dy) < candidate.size + spot.size + 5;
    });

    if (!overlaps) {
      spots.push(candidate);
    }
  }

  return spots;
}

function setMessage(text) {
  els.statusMessage.textContent = text;
}

function setFirebaseStatus(text) {
  els.firebaseStatus.textContent = text;
}

function startSessionTimer() {
  window.clearInterval(state.timerId);
  state.sessionStartedAt = performance.now();
  els.timerText.textContent = "00:00.0";
  state.timerId = window.setInterval(() => {
    els.timerText.textContent = formatDuration(performance.now() - state.sessionStartedAt);
  }, 100);
}

function stopTimer(finalDurationMs) {
  window.clearInterval(state.timerId);
  state.timerId = 0;
  els.timerText.textContent = formatDuration(finalDurationMs);
}

function setImages(src) {
  state.loadToken += 1;
  const token = state.loadToken;
  let loaded = 0;

  els.board.classList.add("is-loading");

  [els.leftImage, els.rightImage].forEach((image) => {
    image.onload = () => {
      loaded += 1;
      if (loaded === 2 && token === state.loadToken) {
        els.board.classList.remove("is-loading");
        setMessage("게임 진행 중");
      }
    };
    image.onerror = () => {
      loaded += 1;
      if (token === state.loadToken) {
        els.board.classList.remove("is-loading");
        setMessage("이미지를 불러오지 못했습니다");
      }
    };
    image.src = src;
  });
}

function renderDots() {
  els.spotDots.innerHTML = "";
  for (let index = 0; index < TOTAL_SPOTS; index += 1) {
    const dot = document.createElement("span");
    dot.className = `spot-dot${index < state.found.size ? " is-found" : ""}`;
    els.spotDots.appendChild(dot);
  }
}

function renderStats() {
  const remaining = TOTAL_SPOTS - state.found.size;
  els.remainingCount.textContent = String(remaining);
  els.foundCount.textContent = `${state.found.size}/${TOTAL_SPOTS}`;
  els.missChanceCount.textContent = String(Math.max(0, MAX_MISSES - state.misses));
  els.roundCount.textContent = String(state.completedRounds + 1);
  els.scoreText.textContent = formatScore(state.totalScore);
  renderDots();
}

function renderDifferences() {
  els.differenceLayer.innerHTML = "";
  const imageUrl = buildImageUrl(IMAGE_SEEDS[state.imageIndex]);

  state.spots.forEach((spot) => {
    const marker = document.createElement("span");
    marker.className = `diff-spot is-${spot.type}${state.found.has(spot.id) ? " is-found" : ""}`;
    marker.style.setProperty("--spot-x", `${spot.x}%`);
    marker.style.setProperty("--spot-y", `${spot.y}%`);
    marker.style.setProperty("--spot-size", `${spot.size}%`);
    marker.style.setProperty("--spot-rx", `${spot.radiusX}%`);
    marker.style.setProperty("--spot-ry", `${spot.radiusY}%`);
    marker.style.setProperty("--spot-image", `url("${imageUrl}")`);
    marker.style.setProperty("--spot-filter", spot.filter);
    marker.style.setProperty("--spot-opacity", spot.opacity);
    marker.style.setProperty("--shift-x", `${spot.shiftX}%`);
    marker.style.setProperty("--shift-y", `${spot.shiftY}%`);
    marker.style.setProperty("--spot-scale", spot.scale);
    els.differenceLayer.appendChild(marker);
  });
}

function renderFoundMarkers() {
  els.leftMarkers.innerHTML = "";
  els.rightMarkers.innerHTML = "";

  state.spots.forEach((spot) => {
    if (!state.found.has(spot.id)) {
      return;
    }

    [els.leftMarkers, els.rightMarkers].forEach((layer) => {
      const pin = document.createElement("span");
      pin.className = "found-pin";
      pin.style.setProperty("--spot-x", `${spot.x}%`);
      pin.style.setProperty("--spot-y", `${spot.y}%`);
      pin.style.setProperty("--pin-size", `${spot.size + 3.2}%`);
      layer.appendChild(pin);
    });
  });
}

function renderBoardLabels() {
  const imageLabel = `이미지 ${String(state.imageIndex + 1).padStart(3, "0")}`;
  els.imageNumberLeft.textContent = imageLabel;
  els.imageNumberRight.textContent = imageLabel;
}

function renderGame() {
  renderBoardLabels();
  renderDifferences();
  renderFoundMarkers();
  renderStats();
}

function startRound() {
  state.imageIndex = chooseImageIndex();
  state.spots = generateSpots();
  state.found = new Set();
  state.isComplete = false;
  state.roundMisses = 0;
  state.roundStartedAt = performance.now();

  saveRecentHistory(state.imageIndex);
  setMessage("새 사진 로딩 중");
  setImages(buildImageUrl(IMAGE_SEEDS[state.imageIndex]));
  renderGame();
}

function startNewGame() {
  window.clearTimeout(state.transitionId);
  state.isGameOver = false;
  state.misses = 0;
  state.completedRounds = 0;
  state.totalScore = 0;
  startSessionTimer();
  startRound();
}

function getPointFromEvent(event, shell) {
  const rect = shell.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 100,
    y: ((event.clientY - rect.top) / rect.height) * 100,
  };
}

function findHitSpot(point) {
  return state.spots.find((spot) => {
    if (state.found.has(spot.id)) {
      return false;
    }

    const dx = (point.x - spot.x) * 1.35;
    const dy = point.y - spot.y;
    return Math.hypot(dx, dy) <= spot.hitRadius;
  });
}

function showMiss(shell, point) {
  const mark = document.createElement("span");
  mark.className = "miss-mark";
  mark.style.setProperty("--miss-x", `${point.x}%`);
  mark.style.setProperty("--miss-y", `${point.y}%`);
  shell.querySelector(".miss-layer").appendChild(mark);
  window.setTimeout(() => mark.remove(), 700);
}

function handleShellClick(event) {
  if (state.isComplete || state.isGameOver || els.board.classList.contains("is-loading")) {
    return;
  }

  const shell = event.currentTarget;
  const point = getPointFromEvent(event, shell);
  const hitSpot = findHitSpot(point);

  if (!hitSpot) {
    state.misses += 1;
    state.roundMisses += 1;
    renderStats();
    showMiss(shell, point);

    if (state.misses >= MAX_MISSES) {
      endGame();
      return;
    }

    setMessage(`다시 살펴보세요. 남은 기회 ${MAX_MISSES - state.misses}번`);
    return;
  }

  state.found.add(hitSpot.id);
  renderDifferences();
  renderFoundMarkers();
  renderStats();

  if (state.found.size === TOTAL_SPOTS) {
    completeRound();
  } else {
    setMessage("찾았습니다");
  }
}

function completeRound() {
  state.isComplete = true;
  const roundDurationMs = Math.max(1000, Math.round(performance.now() - state.roundStartedAt));
  const roundScore = calculateRoundScore(roundDurationMs, state.roundMisses);

  state.totalScore += roundScore;
  state.completedRounds += 1;
  renderStats();
  recordScore(false);
  setMessage(`${state.completedRounds}라운드 완료 +${formatScore(roundScore)}점. 다음 게임으로 이동합니다`);

  state.transitionId = window.setTimeout(() => {
    if (!state.isGameOver) {
      startRound();
    }
  }, NEXT_ROUND_DELAY_MS);
}

function endGame() {
  state.isGameOver = true;
  state.isComplete = true;
  const totalDurationMs = Math.max(1000, Math.round(performance.now() - state.sessionStartedAt));
  stopTimer(totalDurationMs);
  renderStats();
  recordScore(true);
  setMessage(`게임 종료. 총점 ${formatScore(state.totalScore)}점`);
}

function recordScore(isFinal) {
  if (state.totalScore <= 0) {
    return;
  }

  const totalDurationMs = Math.max(1000, Math.round(performance.now() - state.sessionStartedAt));
  const payload = {
    nickname: getPlayerName(),
    score: state.totalScore,
    completedRounds: state.completedRounds,
    misses: state.misses,
    totalTimeMs: totalDurationMs,
    isFinal,
  };

  submitScore(payload);
}

function submitScore(payload) {
  if (!realtimeBridge.enabled) {
    if (!pendingScore || payload.score >= pendingScore.score) {
      pendingScore = payload;
    }
    return;
  }

  Promise.resolve(realtimeBridge.recordScore(payload)).catch((error) => {
    setFirebaseStatus("기록 저장 실패");
    console.error(error);
  });
}

function flushPendingScore() {
  if (!pendingScore || !realtimeBridge.enabled) {
    return;
  }

  const payload = pendingScore;
  pendingScore = null;
  submitScore(payload);
}

function renderLeaderboard(rows, currentUid) {
  els.leaderboardList.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("li");
    empty.className = "is-empty";
    empty.textContent = "기록 대기 중";
    els.leaderboardList.appendChild(empty);
    return;
  }

  rows.forEach((row, index) => {
    const item = document.createElement("li");
    const suffix = row.uid === currentUid ? " 나" : "";

    const rank = document.createElement("span");
    rank.className = "rank-index";
    rank.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = `${row.nickname}${suffix}`;

    const score = document.createElement("span");
    score.className = "rank-score";
    score.textContent = formatScore(row.score);

    const time = document.createElement("span");
    time.className = "rank-time";
    time.textContent = formatDuration(row.totalTimeMs);

    item.append(rank, name, score, time);
    els.leaderboardList.appendChild(item);
  });
}

async function initRealtime() {
  try {
    realtimeBridge = await window.createRealtimeBridge({
      onStatus: setFirebaseStatus,
      onOnlineCount(count) {
        els.onlineCount.textContent = String(count);
      },
      onLeaderboard: renderLeaderboard,
      onError(error) {
        setFirebaseStatus("실시간 연결 실패");
        console.error(error);
      },
    });
    flushPendingScore();
  } catch (error) {
    setFirebaseStatus("실시간 연결 실패");
    console.error(error);
  }
}

function bindEvents() {
  els.playerNameInput.value = sanitizeName(localStorage.getItem(NAME_KEY) || els.playerNameInput.value);
  els.playerNameInput.addEventListener("input", () => {
    localStorage.setItem(NAME_KEY, getPlayerName());
  });

  document.querySelectorAll(".image-shell").forEach((shell) => {
    shell.tabIndex = 0;
    shell.addEventListener("click", handleShellClick);
    shell.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
      }
    });
  });

  els.newGameButton.addEventListener("click", startNewGame);
}

bindEvents();
startNewGame();
initRealtime();
