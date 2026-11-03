/* Shared QR contract. No camera or DOM side effects. */
(function (root) {
  "use strict";
  // One QR holds ~2000 URL characters; AR5 joins up to 9 of them.
  const MAX_FRAGMENT = 20000, MAX_WALLS = 10000, MAX_OPENINGS = 255;
  function parse(fragment) {
    if (typeof fragment !== "string" || fragment.length > MAX_FRAGMENT) throw new Error("Слишком длинные параметры QR");
    let raw;
    try { raw = decodeURIComponent(fragment.replace(/^#/, "")); }
    catch (_) { throw new Error("Неверная кодировка QR"); }
    // Optional, in this order: c=RRGGBB colour of the whole model, s=sheet label (shown in the viewer).
    const extra = "(?:;c=([0-9A-Fa-f]{6}))?(?:;s=([A-Za-z0-9.-]{1,16}))?";
    // ARP1: album passport on the cover (AR Style 0.81, docs/albums/passport.md). No model, only the album card.
    const passport = /^ARP1;data=([A-Za-z0-9_-]{1,2400})$/.exec(raw);
    if (passport) return { kind: "passport", data: passport[1], payload: raw };
    // AR5: one payload over several QR; join() puts the parts back together.
    const part = /^AR5;id=([0-9a-f]{4});part=([1-9]);of=([2-9]);data=([A-Za-z0-9_;=.-]{1,2400})$/.exec(raw);
    if (part) {
      const [n, of] = [Number(part[2]), Number(part[3])];
      if (n > of) throw new Error("Неверный номер части QR");
      return { kind: "part", id: part[1], part: n, of, chunk: part[4], payload: raw };
    }
    // m=1: X/Y are millimetres from the marker centre along the sheet, the model stands on its plan.
    const walls = new RegExp("^AR4;walls;scale=(\\d{1,5})" + extra + "(;m=1)?;data=([A-Za-z0-9_-]+)$").exec(raw);
    if (walls) {
      const scale = Number(walls[1]);
      if (!(scale >= 1 && scale <= 10000)) throw new Error("Масштаб должен быть от 1 до 10000");
      return { kind: "walls", scale, data: walls[5], payload: raw, unit: 1000 / (40 * scale), color: rgb(walls[2]), sheet: walls[3] || "",
        anchored: !!walls[4] };
    }
    const match = new RegExp("^AR1;cube;(\\d{1,5});(\\d{1,5});(\\d{1,5});scale=(\\d{1,5})" + extra + "$").exec(raw);
    if (!match) throw new Error("QR не содержит данные AR Style");
    const [w, d, h, scale] = match.slice(1, 5).map(Number);
    if (![w, d, h, scale].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 10000))
      throw new Error("Размеры и масштаб должны быть от 1 до 10000");
    return { kind: "cube", w, d, h, scale, payload: raw, x: w / scale / 40, y: h / scale / 40, z: d / scale / 40,
      color: rgb(match[5]), sheet: match[6] || "" };
  }
  function crc32(text) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < text.length; i++) {
      c ^= text.charCodeAt(i) & 0xFF;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /** Joins AR5 parts of one model (any order). Returns the parsed model, or null while parts are missing. */
  function join(parts) {
    if (!parts.length) return null;
    const { id, of } = parts[0], byNumber = new Map();
    for (const p of parts) {
      if (p.kind !== "part" || p.id !== id || p.of !== of) throw new Error("Части разных моделей");
      byNumber.set(p.part, p.chunk);
    }
    if (byNumber.size < of) return null;
    const text = Array.from({ length: of }, (_, i) => byNumber.get(i + 1)).join("");
    if ((crc32(text) & 0xFFFF).toString(16).padStart(4, "0") !== id) throw new Error("Части QR повреждены: контрольная сумма не сошлась");
    const value = parse(text);
    if (value.kind === "part") throw new Error("Вложенные части QR не поддерживаются");
    return value;
  }
  function rgb(hex) {
    return hex ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) : null;
  }
  /** Short human title for the viewer, e.g. «Куб 2000 × 2000 × 2000». */
  function title(value) {
    if (value.kind === "part") return `Часть ${value.part} из ${value.of}`;
    if (value.kind === "passport") return "Паспорт альбома";
    return value.kind === "walls" ? "Стены · 1:" + value.scale + (value.anchored ? " · на плане" : "") : `Куб ${value.w} × ${value.d} × ${value.h} · 1:${value.scale}`;
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
  async function gunzip(base64url, what) {
    const s = base64url.replace(/-/g, "+").replace(/_/g, "/");
    let bytes;
    try { bytes = Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0)); }
    catch (_) { throw new Error("Повреждены данные " + what); }
    if (typeof DecompressionStream !== "function") throw new Error("Браузер не умеет распаковывать данные (нужен iOS 16.4+)");
    try { return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(); }
    catch (_) { throw new Error("Повреждены сжатые данные " + what); }
  }
  async function decodeWalls(base64url) {
    return readWalls(await gunzip(base64url, "стен"));
  }
  /* ARP1 JSON: {"v":1,"a":album,"p":project,"r":revision,"d":date,"st":status,"l":[[number,title],…]}; empty keys are omitted,
     the page of a sheet is its place in "l". Everything here is shown as plain text, never as markup. */
  const MAX_PASSPORT = 16384, MAX_PASSPORT_SHEETS = 500, MAX_TEXT = 300;
  function readPassport(buffer) {
    if (buffer.byteLength > MAX_PASSPORT) throw new Error("Паспорт альбома слишком большой");
    let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch (_) { throw new Error("Повреждён паспорт альбома"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждён паспорт альбома");
    if (value.v !== 1) throw new Error("Версия паспорта альбома не поддерживается — обновите просмотрщик");
    const text = key => {
      const x = value[key];
      if (x === undefined || x === null) return "";
      if (typeof x !== "string" && typeof x !== "number") throw new Error("Повреждён паспорт альбома");
      return String(x).trim().slice(0, MAX_TEXT);
    };
    const list = value.l === undefined ? [] : value.l;
    if (!Array.isArray(list) || list.length > MAX_PASSPORT_SHEETS) throw new Error("Повреждён список листов паспорта");
    const sheets = list.map((row, i) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 2 || !row.every(x => typeof x === "string" || typeof x === "number"))
        throw new Error("Повреждён список листов паспорта");
      return { page: i + 1, number: String(row[0]).trim().slice(0, MAX_TEXT), title: String(row[1] ?? "").trim().slice(0, MAX_TEXT) };
    });
    return { album: text("a"), project: text("p"), revision: text("r"), date: text("d"), status: text("st"), sheets };
  }
  async function decodePassport(base64url) {
    return readPassport(await gunzip(base64url, "паспорта"));
  }
  const api = { parse, join, fromUrl, title, crc32, readWalls, decodeWalls, readPassport, decodePassport };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ARCubeData = api;
})(typeof globalThis === "object" ? globalThis : this);
