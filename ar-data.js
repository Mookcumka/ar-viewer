/* Shared QR contract. No camera or DOM side effects. */
(function (root) {
  "use strict";
  // AR4 walls fit in one QR (~2000 URL characters); anything longer is not ours.
  const MAX_FRAGMENT = 4096, MAX_WALLS = 10000, MAX_OPENINGS = 255;
  function parse(fragment) {
    if (typeof fragment !== "string" || fragment.length > MAX_FRAGMENT) throw new Error("Слишком длинные параметры QR");
    let raw;
    try { raw = decodeURIComponent(fragment.replace(/^#/, "")); }
    catch (_) { throw new Error("Неверная кодировка QR"); }
    // Optional, in this order: c=RRGGBB colour of the whole model, s=sheet label (shown in the viewer).
    const extra = "(?:;c=([0-9A-Fa-f]{6}))?(?:;s=([A-Za-z0-9.-]{1,16}))?";
    const walls = new RegExp("^AR4;walls;scale=(\\d{1,5})" + extra + ";data=([A-Za-z0-9_-]+)$").exec(raw);
    if (walls) {
      const scale = Number(walls[1]);
      if (!(scale >= 1 && scale <= 10000)) throw new Error("Масштаб должен быть от 1 до 10000");
      return { kind: "walls", scale, data: walls[4], payload: raw, unit: 1000 / (40 * scale), color: rgb(walls[2]), sheet: walls[3] || "" };
    }
    const match = new RegExp("^AR1;cube;(\\d{1,5});(\\d{1,5});(\\d{1,5});scale=(\\d{1,5})" + extra + "$").exec(raw);
    if (!match) throw new Error("QR не содержит данные AR Style");
    const [w, d, h, scale] = match.slice(1, 5).map(Number);
    if (![w, d, h, scale].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 10000))
      throw new Error("Размеры и масштаб должны быть от 1 до 10000");
    return { kind: "cube", w, d, h, scale, payload: raw, x: w / scale / 40, y: h / scale / 40, z: d / scale / 40,
      color: rgb(match[5]), sheet: match[6] || "" };
  }
  function rgb(hex) {
    return hex ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) : null;
  }
  /** Short human title for the viewer, e.g. «Куб 2000 × 2000 × 2000». */
  function title(value) {
    return value.kind === "walls" ? "Стены · 1:" + value.scale : `Куб ${value.w} × ${value.d} × ${value.h} · 1:${value.scale}`;
  }
  function fromUrl(text) {
    let url;
    try { url = new URL(text); } catch (_) { throw new Error("QR не содержит корректный URL"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Нужна HTTPS-ссылка AR Style");
    // Read data only. Never navigate to a host supplied by a scanned QR.
    return parse(url.hash);
  }
  /* AR4 binary (little endian, after gzip): byte version=4, ushort wall count; per wall
     7 × int32 mm (X1, Y1, X2, Y2, Z0, Z1, thickness), 3 × byte RGB, byte opening count;
     per opening 4 × int32 mm (start, end along the axis, bottom, top above Z0). */
  function readWalls(buffer) {
    const view = new DataView(buffer);
    let p = 0;
    const need = n => { if (p + n > view.byteLength) throw new Error("Данные стен обрезаны"); };
    const u8 = () => { need(1); return view.getUint8(p++); };
    const u16 = () => { need(2); const x = view.getUint16(p, true); p += 2; return x; };
    const metres = () => { need(4); const x = view.getInt32(p, true); p += 4; return x / 1000; };
    if (u8() !== 4) throw new Error("Версия формата стен не поддерживается");
    const count = u16();
    if (count < 1 || count > MAX_WALLS) throw new Error("Неверное количество стен");
    const walls = [];
    for (let i = 0; i < count; i++) {
      const [x1, y1, x2, y2, z0, z1, width] = Array.from({ length: 7 }, metres);
      const color = [u8(), u8(), u8()];
      const n = u8(), length = Math.hypot(x2 - x1, y2 - y1), height = z1 - z0;
      if (!(length > 0 && width > 0 && height > 0) || n > MAX_OPENINGS) throw new Error(`Стена ${i + 1}: неверные размеры`);
      const openings = [];
      for (let j = 0; j < n; j++) {
        const [start, end, bottom, top] = Array.from({ length: 4 }, metres);
        if (start < 0 || end > length + 0.01 || end <= start || bottom < 0 || top > height + 0.01 || top <= bottom)
          throw new Error(`Стена ${i + 1}: неверный проём`);
        openings.push({ start, end, bottom, top });
      }
      walls.push({ x1, y1, x2, y2, z0, z1, width, length, height, color, openings });
    }
    if (p !== view.byteLength) throw new Error("Лишние данные после стен");
    return walls;
  }
  async function decodeWalls(base64url) {
    const s = base64url.replace(/-/g, "+").replace(/_/g, "/");
    let bytes;
    try { bytes = Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0)); }
    catch (_) { throw new Error("Повреждены данные стен"); }
    if (typeof DecompressionStream !== "function") throw new Error("Браузер не умеет распаковывать данные (нужен iOS 16.4+)");
    let buffer;
    try { buffer = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(); }
    catch (_) { throw new Error("Повреждены сжатые данные стен"); }
    return readWalls(buffer);
  }
  const api = { parse, fromUrl, title, readWalls, decodeWalls };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ARCubeData = api;
})(typeof globalThis === "object" ? globalThis : this);
