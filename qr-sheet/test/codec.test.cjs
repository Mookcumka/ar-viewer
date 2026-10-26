const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const vm = require('node:vm');
const codec = require('../../qr-geometry.js');
const usdz = require('../../usdz.js');
// C# production encoder vectors are test data ONLY, not Revit execution and never shipped to the viewer.
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'exporto-vectors.json')));
const packets = v => v.packets.map(x => Uint8Array.from(x));
function collect(parts) { const c = new codec.Collector(); parts.forEach(p => c.add(p)); return c; }
function raw(v = vectors[0]) { return zlib.gunzipSync(collect(packets(v)).join().compressed); }
function altered(change, v = vectors[0]) {
  const b = raw(v), length = b.readUInt32LE(4), meta = JSON.parse(b.subarray(8, 8 + length));
  let geometry = Buffer.from(b.subarray(8 + length));
  geometry = change(meta, geometry) || geometry;
  const json = Buffer.from(JSON.stringify(meta)), header = Buffer.alloc(8); header.write('CBX1'); header.writeUInt32LE(json.length, 4);
  return Buffer.concat([header, json, geometry]);
}
function joined(b) { return { compressed: b, hash: crypto.createHash('sha256').update(b).digest('hex'), count: 1 }; }
for (const v of vectors) test(`C# golden ${v.name}: unordered QR -> SHA -> scene -> generic USDZ`, async () => {
  const p = packets(v).reverse(), c = collect(p); assert.equal(c.add(p[0]).duplicate, true);
  const scene = await codec.restore(c.join());
  assert.equal(scene.triangles, v.triangles); assert.equal(scene.qrCount, p.length);
  assert.equal(scene.units, 'm'); assert.equal(scene.up, 'Y');
  const meshes = codec.usdzMeshes(scene), file = Buffer.from(usdz.build(meshes));
  const offset = 30 + file.readUInt16LE(26) + file.readUInt16LE(28), n = file.readUInt32LE(22);
  assert.equal(offset % 64, 0); assert.equal(file.readUInt16LE(8), 0);
  assert.equal(file.readUInt32LE(14), usdz.crc32(file.subarray(offset, offset + n)));
  assert.match(file.subarray(offset, offset + n).toString(), /metersPerUnit = 1/);
  if (v.name === 'cube') {
    scene.extent.forEach(x => assert.ok(Math.abs(x - .6) < 1e-12));
    assert.deepEqual(scene.meshes[0].rgba, [200,60,40,255]);
    assert.match(file.toString(), /inputs:opacity = 1/);
  }
});
test('packet bounds, missing parts, identity and conflicting duplicates reject transactionally', () => {
  const p = packets(vectors[1]), c = collect([p[0]]);
  assert.throws(() => c.join(), /Не все/);
  assert.throws(() => c.add(packets(vectors[0])[0]), /другой модели/);
  const dup = p[0].slice(); dup[48] ^= 1;
  assert.throws(() => c.add(dup), /Конфликт/); assert.equal(c.parts.size, 1);
  for (const mutate of [b => b[0] = 0, b => b[40] = 255, b => b[42] = 9, b => b[44] = 0]) {
    const b = p[0].slice(); mutate(b); assert.throws(() => codec.packet(b));
  }
  assert.throws(() => codec.packet(new Uint8Array(906)));
});
test('SHA mismatch, truncated gzip, invalid gzip and extra CBX bytes reject before USDZ', async () => {
  const j = collect(packets(vectors[0])).join(), damaged = j.compressed.slice(); damaged[damaged.length - 10] ^= 8;
  await assert.rejects(codec.restore({ ...j, compressed: damaged }), /SHA-256/);
  await assert.rejects(codec.restore(joined(j.compressed.subarray(0, j.compressed.length - 3))));
  await assert.rejects(codec.restore(joined(new Uint8Array([1,2,3]))));
  await assert.rejects(codec.restore(joined(zlib.gzipSync(Buffer.concat([raw(), Buffer.from([0])])))), /Лишние/);
});
test('malformed metadata/layout/index/units/transform/colour never becomes geometry', () => {
  const bad = [
    m => m.up = 'Z', m => m.profile = 'other', m => m.scale = -1, m => m.originMeters = [0,0],
    m => m.meshes[0].rgba[3] = 256, m => m.meshes[0].offset = 1, m => m.meshes[0].min[0] = m.meshes[0].max[0] + 1,
    m => m.nodes[0].matrix[12] = 1, m => m.meshes[0].width = 3, m => m.excluded = [123],
    m => m.meshes[0].indices = 4, m => m.meshes[0].vertices = 1000001
  ];
  for (const mutate of bad) assert.throws(() => codec.decodeRaw(altered(m => { mutate(m); })));
  assert.throws(() => codec.decodeRaw(altered((m,g) => { g.writeUInt16LE(65535, m.meshes[0].vertices * 6); })), /Индекс/);
  assert.throws(() => codec.decodeRaw(raw().subarray(0, raw().length - 1)));
});
test('normalization is already baked; source origin and scale do not shift/rescale mesh twice', () => {
  const a = codec.decodeRaw(raw()), b = codec.decodeRaw(altered(m => { m.scale = .01; m.originMeters = [300,10,-900]; }));
  assert.deepEqual(b.meshes[0].positions, a.meshes[0].positions);
  assert.deepEqual(b.extent, a.extent); assert.equal(b.scale, .01);
});
test('generic USDZ preserves micrometre triangles and refuses float32 collapse rather than silently changing geometry', () => {
  const mesh = p => ({ meshes:[{positions:new Float64Array(p),indices:new Uint32Array([0,1,2]),rgba:[255,0,0,255]}] });
  const tiny=codec.usdzMeshes(mesh([0,0,0,.000002,0,0,0,.000002,0]));
  const text=usdz.usda(tiny);
  assert.ok(tiny[0].positions[3]>0); assert.match(text,/0\.000001999999/);
  assert.throws(()=>codec.usdzMeshes(mesh([1e8,0,0,1e8+.001,0,0,1e8,.001,0])),/float32/);
});
test('render cap refuses a complete scene explicitly; no triangle truncation', () => {
  const b = altered((m,g) => {
    m.meshes[0].indices = (codec.LIMITS.renderTriangles + 1) * 3;
    const out = Buffer.alloc(m.meshes[0].vertices * 6 + m.meshes[0].indices * 2);
    g.copy(out, 0, 0, m.meshes[0].vertices * 6); return out;
  });
  assert.throws(() => codec.decodeRaw(b), /Модель не обрезана/);
});
test('exact sRGB and alpha passed to existing USDZ builder; legacy output remains unchanged', () => {
  const scene = codec.decodeRaw(altered(m => { m.meshes[0].rgba = [10,128,255,128]; }));
  const mesh = codec.usdzMeshes(scene)[0];
  assert.ok(Math.abs(mesh.linearColor[1] - .2158605001) < 1e-9);
  assert.equal(mesh.opacity, 128/255);
  const text = usdz.usda([mesh]); assert.match(text, /diffuseColor = \(0.00304, 0.21586, 1\)/);
  assert.match(text, /inputs:opacity = 0.50196/);
  const legacy = { positions: [0,0,0,1,0,0,0,1,0], color: [200,60,40] };
  const previous = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'legacy-usdz.test-source.txt'), 'utf8'), { module: previous, Uint32Array, TextEncoder, DataView, ArrayBuffer, Uint8Array, Math });
  assert.equal(usdz.usda([legacy]), previous.exports.usda([legacy]));
});
test('HTML fallback extracts bytes only; no DOM, script, URL navigation or executing input', () => {
  const p = Buffer.from(vectors[0].packets[0]).toString('base64');
  const extracted = codec.htmlPackets(`<script>throw Error('untrusted')</script><img data-packet="${p}" src="https://not-used.invalid/">`);
  assert.deepEqual(extracted, packets(vectors[0]));
  assert.throws(() => codec.htmlPackets('nothing'));
  assert.throws(() => codec.htmlPackets('data-packet="A==="'));
  assert.throws(() => codec.htmlPackets(Array(7).fill(`data-packet="${p}"`).join('')));
});
function worker(keys = []) {
  const handlers = {}, deleted = [], entries = new Map(), scope = 'https://example.test/isolated/';
  const cache = { addAll: async urls => urls.forEach(x => entries.set(new URL(x,scope).href, 'cached')), match: async url => entries.get(url) };
  const context = vm.createContext({ URL, self: {
    registration: { scope }, addEventListener: (n, cb) => handlers[n] = cb, skipWaiting: async () => {}, clients: { claim: async () => {} }
  }, caches: { open: async () => cache, keys: async () => keys, delete: async k => deleted.push(k) }, fetch: async () => 'network' });
  context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(__dirname,"../..",file),"utf8"),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../../sw.js"),"utf8"),context);
  return { handlers, deleted, scope, entries };
}
test('isolated offline cache cannot delete other installations or store model/query URLs', async () => {
  const prefix = 'ar-style-cube-' + encodeURIComponent('https://example.test/isolated/') + '-';
  const w = worker(['ar-style-old', 'other', prefix + 'v0']); let p;
  w.handlers.install({ waitUntil: x => p = x }); await p;
  w.handlers.activate({ waitUntil: x => p = x }); await p; assert.deepEqual(w.deleted, [prefix + 'v0']);
  for (const url of ['https://remote.test/model.glb', w.scope + 'model.usdz', w.scope + 'unknown.html?data=secret']) {
    let intercepted = false; w.handlers.fetch({ request: { method: 'GET', url }, respondWith: () => intercepted = true }); assert.equal(intercepted,false);
  }
  w.handlers.message({ data: { type: 'CACHE_STATUS' }, ports: [{ postMessage: value => { assert.equal(value.ready,true); } }], waitUntil: x => p = x }); await p;
  w.entries.delete(w.scope + 'qr-geometry.js');
  w.handlers.message({ data: { type: 'CACHE_STATUS' }, ports: [{ postMessage: value => { assert.equal(value.ready,false); } }], waitUntil: x => p = x }); await p;
});

require("./meshopt.test.cjs");
