/* USDZ for AR Quick Look, built on the phone from the QR model. No camera or DOM side effects. */
(function (root) {
  "use strict";
  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const f = x => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(5).replace(/\.?0+$/, "");
  /** meshes: [{ positions: flat triangle list in metres (Y up), color: [r, g, b] 0..255 }]. */
  function usda(meshes) {
    const out = ['#usda 1.0\n(\n    defaultPrim = "Root"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n',
      'def Xform "Root" (\n    assetInfo = { string name = "AR Style" }\n    kind = "component"\n)\n{'];
    meshes.forEach((mesh, m) => {
      const p = mesh.positions, n = p.length / 3, points = [], normals = [];
      for (let i = 0; i < n; i += 3) {
        const a = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]], b = [p[i * 3 + 3], p[i * 3 + 4], p[i * 3 + 5]], c = [p[i * 3 + 6], p[i * 3 + 7], p[i * 3 + 8]];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const position = mesh.precisePositions ? x => String(x) : f;
        for (const q of [a, b, c]) { points.push(`(${position(q[0])}, ${position(q[1])}, ${position(q[2])})`); normals.push(`(${f(nx)}, ${f(ny)}, ${f(nz)})`); }
      }
      out.push(`
    def Mesh "Mesh${m}" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        uniform bool doubleSided = 1
        int[] faceVertexCounts = [${new Array(n / 3).fill(3).join(", ")}]
        int[] faceVertexIndices = [${Array.from({ length: n }, (_, i) => i).join(", ")}]
        rel material:binding = </Root/Materials/Material${m}>
        normal3f[] normals = [${normals.join(", ")}] (
            interpolation = "vertex"
        )
        point3f[] points = [${points.join(", ")}]
        uniform token subdivisionScheme = "none"
    }`);
    });
    out.push('\n    def Scope "Materials"\n    {');
    meshes.forEach((mesh, m) => {
      // Optional exact linear colour/opacity for generic imported scenes; legacy calls keep their output.
      const [r, g, b] = mesh.linearColor ? mesh.linearColor.map(f) : mesh.color.map(x => f(Math.pow(x / 255, 2.2)));
      out.push(`
        def Material "Material${m}"
        {
            token outputs:surface.connect = </Root/Materials/Material${m}/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (${r}, ${g}, ${b})
                float inputs:metallic = 0
                float inputs:roughness = 0.7${mesh.opacity === undefined ? "" : `\n                float inputs:opacity = ${f(mesh.opacity)}`}
                token outputs:surface
            }
        }`);
    });
    out.push("\n    }\n}\n");
    return out.join("");
  }
  /** Stored (uncompressed) zip with the file data aligned to 64 bytes, as USDZ requires. */
  function zip(name, data) {
    const nameBytes = new TextEncoder().encode(name), crc = crc32(data);
    const pad = (64 - ((30 + nameBytes.length + 4) % 64)) % 64, extra = 4 + pad;
    const local = new DataView(new ArrayBuffer(30 + nameBytes.length + extra));
    const central = new DataView(new ArrayBuffer(46 + nameBytes.length));
    const end = new DataView(new ArrayBuffer(22));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 10, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true); local.setUint16(28, extra, true);
    new Uint8Array(local.buffer).set(nameBytes, 30);
    local.setUint16(30 + nameBytes.length, 0x1986, true); local.setUint16(32 + nameBytes.length, pad, true);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 10, true); central.setUint16(6, 10, true);
    central.setUint32(16, crc, true); central.setUint32(20, data.length, true); central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    new Uint8Array(central.buffer).set(nameBytes, 46);
    const centralAt = local.byteLength + data.length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
    end.setUint32(12, central.byteLength, true); end.setUint32(16, centralAt, true);
    const file = new Uint8Array(centralAt + central.byteLength + end.byteLength);
    file.set(new Uint8Array(local.buffer), 0);
    file.set(data, local.byteLength);
    file.set(new Uint8Array(central.buffer), centralAt);
    file.set(new Uint8Array(end.buffer), centralAt + central.byteLength);
    return file;
  }
  function build(meshes) {
    if (!meshes.length) throw new Error("Нет геометрии для Quick Look");
    return zip("model.usda", new TextEncoder().encode(usda(meshes)));
  }
  const api = { build, usda, zip, crc32, genericMeshProfile: 1 };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ARUsdz = api;
})(typeof globalThis === "object" ? globalThis : this);

