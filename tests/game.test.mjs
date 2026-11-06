import assert from "node:assert/strict";
import test from "node:test";
import { cast, project, solid } from "../mods/crawlspace/engine.js";
import { GUNS, carriedFrom, dropSupplies, loadLevel, newGame, nextLevel, readAgents, step } from "../mods/crawlspace/game.js";
import { LEVELS } from "../mods/crawlspace/levels.js";

const WALL = "#RSH";

// Walks a level from P, opening plain doors, then card doors once the card is reached.
function reach(level) {
  const rows = level.map;
  let start;
  rows.forEach((row, y) => [...row].forEach((tile, x) => { if (tile === "P") start = [x, y]; }));
  const seen = new Set([start.join()]), held = new Set();
  let queue = [start], stuck = [];
  const found = new Set();
  while (queue.length) {
    const [x, y] = queue.pop();
    const tile = rows[y][x];
    found.add(tile);
    if (tile === "K") held.add("r");
    if (tile === "B") held.add("b");
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = rows[ny]?.[nx];
      if (!next || WALL.includes(next) || seen.has(`${nx},${ny}`)) continue;
      if ("rb".includes(next) && !held.has(next)) { stuck.push([nx, ny]); continue; }
      seen.add(`${nx},${ny}`);
      queue.push([nx, ny]);
    }
    if (!queue.length && stuck.length) {
      queue = stuck.filter(([sx, sy]) => held.has(rows[sy][sx]) && !seen.has(`${sx},${sy}`));
      queue.forEach(([sx, sy]) => seen.add(`${sx},${sy}`));
      stuck = stuck.filter(([sx, sy]) => !held.has(rows[sy][sx]));
    }
  }
  return found;
}

test("every level is square, has one start and a hatch you can reach", () => {
  for (const level of LEVELS) {
    assert.ok(level.map.every((row) => row.length === level.map[0].length), level.name);
    assert.equal(level.map.join("").split("P").length - 1, 1, level.name);
    assert.ok(reach(level).has("X"), `${level.name}: hatch unreachable`);
  }
});

test("every enemy and item in a level can be reached", () => {
  for (const level of LEVELS) {
    const found = reach(level);
    for (const tile of new Set(level.map.join(""))) {
      if ("#RSHDrb".includes(tile)) continue;
      assert.ok(found.has(tile), `${level.name}: ${tile} unreachable`);
    }
  }
});

test("a ray stops at the first wall", () => {
  const map = ["#####", "#...#", "#####"].map((row) => [...row]);
  const hit = cast(map, {}, 1.5, 1.5, 1, 0);
  assert.ok(Math.abs(hit.dist - 2.5) < 1e-9);
  assert.equal(hit.tile, "#");
});

test("an open door lets a ray through and a body pass", () => {
  const map = ["#####", "#.D.#", "#####"].map((row) => [...row]);
  assert.equal(cast(map, {}, 1.5, 1.5, 1, 0).tile, "D");
  assert.equal(cast(map, { "2,1": 1 }, 1.5, 1.5, 1, 0).tile, "#");
  assert.equal(solid(map, {}, 2.5, 1.5), true);
  assert.equal(solid(map, { "2,1": 1 }, 2.5, 1.5), false);
});

test("something dead ahead lands at the centre of the view, and behind you nowhere", () => {
  const player = { x: 1, y: 1, a: 0 };
  const ahead = project(player, 4, 1);
  assert.ok(Math.abs(ahead.screen) < 1e-9);
  assert.ok(Math.abs(ahead.depth - 3) < 1e-9);
  assert.equal(project(player, -2, 1), null);
});

test("you can't walk through a wall", () => {
  const game = newGame(() => 0.5);
  for (let i = 0; i < 200; i++) step(game, { forward: 1 }, 0.03);
  assert.ok(game.player.x < 4, `walked to ${game.player.x}`);
});

test("a shot spends ammo and hurts what it hits", () => {
  const game = newGame(() => 0.5);
  const enemy = game.enemies[0];
  enemy.x = game.player.x + 2; enemy.y = game.player.y; enemy.awake = false;
  const before = enemy.hp, rivets = game.player.rivets;
  step(game, { fire: true }, 0.03);
  assert.equal(game.player.rivets, rivets - 1);
  assert.equal(enemy.hp, before - GUNS.rivet.damage);
});

test("running out of health ends the run", () => {
  const game = newGame(() => 0.5);
  game.player.hp = 1;
  const enemy = game.enemies[0];
  enemy.x = game.player.x + 0.6; enemy.y = game.player.y; enemy.cool = 0;
  for (let i = 0; i < 40 && game.phase === "play"; i++) step(game, {}, 0.03);
  assert.equal(game.phase, "dead");
});

test("the last hatch stays shut while the queen lives", () => {
  const game = loadLevel(2, null, () => 0.5);
  const y = game.map.findIndex((row) => row.includes("X")), x = game.map[y].indexOf("X");
  Object.assign(game.player, { x: x + 0.5, y: y - 0.5, a: Math.PI / 2 });
  game.enemies.forEach((enemy) => { enemy.awake = false; enemy.x = 2.5; enemy.y = 2.5; });
  step(game, { use: true }, 0.03);
  assert.equal(game.phase, "play");
  game.enemies.forEach((enemy) => { enemy.dead = true; });
  step(game, { use: true }, 0.03);
  assert.equal(game.phase, "won");
});

test("a card door needs its card", () => {
  const game = newGame(() => 0.5);
  const y = game.map.findIndex((row) => row.includes("r")), x = game.map[y].indexOf("r");
  Object.assign(game.player, { x: x + 0.5, y: y - 0.5, a: Math.PI / 2 });
  game.enemies.forEach((enemy) => { enemy.dead = true; });
  step(game, { use: true }, 0.03);
  assert.equal(Object.keys(game.doors).length, 0);
  game.player.red = true;
  step(game, { use: true }, 0.03);
  assert.equal(Object.keys(game.doors).length, 1);
});

test("the next level keeps your health and guns, and not your cards", () => {
  const game = newGame(() => 0.5);
  game.player.hp = 55; game.player.red = true; game.player.guns.push("zapper");
  const next = nextLevel(game);
  assert.equal(next.player.hp, 55);
  assert.equal(next.player.red, false);
  assert.deepEqual(next.player.guns, ["rivet", "zapper"]);
  assert.equal(carriedFrom(next).score, game.score);
});

test("a finished agent turn is counted once, and a crate lands in reach", () => {
  const first = readAgents({}, [{ address: "a", status: "working" }, { address: "b", status: "blocked" }]);
  assert.equal(first.finished, 0);
  assert.equal(first.working, 1);
  assert.equal(first.blocked.length, 1);
  const second = readAgents(first.now, [{ address: "a", status: "done" }, { address: "b", status: "blocked" }]);
  assert.equal(second.finished, 1);
  assert.equal(readAgents(second.now, [{ address: "a", status: "idle" }]).finished, 0);
  const game = newGame(() => 0.5);
  dropSupplies(game);
  const crate = game.items.at(-1);
  assert.equal(crate.kind, "crate");
  assert.equal(solid(game.map, game.doors, crate.x, crate.y), false);
});

test("a bite from the left is reported as the left", async () => {
  const { sideOf } = await import("../mods/crawlspace/game.js");
  const player = { x: 5, y: 5, a: 0 };
  assert.equal(sideOf(player, 5, 4), -1);
  assert.equal(sideOf(player, 5, 6), 1);
  assert.equal(sideOf(player, 7, 5), 0);
  assert.equal(sideOf(player, 3, 5), 2);
});

test("a mite stops where you can still see it, and can still bite", () => {
  const game = newGame(() => 0.5);
  const enemy = game.enemies[0];
  enemy.x = game.player.x + 2.2; enemy.y = game.player.y; enemy.awake = true; enemy.cool = 0;
  game.enemies = [enemy];
  game.map[1][2] = "."; game.map[1][3] = "."; game.map[1][4] = ".";
  for (let i = 0; i < 120; i++) step(game, {}, 0.03);
  assert.ok(Math.hypot(enemy.x - game.player.x, enemy.y - game.player.y) >= 0.85);
  assert.ok(game.player.hp < 100);
});

test("a rivet can't reach a bug behind a wall", () => {
  const game = newGame(() => 0.5);
  game.map = ["#######", "#..#..#", "#.....#", "#######"].map((row) => [...row]);
  Object.assign(game.player, { x: 1.5, y: 2.5, a: 0 });
  const enemy = game.enemies[0];
  game.enemies = [enemy];
  Object.assign(enemy, { x: 4.5, y: 1.5, awake: false, size: 3 });
  const before = enemy.hp;
  step(game, { fire: true }, 0.03);
  assert.equal(enemy.hp, before);
});

test("reaching the hatch can't be undone by a bite in the same moment", () => {
  const game = newGame(() => 0.5);
  const y = game.map.findIndex((row) => row.includes("X")), x = game.map[y].indexOf("X");
  Object.assign(game.player, { x: x + 0.5, y: y - 0.5, a: Math.PI / 2, hp: 1 });
  const enemy = game.enemies[0];
  game.enemies = [enemy];
  Object.assign(enemy, { x: x + 1.5, y: y - 0.5, awake: true, cool: 0 });
  step(game, { use: true }, 0.03);
  assert.equal(game.phase, "clear");
});

test("a finished level moves the checkpoint on, and winning clears it", async () => {
  const { checkpoint } = await import("../mods/crawlspace/game.js");
  const game = newGame(() => 0.5);
  assert.equal(checkpoint(game), undefined);
  game.phase = "clear";
  assert.equal(checkpoint(game).level, 1);
  game.phase = "won";
  assert.equal(checkpoint(game), null);
  game.phase = "dead";
  assert.equal(checkpoint(game), undefined);
});

test("a saved run comes back through JSON and keeps playing, and a short one gets defaults", async () => {
  const { restore, snapshot } = await import("../mods/crawlspace/game.js");
  const game = newGame(() => 0.5);
  game.doors["4,3"] = 1;
  const live = JSON.parse(JSON.stringify(snapshot(game, { hp: 90 }, { t1: "working" })));
  const back = restore(live);
  assert.equal(back.game.doors["4,3"], 1);
  assert.deepEqual(back.status, { t1: "working" });
  assert.equal(back.carry.hp, 90);
  step(back.game, { forward: 1, fire: true }, 0.03);
  const { fx: _fx, shots: _shots, ...short } = live.game;
  const old = restore({ game: short });
  step(old.game, {}, 0.03);
  assert.equal(old.game.phase, "play");
  assert.equal(restore({ game: { player: {} } }), null);
  assert.equal(restore(null), null);
});

test("a save pointing past the last level is ignored", async () => {
  const { validSave } = await import("../mods/crawlspace/game.js");
  assert.equal(validSave({ level: 1, carried: {} }), true);
  assert.equal(validSave({ level: 99, carried: {} }), false);
  assert.equal(validSave(null), false);
});
