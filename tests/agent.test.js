import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTIONS,
  analyzeCandidates,
  decide,
  findPath,
  formatDecision,
  reachableArea,
  simulateMove,
} from "../src/agent.js";

const makeState = (overrides = {}) => ({
  width: 12,
  height: 12,
  snake: [
    { x: 6, y: 6 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
    { x: 3, y: 6 },
  ],
  food: { x: 9, y: 6 },
  lastAction: "右",
  lastStepReflect: "首次",
  ...overrides,
});

test("拒绝掉头：不会直接进入脖子所在格", () => {
  const state = makeState();
  const decision = decide(state);
  assert.notEqual(decision.action, "左");
  assert.ok(ACTIONS.includes(decision.action));
});

test("长度为 2 时也不会掉头", () => {
  const state = makeState({
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ],
  });
  const decision = decide(state);
  assert.notEqual(decision.action, "左");
});

test("不会撞墙：角落蛇头只选择合法方向", () => {
  const state = makeState({
    width: 8,
    height: 8,
    snake: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
    food: { x: 7, y: 7 },
    lastAction: "左",
  });
  const decision = decide(state);
  assert.equal(decision.action, "下");
  for (const candidate of decision.candidates) {
    if (candidate.action === "上" || candidate.action === "左") {
      assert.equal(candidate.legal, false);
    }
  }
});

test("生存优先：不钻进食物所在的死胡同", () => {
  // 蛇身围成完整的 5x5 环，内部只有 9 格；尾部留在环外，
  // 因此即使尾巴让位，内部依旧封闭。蛇长 17，食物在环内。
  // 贪心地向下会进入空间不足的口袋。
  const snake = [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 2 },
    { x: 5, y: 3 },
    { x: 5, y: 4 },
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
    { x: 2, y: 5 },
    { x: 1, y: 5 },
    { x: 1, y: 4 },
    { x: 1, y: 3 },
    { x: 1, y: 2 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 0 },
  ];
  const state = makeState({
    width: 7,
    height: 7,
    snake,
    food: { x: 3, y: 3 },
    lastAction: "右",
  });

  const candidates = analyzeCandidates(state);
  const down = candidates.find((c) => c.action === "下");
  assert.equal(down.legal, true);
  assert.equal(down.safe, false, "向下会进入仅 9 格的口袋");
  assert.ok(down.area < snake.length);

  const decision = decide(state);
  assert.equal(decision.action, "上", "唯一的安全出口在环外");

  const chosen = candidates.find((c) => c.action === decision.action);
  assert.equal(chosen.safe, true);
  assert.equal(chosen.tailPath, true);
  assert.match(decision.reasoning, /风险预判/);
});

test("有安全走法时，永远选择安全走法", () => {
  const states = [
    makeState(),
    makeState({ food: { x: 0, y: 0 } }),
    makeState({
      food: { x: 6, y: 7 },
      snake: [
        { x: 6, y: 6 },
        { x: 7, y: 6 },
        { x: 7, y: 7 },
        { x: 6, y: 7 },
        { x: 5, y: 7 },
        { x: 5, y: 6 },
      ],
    }),
    makeState({
      width: 10,
      height: 10,
      snake: [
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 5 },
      ],
      food: { x: 1, y: 1 },
    }),
  ];

  for (const state of states) {
    const candidates = analyzeCandidates(state);
    const hasSafe = candidates.some((c) => c.legal && c.safe);
    const decision = decide(state);
    const chosen = candidates.find((c) => c.action === decision.action);

    assert.ok(chosen, "必须返回合法动作");
    assert.equal(chosen.legal, true);
    assert.equal(simulateMove(state, decision.action).legal, true);
    if (hasSafe) assert.equal(chosen.safe, true);
  }
});

test("BFS 路径与可达空间计算正确", () => {
  const body = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
  ];
  assert.equal(reachableArea({ x: 0, y: 0 }, body, 5, 5), 22);
  const path = findPath({ x: 0, y: 0 }, { x: 0, y: 2 }, body, 5, 5);
  assert.equal(path.length, 3);
  assert.deepEqual(path[0], { x: 0, y: 0 });
  assert.deepEqual(path.at(-1), { x: 0, y: 2 });
});

test("严格输出格式：观察 / 推理 / 最终动作", () => {
  const decision = decide(makeState());
  const text = formatDecision(decision);
  const lines = text.split("\n");

  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("• 观察："));
  assert.ok(lines[1].startsWith("• 推理（包含风险预判）："));
  assert.ok(lines[2].startsWith("• 最终动作："));
  assert.ok(ACTIONS.includes(decision.action));
  assert.equal(lines[2], `• 最终动作：${decision.action}`);
  assert.match(lines[0], /蛇头位于 \(6,6\)/);
  assert.match(lines[0], /上一步：首次/);
});

test("反思信息会进入观察", () => {
  const decision = decide(
    makeState({ lastStepReflect: "向右，安全移动，未吃到食物；与食物距离 4→3" }),
  );
  assert.match(decision.observation, /向右，安全移动/);
  assert.match(decision.text, /上一步：向右，安全移动/);
});
