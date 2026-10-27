# AR Viewer 0.3.0-rc.2 · build20261027.1

Draft, не опубликован. Реализация [Issue9](https://github.com/Mookcumka/ar-viewer/issues/9): компактный scanner, AR-first, Android AR/3D, самостоятельные USDZ/GLB через share/download, без HTML import/Stop/sound. iPhone использует родной switch Quick Look. Общие decoder/legacy/Hiro и Android #8 сохранены.

[Контракт, материалы, lifecycle, ограничения и приёмка](docs/ar/approved-viewer-20261026.md). Физический Revit→PDF→iPhone/Android AR ещё не принят. Браузерные тесты не заменяют устройство. Ничего не публиковать/не сливать без отдельного разрешения владельца.

Исходный runtime — ar-poc/, публичный ar-viewer получает побайтную копию. PDF создаёт Exporto, viewer читает его QR камерой. Данные модели не отправляются серверу.

Проверки: node --test test/qr.test.cjs qr-sheet/test/codec.test.cjs; с Playwright: node test/approved-browser.cjs и node test/approved-optical.cjs, node test/camera-browser.cjs. Optical fixtures генерирует qr-sheet/test/make_camera_fixture.py (test-only данные). Portable ZIP: python qr-sheet/package.py destination.zip; обслуживать всю папку по HTTPS.

[Камера: полный кадр, focus/zoom по capabilities, фактическая диагностика и границы проверки](docs/ar/camera-preview-20261027.md).
