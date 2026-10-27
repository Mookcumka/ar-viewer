/* Versioned Exporto QRL1/CBX1, QRL2/CBX2 and QRL3/GBX1 browser adapter. No models or network I/O. */
(function (root) {
  "use strict";
  const LIMITS = Object.freeze({ scene: 5142, packet: 905, chunk: 857, raw: 32 * 1024 * 1024,
    metadata: 2 * 1024 * 1024, meshes: 10000, vertices: 1000000, indices: 3000000,
    renderTriangles: 50000, html: 8 * 1024 * 1024 });
  const gbx = typeof module === "object" && module.exports ? require("./gbx-geometry.js") : root.ARGbx;
  const IDENTITY = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const fail = message => { throw new Error(message); };
  const finite = x => typeof x === "number" && Number.isFinite(x);
  const vector = (a, n) => Array.isArray(a) && a.length === n && a.every(finite);
  const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
  function bytes(value) {
    if (!(value instanceof Uint8Array)) fail("Ожидались бинарные байты QR");
    return value;
  }
  function magic(b, text, at = 0) { return [...text].every((x, i) => b[at + i] === x.charCodeAt(0)); }
  function packet(input) {
    const b = bytes(input);
    if (b.length < 49 || b.length > LIMITS.packet || !(magic(b, "QRL1") || magic(b, "QRL2") || magic(b, "QRL3"))) fail("Это не пакет Exporto QRL1/QRL2/QRL3");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const version = magic(b, "QRL3") ? 3 : magic(b, "QRL2") ? 2 : 1;
    const total = v.getUint32(36, true), index = v.getUint16(40, true), count = v.getUint16(42, true);
    const length = v.getUint32(44, true), hash = hex(b.slice(4, 36));
    if (total < 1 || total > LIMITS.scene || (version === 1 ? ![1,3,6].includes(count) : count < 1 || count > 6) || index >= count ||
        length !== b.length - 48 || length < 1 || length > LIMITS.chunk || total > count * LIMITS.chunk || total < count)
      fail("Неверные границы пакета QRL" + version);
    return { version, hash, total, index, count, body: b.slice(48), key: `${version}:${hash}:${total}:${count}` };
  }
  class Collector {
    constructor() { this.reset(); }
    reset() { this.identity = null; this.parts = new Map(); }
    add(input) {
      const p = packet(input);
      if (this.identity && p.key !== this.identity.key) fail("QR другой модели. Нажмите «Новый лист» перед сменой");
      const old = this.parts.get(p.index);
      if (old && (old.length !== p.body.length || old.some((x, i) => x !== p.body[i]))) fail("Конфликт повторной части QR");
      const sum = [...this.parts.values()].reduce((n, b) => n + b.length, 0) + (old ? 0 : p.body.length);
      if (sum > p.total) fail("Части превышают заявленный размер сцены");
      this.identity = this.identity || p;
      this.parts.set(p.index, p.body);
      return { duplicate: !!old, received: this.parts.size, count: p.count, hash: p.hash,
        complete: this.parts.size === p.count, bytes: sum, total: p.total };
    }
    join() {
      const p = this.identity;
      if (!p || this.parts.size !== p.count) fail("Не все QR собраны");
      const joined = new Uint8Array(p.total);
      let at = 0;
      for (let i = 0; i < p.count; i++) { const b = this.parts.get(i); if (!b || at + b.length > joined.length) fail("Неверная длина частей"); joined.set(b, at); at += b.length; }
      if (at !== p.total) fail("Длина сцены не совпадает с QR");
      return { compressed: joined, hash: p.hash, count: p.count, version: p.version };
    }
  }
  async function inflate(input) {
    if (typeof DecompressionStream !== "function") fail("Нужен Safari с поддержкой gzip DecompressionStream");
    const reader = new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks = []; let length = 0;
    try {
      for (;;) {
        const r = await reader.read(); if (r.done) break;
        length += r.value.length;
        if (length > LIMITS.raw) { await reader.cancel(); fail("Распакованная сцена превышает 32 МиБ"); }
        chunks.push(r.value);
      }
    } finally { reader.releaseLock(); }
    const raw = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { raw.set(chunk, at); at += chunk.length; }
    return raw;
  }
  function decodeRaw(input) {
    const b = bytes(input);
    if (magic(b,"GBX1")) { if(!gbx) fail("Отсутствует декодер GBX1: обновите просмотрщик"); return gbx.decode(b); }
    if (b.length < 8 || b.length > LIMITS.raw || !magic(b, "CBX1")) fail("Ожидалась сцена CBX1");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), size = v.getUint32(4, true);
    if (size < 2 || size > LIMITS.metadata || 8 + size > b.length) fail("Неверный размер метаданных");
    const meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(8, 8 + size)));
    if (!meta || meta.bits !== 16 || meta.units !== "m" || meta.up !== "Y" ||
        meta.profile !== "Exporto-AR-experimental-1") fail("Неподдерживаемый профиль сцены");
    if (!vector(meta.originMeters, 3) || !finite(meta.scale) || meta.scale <= 0) fail("Неверная нормализация");
    if (!Array.isArray(meta.meshes) || !meta.meshes.length || meta.meshes.length > LIMITS.meshes ||
        !Array.isArray(meta.nodes) || meta.nodes.length !== meta.meshes.length) fail("Неверный список мешей/узлов");
    if (!Array.isArray(meta.excluded) || meta.excluded.length > 100 || meta.excluded.some(x => typeof x !== "string" || x.length > 1024)) fail("Неверный отчёт исключений");
    let end = 0, vertices = 0, indices = 0;
    // Validate ALL layouts before allocations. Transforms are already baked by Exporto; do not apply origin/scale twice.
    for (let i = 0; i < meta.meshes.length; i++) {
      const m = meta.meshes[i], n = meta.nodes[i];
      if (!m || !Number.isInteger(m.vertices) || m.vertices < 1 || m.vertices > LIMITS.vertices ||
          !Number.isInteger(m.indices) || m.indices < 3 || m.indices % 3 || m.indices > LIMITS.indices ||
          ![2,4].includes(m.width) || m.offset !== end) fail("Неверная разметка геометрии");
      if (!vector(m.min, 3) || !vector(m.max, 3) || m.min.some((x, a) => x > m.max[a] || !finite(m.max[a] - x))) fail("Неверные границы меша");
      if (!Array.isArray(m.rgba) || m.rgba.length !== 4 || m.rgba.some(x => !Number.isInteger(x) || x < 0 || x > 255)) fail("Неверный RGBA");
      if (!n || n.mesh !== i || !Array.isArray(n.matrix) || n.matrix.length !== 16 || n.matrix.some((x, a) => x !== IDENTITY[a])) fail("Неподдерживаемая трансформация узла");
      end += m.vertices * 6 + m.indices * m.width; vertices += m.vertices; indices += m.indices;
      if (8 + size + end > b.length || vertices > LIMITS.vertices || indices > LIMITS.indices) fail("Геометрия обрезана или превышает лимит");
    }
    if (8 + size + end !== b.length) fail("Лишние/отсутствующие байты геометрии");
    if (indices / 3 > LIMITS.renderTriangles) fail("Сцена восстановима, но превышает предел браузерного USDZ: 50000 треугольников. Модель не обрезана");
    const bounds = { min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity] };
    const meshes = meta.meshes.map(m => {
      const start = 8 + size + m.offset, positions = new Float64Array(m.vertices * 3), faces = new Uint32Array(m.indices);
      for (let j = 0; j < positions.length; j++) {
        const a = j % 3, x = m.min[a] + v.getUint16(start + j * 2, true) / 65535 * (m.max[a] - m.min[a]);
        if (!finite(x)) fail("Переполнение координаты");
        positions[j] = x; bounds.min[a] = Math.min(bounds.min[a], x); bounds.max[a] = Math.max(bounds.max[a], x);
      }
      const at = start + m.vertices * 6;
      for (let j = 0; j < faces.length; j++) {
        faces[j] = m.width === 2 ? v.getUint16(at + j * 2, true) : v.getUint32(at + j * 4, true);
        if (faces[j] >= m.vertices) fail("Индекс за пределами меша");
      }
      return { positions, indices: faces, rgba: m.rgba.slice() };
    });
    const extent = bounds.min.map((x, a) => bounds.max[a] - x);
    if (!extent.every(finite)) fail("Переполнение размеров сцены");
    return { meshes, vertices, triangles: indices / 3, bounds, extent, originMeters: meta.originMeters,
      scale: meta.scale, units: "m", up: "Y", excluded: meta.excluded.slice(), rawBytes: b.length };
  }
  async function expandMeshopt(b) {
    const decoder = root.MeshoptDecoder;
    if (!decoder?.supported) fail("Обновите AR Viewer: отсутствует декодер meshoptimizer. Старый HTML/QR по-прежнему поддерживается");
    if (b.length < 8 || b.length > LIMITS.raw) fail("Неверный размер CBX2");
    const size = new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(4,true);
    if (size < 2 || size > LIMITS.metadata || 8 + size > b.length) fail("Неверный размер метаданных CBX2");
    const meta = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(b.subarray(8,8+size)));
    if (!meta || meta.profile !== "Exporto-AR-meshopt-2" || meta.codec !== "meshopt-0.23" || meta.bits !== 16 || meta.units !== "m" || meta.up !== "Y") fail("Неподдерживаемый профиль CBX2");
    if (!Array.isArray(meta.meshes) || !meta.meshes.length || meta.meshes.length > LIMITS.meshes) fail("Неверный список мешей CBX2");
    let end=0,canonical=0,vertices=0,indices=0;
    for(const m of meta.meshes) {
      if(!m || !Number.isInteger(m.vertices) || m.vertices<1 || m.vertices>LIMITS.vertices || !Number.isInteger(m.indices) || m.indices<3 || m.indices%3 || m.indices>LIMITS.indices || ![2,4].includes(m.width) || m.offset!==end || !Number.isInteger(m.vertexBytes) || m.vertexBytes<1 || !Number.isInteger(m.indexBytes) || m.indexBytes<1) fail("Неверная разметка meshoptimizer");
      end+=m.vertexBytes+m.indexBytes;canonical+=m.vertices*6+m.indices*m.width;vertices+=m.vertices;indices+=m.indices;
      if(end>b.length-8-size || canonical>LIMITS.raw || vertices>LIMITS.vertices || indices>LIMITS.indices) fail("CBX2 превышает лимиты");
    }
    if(end!==b.length-8-size || indices/3>LIMITS.renderTriangles) fail("CBX2 обрезан или превышает предел браузерного USDZ; геометрия не обрезается");
    // Reuse the full CBX1 semantic/layout validator BEFORE native/WASM allocations.
    const layout=structuredClone(meta);layout.profile="Exporto-AR-experimental-1";delete layout.codec;
    let offset=0;for(const m of layout.meshes){m.offset=offset;offset+=m.vertices*6+m.indices*m.width;delete m.vertexBytes;delete m.indexBytes;}
    const json=new TextEncoder().encode(JSON.stringify(layout));
    if(8+json.length+canonical>LIMITS.raw) fail("Распакованный CBX2 превышает 32 МиБ");
    // Validate semantic metadata with the same checks as CBX1 (zero indices are within bounds).
    const target=new Uint8Array(8+json.length+canonical);target.set([67,66,88,49]);new DataView(target.buffer).setUint32(4,json.length,true);target.set(json,8);
    decodeRaw(target);
    await decoder.ready;
    let at=8+json.length;
    for(const m of meta.meshes){
      const start=8+size+m.offset,positions=new Uint8Array(m.vertices*8),faces=new Uint8Array(m.indices*m.width);
      try { decoder.decodeVertexBuffer(positions,m.vertices,8,b.subarray(start,start+m.vertexBytes));decoder.decodeIndexBuffer(faces,m.indices,m.width,b.subarray(start+m.vertexBytes,start+m.vertexBytes+m.indexBytes)); }
      catch { fail("Повреждён поток meshoptimizer; модель не создана"); }
      for(let i=0;i<m.vertices;i++)target.set(positions.subarray(i*8,i*8+6),at+i*6);
      at+=m.vertices*6;target.set(faces,at);at+=faces.length;
    }
    return target;
  }
  async function restore(joined) {
    const started = root.performance?.now() ?? Date.now();
    if (!root.crypto?.subtle) fail("Для SHA-256 нужен защищённый контекст HTTPS");
    const hash = hex(new Uint8Array(await root.crypto.subtle.digest("SHA-256", joined.compressed)));
    if (hash !== joined.hash) fail("SHA-256 не совпадает. Модель не создана");
    const raw = await inflate(joined.compressed);
    const compact = magic(raw,"GBX1");
    if ((joined.version === 3) !== compact) fail("QRL3 требует GBX1; несовместимый тип полезной нагрузки");
    const meshopt = magic(raw,"CBX2");
    const scene = decodeRaw(meshopt ? await expandMeshopt(raw) : raw);
    scene.codec = compact ? "gzip-gbx1" : meshopt ? "meshopt-0.23+gzip" : "gzip-cbx1"; scene.rawBytes = raw.length;
    return Object.assign(scene, { sha256: hash, compressedBytes: joined.compressed.length, qrCount: joined.count, decodeMilliseconds: (root.performance?.now() ?? Date.now()) - started });
  }
  function htmlPackets(text) {
    // Treat a user HTML as data only. Never parse into a live DOM, evaluate it, or follow its URLs.
    if (typeof text !== "string" || new TextEncoder().encode(text).length > LIMITS.html) fail("HTML превышает 8 МиБ");
    const values = [...text.matchAll(/data-packet="([A-Za-z0-9+/=]+)"/g)];
    if (!values.length || values.length > 6) fail("В HTML нет 1–6 пакетов Exporto");
    return values.map(m => {
      if (m[1].length > 1208 || m[1].length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m[1])) fail("Неверный base64 пакета");
      return Uint8Array.from(atob(m[1]), x => x.charCodeAt(0));
    });
  }
  // Legacy builder consumes flat triangles. Keep it generic; no album IDs, primitives or model fixtures.
  function usdzMeshes(scene) {
    const linear = x => { const c = x / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return scene.meshes.map(m => {
      // USD point3f is float32: validate this final conversion rather than silently rounding to 5 decimals.
      const positions = new Float32Array(m.indices.length * 3);
      for (let i = 0; i < m.indices.length; i++) for (let a = 0; a < 3; a++) positions[i * 3 + a] = m.positions[m.indices[i] * 3 + a];
      if (!positions.every(finite)) fail("Координаты не помещаются в USDZ float32");
      const normal = (p, a, b, c) => {
        const u = [0,1,2].map(k => p[b+k] - p[a+k]), v = [0,1,2].map(k => p[c+k] - p[a+k]);
        return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      };
      for (let i = 0; i < m.indices.length; i += 3) {
        const old = normal(m.positions, m.indices[i]*3, m.indices[i+1]*3, m.indices[i+2]*3);
        const next = normal(positions, i*3, i*3+3, i*3+6);
        const length = Math.hypot(...next), dot = old.reduce((n,x,k) => n + x * next[k], 0);
        if (!finite(length) || length === 0 || !finite(dot) || dot <= 0) fail("USDZ float32 схлопывает треугольник или меняет нормаль. Модель не обрезана");
      }
      return { positions, precisePositions: true, color: m.rgba.slice(0, 3), linearColor: m.rgba.slice(0, 3).map(linear), opacity: m.rgba[3] / 255 };
    });
  }
  const api = { LIMITS, Collector, packet, restore, decodeRaw, htmlPackets, usdzMeshes };
  if (typeof module === "object" && module.exports) module.exports = api; else root.ExportoQr = api;
})(typeof globalThis === "object" ? globalThis : this);
