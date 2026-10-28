/* GBX2 v1: compact quantized scene for <=2 sheet QR (docs/gbx2-wire-format.md).
 * Viewer space: metres, Y-up. Coordinates are unsigned grid units of `step` metres from the scene minimum.
 * decode() validates everything before building; write() is the reference encoder used for golden bytes. */
(function (root) {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const earcut = node ? require("./vendor/gbx-earcut.js") : root.ARGbxEarcut;
  const library = node ? require("./gbx2-library.js") : root.ARGbx2Library;
  const LIMITS = Object.freeze({ raw: 1024 * 1024, records: 10000, palette: 255, loops: 64, loopPoints: 1024,
    openings: 64, params: 8, vertices: 1000000, indices: 3000000, triangles: 50000, renderGroups: 256 });
  const KIND = Object.freeze({ mesh: 0, box: 1, prism: 2, wall: 3, instance: 4 });
  const fail = m => { throw new Error("GBX2: " + m); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const area2 = ring => { let s = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };

  // Triangle sink: one per palette colour, shared across records; `out` orients every face explicitly.
  class Sink {
    constructor() { this.groups = new Map(); this.triangles = 0; }
    group(rgba) {
      const key = rgba.join(",");
      let g = this.groups.get(key);
      if (!g) { if (this.groups.size >= LIMITS.renderGroups) fail("слишком много цветов"); g = { rgba: rgba.slice(), positions: [], indices: [] }; this.groups.set(key, g); }
      return g;
    }
    tri(rgba, a, b, c, out) {
      let n = cross(sub(b, a), sub(c, a));
      if (Math.hypot(n[0], n[1], n[2]) < 1e-12) fail("вырожденный треугольник");
      if (out && dot(n, out) < 0) [b, c] = [c, b];
      if (++this.triangles > LIMITS.triangles) fail("больше 50000 треугольников; модель не обрезана");
      const g = this.group(rgba), at = g.positions.length / 3;
      g.positions.push(...a, ...b, ...c); g.indices.push(at, at + 1, at + 2);
    }
    quad(rgba, a, b, c, d, out) { this.tri(rgba, a, b, c, out); this.tri(rgba, a, c, d, out); }
  }
  // Earcut a planar polygon given in 2D, lift with `map`, orient by `out`.
  function cap(sink, rgba, rings, map, out) {
    const flat = [], holes = [];
    rings.forEach((r, i) => { if (i) holes.push(flat.length / 2); for (const p of r) flat.push(p[0], p[1]); });
    const index = earcut.triangulate(flat, holes, 2);
    // Earcut may drop collinear bridge points between aligned holes, so check covered area, not triangle count.
    let got = 0; for (let i = 0; i < index.length; i += 3) { const [a, b, c] = [index[i], index[i + 1], index[i + 2]].map(j => [flat[j * 2], flat[j * 2 + 1]]); got += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); }
    const area = Math.abs(area2(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(area2(r)), 0);
    if (!(area > 0) || Math.abs(got - area) > area * 1e-9) fail("контур не триангулируется (самопересечение?)");
    const p = i => map(flat[i * 2], flat[i * 2 + 1]);
    for (let i = 0; i < index.length; i += 3) sink.tri(rgba, p(index[i]), p(index[i + 1]), p(index[i + 2]), out);
  }
  function boxes(sink, rgba, list, place) {
    for (const [x0, y0, z0, x1, y1, z1] of list) {
      if (!(x1 > x0 && y1 > y0 && z1 > z0)) fail("пустой ящик");
      const c = [x0 / 2 + x1 / 2, y0 / 2 + y1 / 2, z0 / 2 + z1 / 2], P = (x, y, z) => place([x, y, z]), C = place(c);
      const faces = [[[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
        [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
        [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]]];
      for (const f of faces) {
        const q = f.map(v => P(...v)), m = q.reduce((s, v) => [s[0] + v[0] / 4, s[1] + v[1] / 4, s[2] + v[2] / 4], [0, 0, 0]);
        sink.quad(rgba, q[0], q[1], q[2], q[3], sub(m, C));
      }
    }
  }
  const yawPlace = (origin, yaw) => {
    const t = yaw / 65536 * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    return p => [origin[0] + p[0] * c + p[2] * s, origin[1] + p[1], origin[2] - p[0] * s + p[2] * c];
  };
  function prism(sink, rgba, y0, h, loops) {
    const outer = loops.filter(r => area2(r) > 0), holes = loops.filter(r => area2(r) < 0);
    if (!outer.length || outer.length + holes.length !== loops.length) fail("контур призмы без площади");
    const inside = (p, r) => { let v = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[j], b = r[i]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) v = !v; } return v; };
    const owner = holes.map(hl => { const o = outer.filter(r => inside(hl[0], r)).sort((a, b) => area2(a) - area2(b))[0]; if (!o) fail("отверстие призмы вне контура"); return o; });
    for (const o of outer) {
      const rings = [o, ...holes.filter((_, i) => owner[i] === o)];
      cap(sink, rgba, rings, (x, z) => [x, y0, z], [0, -1, 0]);
      cap(sink, rgba, rings, (x, z) => [x, y0 + h, z], [0, 1, 0]);
    }
    for (const r of loops) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], out = [b[1] - a[1], 0, -(b[0] - a[0])];
      sink.quad(rgba, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y0 + h, b[1]], [a[0], y0 + h, a[1]], out);
    }
  }
  // Wall: face A along a->b, face B offset by signed thickness t along n=(u.z,0,-u.x); B ends shifted e0/e1 along u (miters).
  function wall(sink, colors, w) {
    const [ca, cb, ce] = colors, { a, b, t, e0, e1, y0, h, openings } = w;
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (!(L > 0) || !t || !(h > 0)) fail("пустая стена");
    const u = [dx / L, 0, dz / L], n = [u[2], 0, -u[0]], side = Math.sign(t);
    const A = (s, v) => [a[0] + u[0] * s, y0 + v, a[1] + u[2] * s], B = (s, v) => [a[0] + u[0] * s + n[0] * t, y0 + v, a[1] + u[2] * s + n[2] * t];
    const lo = Math.max(0, e0), hi = Math.min(L, L + e1);
    if (!(hi > lo)) fail("стена короче подрезки торцов");
    const sorted = openings.slice().sort((p, q) => p.u0 - q.u0);
    for (const o of sorted) if (!(o.w > 0 && o.h > 0 && o.u0 > lo && o.u0 + o.w < hi && o.v0 >= 0 && o.v0 + o.h < h)) fail("проём выходит за стену");
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const p = sorted[i], q = sorted[j];
      if (q.u0 <= p.u0 + p.w && q.v0 <= p.v0 + p.h && p.v0 <= q.v0 + q.h) fail("проёмы пересекаются");
    }
    const notches = sorted.filter(o => o.v0 === 0), holes = sorted.filter(o => o.v0 > 0);
    const face = (s0, s1) => {
      const ring = [[s0, 0]];
      for (const o of notches) ring.push([o.u0, 0], [o.u0, o.h], [o.u0 + o.w, o.h], [o.u0 + o.w, 0]);
      ring.push([s1, 0], [s1, h], [s0, h]);
      return [ring, ...holes.map(o => [[o.u0, o.v0], [o.u0, o.v0 + o.h], [o.u0 + o.w, o.v0 + o.h], [o.u0 + o.w, o.v0]])];
    };
    const outA = n.map(x => -x * side), outB = n.map(x => x * side);
    cap(sink, ca, face(0, L), A, outA);
    cap(sink, cb, face(e0, L + e1), B, outB);
    sink.quad(ce, A(0, h), A(L, h), B(L + e1, h), B(e0, h), [0, 1, 0]);
    const cuts = [0, ...notches.flatMap(o => [o.u0, o.u0 + o.w]), L];
    for (let i = 0; i < cuts.length; i += 2) {
      const s0 = cuts[i], s1 = cuts[i + 1], f0 = i ? s0 : e0, f1 = i + 2 < cuts.length ? s1 : L + e1;
      sink.quad(ce, A(s0, 0), A(s1, 0), B(f1, 0), B(f0, 0), [0, -1, 0]);
    }
    const back = u.map(x => -x);
    sink.quad(ce, A(0, 0), B(e0, 0), B(e0, h), A(0, h), back);
    sink.quad(ce, A(L, 0), B(L + e1, 0), B(L + e1, h), A(L, h), u);
    for (const o of sorted) {
      const s0 = o.u0, s1 = o.u0 + o.w, v0 = o.v0, v1 = o.v0 + o.h;
      sink.quad(ce, A(s0, v0), A(s0, v1), B(s0, v1), B(s0, v0), u);
      sink.quad(ce, A(s1, v0), A(s1, v1), B(s1, v1), B(s1, v0), back);
      sink.quad(ce, A(s0, v1), A(s1, v1), B(s1, v1), B(s0, v1), [0, -1, 0]);
      if (v0 > 0) sink.quad(ce, A(s0, v0), A(s1, v0), B(s1, v0), B(s0, v0), [0, 1, 0]);
    }
  }

  function reader(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let at = 0;
    const need = n => { if (n > b.length - at) fail("данные обрезаны"); };
    const r = {
      get at() { return at; }, get left() { return b.length - at; },
      u8() { need(1); return v.getUint8(at++); },
      u16() { need(2); const x = v.getUint16(at, true); at += 2; return x; },
      i16() { need(2); const x = v.getInt16(at, true); at += 2; return x; },
      u32() { need(4); const x = v.getUint32(at, true); at += 4; return x; },
      f32() { need(4); const x = v.getFloat32(at, true); at += 4; if (!Number.isFinite(x)) fail("нечисловое значение"); return x; },
      varint(max) { let x = 0, shift = 0, c; do { c = r.u8(); x += (c & 127) * 2 ** shift; shift += 7; if (shift > 28) fail("длинное число"); } while (c & 128); if (x > max) fail("счётчик превышает предел"); return x; },
      bytes(n) { need(n); const s = b.subarray(at, at + n); at += n; return s; }
    };
    return r;
  }

  async function decode(input, { meshopt = root.MeshoptDecoder } = {}) {
    if (!(input instanceof Uint8Array) || input.length < 18 || input.length > LIMITS.raw) fail("неверный размер");
    const r = reader(input);
    if (String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8()) !== "GBX2" || r.u8() !== 1) fail("неподдерживаемая версия");
    const flags = r.u8(); if (flags) fail("неизвестные флаги");
    const step = r.f32(), scale = r.f32(), libVersion = r.u16();
    if (!(step > 0 && step <= 1) || !(scale > 0)) fail("неверный шаг сетки");
    if (libVersion > library.VERSION) fail("библиотека семейств v" + libVersion + " новее просмотрщика. Обновите просмотрщик");
    const palette = Array.from({ length: r.varint(LIMITS.palette) }, () => [r.u8(), r.u8(), r.u8(), r.u8()]);
    if (!palette.length) fail("пустая палитра");
    const color = () => { const i = r.u8(); if (i >= palette.length) fail("цвет вне палитры"); return palette[i]; };
    const q = x => x * step, P2 = () => [q(r.u16()), q(r.u16())], P3 = () => [q(r.u16()), q(r.u16()), q(r.u16())];
    const count = r.varint(LIMITS.records), sink = new Sink(), stats = { boxes: 0, prisms: 0, walls: 0, instances: 0, meshes: 0 }, families = {};
    for (let k = 0; k < count; k++) {
      const kind = r.u8(), rgba = color();
      if (kind === KIND.box) {
        stats.boxes++;
        const origin = P3(), yaw = r.u16(), size = P3();
        boxes(sink, rgba, [[0, 0, 0, ...size]], yawPlace(origin, yaw));
      } else if (kind === KIND.prism) {
        stats.prisms++;
        const y0 = q(r.u16()), h = q(r.u16()), loops = Array.from({ length: r.varint(LIMITS.loops) }, () => {
          const n = r.varint(LIMITS.loopPoints); if (n < 3) fail("короткий контур"); return Array.from({ length: n }, P2);
        });
        if (!loops.length || !(h > 0)) fail("пустая призма");
        prism(sink, rgba, y0, h, loops);
      } else if (kind === KIND.wall) {
        stats.walls++;
        const a = P2(), b = P2(), t = q(r.i16()), e0 = q(r.i16()), e1 = q(r.i16()), y0 = q(r.u16()), h = q(r.u16()), cb = color(), ce = color();
        const openings = Array.from({ length: r.varint(LIMITS.openings) }, () => ({ u0: q(r.u16()), v0: q(r.u16()), w: q(r.u16()), h: q(r.u16()) }));
        wall(sink, [rgba, cb, ce], { a, b, t, e0, e1, y0, h, openings });
      } else if (kind === KIND.instance) {
        stats.instances++;
        const code = r.u16(), origin = P3(), yaw = r.u16(), params = Array.from({ length: r.varint(LIMITS.params) }, () => r.u16());
        const name = library.FAMILIES[code]?.name ?? String(code); families[name] = (families[name] || 0) + 1;
        // Library sizes are real millimetres; the export scale shrinks them like the rest of the model.
        const at = yawPlace(origin, yaw), place = p => at([p[0] * scale, p[1] * scale, p[2] * scale]);
        for (const part of library.build(code, params, rgba)) boxes(sink, part.rgba, part.boxes, place);
      } else if (kind === KIND.mesh) {
        stats.meshes++;
        const nv = r.varint(LIMITS.vertices), ni = r.varint(LIMITS.indices), codec = r.u8();
        if (nv < 3 || ni < 3 || ni % 3) fail("неверный размер сетки");
        let raw16, faces;
        if (codec === 0) {
          raw16 = new Uint16Array(nv * 4); for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) raw16[i * 4 + a] = r.u16();
          faces = new Uint32Array(ni); for (let i = 0; i < ni; i++) faces[i] = nv > 65535 ? r.u32() : r.u16();
        } else if (codec === 1) {
          const vb = r.bytes(r.varint(LIMITS.raw)), ib = r.bytes(r.varint(LIMITS.raw));
          if (!meshopt?.supported) fail("нет декодера meshoptimizer. Обновите просмотрщик");
          await meshopt.ready;
          const vertices = new Uint8Array(nv * 8), indices = new Uint8Array(ni * 4);
          try { meshopt.decodeVertexBuffer(vertices, nv, 8, vb); meshopt.decodeIndexBuffer(indices, ni, 4, ib); } catch { fail("повреждён поток meshoptimizer"); }
          raw16 = new Uint16Array(vertices.buffer); faces = new Uint32Array(indices.buffer);
        } else fail("неизвестный кодек сетки");
        const point = i => { if (i >= nv) fail("индекс вне сетки"); return [q(raw16[i * 4]), q(raw16[i * 4 + 1]), q(raw16[i * 4 + 2])]; };
        for (let i = 0; i < ni; i += 3) sink.tri(rgba, point(faces[i]), point(faces[i + 1]), point(faces[i + 2]));
      } else fail("неизвестный тип записи " + kind);
    }
    if (r.left) fail("лишние байты");
    if (!sink.triangles) fail("пустая сцена");
    // Same normalization as CBX: bottom-centre of everything, metres, Y-up.
    const groups = [...sink.groups.values()], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const g of groups) for (let i = 0; i < g.positions.length; i++) { const a = i % 3; min[a] = Math.min(min[a], g.positions[i]); max[a] = Math.max(max[a], g.positions[i]); }
    const originMeters = [min[0] / 2 + max[0] / 2, min[1], min[2] / 2 + max[2] / 2];
    const meshes = groups.map(g => {
      const positions = Float64Array.from(g.positions, (x, i) => x - originMeters[i % 3]);
      return { positions, indices: Uint32Array.from(g.indices), rgba: g.rgba };
    });
    const bounds = { min: min.map((x, i) => x - originMeters[i]), max: max.map((x, i) => x - originMeters[i]) };
    return { meshes, vertices: meshes.reduce((s, m) => s + m.positions.length / 3, 0), triangles: sink.triangles, bounds,
      extent: bounds.max.map((x, i) => x - bounds.min[i]), originMeters, scale, step, units: "m", up: "Y", rawBytes: input.length,
      objects: count, primitives: stats, families, libraryVersion: libVersion,
      excluded: ["GBX2: цвет без текстур; двери, окна и мебель из библиотеки просмотрщика по коду семейства"] };
  }

  // Reference writer. Values are already integer grid units / palette indices; mesh codec 0 only (meshopt is encoded by Exporto).
  function write({ step = 0.001, scale = 1, libVersion = library.VERSION, palette, records }) {
    const out = [], u8 = x => out.push(x & 255), u16 = x => { if (!Number.isInteger(x) || x < 0 || x > 65535) fail("u16 вне диапазона: " + x); u8(x); u8(x >> 8); },
      i16 = x => { if (!Number.isInteger(x) || x < -32768 || x > 32767) fail("i16 вне диапазона: " + x); u16(x & 0xffff); },
      varint = x => { do { let c = x & 127; x = Math.floor(x / 128); if (x) c |= 128; u8(c); } while (x); },
      f32 = x => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); out.push(...b); };
    out.push(71, 66, 88, 50); u8(1); u8(0); f32(step); f32(scale); u16(libVersion);
    varint(palette.length); for (const c of palette) c.forEach(u8);
    varint(records.length);
    for (const x of records) {
      u8(KIND[x.kind]); u8(x.color);
      if (x.kind === "box") { x.origin.forEach(u16); u16(x.yaw || 0); x.size.forEach(u16); }
      else if (x.kind === "prism") { u16(x.y0); u16(x.h); varint(x.loops.length); for (const l of x.loops) { varint(l.length); for (const p of l) p.forEach(u16); } }
      else if (x.kind === "wall") { x.a.forEach(u16); x.b.forEach(u16); i16(x.t); i16(x.e0 || 0); i16(x.e1 || 0); u16(x.y0); u16(x.h); u8(x.colorB ?? x.color); u8(x.colorEdge ?? x.color); varint(x.openings?.length || 0); for (const o of x.openings || []) [o.u0, o.v0, o.w, o.h].forEach(u16); }
      else if (x.kind === "instance") { u16(x.code); x.origin.forEach(u16); u16(x.yaw || 0); varint(x.params?.length || 0); (x.params || []).forEach(u16); }
      else if (x.kind === "mesh") { varint(x.points.length); varint(x.faces.length); u8(0); x.points.forEach(p => p.forEach(u16)); x.faces.forEach(x.points.length > 65535 ? (i => { u16(i & 0xffff); u16(i >>> 16); }) : u16); }
      else fail("неизвестный тип записи");
    }
    return Uint8Array.from(out);
  }
  const api = { LIMITS, KIND, decode, write };
  if (node) module.exports = api; else root.ARGbx2 = api;
})(typeof globalThis === "object" ? globalThis : this);
