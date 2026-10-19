/**
 * Snake Agent —— 生存优先的贪吃蛇决策器
 *
 * 决策优先级：
 *   1. 先保证存活：移动后仍有足够的可达空间，并尽量保留回到尾部的路径；
 *   2. 再靠近食物：在安全走法中选距离食物最短的一步；
 *   3. 永不掉头、撞墙、自噬。
 *
 * 该模块不依赖浏览器，可直接被 Node 测试或前端游戏复用。
 */

export const ACTIONS = ["上", "下", "左", "右"];

export const VECTORS = {
  上: { x: 0, y: -1 },
  下: { x: 0, y: 1 },
  左: { x: -1, y: 0 },
  右: { x: 1, y: 0 },
};

const OPPOSITE = { 上: "下", 下: "上", 左: "右", 右: "左" };

const keyOf = (p) => `${p.x},${p.y}`;
const same = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
const inside = (x, y, width, height) =>
  x >= 0 && y >= 0 && x < width && y < height;

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function neighbours(point, width, height) {
  const result = [];
  for (const action of ACTIONS) {
    const v = VECTORS[action];
    const next = { x: point.x + v.x, y: point.y + v.y };
    if (inside(next.x, next.y, width, height)) result.push(next);
  }
  return result;
}

/** 统计从 start 出发能到达的空格数量（含 start）。 */
export function reachableArea(start, body, width, height) {
  if (!start) return 0;
  const blocked = new Set(body.map(keyOf));
  blocked.delete(keyOf(start));
  const seen = new Set([keyOf(start)]);
  const queue = [start];

  for (let i = 0; i < queue.length; i += 1) {
    for (const next of neighbours(queue[i], width, height)) {
      const key = keyOf(next);
      if (seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen.size;
}

/**
 * BFS 最短路。body 中的格子视为障碍（起点和终点会自动放行）。
 * 返回包含起点与终点的坐标数组；不可达时返回 null。
 */
export function findPath(start, goal, body, width, height) {
  if (!start || !goal) return null;
  if (same(start, goal)) return [start];

  const blocked = new Set(body.map(keyOf));
  blocked.delete(keyOf(start));
  blocked.delete(keyOf(goal));

  const startKey = keyOf(start);
  const goalKey = keyOf(goal);
  const previous = new Map();
  const seen = new Set([startKey]);
  const queue = [start];

  for (let i = 0; i < queue.length; i += 1) {
    const current = queue[i];
    for (const next of neighbours(current, width, height)) {
      const key = keyOf(next);
      if (seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      previous.set(key, current);

      if (key === goalKey) {
        const path = [next];
        let cursor = current;
        while (cursor && keyOf(cursor) !== startKey) {
          path.push(cursor);
          cursor = previous.get(keyOf(cursor));
        }
        path.push(start);
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * 模拟一步移动，返回碰撞、进食、可达空间、尾部路径与食物路径等信息。
 */
export function simulateMove(state, action) {
  const vector = VECTORS[action];
  if (!vector) {
    return { action, legal: false, reason: "无效动作" };
  }

  const { snake, food, width, height } = state;
  const head = snake[0];
  const neck = snake[1];
  const next = { x: head.x + vector.x, y: head.y + vector.y };

  if (!inside(next.x, next.y, width, height)) {
    return { action, legal: false, reason: "撞墙", next };
  }

  // 几何判断：撞到脖子等价于掉头（长度为 2 时脖子就是尾巴）。
  if (neck && same(next, neck)) {
    return { action, legal: false, reason: "掉头", next };
  }

  const eating = Boolean(food) && same(next, food);
  const tail = snake[snake.length - 1];
  const tailVacates = !eating && snake.length > 1;
  const occupied = new Set(snake.map(keyOf));

  if (occupied.has(keyOf(next)) && !(tailVacates && same(next, tail))) {
    return { action, legal: false, reason: "自噬", next };
  }

  const newBody = [next, ...snake.map((p) => ({ ...p }))];
  if (!eating) newBody.pop();

  const area = reachableArea(next, newBody, width, height);
  const safe = area >= newBody.length;

  let tailPath = true;
  if (newBody.length > 1) {
    const tailPoint = newBody[newBody.length - 1];
    tailPath = Boolean(findPath(next, tailPoint, newBody, width, height));
  }

  const foodPath = food ? findPath(next, food, newBody, width, height) : null;
  const pathLength = foodPath ? foodPath.length - 1 : Infinity;

  return {
    action,
    legal: true,
    next,
    eating,
    newBody,
    area,
    safe,
    tailPath,
    foodPath,
    pathLength,
  };
}

export function analyzeCandidates(state) {
  return ACTIONS.map((action) => simulateMove(state, action));
}

/**
 * 选步策略：
 *   安全且有尾路 > 安全但无尾路 > 仅合法（选择空间最大者）。
 * 同一档内再按食物距离、可达空间排序。
 */
export function chooseCandidate(candidates) {
  const legal = candidates.filter((c) => c.legal);
  if (!legal.length) return { candidate: null, mode: "stuck" };

  const safe = legal.filter((c) => c.safe);
  const withTail = safe.filter((c) => c.tailPath);

  let pool;
  let mode;
  if (withTail.length) {
    pool = withTail;
    mode = "safe";
  } else if (safe.length) {
    pool = safe;
    mode = "tight";
  } else {
    pool = legal;
    mode = "desperate";
  }

  const sorted = [...pool].sort((a, b) => {
    if (mode === "desperate" && b.area !== a.area) return b.area - a.area;
    if (a.pathLength !== b.pathLength) return a.pathLength - b.pathLength;
    if (b.area !== a.area) return b.area - a.area;
    return ACTIONS.indexOf(a.action) - ACTIONS.indexOf(b.action);
  });

  return { candidate: sorted[0], mode };
}

function describeCandidate(c) {
  if (!c.legal) return `${c.action}（${c.reason}，排除）`;
  const space = c.safe ? "空间充足" : "空间不足";
  const tail = c.tailPath ? "有尾路" : "无尾路";
  const food = Number.isFinite(c.pathLength)
    ? `距食物 ${c.pathLength} 步`
    : "食物不可达";
  return `${c.action}（可达 ${c.area} 格，${space}，${tail}，${food}）`;
}

/**
 * 生成一步决策。返回可直接展示的三行文本与结构化数据。
 *
 * state = { width, height, snake, food, lastAction, lastStepReflect }
 */
export function decide(state) {
  const { snake, food, width, height } = state;
  const head = snake[0];
  const candidates = analyzeCandidates(state);
  const { candidate, mode } = chooseCandidate(candidates);
  const lastStep = (state.lastStepReflect || "首次").trim();

  const foodInfo = food
    ? `食物位于 (${food.x},${food.y})，曼哈顿距离 ${manhattan(head, food)}`
    : "食物已被吃完，棋盘即将填满";

  const observation =
    `蛇头位于 (${head.x},${head.y})，蛇身长度 ${snake.length}；` +
    `${foodInfo}；上一步：${lastStep}。`;

  if (!candidate) {
    const action = "上";
    const reasoning =
      `风险预判：四周均被墙壁或蛇身封锁，已无合法走法；` +
      `候选：${candidates.map(describeCandidate).join("；")}。`;
    const result = { action, observation, reasoning, candidates, plannedPath: null, mode };
    return { ...result, text: formatDecision(result) };
  }

  const legal = candidates.filter((c) => c.legal);
  const excluded = candidates.filter((c) => !c.legal);
  const reasons = [];

  if (excluded.length) {
    reasons.push(`排除 ${excluded.map((c) => `${c.action}（${c.reason}）`).join("、")}`);
  }
  reasons.push(`候选 ${legal.map(describeCandidate).join("；")}`);

  let risk;
  if (mode === "safe") {
    risk =
      `风险预判：选择「${candidate.action}」后可达 ${candidate.area} 格，` +
      `不小于蛇长 ${candidate.newBody.length}，且存在回到尾部的路径，不会钻进死胡同`;
    if (candidate.safe && candidate.pathLength <= 1) {
      risk += `；食物就在下一步，仍需确认进食后的空间足够`;
    }
  } else if (mode === "tight") {
    risk =
      `风险预判：没有同时满足空间与尾路的安全走法，` +
      `只能选择可达空间较大的「${candidate.action}」（${candidate.area} 格），仍有被围死风险`;
  } else {
    risk =
      `风险预判：当前没有安全走法，选择可达空间最大的「${candidate.action}」` +
      `（${candidate.area} 格），只能尽量拖延`;
  }

  const reasoning = `${reasons.join("；")}。${risk}。`;
  const result = {
    action: candidate.action,
    observation,
    reasoning,
    candidates,
    plannedPath: candidate.foodPath,
    mode,
  };

  return { ...result, text: formatDecision(result) };
}

/** 严格输出格式，供 UI 或外部 Agent 使用。 */
export function formatDecision({ observation, reasoning, action }) {
  return [
    `• 观察：${observation}`,
    `• 推理（包含风险预判）：${reasoning}`,
    `• 最终动作：${action}`,
  ].join("\n");
}

export { OPPOSITE, keyOf, same };
