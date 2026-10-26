# AR Viewer

Один общий просмотрщик AR Style/Exporto. Legacy AR1/4/5/Hiro и QRL1/2 (CBX1/2,meshoptimizer0.23), общий USDZ/Quick Look, одна камера. Геометрия из QR/HTML, без загрузки моделей с сервера и без встроенных демонстрационных mesh.

Исходник AR-Project ar-poc/, commit 61930bf2b872d7a84b07fad889c16bc7e7f15a2d. Source manifest проверяет21общий runtime-файл. Здесь публикуется копия исходника; main обновляется только по отдельному разрешению владельца.

## Текущая UX-доработка (Draft, не опубликована)

Один сценарий листа на бумаге и экране: экран ноутбука имитирует бумагу. Нет режима ноутбука/слайд-шоу. Принятые номера1…N, список оставшихся, подтверждение повторов, краткие контуры считанных QR. После QRL готовности scanner останавливается; New Sheet возобновляет его при активной камере. Прежний Hiro marker loop сохраняется. HTML import доступен обычной кнопкой, отчёт различает camera/html-file.

Поиск: full frame+2циклическиеROI за snapshot из того же video, маска текущего кадра; yield/cancel между decode. Части можно читать в любом порядке, приближая камеру к разным областям одного листа. Полное чтение всех кодов издалека одним наведением НЕ гарантируется. В тесте маленьких QR полный snapshot не прочитал все части; ограничение задокументировано.

Офлайн: root cachev9 включает scan-feedback.js и официальный self-contained meshoptimizer decoder. При обновлении один раз перезагрузить с интернетом, дождаться «Ресурсы сохранены офлайн». Build unified-scan-ux-20261026-3. Кэш iOS может быть удалён; код придётся получить заново из независимого совместимого источника.

[Контракт UX и физическая приёмка](docs/ar/scan-feedback-20261026.md). [Общая архитектура](docs/ar/unified-viewer.md). [Протокол и сжатие](docs/ar/qr-meshoptimizer-20261026.md).

## Проверки

node --test test/qr.test.cjs qr-sheet/test/codec.test.cjs:38/38. Browser software regression: test/unified-browser.cjs; QR fixture generator qr-sheet/test/make_camera_fixture.py. Новая проверка — один неизменный лист с7QR, camera approach, прогресс/повтор/наклон. Synthetic C# vectors только test/, не runtime. Полный результат CI/browser фиксируется в PR.

index.html?diagnostics=1 — тот же UI с JSON-отчётом. Ни software tests, ни готовность USDZ, ни нажатие rel=ar не подтверждают настоящий AR. Новые изменения требуют ручного теста iPhone Safari с настоящим экспортом Revit. Generic QRL использует Quick Look на поверхности; автоматическое совмещение с линиями листа не заявляется.

compare/qr-sheet-1 и qr-sheet — совместимые маршруты основного index. Исторический compare/camera-1 не развивается как второй viewer. Vendor/calibration/маркер и протокол сохранены. Установка приложения не требуется.
