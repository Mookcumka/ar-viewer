# AR Viewer 0.3.0-rc.5 - build20261027.4

Draft GBX1/QRL3 decoder candidate, NOT published. Baseline rc.4/build20261027.3 is published; physical acceptance remains open. Adds the agreed Exporto compact geometry contract to the existing viewer, preserving camera, magnetic QR frames, UI, Quick Look, Android WebXR and local USDZ/GLB.

GBX1 boxes, extrusions with holes and meshes restore locally from QR. Six frozen C# goldens verify bytes, surfaces, materials and scale. No test geometry in runtime and no new model server. The format remains experimental; synthetic tests do not prove Revit/phone acceptance or QR savings on a real model.

Canonical runtime: AR-Project ar-poc/. Public ar-viewer is a byte-exact mirror. PDF generation belongs to Exporto; the viewer reads its QR. Geometry is not uploaded. No merge or publication without owner permission.

- [GBX1 contract, limits, provenance and tests](docs/ar/gbx1-20261027.md)
- [Existing UI/AR/file contract](docs/ar/approved-viewer-20261026.md)
- [Camera management](docs/ar/camera-preview-20261027.md)
- [QR tracking](docs/ar/qr-tracking-20261027.md)

Tests: `node --test test/qr.test.cjs qr-sheet/test/codec.test.cjs`.
Browser suites: `node test/approved-browser.cjs`, `node test/approved-optical.cjs`,
`node test/camera-browser.cjs`, `node test/tracker-browser.cjs`, `node test/dense-browser.cjs`.
GBX optical fixtures: `python qr-sheet/test/make_gbx_camera_fixture.py /tmp/ar-gbx-camera`,
then `node test/gbx-optical.cjs` with existing Playwright/CHROMIUM_PATH.
Portable archive: `python qr-sheet/package.py destination.zip`; serve the whole folder via HTTPS.
Prepared offline cache is conditional and may be evicted by the OS. Physical device tests remain required.
