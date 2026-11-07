const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "PlayerPlaylistControls.js");

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.events = new Map();
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this._text = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set(this.className.split(/\s+/).filter(Boolean).concat(names))].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classList.contains(name) : force;
        this.classList[enabled ? "add" : "remove"](name);
        return enabled;
      },
    };
  }
  get id() { return this.attributes.id || ""; }
  set id(value) { this.attributes.id = value; }
  get className() { return this.attributes.class || ""; }
  set className(value) { this.attributes.class = value; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children.forEach((child) => { child.parentNode = null; }); this.children = []; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children.at(-1) || null; }
  get parentElement() { return this.parentNode; }
  get isConnected() { return Boolean(this.parentNode && (this.parentNode.tagName === "HTML" || this.parentNode.isConnected)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    if (child.parentNode) child.remove();
    const index = this.children.indexOf(reference);
    assert.notEqual(index, -1);
    child.parentNode = this;
    this.children.splice(index, 0, child);
    return child;
  }
  insertAdjacentElement(position, child) {
    if (position === "beforeend") return this.appendChild(child);
    if (position === "afterbegin") return this.insertBefore(child, this.firstChild);
    return this.parentNode.insertBefore(child, position === "beforebegin" ? this : this.parentNode.children[this.parentNode.children.indexOf(this) + 1]);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(callback);
  }
  removeEventListener(name, callback) { this.events.set(name, (this.events.get(name) || []).filter((fn) => fn !== callback)); }
  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => {};
    event.stopPropagation ||= () => {};
    (this.events.get(event.type) || []).forEach((callback) => callback.call(this, event));
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: "click" }); }
  focus() {}
  matches(selector) {
    return selector.split(",").some((part) => {
      const chain = part.trim().replace(/\s*>\s*/g, " ").split(/\s+/);
      const simple = (element, token) => {
        if (!element) return false;
        const tag = token.match(/^[a-z][a-z0-9-]*/i);
        if (tag && tag[0].toUpperCase() !== element.tagName) return false;
        const id = token.match(/#([\w-]+)/);
        if (id && element.id !== id[1]) return false;
        if ([...token.matchAll(/\.([\w-]+)/g)].some((match) => !element.classList.contains(match[1]))) return false;
        for (const match of token.matchAll(/\[([\w-]+)(?:[=]?["']?([^\]"']*)["']?)?\]/g)) {
          const value = element.getAttribute(match[1]);
          if (value === null || (match[2] && value !== match[2])) return false;
        }
        return true;
      };
      if (!simple(this, chain.pop())) return false;
      let ancestor = this.parentNode;
      while (chain.length) {
        const token = chain.pop();
        while (ancestor && !simple(ancestor, token)) ancestor = ancestor.parentNode;
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    });
  }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    return selector === "*" ? descendants : descendants.filter((child) => child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
}

function harness({ repeat = false, responder } = {}) {
  const root = new Element("html");
  const head = root.appendChild(new Element("head"));
  const body = root.appendChild(new Element("body"));
  const videoRoot = body.appendChild(new Element("div"));
  videoRoot.id = "stash-player";
  videoRoot.className = "video-js";
  const video = videoRoot.appendChild(new Element("video"));
  video.className = "vjs-tech";
  const controls = videoRoot.appendChild(new Element("div"));
  controls.className = "vjs-control-bar";
  const fullscreen = controls.appendChild(new Element("button"));
  fullscreen.className = "vjs-fullscreen-control";
  const documentEvents = new Element("document");
  const document = {
    readyState: "complete", documentElement: root, head, body,
    createElement: (name) => new Element(name),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    getElementById: (id) => root.querySelector("#" + id),
    contains: (element) => root.contains(element),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  };
  let time = 17;
  let looping = false;
  const playerEvents = new Element("player");
  const player = {
    el: () => videoRoot,
    isDisposed: () => false,
    currentTime(value) { if (value !== undefined) time = value; return time; },
    loop(value) { if (value !== undefined) looping = value; return looping; },
    playCalls: 0,
    play() { this.playCalls += 1; return Promise.resolve(); },
    on: playerEvents.addEventListener.bind(playerEvents),
    off: playerEvents.removeEventListener.bind(playerEvents),
    ready(callback) { callback.call(this); },
    paused: () => false,
  };
  videoRoot.player = player;
  const storage = new Map([["stash-player-playlist.repeat", String(repeat)]]);
  const timers = new Map();
  const intervals = [];
  const patches = new Map();
  const requests = [];
  const navigations = [];
  const errors = [];
  const windowEvents = new Element("window");
  let timerId = 0;
  const window = {
    document,
    location: {
      pathname: "/scenes/42", search: "?continue=true", origin: "http://localhost:6974",
      href: "http://localhost:6974/scenes/42?continue=true",
      assign(url) { navigations.push(String(url)); },
    },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout(callback, delay = 0) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    alert(message) { errors.push(String(message)); },
    PluginApi: {
      patch: { before(name, callback) { patches.set(name, callback); } },
      utils: { InteractiveUtils: { getPlayer: () => player } },
      Event: { addEventListener: windowEvents.addEventListener.bind(windowEvents) },
    },
  };
  const fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const payload = await responder?.(request, requests.length);
    return { ok: true, status: 200, json: async () => payload || { data: {} } };
  };
  window.fetch = fetch;
  const context = {
    window, document, URL, URLSearchParams, Promise,
    MutationObserver: class { observe() {} disconnect() {} },
    Element, HTMLElement: Element, HTMLVideoElement: Element,
    localStorage: window.localStorage,
    location: window.location,
    fetch,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    requestAnimationFrame: (callback) => window.setTimeout(callback),
    console: { error: (...args) => errors.push(args.join(" ")), warn: (...args) => errors.push(args.join(" ")), log() {} },
  };
  window.requestAnimationFrame = context.requestAnimationFrame;
  vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  async function settle() {
    for (let pass = 0; pass < 40; pass += 1) {
      await Promise.resolve();
      const ready = [...timers].filter(([, timer]) => timer.delay <= 300);
      for (const [id, timer] of ready) { timers.delete(id); timer.callback(); }
    }
  }
  return { window, document, player, controls, storage, patches, requests, navigations, errors, settle, intervals };
}

const scene = {
  id: "42",
  files: [{ parent_folder: { id: "81", path: "D:\\Media (A)&B\\folder" } }],
  performers: [{ id: "7", name: "One" }, { id: "9", name: "Two" }],
};

function playlistResponder(request) {
  return request.query.includes("findScenes")
    ? { data: { findScenes: { count: 3, scenes: [{ id: "98" }] } } }
    : { data: { findScene: scene } };
}

function inputContaining(variables, field) {
  return Object.values(variables).find((value) => value && typeof value === "object" && Object.hasOwn(value, field));
}

test("Repeat ON replays the current scene without continuing an enabled queue", async () => {
  const h = harness({ repeat: true });
  await h.settle();
  let continued = 0;
  const patch = h.patches.get("ScenePlayer");
  assert.equal(typeof patch, "function");
  const [props] = patch({ scene, onComplete: () => { continued += 1; }, permitLoop: true });
  props.onComplete();
  await h.settle();
  assert.equal(continued, 0);
  assert.equal(h.player.currentTime(), 0);
  assert.ok(h.player.playCalls >= 1);
});

test("Repeat OFF forwards completion and disables Stash's automatic short-video loop", async () => {
  const h = harness();
  await h.settle();
  let continued = 0;
  const [props] = h.patches.get("ScenePlayer")({ scene, onComplete: () => { continued += 1; }, permitLoop: true });
  assert.equal(props.permitLoop, false);
  props.onComplete();
  assert.equal(continued, 1);
  assert.equal(h.player.playCalls, 0);
});

test("repeat control updates completion behavior without waiting for React to render again", async () => {
  const h = harness();
  await h.settle();
  let continued = 0;
  const [props] = h.patches.get("ScenePlayer")({ scene, onComplete: () => { continued += 1; } });
  const button = h.document.getElementById("spc-repeat-button");
  assert.ok(button, "repeat button is present in the player controls");
  assert.ok(h.controls.contains(button));
  assert.match(button.textContent, /Repeat OFF/);
  button.click();
  assert.match(button.textContent, /Repeat ON/);
  props.onComplete();
  assert.equal(continued, 0);
  button.click();
  props.onComplete();
  assert.equal(continued, 1);
});

test("folder playlist uses only the direct folder and a matching seeded native queue", async () => {
  const h = harness({ repeat: true, responder: playlistResponder });
  await h.settle();
  h.document.getElementById("spc-folder-button").click();
  await h.settle();
  assert.equal(h.navigations.length, 1);
  const request = h.requests.find((item) => item.query.includes("findScenes"));
  const filter = inputContaining(request.variables, "files_filter");
  assert.deepEqual(JSON.parse(JSON.stringify(filter.files_filter.parent_folder)), { value: ["81"], modifier: "INCLUDES", depth: 0 });
  const findFilter = inputContaining(request.variables, "sort");
  const url = new URL(h.navigations[0], h.window.location.origin);
  assert.equal(url.pathname, "/scenes/98");
  assert.equal(url.searchParams.get("qsort"), findFilter.sort);
  assert.match(findFilter.sort, /^random_\d+$/);
  assert.equal(findFilter.page, 1);
  assert.equal(findFilter.per_page, 1);
  assert.equal(findFilter.direction, "ASC");
  assert.equal(url.searchParams.get("qfp"), "1");
  assert.equal(url.searchParams.get("continue"), "true");
  assert.equal(url.searchParams.get("autoplay"), "true");
  const criterion = JSON.parse(url.searchParams.get("qfc"));
  assert.equal(criterion.type, "folder");
  assert.equal(criterion.value.depth, 0);
  assert.equal(criterion.value.items[0].label, scene.files[0].parent_folder.path);
  assert.equal(h.storage.get("stash-player-playlist.repeat"), "false");
});

test("performer playlist includes any current performer and keeps those original IDs in its queue", async () => {
  const h = harness({ responder: playlistResponder });
  await h.settle();
  h.document.getElementById("spc-performer-button").click();
  await h.settle();
  assert.equal(h.navigations.length, 1);
  const request = h.requests.find((item) => item.query.includes("findScenes"));
  const filter = inputContaining(request.variables, "performers");
  assert.equal(filter.performers.modifier, "INCLUDES");
  assert.deepEqual(Array.from(filter.performers.value), ["7", "9"]);
  const url = new URL(h.navigations[0], h.window.location.origin);
  const criterion = JSON.parse(url.searchParams.get("qfc"));
  assert.equal(criterion.type, "performers");
  assert.equal(criterion.modifier, "INCLUDES");
  assert.deepEqual(criterion.value.items.map((item) => item.id), ["7", "9"]);
});

test("missing performer metadata does not create an unfiltered queue", async () => {
  const h = harness({ responder: () => ({ data: { findScene: { ...scene, performers: [] } } }) });
  await h.settle();
  const button = h.document.getElementById("spc-performer-button");
  button.click();
  await h.settle();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(button.disabled, false);
});

test("GraphQL failures keep the current scene and release loading controls", async () => {
  const h = harness({ responder: () => ({ errors: [{ message: "query failed" }] }) });
  await h.settle();
  const button = h.document.getElementById("spc-folder-button");
  button.click();
  await h.settle();
  assert.equal(h.navigations.length, 0);
  assert.equal(button.disabled, false);
  assert.ok(h.errors.length || /실패|오류/.test(button.textContent), "failure is surfaced");
});

test("a playlist response arriving after navigation cannot replace the new scene", async () => {
  let resolveScene;
  const h = harness({ responder: () => new Promise((resolve) => { resolveScene = resolve; }) });
  await h.settle();
  h.document.getElementById("spc-folder-button").click();
  await h.settle();
  h.window.location.pathname = "/scenes/99";
  h.window.location.href = h.window.location.origin + "/scenes/99";
  resolveScene({ data: { findScene: scene } });
  await h.settle();
  assert.equal(h.navigations.length, 0);
});

test("playlist controls prevent duplicate work while a request is pending", async () => {
  let resolveScene;
  const h = harness({ responder: () => new Promise((resolve) => { resolveScene = resolve; }) });
  await h.settle();
  const folder = h.document.getElementById("spc-folder-button");
  const performer = h.document.getElementById("spc-performer-button");
  folder.click();
  folder.click();
  performer.click();
  await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(folder.disabled, true);
  assert.equal(performer.disabled, true);
  resolveScene({ errors: [{ message: "failed" }] });
  await h.settle();
  assert.equal(folder.disabled, false);
  assert.equal(performer.disabled, false);
});

test("a first-result response arriving after navigation cannot start its stale queue", async () => {
  let resolveFirst;
  const h = harness({
    repeat: true,
    responder: (request) => request.query.includes("findScenes")
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : { data: { findScene: scene } },
  });
  await h.settle();
  h.document.getElementById("spc-folder-button").click();
  await h.settle();
  assert.equal(h.requests.length, 2);
  h.window.location.pathname = "/scenes/99";
  resolveFirst({ data: { findScenes: { count: 1, scenes: [{ id: "98" }] } } });
  await h.settle();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.storage.get("stash-player-playlist.repeat"), "true");
});

test("empty playlists preserve repeat and leave the current scene playing", async () => {
  const h = harness({
    repeat: true,
    responder: (request) => request.query.includes("findScenes")
      ? { data: { findScenes: { count: 0, scenes: [] } } }
      : { data: { findScene: scene } },
  });
  await h.settle();
  const button = h.document.getElementById("spc-folder-button");
  button.click();
  await h.settle();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.storage.get("stash-player-playlist.repeat"), "true");
  assert.equal(button.disabled, false);
});
