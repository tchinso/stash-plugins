const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.textContent = "";
    this.classList = {
      contains: (name) => (this.className || "").split(/\s+/).includes(name),
      add: (name) => { this.className = (this.className || "") + " " + name; },
      toggle: (name, enabled) => {
        this.className = (this.className || "").split(/\s+/).filter((item) => item !== name).concat(enabled ? [name] : []).join(" ");
      },
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, target) {
    child.parentNode = this;
    const index = this.children.indexOf(target);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  removeEventListener(name, handler) { this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== handler); }
  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    event.stopPropagation ||= () => { event.propagationStopped = true; };
    for (const handler of this.listeners[event.type] || []) handler(event);
    return event;
  }
  click() { return !this.disabled && this.dispatchEvent({ type: "click" }); }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]).filter((child) => selector === "*" || child.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
}

const scene = {
  id: "42",
  files: [
    { id: "11", path: "D:\\동영상 (테스트)\\100% #1 & two.mp4" },
    { id: "12", path: "D:\\동영상 (테스트)\\second %20 #2.mp4" },
  ],
};
const playerPath = "C:\\Program Files\\DAUM\\PotPlayer\\PotPlayer64.exe";

function harness({ responder, ownConfig = { mediaPlayerPath: playerPath }, legacyConfig = {} } = {}) {
  const body = new Element("body");
  const root = body.appendChild(new Element("div"));
  root.className = "video-js";
  const bar = root.appendChild(new Element("div"));
  bar.className = "vjs-control-bar";
  const fullscreen = bar.appendChild(new Element("button"));
  fullscreen.className = "vjs-fullscreen-control";
  const before = new Map();
  const after = new Map();
  const events = {};
  const requests = [];
  const errors = [];
  const timers = new Map();
  const intervals = [];
  let nextTimer = 0;
  const player = {
    pauseCalls: 0,
    pause() { this.pauseCalls += 1; },
    isDisposed: () => false,
    el: () => root,
    on() {}, off() {},
  };
  const document = {
    readyState: "complete", body,
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    getElementById: (id) => body.querySelector("#" + id),
    contains: (element) => body.contains(element),
    addEventListener() {},
  };
  const React = {
    isValidElement: (value) => Boolean(value && value.props),
    cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const window = {
    location: { pathname: "/scenes/42", origin: "http://localhost:6974", href: "http://localhost:6974/scenes/42" },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    PluginApi: {
      React,
      patch: { before(name, callback) { before.set(name, callback); }, after(name, callback) { after.set(name, callback); } },
      utils: { InteractiveUtils: { getPlayer: () => player } },
      Event: { addEventListener(name, callback) { (events[name] ||= []).push(callback); } },
    },
  };
  async function fetch(url, options) {
    const request = { ...JSON.parse(options.body), url: String(url) };
    requests.push(request);
    const payload = (await responder?.(request, requests.length)) ?? (request.query.includes("runPluginOperation")
      ? { data: { runPluginOperation: { started: true } } }
      : request.query.includes("configuration")
        ? { data: { configuration: { plugins: { PlayerPlaylistControls: ownConfig, stashOpenMediaPlayer: legacyConfig } } } }
        : { data: { findScene: scene } });
    return { ok: true, status: 200, json: async () => payload };
  }
  const context = {
    window, document, fetch, URL, URLSearchParams, Promise,
    MutationObserver: class { observe() {} disconnect() {} },
    console: { error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval,
  };
  window.fetch = fetch;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "ExternalMediaPlayer.js"), "utf8"), context);
  async function settle() {
    for (let pass = 0; pass < 50; pass += 1) {
      await Promise.resolve();
      for (const [id, timer] of [...timers]) {
        if (timer.delay <= 300) { timers.delete(id); timer.callback(); }
      }
    }
  }
  return { window, document, before, after, requests, errors, player, root, bar, events, settle };
}

function operation(h) {
  return h.requests.find((request) => request.query.includes("runPluginOperation"));
}

function operationArgs(h) {
  return Object.values(operation(h).variables).find((value) => value && typeof value === "object" && "path" in value);
}

function pathControl(h, filePath) {
  const original = { type: "div", props: { className: "TruncatedText", children: filePath, onMouseEnter: () => {}, ref: {} } };
  h.before.get("SceneFileInfoPanel")({ scene });
  // Stash forwards React's legacy context argument before the render result.
  const patched = h.after.get("TruncatedText")({ text: filePath }, {}, original);
  assert.equal(patched.props.onMouseEnter, original.props.onMouseEnter, "the original path tooltip handler is retained");
  assert.equal(patched.props.ref, original.props.ref, "Stash retains its tooltip target");
  return patched;
}

function clickEvent(extra = {}) {
  return {
    defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...extra,
  };
}

test("external button launches the primary raw file path with the configured player", async () => {
  const h = harness();
  await h.settle();
  const button = h.document.getElementById("spc-external-button");
  assert.ok(button, "external button is in the player control bar");
  assert.ok(h.bar.contains(button));
  button.click();
  await h.settle();
  const args = operationArgs(h);
  assert.equal(args.path, scene.files[0].path);
  assert.equal(args.mediaPlayerPath, playerPath);
  assert.equal(h.player.pauseCalls, 1);
});

test("legacy player setting is reused when the new plugin has no configured path", async () => {
  const h = harness({ ownConfig: {}, legacyConfig: { mediaPlayerPath: playerPath } });
  await h.settle();
  h.document.getElementById("spc-external-button").click();
  await h.settle();
  assert.equal(operationArgs(h).mediaPlayerPath, playerPath);
});

test("a configured player in this plugin takes precedence over the legacy player", async () => {
  const h = harness({ legacyConfig: { mediaPlayerPath: "C:\\Legacy\\vlc.exe" } });
  await h.settle();
  h.document.getElementById("spc-external-button").click();
  await h.settle();
  assert.equal(operationArgs(h).mediaPlayerPath, playerPath);
});

test("missing player settings leave playback running and show an actionable error", async () => {
  const h = harness({ ownConfig: {}, legacyConfig: {} });
  await h.settle();
  const button = h.document.getElementById("spc-external-button");
  button.click();
  await h.settle();
  assert.equal(operation(h), undefined);
  assert.equal(h.player.pauseCalls, 0);
  assert.equal(button.disabled, false);
  assert.ok(h.errors.length || h.root.querySelector(".spc-status"), "an error is visible or logged");
});

test("each file-info path opens that exact file without URI decoding or encoding", async () => {
  const h = harness();
  await h.settle();
  const control = pathControl(h, scene.files[1].path);
  assert.equal(control.props.role, "button");
  assert.equal(control.props.tabIndex, 0);
  const event = clickEvent();
  control.props.onClick(event);
  await h.settle();
  assert.equal(operationArgs(h).path, scene.files[1].path);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("file paths support keyboard activation while unrelated truncated text is unchanged", async () => {
  const h = harness();
  await h.settle();
  const control = pathControl(h, scene.files[0].path);
  const unrelated = { type: "div", props: { className: "TruncatedText", children: "Title" } };
  assert.equal(h.after.get("TruncatedText")({ text: "Title" }, {}, unrelated), unrelated);
  const event = clickEvent({ key: "Enter" });
  control.props.onKeyDown(event);
  await h.settle();
  assert.equal(operationArgs(h).path, scene.files[0].path);
  assert.equal(event.defaultPrevented, true);
});

test("Stash's legacy React context cannot replace an unrelated truncated-text render result", async () => {
  const h = harness();
  await h.settle();
  h.before.get("SceneFileInfoPanel")({ scene }, {});
  const result = { type: "div", props: { className: "TruncatedText", children: "Unrelated title" } };
  const legacyContext = {};
  const patched = h.after.get("TruncatedText")({ text: "Unrelated title" }, legacyContext, result);
  assert.equal(patched, result);
  assert.notEqual(patched, legacyContext);
});

test("operation failures do not pause the browser and release the launch button", async () => {
  const h = harness({ responder: (request) => request.query.includes("runPluginOperation")
    ? { errors: [{ message: "Player executable was not found" }] }
    : undefined });
  await h.settle();
  const button = h.document.getElementById("spc-external-button");
  button.click();
  await h.settle();
  assert.equal(h.player.pauseCalls, 0);
  assert.equal(button.disabled, false);
});

test("a missing launch acknowledgement is treated as a failure", async () => {
  const h = harness({ responder: (request) => request.query.includes("runPluginOperation")
    ? { data: { runPluginOperation: null } }
    : undefined });
  await h.settle();
  const button = h.document.getElementById("spc-external-button");
  button.click();
  await h.settle();
  assert.equal(h.player.pauseCalls, 0);
  assert.equal(button.disabled, false);
  assert.ok(h.errors.length);
});

test("scenes without an original file cannot send an incomplete launch operation", async () => {
  const h = harness({ responder: (request) => request.query.includes("findScene")
    ? { data: { findScene: { files: [] } } }
    : undefined });
  await h.settle();
  h.document.getElementById("spc-external-button").click();
  await h.settle();
  assert.equal(operation(h), undefined);
  assert.equal(h.player.pauseCalls, 0);
});

test("repeated clicks cannot launch multiple external players while a request is pending", async () => {
  let resolveConfig;
  const h = harness({ responder: (request) => request.query.includes("configuration")
    ? new Promise((resolve) => { resolveConfig = resolve; })
    : undefined });
  await h.settle();
  const button = h.document.getElementById("spc-external-button");
  button.click();
  button.click();
  await h.settle();
  assert.equal(h.requests.filter((request) => request.query.includes("configuration")).length, 1);
  resolveConfig({ data: { configuration: { plugins: { PlayerPlaylistControls: { mediaPlayerPath: playerPath } } } } });
  await h.settle();
  assert.equal(h.requests.filter((request) => request.query.includes("runPluginOperation")).length, 1);
});

test("navigation invalidates a pending launch before it reaches the backend", async () => {
  let resolveConfig;
  const h = harness({ responder: (request) => request.query.includes("configuration")
    ? new Promise((resolve) => { resolveConfig = resolve; })
    : undefined });
  await h.settle();
  h.document.getElementById("spc-external-button").click();
  await h.settle();
  h.window.location.pathname = "/scenes/99";
  for (const callback of h.events["stash:location"] || []) callback();
  resolveConfig({ data: { configuration: { plugins: { PlayerPlaylistControls: { mediaPlayerPath: playerPath } } } } });
  await h.settle();
  assert.equal(operation(h), undefined);
  assert.equal(h.player.pauseCalls, 0);
});

test("a completed old launch cannot pause a newly selected scene", async () => {
  let resolveOperation;
  const h = harness({ responder: (request) => request.query.includes("runPluginOperation")
    ? new Promise((resolve) => { resolveOperation = resolve; })
    : undefined });
  await h.settle();
  h.document.getElementById("spc-external-button").click();
  await h.settle();
  h.window.location.pathname = "/scenes/99";
  for (const callback of h.events["stash:location"] || []) callback();
  resolveOperation({ data: { runPluginOperation: { started: true } } });
  await h.settle();
  assert.equal(h.player.pauseCalls, 0);
  assert.equal(h.document.getElementById("spc-external-button").disabled, false);
});

