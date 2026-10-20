const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const data = require("../ar-data.js");
const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("QR round-trip and physical dimensions at 1:50", () => {
  const value = data.fromUrl("https://example.test/ar/index.html#" + encodeURIComponent("AR1;cube;2000;2000;2000;scale=50"));
  assert.equal(value.x, 1);
  assert.equal(value.y, 1);
  assert.equal(value.z, 1);
});
test("malformed, out of bounds and non-HTTPS QR are rejected", () => {
  for (const input of ["", "%", "AR1;cube;0;2000;2000;scale=50", "AR1;cube;10001;1;1;scale=1",
    "AR1;cube;1;1;1;scale=0", "AR1;cube;1;1;1;scale=" + "9".repeat(400), "AR1;cube;1;1;1;scale=1junk"])
    assert.throws(() => data.parse(input), input);
  for (const url of ["javascript:alert(1)#AR1;cube;1;1;1;scale=1", "http://example.test/#AR1;cube;1;1;1;scale=1",
    "https://user@example.test/#AR1;cube;1;1;1;scale=1"])
    assert.throws(() => data.fromUrl(url), url);
});
function viewer(hash) {
  const nodes = [], events = {}, status = { textContent: "" }, button = { disabled: true };
  function node(tag) {
    const n = { tag, attributes: {}, children: [], setAttribute(k,v) { this.attributes[k]=v; },
      appendChild(child) { this.children.push(child); return child; }, addEventListener() {} };
    nodes.push(n); return n;
  }
  const document = { hidden: false, getElementById: id => id === "status" ? status : button,
    createElement: node, body: node("body"), querySelectorAll: () => [],
    addEventListener: (name, callback) => events[name] = callback };
  const window = { AFRAME: { systems: { arjs: {} } }, addEventListener: (name, callback) => events[name] = callback };
  vm.runInNewContext(read("viewer.js"), { document, window, AFRAME: window.AFRAME, ARCubeData: data, location: { hash } });
  return { nodes, document, status, button };
}
test("invalid QR never creates an AR scene or enables camera", () => {
  const page = viewer("#bad");
  assert.equal(page.button.disabled, true);
  assert.equal(page.nodes.some(n => n.tag === "a-scene"), false);
});
test("AR.js SYSTEM enables explicit start; cube is dimensioned before insertion", () => {
  const page = viewer("#AR1;cube;2000;1000;3000;scale=50");
  assert.equal(page.button.disabled, false);
  assert.equal(page.nodes.some(n => n.tag === "a-scene"), false);
  page.button.onclick();
  const box = page.nodes.find(n => n.tag === "a-box");
  assert.equal(box.attributes.width, 1);
  assert.equal(box.attributes.height, 1.5);
  assert.equal(box.attributes.depth, 0.5);
  assert.equal(page.document.body.children.length, 1);
});
function worker(keys) {
  const handlers = {}, deleted = [], responses = new Map();
  const cache = { addAll: async () => {}, match: async url => responses.get(url) };
  let fetches = 0;
  const scope = "https://example.test/ar/";
  vm.runInNewContext(read("sw.js"), {
    URL, Set, self: { registration: { scope }, addEventListener: (name, cb) => handlers[name] = cb,
      clients: { claim: async () => {} }, skipWaiting: async () => {} },
    caches: { keys: async () => keys, delete: async key => deleted.push(key), open: async () => cache },
    fetch: async () => { fetches++; return "network"; }
  });
  return { handlers, deleted, responses, scope, fetches: () => fetches };
}
test("cache cleanup keeps other apps and another AR installation", async () => {
  const prefix = "ar-style-cube-" + encodeURIComponent("https://example.test/ar/") + "-";
  const other = "ar-style-cube-" + encodeURIComponent("https://example.test/other/") + "-v2";
  const w = worker(["unrelated-cache", prefix + "v3", prefix + "v4", other]);
  let pending;
  w.handlers.activate({ waitUntil: p => pending = p });
  await pending;
  assert.deepEqual(w.deleted, [prefix + "v3"]);
});
test("worker serves cached deep link offline and ignores unrelated URLs", async () => {
  const w = worker([]);
  w.responses.set(w.scope + "index.html", "cached-viewer");
  let result;
  w.handlers.fetch({ request: { method: "GET", url: w.scope + "index.html?v=1" }, respondWith: p => result = p });
  assert.equal(await result, "cached-viewer");
  assert.equal(w.fetches(), 0);
  for (const url of ["https://external.test/file", "https://example.test/private.json", w.scope + "unknown.html"]) {
    let intercepted = false;
    w.handlers.fetch({ request: { method: "GET", url }, respondWith: () => intercepted = true });
    assert.equal(intercepted, false, url);
  }
});
test("offline readiness is false if any required resource is missing", async () => {
  const w = worker([]);
  let pending, message;
  w.handlers.message({ data: { type: "CACHE_STATUS" }, ports: [{ postMessage: value => message = value }],
    waitUntil: p => pending = p });
  await pending;
  assert.equal(message.ready, false);
});
test("scanner stops a camera permission resolved after backgrounding", async () => {
  let permissionResolve, stopped = 0;
  const events = {}, status = {}, button = { disabled: false };
  const video = { play: async () => {}, srcObject: null };
  const document = { hidden: false, getElementById: id => ({ camera: video, status, start: button })[id],
    createElement: () => ({ getContext: () => ({}) }), addEventListener: (name, fn) => events[name] = fn };
  vm.runInNewContext(read("scanner.js"), { document, window: { addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => permissionResolve = resolve) } },
    jsQR() {}, ARCubeData: data, cancelAnimationFrame() {}, requestAnimationFrame() {} });
  const pending = button.onclick();
  document.hidden = true;
  events.visibilitychange();
  permissionResolve({ getTracks: () => [{ stop: () => stopped++ }] });
  await pending;
  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
  assert.equal(button.disabled, false);
});
// AR4 walls: same binary layout as plugin/src/ArWallSolidPayload.cs.
const zlib = require("node:zlib");
function ar4(walls) {
  const parts = [Buffer.from([4]), Buffer.alloc(2)];
  parts[1].writeUInt16LE(walls.length);
  for (const w of walls) {
    const head = Buffer.alloc(32);
    [w.x1, w.y1, w.x2, w.y2, w.z0, w.z1, w.t].forEach((v, i) => head.writeInt32LE(v, i * 4));
    head.writeUInt8(185, 28); head.writeUInt8(185, 29); head.writeUInt8(185, 30); head.writeUInt8(w.holes.length, 31);
    parts.push(head);
    for (const h of w.holes) { const b = Buffer.alloc(16); h.forEach((v, i) => b.writeInt32LE(v, i * 4)); parts.push(b); }
  }
  return zlib.gzipSync(Buffer.concat(parts)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
const testWall = { x1: 0, y1: 0, x2: 3000, y2: 0, z0: 0, z1: 2700, t: 200, holes: [[1100, 1800, 900, 1900]] };
test("AR4 walls round-trip with an opening and 1:50 marker units", async () => {
  const value = data.fromUrl("https://example.test/ar/index.html#AR4;walls;scale=50;data=" + ar4([testWall]));
  assert.equal(value.kind, "walls");
  assert.equal(value.unit, 0.5);
  const walls = await data.decodeWalls(value.data);
  assert.equal(walls.length, 1);
  assert.equal(walls[0].length, 3);
  assert.equal(walls[0].width, 0.2);
  assert.deepEqual(walls[0].openings, [{ start: 1.1, end: 1.8, bottom: 0.9, top: 1.9 }]);
});
test("AR4 rejects truncated, trailing and out-of-wall openings", async () => {
  const bad = [
    ar4([{ ...testWall, holes: [[2500, 3500, 0, 100]] }]),
    ar4([{ ...testWall, x2: 0 }]),
  ];
  for (const b of bad) await assert.rejects(data.decodeWalls(b));
  const raw = zlib.gunzipSync(Buffer.from(ar4([testWall]).replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  assert.throws(() => data.readWalls(ab(raw.subarray(0, raw.length - 1))));
  assert.throws(() => data.readWalls(ab(Buffer.concat([raw, Buffer.from([0])]))));
});
test("invalid AR4 data never enables the camera", async () => {
  const page = viewer("#AR4;walls;scale=50;data=AAAA");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(page.button.disabled, true);
  assert.equal(page.nodes.some(n => n.tag === "a-scene"), false);
});
test("valid AR4 enables explicit start and puts a walls entity in the marker", async () => {
  const page = viewer("#AR4;walls;scale=50;data=" + ar4([testWall]));
  assert.equal(page.button.disabled, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(page.button.disabled, false);
  page.button.onclick();
  const marker = page.nodes.find(n => n.tag === "a-marker");
  assert.equal(marker.children.some(n => n.tag === "a-entity"), true);
  assert.equal(page.nodes.some(n => n.tag === "a-box"), false);
});
