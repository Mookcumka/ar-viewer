/* GBX2 family library v3 (v2 + built-in oven, 28.10.2026): parametric stand-ins that the QR references by code instead of geometry.
 * Local frame: metres, +X along the host wall / width, +Y up, +Z into the room. Params are millimetres.
 * Codes are a public contract (docs/gbx2-wire-format.md): never renumber, only append. */
(function (root) {
  "use strict";
  const VERSION = 3;
  const GLASS = [170, 200, 230, 110], WHITE = [245, 245, 242, 255], METAL = [190, 192, 196, 255];
  const shade = (c, k) => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), c[3]];
  // Each builder gets params in metres and the record colour, returns [{rgba, boxes:[[x0,y0,z0,x1,y1,z1]]}].
  const FAMILIES = {
    1: { name: "door", params: ["width", "height", "wallThickness", "hand"], defaults: [800, 2000, 100, 0],
      // Origin: centre of the clear opening, on the wall centreline, at floor level. hand 0 = handle on -X side.
      build([w, h, t, hand], c) {
        const f = 0.04, d = Math.max(t, 0.06) / 2, x = w / 2, leafX = hand > 0.0005 ? x - f - 0.08 : -x + f + 0.04;
        return [{ rgba: shade(c, 0.8), boxes: [[-x, 0, -d, -x + f, h, d], [x - f, 0, -d, x, h, d], [-x + f, h - f, -d, x - f, h, d]] },
          { rgba: c, boxes: [[-x + f, 0, -0.02, x - f, h - f, 0.02]] },
          { rgba: METAL, boxes: [[leafX, 1.0, -0.04, leafX + 0.04, 1.03, 0.04]] }];
      } },
    2: { name: "window", params: ["width", "height", "wallThickness"], defaults: [1200, 1400, 100],
      // Origin: bottom centre of the opening (sill level), on the wall centreline.
      build([w, h, t], c) {
        const f = 0.06, d = Math.min(0.035, t / 2), x = w / 2;
        return [{ rgba: c, boxes: [[-x, 0, -d, x, f, d], [-x, h - f, -d, x, h, d], [-x, f, -d, -x + f, h - f, d], [x - f, f, -d, x, h - f, d], [-f / 2, f, -d, f / 2, h - f, d]] },
          { rgba: GLASS, boxes: [[-x + f, f, -0.005, -f / 2, h - f, 0.005], [f / 2, f, -0.005, x - f, h - f, 0.005]] }];
      } },
    10: { name: "wc", params: ["width", "depth", "height"], defaults: [370, 650, 780],
      // Origin: back centre at floor (against the wall).
      build([w, d, h], c) { const x = w / 2, tank = Math.min(0.18, d / 3); return [{ rgba: c, boxes: [[-x, 0, 0, x, h, tank], [-x * 0.9, 0, tank, x * 0.9, Math.min(0.4, h), d]] }]; } },
    11: { name: "bath", params: ["length", "width", "height"], defaults: [1700, 700, 600],
      // Origin: back centre of the long side at floor.
      build([l, w, h], c) { const x = l / 2, s = 0.05; return [{ rgba: c, boxes: [[-x, 0, 0, x, 0.15, w], [-x, 0.15, 0, x, h, s], [-x, 0.15, w - s, x, h, w], [-x, 0.15, s, -x + s, h, w - s], [x - s, 0.15, s, x, h, w - s]] }]; } },
    12: { name: "sink", params: ["width", "depth", "height"], defaults: [600, 450, 850],
      build([w, d, h], c) { const x = w / 2; return [{ rgba: c, boxes: [[-x, h - 0.15, 0, x, h, d]] }, { rgba: shade(c, 0.85), boxes: [[-0.09, 0, 0, 0.09, h - 0.15, 0.2]] }]; } },
    13: { name: "showerTray", params: ["length", "width", "height"], defaults: [900, 900, 150],
      build([l, w, h], c) { return [{ rgba: c, boxes: [[-l / 2, 0, 0, l / 2, h, w]] }]; } },
    20: { name: "bed", params: ["width", "length", "height"], defaults: [1600, 2000, 450],
      // Origin: head-board centre at floor, foot towards +Z.
      build([w, l, h], c) { const x = w / 2; return [{ rgba: c, boxes: [[-x, 0, 0.08, x, h, l]] }, { rgba: shade(c, 0.75), boxes: [[-x, 0, 0, x, 1.0, 0.08]] }]; } },
    21: { name: "sofa", params: ["length", "depth", "height"], defaults: [2000, 900, 850],
      build([l, d, h], c) { const x = l / 2, a = 0.15; return [{ rgba: c, boxes: [[-x + a, 0, 0.2, x - a, 0.45, d], [-x, 0, 0, x, h, 0.2], [-x, 0, 0.2, -x + a, 0.65, d], [x - a, 0, 0.2, x, 0.65, d]] }]; } },
    22: { name: "table", params: ["length", "width", "height"], defaults: [1200, 800, 750],
      // Origin: centre at floor.
      build([l, w, h], c) { const x = l / 2, z = w / 2, g = 0.05, top = h - 0.04;
        return [{ rgba: c, boxes: [[-x, top, -z, x, h, z], [-x, 0, -z, -x + g, top, -z + g], [x - g, 0, -z, x, top, -z + g], [-x, 0, z - g, -x + g, top, z], [x - g, 0, z - g, x, top, z]] }]; } },
    23: { name: "chair", params: ["width", "depth", "height"], defaults: [450, 500, 900],
      build([w, d, h], c) { const x = w / 2, z = d / 2, g = 0.04;
        return [{ rgba: c, boxes: [[-x, 0.42, -z, x, 0.46, z], [-x, 0.46, z - g, x, h, z], [-x, 0, -z, -x + g, 0.42, -z + g], [x - g, 0, -z, x, 0.42, -z + g], [-x, 0, z - g, -x + g, 0.42, z], [x - g, 0, z - g, x, 0.42, z]] }]; } },
    24: { name: "wardrobe", params: ["width", "depth", "height"], defaults: [1200, 600, 2200],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    25: { name: "kitchenBase", params: ["length", "depth", "height"], defaults: [2400, 600, 900],
      build([l, d, h], c) { const x = l / 2; return [{ rgba: shade(c, 0.6), boxes: [[-x, 0, 0, x, 0.1, d - 0.05]] }, { rgba: c, boxes: [[-x, 0.1, 0, x, h - 0.03, d]] }, { rgba: shade(c, 0.8), boxes: [[-x, h - 0.03, 0, x, h, d + 0.02]] }]; } },
    26: { name: "kitchenWall", params: ["length", "depth", "height"], defaults: [2400, 350, 700],
      // Origin: back centre at the cabinet bottom (mount height is the Y of the placement).
      build([l, d, h], c) { return [{ rgba: c, boxes: [[-l / 2, 0, 0, l / 2, h, d]] }]; } },
    27: { name: "fridge", params: ["width", "depth", "height"], defaults: [600, 650, 1850],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    28: { name: "washer", params: ["width", "depth", "height"], defaults: [600, 600, 850],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    // v2. Params are [width, depth, height] (Exporto's family bounding box); origin back centre at floor unless noted.
    14: { name: "bidet", params: ["width", "depth", "height"], defaults: [370, 550, 400],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w * 0.45, 0, 0, w * 0.45, h, d]] }]; } },
    15: { name: "showerCabin", params: ["width", "depth", "height"], defaults: [900, 900, 2100],
      build([w, d, h], c) { const x = w / 2, g = 0.01, t = Math.min(0.15, h / 10);
        return [{ rgba: c, boxes: [[-x, 0, 0, x, t, d]] }, { rgba: GLASS, boxes: [[-x, t, d - g, x, h, d], [-x, t, 0, -x + g, h, d - g], [x - g, t, 0, x, h, d - g]] }]; } },
    29: { name: "nightstand", params: ["width", "depth", "height"], defaults: [450, 400, 550],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    31: { name: "towelRail", params: ["width", "depth", "height"], defaults: [500, 100, 800],
      build([w, d, h], c) { const x = w / 2, r = 0.012, n = Math.max(3, Math.round(h / 0.15)), bars = [];
        for (let i = 0; i < n; i++) { const y = r + i * (h - 2 * r) / (n - 1); bars.push([-x, y - r, d / 2 - r, x, y + r, d / 2 + r]); }
        return [{ rgba: c, boxes: [[-x, 0, 0, -x + 2 * r, h, d], [x - 2 * r, 0, 0, x, h, d], ...bars] }]; } },
    32: { name: "waterHeater", params: ["width", "depth", "height"], defaults: [450, 450, 800],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    33: { name: "airConditioner", params: ["width", "depth", "height"], defaults: [800, 200, 280],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }, { rgba: shade(c, 0.7), boxes: [[-w / 2 + 0.03, 0.02, d, w / 2 - 0.03, 0.06, d + 0.005]] }]; } },
    40: { name: "shelving", params: ["width", "depth", "height"], defaults: [800, 350, 2000],
      build([w, d, h], c) { const x = w / 2, s = 0.02, n = Math.max(2, Math.round(h / 0.35)), boxes = [[-x, 0, 0, -x + s, h, d], [x - s, 0, 0, x, h, d]];
        for (let i = 0; i <= n; i++) { const y = Math.min(h - s, i * (h - s) / n); boxes.push([-x + s, y, 0, x - s, y + s, d]); }
        return [{ rgba: c, boxes }]; } },
    41: { name: "armchair", params: ["width", "depth", "height"], defaults: [850, 850, 850],
      build([w, d, h], c) { const x = w / 2, a = Math.min(0.15, w / 6);
        return [{ rgba: c, boxes: [[-x + a, 0, 0.2, x - a, 0.45, d], [-x, 0, 0, x, h, 0.2], [-x, 0, 0.2, -x + a, 0.65, d], [x - a, 0, 0.2, x, 0.65, d]] }]; } },
    42: { name: "dresser", params: ["width", "depth", "height"], defaults: [1000, 450, 850],
      build([w, d, h], c) { return [{ rgba: shade(c, 0.7), boxes: [[-w / 2, 0, 0, w / 2, 0.06, d - 0.03]] }, { rgba: c, boxes: [[-w / 2, 0.06, 0, w / 2, h, d]] }]; } },
    43: { name: "tv", params: ["width", "depth", "height"], defaults: [1200, 80, 700],
      build([w, d, h], c) { return [{ rgba: [40, 40, 44, 255], boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    44: { name: "kitchenIsland", params: ["width", "depth", "height"], defaults: [1800, 900, 900],
      // Origin: centre at floor (free-standing).
      build([w, d, h], c) { const x = w / 2, z = d / 2;
        return [{ rgba: shade(c, 0.6), boxes: [[-x + 0.05, 0, -z + 0.05, x - 0.05, 0.1, z - 0.05]] }, { rgba: c, boxes: [[-x, 0.1, -z, x, h - 0.03, z]] }, { rgba: shade(c, 0.8), boxes: [[-x - 0.02, h - 0.03, -z - 0.02, x + 0.02, h, z + 0.02]] }]; } },
    45: { name: "dishwasher", params: ["width", "depth", "height"], defaults: [600, 600, 850],
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h, d]] }]; } },
    46: { name: "cooker", params: ["width", "depth", "height"], defaults: [600, 600, 850],
      build([w, d, h], c) { const t = Math.min(0.03, h / 10);
        return [{ rgba: c, boxes: [[-w / 2, 0, 0, w / 2, h - t, d]] }, { rgba: [35, 35, 38, 255], boxes: [[-w / 2, h - t, 0, w / 2, h, d]] }]; } },
    47: { name: "oven", params: ["width", "depth", "height"], defaults: [595, 560, 595],
      // Built-in oven (v3). Origin: back centre at the oven bottom (Exporto places it at its real height).
      build([w, d, h], c) { const x = w / 2, f = Math.min(0.02, d / 10), m = Math.min(0.03, w / 10), p = Math.min(0.12, h / 4);
        return [{ rgba: c, boxes: [[-x, 0, 0, x, h, d - f]] }, { rgba: [35, 35, 38, 255], boxes: [[-x + m, m, d - f, x - m, h - p, d]] },
          { rgba: METAL, boxes: [[-x + 2 * m, h - p + 0.02, d, x - 2 * m, h - p + 0.04, d + 0.03]] }]; } },
    50: { name: "ceilingLight", params: ["width", "depth", "height"], defaults: [400, 400, 100],
      // Origin: centre of the fixture bottom (Exporto places it at its real height).
      build([w, d, h], c) { return [{ rgba: c, boxes: [[-w / 2, 0, -d / 2, w / 2, h, d / 2]] }]; } },
    51: { name: "floorLamp", params: ["width", "depth", "height"], defaults: [400, 400, 1600],
      // Origin: centre at floor.
      build([w, d, h], c) { const r = Math.min(w, d) * 0.3, p = 0.015, s = Math.min(0.3, h / 4);
        return [{ rgba: METAL, boxes: [[-r, 0, -r, r, 0.03, r], [-p, 0.03, -p, p, h - s, p]] }, { rgba: c, boxes: [[-w / 2, h - s, -d / 2, w / 2, h, d / 2]] }]; } },
    30: { name: "radiator", params: ["length", "height", "depth"], defaults: [800, 500, 100],
      // Origin: back centre at the radiator bottom.
      build([l, h, d], c) { return [{ rgba: c, boxes: [[-l / 2, 0, 0, l / 2, h, d]] }]; } }
  };
  function build(code, params, rgba) {
    const family = FAMILIES[code];
    if (!family) throw new Error("GBX2: семейство библиотеки " + code + " неизвестно. Обновите просмотрщик");
    if (params.length > family.params.length) throw new Error("GBX2: лишние параметры семейства " + family.name);
    const values = family.defaults.map((x, i) => (i < params.length ? params[i] : x) / 1000);
    if (values.some((x, i) => family.params[i] !== "hand" && !(x > 0))) throw new Error("GBX2: нулевой размер семейства " + family.name);
    return family.build(values, rgba ?? WHITE);
  }
  const api = { VERSION, FAMILIES, build };
  if (typeof module === "object" && module.exports) module.exports = api; else root.ARGbx2Library = api;
})(typeof globalThis === "object" ? globalThis : this);
