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
test("optional colour and sheet label; old QR still valid", () => {
  const value = data.parse("AR1;cube;3000;1000;600;scale=50;c=2F6F73;s=AR-T.04");
  assert.deepEqual(value.color, [47, 111, 115]);
  assert.equal(value.sheet, "AR-T.04");
  assert.equal(data.parse("AR1;cube;3000;1000;600;scale=50").color, null);
  const walls = data.parse("AR4;walls;scale=50;c=7a5c9e;s=AR-T.05;data=AAAA");
  assert.equal(walls.data, "AAAA");
  assert.deepEqual(walls.color, [122, 92, 158]);
  for (const input of ["AR1;cube;1;1;1;scale=1;c=12345", "AR1;cube;1;1;1;scale=1;s=" + "x".repeat(17),
    "AR1;cube;1;1;1;scale=1;s=a b", "AR1;cube;1;1;1;scale=1;s=A;c=123456"])
    assert.throws(() => data.parse(input), input);
});
test("USDZ: stored zip, data aligned to 64 bytes, valid CRC, triangles and colour", () => {
  const usdz = require("../usdz.js");
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const file = Buffer.from(usdz.build([{ positions: tri, color: [255, 0, 0] }]));
  assert.equal(file.readUInt32LE(0), 0x04034b50);
  assert.equal(file.readUInt16LE(8), 0, "stored");
  const nameLength = file.readUInt16LE(26), extra = file.readUInt16LE(28), offset = 30 + nameLength + extra;
  assert.equal(offset % 64, 0);
  assert.equal(file.subarray(30, 30 + nameLength).toString(), "model.usda");
  const size = file.readUInt32LE(22), text = file.subarray(offset, offset + size);
  assert.equal(file.readUInt32LE(14), usdz.crc32(text));
  const usda = text.toString();
  assert.match(usda, /^#usda 1.0/);
  assert.match(usda, /faceVertexIndices = \[0, 1, 2\]/);
  assert.match(usda, /diffuseColor = \(1, 0, 0\)/);
  const end = file.length - 22;
  assert.equal(file.readUInt32LE(end), 0x06054b50);
  assert.equal(file.readUInt32LE(end + 16), offset + size, "central directory follows the data");
  assert.equal(usdz.crc32(Buffer.from("123456789")), 0xCBF43926);
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
  const w = worker(["unrelated-cache", prefix + "v3", prefix + "v6", other]);
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
// AR5: same split as plugin/src/ArQrParts.cs.
function split(payload, count) {
  const id = (data.crc32(payload) & 0xFFFF).toString(16).padStart(4, "0"), size = Math.ceil(payload.length / count);
  return Array.from({ length: count }, (_, i) => `AR5;id=${id};part=${i + 1};of=${count};data=${payload.slice(i * size, (i + 1) * size)}`);
}
test("AR5 parts join in any order into an anchored AR4 model", async () => {
  const payload = "AR4;walls;scale=100;c=B08A2E;s=AR-T.07;m=1;data=" + ar4([testWall]);
  const parts = split(payload, 3).map(p => data.parse(p));
  assert.equal(parts[1].kind, "part");
  assert.equal(data.join([parts[2], parts[0]]), null, "missing part");
  const model = data.join([parts[2], parts[0], parts[1]]);
  assert.equal(model.kind, "walls");
  assert.equal(model.anchored, true);
  assert.equal(model.scale, 100);
  assert.equal((await data.decodeWalls(model.data)).length, 1);
  assert.equal(data.parse("AR4;walls;scale=50;data=AAAA").anchored, false);
});
test("AR5 rejects mixed models, corrupted parts and bad numbering", () => {
  const a = split("AR1;cube;2000;2000;2000;scale=50", 2).map(p => data.parse(p));
  const b = split("AR1;cube;1000;1000;1000;scale=50", 2).map(p => data.parse(p));
  assert.throws(() => data.join([a[0], b[1]]));
  const broken = data.parse(split("AR1;cube;2000;2000;2000;scale=50", 2)[1].replace(/data=./, "data=X"));
  assert.throws(() => data.join([a[0], broken]), /контрольная/);
  for (const bad of ["AR5;id=abcd;part=3;of=2;data=x", "AR5;id=abcd;part=1;of=1;data=x", "AR5;id=ABCD;part=1;of=2;data=x"])
    assert.throws(() => data.parse(bad), bad);
});
