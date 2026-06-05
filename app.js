const TOTAL_SPOTS = 5;
const MAX_MISSES = 10;
const IMAGE_COUNT = 100;
const MAX_ROUNDS = 100;
const MAX_LEVEL = 10;
const ROUNDS_PER_LEVEL = 10;
const NEXT_ROUND_DELAY_MS = 950;
const RECENT_HISTORY_LIMIT = 14;
const HISTORY_KEY = "game2-recent-images";
const NAME_KEY = "game2-player-name";

const IMAGE_SEEDS = Array.from({ length: IMAGE_COUNT }, (_, index) => {
  return `game2-spot-${String(index + 1).padStart(3, "0")}`;
});

const VISUAL_TYPES = ["color", "missing", "replace", "shape", "bright", "zoom", "shift", "warm"];

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
  totalMisses: 0,
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
  levelText: document.getElementById("levelText"),
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

function getCurrentRoundNumber() {
  return Math.min(MAX_ROUNDS, state.completedRounds + 1);
}

function getLevelForRound(roundNumber = getCurrentRoundNumber()) {
  return Math.min(MAX_LEVEL, Math.max(1, Math.ceil(roundNumber / ROUNDS_PER_LEVEL)));
}

function getDifficultyConfig(level) {
  const progress = (level - 1) / (MAX_LEVEL - 1);
  return {
    sizeMin: 16 - progress * 6.5,
    sizeMax: 21 - progress * 8,
    hitBonus: 9 - progress * 4.5,
    shiftMin: 6.5 - progress * 2.5,
    shiftMax: 11 - progress * 4.5,
    opacityMin: 0.98 - progress * 0.1,
    opacityMax: 1,
    gap: 10 - progress * 3,
  };
}

function getVisualTypesForLevel(level) {
  if (level <= 3) {
    return ["color", "missing", "replace", "shape", "bright"];
  }

  if (level <= 7) {
    return ["color", "missing", "replace", "shape", "bright", "zoom"];
  }

  return VISUAL_TYPES;
}

function calculateRoundScore(durationMs, roundMisses, level) {
  const levelMultiplier = 1 + (level - 1) * 0.14;
  const speedScore = Math.max(650, 7000 - Math.floor(durationMs / 18));
  const missPenalty = roundMisses * (170 + level * 20);
  return Math.max(150, Math.round((speedScore - missPenalty) * levelMultiplier));
}

function getSpotFilter(type, level) {
  const progress = (level - 1) / (MAX_LEVEL - 1);
  const filters = {
    color: `hue-rotate(${Math.round(58 - progress * 28)}deg) saturate(${1.7 - progress * 0.32}) brightness(${1.08 - progress * 0.03})`,
    missing: `blur(${2.4 - progress * 0.7}px) saturate(${0.34 + progress * 0.22}) brightness(${1.15 - progress * 0.07})`,
    replace: `contrast(${1.28 - progress * 0.12}) saturate(${1.28 - progress * 0.12}) brightness(${1.08 - progress * 0.02})`,
    shape: `contrast(${1.36 - progress * 0.14}) saturate(${1.35 - progress * 0.12}) brightness(${1.08 - progress * 0.03})`,
    bright: `brightness(${1.33 - progress * 0.15}) contrast(${1.08 + progress * 0.04}) saturate(${1.08 - progress * 0.02})`,
    zoom: `contrast(${1.18 - progress * 0.08}) saturate(${1.16 - progress * 0.08})`,
    shift: `contrast(${1.13 - progress * 0.06}) saturate(${1.12 - progress * 0.05})`,
    warm: `sepia(${0.26 - progress * 0.08}) saturate(${1.32 - progress * 0.16}) brightness(${1.08 - progress * 0.03})`,
  };

  return filters[type] || filters.replace;
}

function randomSign() {
  return Math.random() < 0.5 ? -1 : 1;
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
  const level = getLevelForRound();
  const difficulty = getDifficultyConfig(level);
  const visualTypes = getVisualTypesForLevel(level);
  const typeOffset = Math.floor(Math.random() * visualTypes.length);

  while (spots.length < TOTAL_SPOTS && attempts < 500) {
    attempts += 1;
    const size = randomBetween(difficulty.sizeMin, difficulty.sizeMax);
    const type = visualTypes[(spots.length + typeOffset) % visualTypes.length];
    const baseShiftX = randomBetween(difficulty.shiftMin, difficulty.shiftMax) * randomSign();
    const baseShiftY = randomBetween(difficulty.shiftMin * 0.72, difficulty.shiftMax * 0.82) * randomSign();
    const shiftBoost = type === "replace" || type === "missing" ? 1.25 : 1;
    const candidate = {
      id: `spot-${spots.length + 1}`,
      x: randomBetween(12, 88),
      y: randomBetween(13, 84),
      size,
      hitRadius: size + difficulty.hitBonus,
      type,
      radiusX: size * randomBetween(0.62, 0.86),
      radiusY: size * randomBetween(0.48, 0.7),
      shiftX: baseShiftX * shiftBoost,
      shiftY: baseShiftY * shiftBoost,
      scale: type === "zoom" ? randomBetween(1.13, 1.22) : randomBetween(1.04, 1.12),
      filter: getSpotFilter(type, level),
      opacity: randomBetween(difficulty.opacityMin, difficulty.opacityMax),
    };

    const overlaps = spots.some((spot) => {
      const dx = (candidate.x - spot.x) * 1.35;
      const dy = candidate.y - spot.y;
      return Math.hypot(dx, dy) < candidate.size + spot.size + difficulty.gap;
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
  els.missChanceCount.textContent = String(Math.max(0, MAX_MISSES - state.roundMisses));
  els.roundCount.textContent = `${getCurrentRoundNumber()}/${MAX_ROUNDS}`;
  els.levelText.textContent = String(getLevelForRound());
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
  if (state.completedRounds >= MAX_ROUNDS) {
    endGame("100문제를 모두 맞췄습니다. 레벨 10 달성");
    return;
  }

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
  state.totalMisses = 0;
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
    state.roundMisses += 1;
    state.totalMisses += 1;
    renderStats();
    showMiss(shell, point);

    if (state.roundMisses >= MAX_MISSES) {
      endGame("이번 게임에서 10번 틀렸습니다");
      return;
    }

    setMessage(`다시 살펴보세요. 남은 기회 ${MAX_MISSES - state.roundMisses}번`);
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
  const level = getLevelForRound();
  const roundScore = calculateRoundScore(roundDurationMs, state.roundMisses, level);

  state.totalScore += roundScore;
  state.completedRounds += 1;
  renderStats();
  recordScore(false);

  if (state.completedRounds >= MAX_ROUNDS) {
    endGame("100문제를 모두 맞췄습니다. 레벨 10 달성");
    return;
  }

  setMessage(`${state.completedRounds}라운드 완료 +${formatScore(roundScore)}점. 다음 게임으로 이동합니다`);

  state.transitionId = window.setTimeout(() => {
    if (!state.isGameOver) {
      startRound();
    }
  }, NEXT_ROUND_DELAY_MS);
}

function endGame(reason = "게임 종료") {
  state.isGameOver = true;
  state.isComplete = true;
  const totalDurationMs = Math.max(1000, Math.round(performance.now() - state.sessionStartedAt));
  stopTimer(totalDurationMs);
  renderStats();
  recordScore(true);
  setMessage(`${reason}. 총점 ${formatScore(state.totalScore)}점`);
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
    misses: state.totalMisses,
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
