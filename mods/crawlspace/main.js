// Crawlspace: a first-person bug hunt to play while your agents work. A finished agent turn drops supplies, and a blocked agent shows a banner with a key to go to it.
import { View, div } from "gpui-kit";
import { agents, nextCommand, playSound, props, run, setShared, settings, shared, closeOverlay } from "herdr";
import { playView, screenView } from "./view.js";
import { SAVE_KEY, carriedFrom, checkpoint, dropSupplies, loadLevel, newGame, nextLevel, readAgents, restore, retry, snapshot, step, validSave } from "./game.js";

const SOUND_KEY = "crawlspace.sound";
const LIVE_KEY = "crawlspace.live";
const FIRST_BOX = { width: 960, height: 640 };
const SOUNDS = new Set(["rivet", "zapper", "hurt", "splat", "pickup", "door", "spit"]);

export default class Crawlspace extends View {
  init(_initial, cx) {
    const given = props() ?? {};
    this.overlay = given.overlay ?? null;
    this.demo = Boolean(given.demo);
    this.handle = cx.focus_handle();
    this.held = new Set();
    this.once = new Set();
    this.look = 0;
    this.pixels = null;
    this.screen = "title";
    this.game = null;
    this.startCarry = null;
    this.status = {};
    this.link = { working: 0, blocked: 0, first: null };
    this.sound = shared(SOUND_KEY) !== false;
    this.last = Date.now();
    this.nextAgents = 0;
    if (this.demo) this.begin(newGame());
    else this.resume();
    this.ticker = cx.timer.every(16, (c) => this.tick(c));
    cx.spawn(async (c) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        if (command === "start") this.enter();
        c.notify();
      }
    });
  }

  close() {
    this.closed = true;
    this.ticker?.cancel();
    this.keep();
  }

  // Closing the game keeps your place, so going to an agent costs nothing.
  keep() {
    if (this.demo || this.screen !== "play" || !this.game) return;
    setShared(LIVE_KEY, snapshot(this.game, this.startCarry, this.status));
  }

  resume() {
    const live = restore(shared(LIVE_KEY));
    if (!live) return;
    this.game = live.game;
    this.startCarry = live.carry ?? carriedFrom(live.game);
    this.status = live.status;
    this.screen = "play";
    setShared(LIVE_KEY, null);
  }

  box() {
    const zoom = settings().zoom || 1;
    return this.pixels ? { width: this.pixels.width / zoom, height: this.pixels.height / zoom } : FIRST_BOX;
  }

  begin(game) {
    this.game = game;
    this.screen = "play";
    this.startCarry = carriedFrom(game);
    if (!this.demo) setShared(SAVE_KEY, { level: game.level, carried: this.startCarry });
  }

  enter() {
    if (this.screen === "title") {
      const saved = shared(SAVE_KEY);
      this.begin(validSave(saved) ? loadLevel(saved.level, saved.carried) : newGame());
    } else if (this.screen === "dead") this.begin(retry(this.game, this.startCarry));
    else if (this.screen === "clear") this.begin(nextLevel(this.game));
    else if (this.screen === "won") { setShared(SAVE_KEY, null); this.begin(newGame()); }
  }

  readAgents() {
    const seen = readAgents(this.status, agents());
    this.status = seen.now;
    this.link = { working: seen.working, blocked: seen.blocked.length, first: seen.blocked[0]?.address ?? null };
    if (seen.finished > 0 && this.game && this.screen === "play") for (let i = 0; i < seen.finished; i++) dropSupplies(this.game);
  }

  input() {
    const on = (...names) => names.some((name) => this.held.has(name));
    const input = {
      forward: (on("w", "up") ? 1 : 0) - (on("s", "down") ? 1 : 0),
      strafe: (on("d") ? 1 : 0) - (on("a") ? 1 : 0),
      turn: (on("right") ? 1 : 0) - (on("left") ? 1 : 0),
      look: this.look,
      fire: on("space", "mouse"),
      use: this.once.has("e"),
      gun: this.once.has("1") ? "rivet" : this.once.has("2") ? "zapper" : null,
    };
    this.look = 0;
    this.once.clear();
    return input;
  }

  tick(cx) {
    if (this.closed) return;
    const now = Date.now(), dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (now >= this.nextAgents) {
      this.nextAgents = now + 1000;
      this.readAgents();
    }
    if (this.overlay != null && !this.focusAsked) { this.focusAsked = true; this.handle.focus(); }
    const focused = this.handle.is_focused();
    if (!focused && this.held.size > 0) this.held.clear();
    this.paused = !focused;
    if (this.screen !== "play" || this.paused) {
      if (now - (this.lastIdle ?? 0) > 500 || this.wasPlaying) { this.lastIdle = now; this.wasPlaying = false; cx.notify(); }
      return;
    }
    this.wasPlaying = true;
    const game = this.game;
    step(game, this.input(), dt);
    for (const name of game.sounds.splice(0)) if (this.sound && SOUNDS.has(name)) playSound(`mods/crawlspace/sound/${name}.mp3`);
    if (game.phase !== "play") {
      this.screen = game.phase;
      const next = checkpoint(game);
      if (next !== undefined) setShared(SAVE_KEY, next);
    }
    cx.notify();
  }

  goToAgent() {
    if (!this.link.first) return;
    const terminal = this.link.first;
    if (this.overlay != null) closeOverlay(this.overlay);
    run("agent.focus", { terminal });
  }

  keyDown(event, cx) {
    const key = event.key;
    if (key === "g") this.goToAgent();
    else if (key === "enter") this.enter();
    else if (key === "n" && this.screen === "title") { setShared(SAVE_KEY, null); this.begin(newGame()); }
    else if (key === "m") { this.sound = !this.sound; setShared(SOUND_KEY, this.sound); }
    else if (key === "e" || key === "1" || key === "2") this.once.add(key);
    else this.held.add(key);
    cx.notify();
  }

  render() {
    const box = this.box();
    const kids = this.screen === "play"
      ? playView(this.game, box, this.link, this.paused)
      : screenView(this.screen, box, { canContinue: validSave(shared(SAVE_KEY)), kills: this.game?.kills ?? 0, score: this.game?.score ?? 0 });
    return div().id("crawlspace").relative().size_full().overflow_hidden().bg("#050709").track_focus(this.handle)
      .on_size_change((size) => { this.pixels = size; })
      .on_key_down((event, cx) => this.keyDown(event, cx))
      .on_key_up((event) => { this.held.delete(event.key); })
      .on_mouse_down("left", () => { this.handle.focus(); if (this.screen === "play" && !this.paused) this.held.add("mouse"); })
      .on_mouse_up("left", () => { this.held.delete("mouse"); })
      .on_mouse_move((event) => {
        const x = event.position.x;
        if (this.mouseX != null && !this.paused) this.look += (x - this.mouseX) * 0.0035;
        this.mouseX = x;
      })
      .children(kids);
  }
}
