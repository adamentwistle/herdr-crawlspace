// Draws the game. Walls are one clipped image per column; everything is painted far to near, so sprites hide behind nearer columns.
import { div, image } from "gpui-kit";
import { castView, project } from "./engine.js";
import { GUNS } from "./game.js";
import { LEVELS } from "./levels.js";

const ART = "mods/crawlspace/art";
const TEX = 256;
const HUD = 76;
const WALLS = { "#": "block", R: "racks", S: "steel", H: "hive", D: "door", r: "door", b: "door", X: "hatch" };
const TINT = { r: "#d0302840", b: "#2860d040" };
const AMBER = "#f2b950";
const INK = "#0b0d10";
const DIM = "#8b949e";
const SHADES = Array.from({ length: 32 }, (_, i) => `#050709${Math.round((i / 31) * 235).toString(16).padStart(2, "0")}`);

const wallImage = (tile) => `${ART}/wall-${WALLS[tile] ?? "block"}.png`;
const shadeFor = (dist, side) => SHADES[Math.min(31, Math.floor(dist * 2.6 + (side ? 4 : 0)))];

function column(ray, i, cw, H) {
  const h = H / ray.dist, top = (H - h) / 2, sc = h / TEX, left = i * cw;
  const el = div().absolute().left(left).top(top).w(cw + 0.6).h(h).overflow_hidden()
    .child(image(wallImage(ray.tile)).absolute().left(-ray.u * TEX * sc).top(0).w(h).h(h));
  if (TINT[ray.tile]) el.child(div().absolute().left(0).top(0).w(cw + 1).h(h).bg(TINT[ray.tile]));
  return el.child(div().absolute().left(0).top(0).w(cw + 1).h(h).bg(shadeFor(ray.dist, ray.side)));
}

function sprite(player, x, y, name, size, lift, W, H, rays, fade = true) {
  const at = project(player, x, y);
  if (!at || at.depth > 20) return null;
  const wall = H / at.depth, px = wall * size;
  const cx = (W / 2) * (1 + at.screen / 0.66 * 0.66);
  if (cx < -px || cx > W + px) return null;
  const floor = H / 2 + wall / 2 - lift * wall;
  const el = image(`${ART}/${name}.png`).absolute().left(cx - px / 2).top(floor - px).w(px).h(px);
  return { depth: at.depth, el: fade ? el.opacity(Math.max(0.28, 1 - at.depth * 0.075)) : el };
}

function enemyFrame(enemy, time) {
  if (enemy.dead) return `${enemy.kind}-dead`;
  if (enemy.attack > 0) return `${enemy.kind}-attack`;
  return `${enemy.kind}-${Math.floor(time * 5 + enemy.x) % 2 ? "walk" : "idle"}`;
}

function world(game, W, H, cols) {
  const p = game.player, cw = W / cols;
  const rays = castView(game.map, game.doors, p, cols);
  const parts = rays.map((ray, i) => ({ depth: ray.dist, el: column(ray, i, cw, H) }));
  const add = (part) => { if (part) parts.push(part); };
  for (const item of game.items) add(sprite(p, item.x, item.y, item.kind === "crate" ? "item-rivets" : `item-${item.kind === "zapper" ? "battery" : item.kind}`, 0.32, 0, W, H, rays));
  for (const enemy of game.enemies) add(sprite(p, enemy.x, enemy.y, enemyFrame(enemy, game.time), enemy.dead ? enemy.size * 0.8 : enemy.size, enemy.flies && !enemy.dead ? 0.3 : 0, W, H, rays));
  for (const shot of game.shots) add(sprite(p, shot.x, shot.y, "fx-acid", 0.3, 0.35, W, H, rays, false));
  for (const fx of game.fx) add(sprite(p, fx.x, fx.y, `fx-${fx.kind}`, 0.45, 0.3, W, H, rays, false));
  parts.sort((a, b) => b.depth - a.depth);
  return parts.map((part) => part.el);
}

function gun(game, W, H) {
  const p = game.player, h = Math.min(H * 0.44, 340), w = h * (600 / 420);
  const bob = game.moving ? Math.sin(game.time * 9) * 9 : 0, kick = game.firing > 0 ? 12 : 0;
  return image(`${ART}/gun-${p.gun}-${game.firing > 0 ? "fire" : "rest"}.png`).absolute().left(W * 0.66 - w / 2 + bob).top(H - h + Math.abs(bob) * 0.5 + kick).w(w).h(h);
}

const label = (text, colour = DIM, size = 12) => div().text_size(size).text_color(colour).child(text);

function meter(name, value, colour) {
  return div().flex().flex_col().gap(3).w(128)
    .child(div().flex().justify_between().child(label(name)).child(label(String(Math.round(value)), "#e6edf3", 15)))
    .child(div().h(6).w(128).bg("#ffffff18").child(div().h(6).w(Math.min(128, value * 1.28)).bg(colour)));
}

function hud(game, W, H, link) {
  const p = game.player, g = GUNS[p.gun];
  const card = (on, colour) => div().w(14).h(20).rounded(2).bg(on ? colour : "#ffffff12");
  return div().absolute().left(0).top(H).w(W).h(HUD).bg(INK).border_t_1().border_color("#ffffff14").flex().items_center().gap(24).px(20)
    .child(meter("Health", p.hp, p.hp > 30 ? "#3fb950" : "#f85149"))
    .child(meter("Armor", p.armor, "#58a6ff"))
    .child(div().flex().flex_col().gap(2).child(label(g.name)).child(label(`${p[g.ammo]} ${g.ammo}`, AMBER, 18)))
    .child(div().flex().gap(5).child(card(p.red, "#e5534b")).child(card(p.blue, "#539bf5")))
    .child(div().flex_1())
    .child(div().flex().flex_col().gap(2).items_end().child(label(LEVELS[game.level].name)).child(label(`${game.score}`, "#e6edf3", 18)))
    .child(div().flex().flex_col().gap(2).items_end().child(label("Agents")).child(label(`${link.working} working`, link.working ? "#3fb950" : DIM, 13)));
}

// A picture scaled to cover the box, because image() keeps its shape and would leave bars.
function cover(path, W, H) {
  const h = Math.max(H, (W * 9) / 16), w = (h * 16) / 9;
  return image(path).absolute().left((W - w) / 2).top((H - h) / 2).w(w).h(h);
}

const centre = (W, H) => div().absolute().left(0).top(0).w(W).h(H).flex().flex_col().items_center().justify_center().gap(12);

function banner(text, W, top, colour) {
  return div().absolute().left(0).top(top).w(W).flex().justify_center()
    .child(div().px(14).py(6).rounded(4).bg("#000000b0").text_size(15).text_color(colour).child(text));
}

export function playView(game, box, link, paused) {
  const W = box.width, H = Math.max(120, box.height - HUD), cols = Math.max(80, Math.min(240, Math.floor(W / 3)));
  const stage = div().absolute().left(0).top(0).w(W).h(H).overflow_hidden()
    .child(cover(`${ART}/backdrop.jpg`, W, H))
    .children(world(game, W, H, cols))
    .child(gun(game, W, H))
    .child(div().absolute().left(W / 2 - 2).top(H / 2 - 2).w(4).h(4).rounded(2).bg("#ffffff90"));
  if (game.pain > 0) {
    stage.child(div().absolute().left(0).top(0).w(W).h(H).bg("#c0201030"));
    const edge = W * 0.1;
    if (game.painSide === -1) stage.child(div().absolute().left(0).top(0).w(edge).h(H).bg("#e0302080"));
    if (game.painSide === 1) stage.child(div().absolute().left(W - edge).top(0).w(edge).h(H).bg("#e0302080"));
    if (game.painSide === 2) stage.child(div().absolute().left(0).top(H - edge).w(W).h(edge).bg("#e0302080"));
  }
  if (game.noteFor > 0) stage.child(banner(game.note, W, 16, "#e6edf3"));
  if (link.blocked > 0) stage.child(banner(`${link.blocked === 1 ? "An agent needs" : `${link.blocked} agents need`} you. G to go.`, W, 56, "#ff7b72"));
  if (paused) stage.child(centre(W, H).bg("#00000090").child(label("Paused", "#e6edf3", 28)).child(label("Click to play", DIM, 14)));
  return [stage, hud(game, W, H, link)];
}

export function screenView(kind, box, info) {
  const W = box.width, H = box.height;
  const words = {
    title: ["CRAWLSPACE", info.canContinue ? "Enter to continue  ·  N for a new game" : "Enter to start"],
    dead: ["They got you", "Enter to try the level again"],
    clear: ["Level clear", `${info.kills} bugs  ·  Enter for the next level`],
    won: ["The crawlspace is clean", `Score ${info.score}  ·  Enter to play again`],
  }[kind];
  const out = [cover(`${ART}/title.jpg`, W, H), div().absolute().left(0).top(0).w(W).h(H).bg("#00000070"),
    centre(W, H).child(label(words[0], AMBER, kind === "title" ? 56 : 38)).child(label(words[1], "#e6edf3", 16))];
  if (kind === "title") out.push(div().absolute().left(0).top(H - 44).w(W).flex().justify_center()
    .child(label("WASD move  ·  arrows or mouse turn  ·  Space or click fire  ·  E open  ·  1 2 guns  ·  M sound", DIM, 13)));
  return out;
}
