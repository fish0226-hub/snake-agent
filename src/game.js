import { ACTIONS, VECTORS, decide, manhattan } from "./agent.js";

const COLS = 26;
const ROWS = 20;
const CELL = 28;
const START_LENGTH = 3;
const SCORE_PER_FOOD = 10;
const BEST_KEY = "snake-agent-best";

const OPPOSITE = { 上: "下", 下: "上", 左: "右", 右: "左" };
const MODE_LABEL = {
  safe: "安全",
  tight: "勉强",
  desperate: "危险",
  stuck: "无路",
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const lengthEl = document.getElementById("length");

const overlay = document.getElementById("overlay");
const overlayEyebrow = document.getElementById("overlayEyebrow");
const overlayTitle = document.getElementById("overlayTitle");
const overlayText = document.getElementById("overlayText");
const overlayBtn = document.getElementById("overlayBtn");
const overlayHint = document.getElementById("overlayHint");

const aiBtn = document.getElementById("aiBtn");
const pauseBtn = document.getElementById("pauseBtn");
const restartBtn = document.getElementById("restartBtn");
const speedSelect = document.getElementById("speed");

const agentStatus = document.getElementById("agentStatus");
const agentEmpty = document.getElementById("agentEmpty");
const agentOutput = document.getElementById("agentOutput");

let snake = [];
let food = null;
let score = 0;
let best = readBest();
let direction = "右";
let inputQueue = [];

let running = false;
let paused = false;
let over = false;
let won = false;
let aiEnabled = false;

let lastAction = "右";
let lastStepReflect = "首次";
let plannedPath = null;
let turn = 0;
let lastDecision = null;

let timer = null;
let overlayAction = null;

bestEl.textContent = String(best);

/* ---------------------------------------------------------------- game state */

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    /* 忽略隐私模式下的存储错误 */
  }
}

function spawnFood() {
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
  const free = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

function resetGame() {
  clearTimeout(timer);
  timer = null;

  const cx = Math.floor(COLS / 2);
  const cy = Math.floor(ROWS / 2);
  snake = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];

  score = 0;
  direction = "右";
  inputQueue = [];
  running = false;
  paused = false;
  over = false;
  won = false;

  lastAction = "右";
  lastStepReflect = "首次";
  plannedPath = null;
  turn = 0;
  lastDecision = null;

  food = spawnFood();

  updateStats();
  syncAiButton();
  pauseBtn.disabled = true;
  pauseBtn.textContent = "暂停";
  clearAgentPanel();
  showReadyOverlay();
}

function startGame() {
  if (running) return;
  if (over || won) {
    resetGame();
  }

  running = true;
  paused = false;
  over = false;
  won = false;

  hideOverlay();
  pauseBtn.disabled = false;
  pauseBtn.textContent = "暂停";
  updateStatus();
  schedule();
}

function restartGame() {
  const keepAi = aiEnabled;
  resetGame();
  aiEnabled = keepAi;
  syncAiButton();
  running = false;
  startGame();
}

function endGame(reason) {
  running = false;
  over = true;
  clearTimeout(timer);
  timer = null;

  pauseBtn.disabled = true;
  overlayAction = restartGame;
  showOverlay({
    eyebrow: "GAME OVER",
    title: reason === "自噬" ? "咬到自己了" : "撞到墙了",
    text: `本局得分 ${score}，蛇身长度 ${snake.length}。调整方向，再来一局。`,
    button: "再来一局",
    hint: "按空格也可以立即重开",
  });

  agentStatus.textContent = "游戏结束";
  agentStatus.classList.remove("live");
}

function winGame() {
  running = false;
  won = true;
  clearTimeout(timer);
  timer = null;

  pauseBtn.disabled = true;
  overlayAction = restartGame;
  showOverlay({
    eyebrow: "PERFECT",
    title: "通关！",
    text: `你填满了整个棋盘，最终得分 ${score}。这可能是最圆满的贪吃蛇结局。`,
    button: "再来一局",
    hint: "按空格重新开始",
  });

  agentStatus.textContent = "通关";
  agentStatus.classList.remove("live");
}

/* ------------------------------------------------------------------- moving */

function queueDirection(action) {
  if (!ACTIONS.includes(action)) return;

  const base = inputQueue.length
    ? inputQueue[inputQueue.length - 1]
    : direction;
  if (action === OPPOSITE[base]) return;
  if (inputQueue[inputQueue.length - 1] === action) return;

  if (inputQueue.length >= 2) inputQueue.shift();
  inputQueue.push(action);
}

function applyMove(action, decision = null) {
  const vector = VECTORS[action];
  if (!vector) return false;

  const head = snake[0];
  const next = { x: head.x + vector.x, y: head.y + vector.y };

  if (next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS) {
    endGame("撞墙");
    return false;
  }

  const eating = food && next.x === food.x && next.y === food.y;
  const tail = snake[snake.length - 1];
  const tailVacates = !eating && snake.length > 1;
  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));

  if (
    occupied.has(`${next.x},${next.y}`) &&
    !(tailVacates && next.x === tail.x && next.y === tail.y)
  ) {
    endGame("自噬");
    return false;
  }

  const distanceBefore = food ? manhattan(head, food) : null;

  snake.unshift(next);
  if (!eating) snake.pop();

  if (eating) {
    score += SCORE_PER_FOOD;
    if (score > best) {
      best = score;
      saveBest();
    }
    food = spawnFood();
    plannedPath = null;
  } else if (decision) {
    plannedPath = decision.plannedPath;
  } else {
    plannedPath = null;
  }

  const newHead = snake[0];
  direction = action;
  lastAction = action;

  if (aiEnabled && decision) {
    if (eating) {
      const distanceAfter = food ? manhattan(newHead, food) : null;
      lastStepReflect = food
        ? `${action}，吃到食物，得分 +${SCORE_PER_FOOD}；新食物距离 ${distanceAfter}`
        : `${action}，吃到食物，棋盘已填满`;
    } else {
      const distanceAfter = food ? manhattan(newHead, food) : null;
      lastStepReflect = food
        ? `${action}，安全移动，未吃到食物；与食物距离 ${distanceBefore}→${distanceAfter}`
        : `${action}，安全移动；食物已吃完`;
    }
  }

  updateStats();

  if (!food) {
    winGame();
    return false;
  }
  return true;
}

function step() {
  timer = null;
  if (!running || paused || over || won) return;

  if (aiEnabled) {
    const decision = decide({
      width: COLS,
      height: ROWS,
      snake: snake.map((p) => ({ ...p })),
      food: food ? { ...food } : null,
      lastAction,
      lastStepReflect,
    });

    lastDecision = decision;
    turn += 1;
    renderDecision(decision, turn);

    const alive = applyMove(decision.action, decision);
    if (!alive) return;
  } else {
    let action = direction;
    while (inputQueue.length) {
      const candidate = inputQueue.shift();
      if (candidate !== OPPOSITE[direction]) {
        action = candidate;
        break;
      }
    }
    const alive = applyMove(action, null);
    if (!alive) return;
  }

  schedule();
}

function schedule() {
  clearTimeout(timer);
  if (!running || paused || over || won) return;

  const base = Number(speedSelect.value) || 120;
  const delay = aiEnabled ? base + 40 : base;
  timer = setTimeout(step, delay);
}

/* --------------------------------------------------------------------- UI */

function updateStats() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  lengthEl.textContent = String(snake.length);
}

function updateStatus() {
  agentStatus.classList.toggle("live", aiEnabled && running && !paused);
  if (paused) {
    agentStatus.textContent = "已暂停";
  } else if (running) {
    agentStatus.textContent = aiEnabled ? "AI 接管中" : "手动控制";
  } else if (aiEnabled) {
    agentStatus.textContent = "AI 待命";
  } else {
    agentStatus.textContent = "等待开始";
  }
}

function renderDecision(decision, stepNumber) {
  agentEmpty.hidden = true;
  agentOutput.hidden = false;
  agentOutput.textContent = decision.text;
  agentOutput.scrollTop = 0;
  agentStatus.textContent = `第 ${stepNumber} 步 · ${
    MODE_LABEL[decision.mode] || "决策"
  }`;
  agentStatus.classList.add("live");
}

function clearAgentPanel() {
  lastDecision = null;
  agentOutput.textContent = "";
  agentOutput.hidden = true;
  agentEmpty.hidden = false;
  if (aiEnabled) {
    agentEmpty.textContent =
      "AI 已就绪。开始游戏后，这里会逐步展示观察、推理与最终动作。";
  } else {
    agentEmpty.textContent =
      "开启「AI 接管」，这里会显示每一步的观察、推理与最终动作。";
  }
  updateStatus();
}

function syncAiButton() {
  aiBtn.classList.toggle("active", aiEnabled);
  aiBtn.innerHTML = aiEnabled
    ? '<span class="ai-dot" aria-hidden="true"></span>交还控制'
    : '<span class="ai-dot" aria-hidden="true"></span>AI 接管';
}

function showOverlay({ eyebrow, title, text, button, hint }) {
  overlayEyebrow.textContent = eyebrow;
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlayBtn.textContent = button;
  overlayHint.textContent = hint;
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function showReadyOverlay() {
  overlayAction = startGame;
  showOverlay({
    eyebrow: "READY",
    title: "准备好了吗？",
    text: "手动控制，或交给 Agent。它会先确认逃生空间，再靠近食物。",
    button: "开始游戏",
    hint: "方向键 / WASD 移动 · 空格暂停",
  });
}

/* ----------------------------------------------------------------- controls */

function toggleAi() {
  aiEnabled = !aiEnabled;
  syncAiButton();

  if (aiEnabled) {
    inputQueue = [];
    if (over || won) {
      restartGame();
      return;
    }
    if (!running) {
      startGame();
      return;
    }
    if (paused) {
      paused = false;
      pauseBtn.textContent = "暂停";
      hideOverlay();
    }
    agentEmpty.textContent = "AI 接管中，下一步决策即将到达…";
    updateStatus();
    schedule();
  } else {
    updateStatus();
    if (running && !paused) {
      agentEmpty.hidden = false;
      agentOutput.hidden = true;
      agentEmpty.textContent = "已交还手动控制。按方向键继续。";
    }
  }
}

function togglePause() {
  if (over || won) {
    restartGame();
    return;
  }
  if (!running) {
    startGame();
    return;
  }

  paused = !paused;
  pauseBtn.textContent = paused ? "继续" : "暂停";

  if (paused) {
    clearTimeout(timer);
    timer = null;
    overlayAction = togglePause;
    showOverlay({
      eyebrow: "PAUSED",
      title: "已暂停",
      text: "休息一下。你的蛇身和 Agent 的下一步计划都在原地等你。",
      button: "继续游戏",
      hint: "按空格或点击继续",
    });
    updateStatus();
  } else {
    hideOverlay();
    updateStatus();
    schedule();
  }
}

const KEY_ACTIONS = {
  ArrowUp: "上",
  ArrowDown: "下",
  ArrowLeft: "左",
  ArrowRight: "右",
  w: "上",
  W: "上",
  s: "下",
  S: "下",
  a: "左",
  A: "左",
  d: "右",
  D: "右",
};

function handleHumanAction(action) {
  if (over || won) {
    restartGame();
  }

  if (aiEnabled) {
    aiEnabled = false;
    syncAiButton();
    agentEmpty.hidden = false;
    agentOutput.hidden = true;
    agentEmpty.textContent = "已交还手动控制。按方向键继续。";
  }

  if (paused) {
    togglePause();
  }
  if (!running) {
    startGame();
  }

  queueDirection(action);
  updateStatus();
}

window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    if (over || won) {
      restartGame();
    } else {
      togglePause();
    }
    return;
  }

  const action = KEY_ACTIONS[event.key];
  if (!action) return;
  event.preventDefault();
  handleHumanAction(action);
});

aiBtn.addEventListener("click", toggleAi);
pauseBtn.addEventListener("click", togglePause);
restartBtn.addEventListener("click", restartGame);
overlayBtn.addEventListener("click", () => {
  if (overlayAction) overlayAction();
});

speedSelect.addEventListener("change", schedule);

document.querySelectorAll(".dpad button").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handleHumanAction(button.dataset.action);
  });
});

/* ----------------------------------------------------------------- drawing */

function drawGrid(width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(120, 205, 160, 0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= COLS; x += 1) {
    ctx.moveTo(x * CELL + 0.5, 0);
    ctx.lineTo(x * CELL + 0.5, height);
  }
  for (let y = 0; y <= ROWS; y += 1) {
    ctx.moveTo(0, y * CELL + 0.5);
    ctx.lineTo(width, y * CELL + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFood(now) {
  if (!food) return;

  const cx = food.x * CELL + CELL / 2;
  const cy = food.y * CELL + CELL / 2;
  const pulse = 1 + Math.sin(now / 260) * 0.07;
  const radius = CELL * 0.29 * pulse;

  ctx.save();
  ctx.shadowColor = "rgba(255, 96, 122, 0.95)";
  ctx.shadowBlur = 20;

  const gradient = ctx.createRadialGradient(
    cx - radius * 0.35,
    cy - radius * 0.35,
    radius * 0.15,
    cx,
    cy,
    radius,
  );
  gradient.addColorStop(0, "#ffb3c0");
  gradient.addColorStop(0.45, "#ff6b81");
  gradient.addColorStop(1, "#d92d4e");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.arc(cx - radius * 0.34, cy - radius * 0.36, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(120, 242, 174, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx + radius * 0.15, cy - radius * 0.92);
  ctx.quadraticCurveTo(
    cx + radius * 0.55,
    cy - radius * 1.3,
    cx + radius * 0.9,
    cy - radius * 0.95,
  );
  ctx.stroke();
  ctx.restore();
}

function drawPath() {
  if (!plannedPath || !aiEnabled || !running || paused) return;

  const occupied = new Set(snake.map((p) => `${p.x},${p.y}`));
  ctx.save();
  for (let i = 1; i < plannedPath.length; i += 1) {
    const point = plannedPath[i];
    const key = `${point.x},${point.y}`;
    if (occupied.has(key)) continue;
    if (food && point.x === food.x && point.y === food.y) continue;

    const alpha = Math.max(0.1, 0.36 - i * 0.012);
    ctx.fillStyle = `rgba(120, 242, 174, ${alpha})`;
    ctx.beginPath();
    ctx.arc(
      point.x * CELL + CELL / 2,
      point.y * CELL + CELL / 2,
      2.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawSnake() {
  if (!snake.length) return;

  const head = snake[0];
  const neck = snake[1] || { x: head.x - 1, y: head.y };
  const dx = Math.sign(head.x - neck.x);
  const dy = Math.sign(head.y - neck.y);

  ctx.save();
  for (let i = snake.length - 1; i >= 0; i -= 1) {
    const segment = snake[i];
    const t = snake.length > 1 ? i / (snake.length - 1) : 0;
    const x = segment.x * CELL;
    const y = segment.y * CELL;

    if (i === 0) {
      ctx.shadowColor = "rgba(75, 229, 142, 0.55)";
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#7cf4b2";
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsl(${150 - 18 * t} 64% ${56 - 23 * t}%)`;
    }

    ctx.beginPath();
    ctx.roundRect(x + 2.2, y + 2.2, CELL - 4.4, CELL - 4.4, i === 0 ? 9 : 7);
    ctx.fill();
  }
  ctx.restore();

  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  const perpX = -dy;
  const perpY = dx;
  const spread = CELL * 0.18;
  const forward = CELL * 0.16;

  ctx.save();
  ctx.fillStyle = "#062014";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      cx + dx * forward + perpX * spread * side,
      cy + dy * forward + perpY * spread * side,
      2.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function draw(now) {
  const width = COLS * CELL;
  const height = ROWS * CELL;

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#081216");
  background.addColorStop(0.55, "#060d11");
  background.addColorStop(1, "#07100d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width / 2,
    height / 2,
    30,
    width / 2,
    height / 2,
    width * 0.7,
  );
  glow.addColorStop(0, "rgba(75, 229, 142, 0.045)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawGrid(width, height);
  drawPath();
  drawFood(now);
  drawSnake();

  requestAnimationFrame(draw);
}

/* ------------------------------------------------------------------- boot */

resetGame();
requestAnimationFrame(draw);

// 演示模式：?demo=1 直接由 AI 接管，方便录制或截图。
if (new URLSearchParams(window.location.search).get("demo") === "1") {
  aiEnabled = true;
  syncAiButton();
  startGame();
}
