const TOTAL_SPOTS = 5;
const IMAGE_COUNT = 100;
const RECENT_HISTORY_LIMIT = 14;
const HISTORY_KEY = "game2-recent-images";

const IMAGE_SEEDS = Array.from({ length: IMAGE_COUNT }, (_, index) => {
  return `game2-spot-${String(index + 1).padStart(3, "0")}`;
});

const VISUAL_TYPES = ["shift", "bright", "soft", "warm", "zoom"];

const state = {
  imageIndex: 0,
  spots: [],
  found: new Set(),
  isComplete: false,
  loadToken: 0,
  startedAt: 0,
  timerId: 0,
};

let realtimeBridge = {
  enabled: false,
  recordCompletion() {},
};

const els = {
  board: document.getElementById("gameBoard"),
  leftImage: document.getElementById("leftImage"),
  rightImage: document.getElementById("rightImage"),
  differenceLayer: document.getElementById("differenceLayer"),
  leftMarkers: document.getElementById("leftMarkers"),
  rightMarkers: document.getElementById("rightMarkers"),
  remainingCount: document.getElementById("remainingCount"),
  foundCount: document.getElementById("foundCount"),
  timerText: document.getElementById("timerText"),
  onlineCount: document.getElementById("onlineCount"),
  spotDots: document.getElementById("spotDots"),
  newGameButton: document.getElementById("newGameButton"),
  statusMessage: document.getElementById("statusMessage"),
  firebaseStatus: document.getElementById("firebaseStatus"),
  leaderboardList: document.getElementById("leaderboardList"),
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

function startTimer() {
  window.clearInterval(state.timerId);
  state.startedAt = performance.now();
  els.timerText.textContent = "00:00.0";
  state.timerId = window.setInterval(() => {
    els.timerText.textContent = formatDuration(performance.now() - state.startedAt);
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

function startNewGame() {
  state.imageIndex = chooseImageIndex();
  state.spots = generateSpots();
  state.found = new Set();
  state.isComplete = false;

  saveRecentHistory(state.imageIndex);
  startTimer();
  setMessage("새 사진 로딩 중");
  setImages(buildImageUrl(IMAGE_SEEDS[state.imageIndex]));
  renderGame();
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
  if (state.isComplete || els.board.classList.contains("is-loading")) {
    return;
  }

  const shell = event.currentTarget;
  const point = getPointFromEvent(event, shell);
  const hitSpot = findHitSpot(point);

  if (!hitSpot) {
    showMiss(shell, point);
    setMessage("다시 살펴보세요");
    return;
  }

  state.found.add(hitSpot.id);
  renderDifferences();
  renderFoundMarkers();
  renderStats();

  if (state.found.size === TOTAL_SPOTS) {
    state.isComplete = true;
    const durationMs = Math.max(1000, Math.round(performance.now() - state.startedAt));
    stopTimer(durationMs);
    realtimeBridge.recordCompletion({
      durationMs,
      imageIndex: state.imageIndex,
    }).catch((error) => {
      setFirebaseStatus("기록 저장 실패");
      console.error(error);
    });
    setMessage("5개를 모두 찾았습니다");
  } else {
    setMessage("찾았습니다");
  }
}

function renderLeaderboard(rows, currentUid) {
  els.leaderboardList.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("li");
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

    const time = document.createElement("span");
    time.className = "rank-time";
    time.textContent = formatDuration(row.durationMs);

    item.append(rank, name, time);
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
  } catch (error) {
    setFirebaseStatus("실시간 연결 실패");
    console.error(error);
  }
}

function bindEvents() {
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
