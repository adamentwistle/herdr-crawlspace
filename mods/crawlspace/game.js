// The rules. No app calls here, so tests can run it. step() moves everything on by dt seconds.
import { canSee, cast, doorKey, isDoor, solid, tileAt } from "./engine.js";
import { LEVELS } from "./levels.js";

export const SAVE_KEY = "crawlspace.save";
const RADIUS = 0.24;
const MOVE = 3.1;
const TURN = 2.5;

export const ENEMIES = {
  m: { kind: "mite", hp: 22, speed: 2.1, damage: 6, reach: 1.15, wait: 1.1, size: 0.5, points: 10 },
  s: { kind: "beetle", hp: 65, speed: 1.05, damage: 12, reach: 8, wait: 2.0, size: 0.85, spits: true, points: 40 },
  w: { kind: "wasp", hp: 32, speed: 2.9, damage: 9, reach: 1.2, wait: 1.1, size: 0.6, flies: true, points: 25 },
  Q: { kind: "queen", hp: 900, speed: 0.55, damage: 16, reach: 11, wait: 1.5, size: 1.7, spits: true, boss: true, points: 500 },
};

export const GUNS = {
  rivet: { name: "Rivet gun", ammo: "rivets", cost: 1, damage: 19, wait: 0.3, cone: 0, targets: 1 },
  zapper: { name: "Zapper", ammo: "cells", cost: 2, damage: 42, wait: 0.6, cone: 0.16, targets: 3 },
};

const ITEMS = {
  "+": { kind: "health" }, a: { kind: "rivets" }, c: { kind: "battery" }, K: { kind: "keyred" }, B: { kind: "keyblue" }, G: { kind: "helmet" }, Z: { kind: "zapper" },
};

export const freshPlayer = () => ({ x: 1.5, y: 1.5, a: 0, hp: 100, armor: 0, rivets: 40, cells: 0, gun: "rivet", guns: ["rivet"], red: false, blue: false });

export function loadLevel(index, carried, rng = Math.random) {
  const level = LEVELS[index];
  const player = { ...freshPlayer(), ...(carried ?? {}), red: false, blue: false };
  const enemies = [], items = [];
  const map = level.map.map((row, y) => [...row].map((tile, x) => {
    if (tile === "P") { player.x = x + 0.5; player.y = y + 0.5; player.a = 0; return "."; }
    if (ENEMIES[tile]) {
      enemies.push({ type: tile, ...ENEMIES[tile], x: x + 0.5, y: y + 0.5, awake: false, cool: rng() * 1.2, attack: 0, hurt: 0, dead: false });
      return ".";
    }
    if (ITEMS[tile]) { items.push({ ...ITEMS[tile], x: x + 0.5, y: y + 0.5 }); return "."; }
    return tile;
  }));
  return { phase: "play", level: index, map, doors: {}, player, enemies, items, shots: [], fx: [], kills: 0, score: carried?.score ?? 0, time: 0, cool: 0, firing: 0, pain: 0, note: level.name, noteFor: 3, sounds: [], rng };
}

export const newGame = (rng) => loadLevel(0, null, rng);

const say = (game, note, noteFor = 2.5) => { game.note = note; game.noteFor = noteFor; };

function tryMove(game, body, dx, dy, radius) {
  const free = (x, y) => !solid(game.map, game.doors, x + radius, y + radius) && !solid(game.map, game.doors, x - radius, y + radius)
    && !solid(game.map, game.doors, x + radius, y - radius) && !solid(game.map, game.doors, x - radius, y - radius);
  if (free(body.x + dx, body.y)) body.x += dx;
  if (free(body.x, body.y + dy)) body.y += dy;
}

// Which side a hit came from: -1 left, 1 right, 0 ahead, 2 behind.
export function sideOf(player, x, y) {
  let off = Math.atan2(y - player.y, x - player.x) - player.a;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  if (Math.abs(off) < 0.6) return 0;
  if (Math.abs(off) > 2.4) return 2;
  return off < 0 ? -1 : 1;
}

function hurtPlayer(game, damage, from) {
  const p = game.player;
  game.painSide = sideOf(p, from.x, from.y);
  const soaked = Math.min(p.armor, Math.ceil(damage / 2));
  p.armor -= soaked;
  p.hp -= damage - soaked;
  game.pain = 0.35;
  game.sounds.push("hurt");
  if (p.hp <= 0) { p.hp = 0; game.phase = "dead"; }
}

function hurtEnemy(game, enemy, damage) {
  enemy.hp -= damage;
  enemy.hurt = 0.14;
  enemy.awake = true;
  if (enemy.hp > 0) return;
  enemy.dead = true;
  game.kills += 1;
  game.score += enemy.points;
  game.sounds.push("splat");
  if (enemy.boss) say(game, "The queen is dead. Get to the hatch.", 4);
}

// What a shot can reach, nearest first.
function targets(game, cone) {
  const p = game.player;
  const found = [];
  for (const enemy of game.enemies) {
    if (enemy.dead) continue;
    const dx = enemy.x - p.x, dy = enemy.y - p.y, dist = Math.hypot(dx, dy);
    let off = Math.atan2(dy, dx) - p.a;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    const half = Math.atan2(enemy.size * 0.5, dist) + cone;
    if (Math.abs(off) > half) continue;
    if (!canSee(game.map, game.doors, p.x, p.y, enemy.x, enemy.y)) continue;
    found.push({ enemy, dist });
  }
  return found.sort((a, b) => a.dist - b.dist);
}

function fire(game) {
  const p = game.player, gun = GUNS[p.gun];
  if (game.cool > 0) return;
  if (p[gun.ammo] < gun.cost) {
    const other = p.guns.find((name) => p[GUNS[name].ammo] >= GUNS[name].cost);
    if (other) p.gun = other; else say(game, "Out of ammo");
    return;
  }
  p[gun.ammo] -= gun.cost;
  game.cool = gun.wait;
  game.firing = 0.12;
  game.sounds.push(p.gun);
  const kind = p.gun === "zapper" ? "zap" : "spark";
  const hits = targets(game, gun.cone).slice(0, gun.targets);
  for (const { enemy } of hits) {
    hurtEnemy(game, enemy, gun.damage);
    game.fx.push({ kind, x: enemy.x - Math.cos(p.a) * 0.2, y: enemy.y - Math.sin(p.a) * 0.2, left: 0.16 });
  }
  if (hits.length === 0) {
    const wall = cast(game.map, game.doors, p.x, p.y, Math.cos(p.a), Math.sin(p.a)).dist - 0.1;
    game.fx.push({ kind, x: p.x + Math.cos(p.a) * wall, y: p.y + Math.sin(p.a) * wall, left: 0.1 });
  }
}

function use(game) {
  const p = game.player;
  const tx = p.x + Math.cos(p.a) * 0.9, ty = p.y + Math.sin(p.a) * 0.9;
  const tile = tileAt(game.map, tx, ty);
  if (tile === "X") {
    if (game.enemies.some((enemy) => enemy.boss && !enemy.dead)) return say(game, "The hatch won't move while she lives.");
    game.phase = game.level + 1 >= LEVELS.length ? "won" : "clear";
    game.sounds.push("door");
    return;
  }
  if (!isDoor(tile)) return;
  if (tile === "r" && !p.red) return say(game, "Needs the red card");
  if (tile === "b" && !p.blue) return say(game, "Needs the blue card");
  const key = doorKey(tx, ty);
  if ((game.doors[key] ?? 0) === 0) { game.doors[key] = 0.01; game.sounds.push("door"); }
}

function pickUp(game) {
  const p = game.player;
  game.items = game.items.filter((item) => {
    if (Math.hypot(item.x - p.x, item.y - p.y) > 0.55) return true;
    if (item.kind === "health") { if (p.hp >= 100) return true; p.hp = Math.min(100, p.hp + 30); say(game, "First aid"); }
    if (item.kind === "rivets") { p.rivets = Math.min(200, p.rivets + 25); say(game, "Rivets"); }
    if (item.kind === "battery") { p.cells = Math.min(100, p.cells + 16); say(game, "Battery"); }
    if (item.kind === "helmet") { p.armor = Math.min(100, p.armor + 50); say(game, "Hard hat"); }
    if (item.kind === "keyred") { p.red = true; say(game, "Red card"); }
    if (item.kind === "keyblue") { p.blue = true; say(game, "Blue card"); }
    if (item.kind === "zapper") { p.guns.push("zapper"); p.gun = "zapper"; p.cells += 16; say(game, "Zapper. Press 2 to switch."); }
    if (item.kind === "crate") { p.hp = Math.min(100, p.hp + 15); p.rivets = Math.min(200, p.rivets + 15); p.cells = Math.min(100, p.cells + 6); say(game, "Supplies"); }
    game.sounds.push("pickup");
    return false;
  });
}

function moveEnemy(game, enemy, dt) {
  const p = game.player;
  enemy.cool -= dt;
  enemy.attack = Math.max(0, enemy.attack - dt);
  enemy.hurt = Math.max(0, enemy.hurt - dt);
  const dx = p.x - enemy.x, dy = p.y - enemy.y, dist = Math.hypot(dx, dy);
  const sees = dist < 12 && canSee(game.map, game.doors, enemy.x, enemy.y, p.x, p.y);
  if (!enemy.awake) { if (sees && dist < 9) enemy.awake = true; else return; }
  if (sees && dist <= enemy.reach && enemy.cool <= 0) {
    enemy.cool = enemy.wait;
    enemy.attack = 0.35;
    if (enemy.spits) {
      const spread = enemy.boss ? [-0.22, 0, 0.22] : [0];
      const angle = Math.atan2(dy, dx);
      for (const off of spread) game.shots.push({ x: enemy.x, y: enemy.y, dx: Math.cos(angle + off) * 5, dy: Math.sin(angle + off) * 5, damage: enemy.damage });
      game.sounds.push("spit");
    } else hurtPlayer(game, enemy.damage, enemy);
    if (enemy.boss && game.rng() < 0.4 && game.enemies.filter((other) => !other.dead).length < 14) {
      game.enemies.push({ type: "m", ...ENEMIES.m, x: enemy.x, y: enemy.y, awake: true, cool: 1, attack: 0, hurt: 0, dead: false });
    }
  }
  const keep = enemy.spits ? 3 : 0.9;
  if (dist > keep && enemy.attack === 0) {
    tryMove(game, enemy, (dx / dist) * enemy.speed * dt, (dy / dist) * enemy.speed * dt, 0.22);
  }
}

function moveShots(game, dt) {
  const p = game.player;
  game.shots = game.shots.filter((shot) => {
    shot.x += shot.dx * dt;
    shot.y += shot.dy * dt;
    if (Math.hypot(shot.x - p.x, shot.y - p.y) < 0.4) { hurtPlayer(game, shot.damage, { x: shot.x - shot.dx, y: shot.y - shot.dy }); return false; }
    return !solid(game.map, game.doors, shot.x, shot.y);
  });
}

export function step(game, input, dt) {
  if (game.phase !== "play") return game;
  const p = game.player;
  game.time += dt;
  game.cool = Math.max(0, game.cool - dt);
  game.firing = Math.max(0, game.firing - dt);
  game.pain = Math.max(0, game.pain - dt);
  game.noteFor = Math.max(0, game.noteFor - dt);

  p.a += (input.turn ?? 0) * TURN * dt + (input.look ?? 0);
  const cos = Math.cos(p.a), sin = Math.sin(p.a);
  const f = (input.forward ?? 0) * MOVE * dt, s = (input.strafe ?? 0) * MOVE * dt;
  game.moving = f !== 0 || s !== 0;
  tryMove(game, p, cos * f - sin * s, sin * f + cos * s, RADIUS);

  if (input.gun && p.guns.includes(input.gun)) p.gun = input.gun;
  if (input.fire) fire(game);
  if (input.use) use(game);
  if (game.phase !== "play") return game;
  pickUp(game);

  for (const key of Object.keys(game.doors)) if (game.doors[key] < 1) game.doors[key] = Math.min(1, game.doors[key] + dt * 1.8);
  for (const enemy of game.enemies) if (!enemy.dead) moveEnemy(game, enemy, dt);
  moveShots(game, dt);
  game.fx = game.fx.filter((fx) => (fx.left -= dt) > 0);
  return game;
}

// A finished agent turn drops a crate ahead and to the right, clear of the gun, or at your feet if that's a wall.
export function dropSupplies(game) {
  const p = game.player;
  const x = p.x + Math.cos(p.a + 0.5) * 1.5, y = p.y + Math.sin(p.a + 0.5) * 1.5;
  const clear = !solid(game.map, game.doors, x, y);
  game.items.push({ kind: "crate", x: clear ? x : p.x, y: clear ? y : p.y });
  say(game, "An agent finished. Supplies dropped.", 3);
  game.sounds.push("pickup");
}

export const carriedFrom = (game) => {
  const p = game.player;
  return { hp: p.hp, armor: p.armor, rivets: p.rivets, cells: p.cells, gun: p.gun, guns: [...p.guns], score: game.score };
};

export const nextLevel = (game) => loadLevel(game.level + 1, carriedFrom(game), game.rng);

// Dying restarts the level with what you brought into it.
export const retry = (game, carried) => loadLevel(game.level, carried ?? { score: game.score }, game.rng);

// Where the next Continue should start: the next level once this one is clear, nowhere after the last. Undefined leaves it alone.
export function checkpoint(game) {
  if (game.phase === "clear") return { level: game.level + 1, carried: carriedFrom(game) };
  if (game.phase === "won") return null;
  return undefined;
}

export const validSave = (save) => Number.isInteger(save?.level) && save.level >= 0 && save.level < LEVELS.length;

// A run in progress, as plain data. `status` is the agents as last seen, so a turn that ends while the game is closed still pays.
export function snapshot(game, carry, status) {
  const { rng: _rng, sounds: _sounds, ...rest } = game;
  return { game: rest, carry, status };
}

export function restore(live) {
  const saved = live?.game;
  if (!saved?.player || !Array.isArray(saved.map) || !Array.isArray(saved.enemies)) return null;
  const game = { phase: "play", level: 0, doors: {}, items: [], shots: [], fx: [], kills: 0, score: 0, time: 0, cool: 0, firing: 0, pain: 0, note: "", noteFor: 0, ...saved, rng: Math.random, sounds: [] };
  return { game, carry: live.carry ?? null, status: live.status ?? {} };
}

// What changed among the agents since last time: turns finished, and who is waiting now.
export function readAgents(before, list) {
  const now = {};
  let finished = 0;
  for (const agent of list) {
    now[agent.address] = agent.status;
    const was = before[agent.address];
    if ((was === "working" || was === "blocked") && (agent.status === "idle" || agent.status === "done")) finished += 1;
  }
  return { now, finished, blocked: list.filter((agent) => agent.status === "blocked"), working: list.filter((agent) => agent.status === "working").length };
}
