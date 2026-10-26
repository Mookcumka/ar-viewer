# AR Viewer

Один общий просмотрщик QR-листов AR Style и Exporto. Модель берётся с листа: legacy AR1/AR4/AR5 из QR/URL fragment, либо бинарные части Exporto QRL1/CBX1. Геометрии на сервере и заранее встроенных mesh в runtime нет.

Исходник — AR-Project, `ar-poc/`. Править там, сюда копировать. Эта интеграция из Draft72 `4c482cce6446e9577bb321982532656cd065ed28`; merge/публикация требуют отдельного решения владельца.

- `index.html`, `viewer.js` — прежний основной стеклянный интерфейс, одна AR.js камера/сцена, прежний Hiro tracking для legacy. «Новый лист» сбрасывает текущую сборку. Stop/фон останавливают camera tracks; возобновление явное.
- `qr-geometry.js` — общий bounded QRL1/SHA-256/gzip/CBX1 decoder; `usdz.js` — общий USDZ writer и имеющаяся кнопка Quick Look для всех моделей. У QRL1 нет placement-контракта: новый mesh размещается на поверхности через Quick Look, автоматическое совмещение с листом не обещается.
- `index.html?diagnostics=1` — тот же интерфейс с JSON-журналом и безопасным чтением HTML Exporto, без исполнения скриптов файла. QR запуска содержит только заменяемый HTTPS URL кода; части геометрии считываются уже внутри Safari.
- `compare/qr-sheet-1/qr-sheet/index.html` и `qr-sheet/` — совместимые маршруты в основной viewer. Миграционный child-worker обслуживает только прежний scope; второй viewer удалён. Старый launch.svg действует через это перенаправление.
- `scan.html` — прежняя переадресация в основной index; `vendor/` — прежние фиксированные версии без CDN, `licenses/` — upstream terms. `compare/camera-1/` остаётся историческим экспериментом, в текущую реализацию не включается.

[Архитектура, переиспользование и границы](docs/ar/unified-viewer.md). [Runtime manifest](source-manifest.json). Прежние vendor/calibration/маркер и legacy wire не менялись.

## Проверки и приёмка

`node --test test/qr.test.cjs qr-sheet/test/codec.test.cjs`: 23/23. Browser software: `python3 qr-sheet/test/make_camera_fixture.py /tmp/ar-viewer-unified-test compare/camera-1/comparison/hiro.jpg`, затем `node test/unified-browser.cjs` (Playwright/Chromium, без установки новых зависимостей здесь): 13 gates в исходнике. Тестовые vectors — синтетические fixtures C# encoder Exporto71, исключительно в test/, не реальный экспорт Revit и не часть runtime/portable bundle.

Для iPhone: один раз получить код по HTTPS, дождаться «Ресурсы сохранены офлайн», при обновлении с v6 один раз перезагрузить документ и проверить diagnostic build `unified-20261026-1`. Установка приложения/PWA не нужна. Кэш iOS может удалить; тогда код нужно получить снова из любого совместимого источника. Наличие кэша не доказывает offline AR.

Открытая физическая приёмка: Camera iPhone → Safari → общий viewer → новые QRL1 из настоящей SceneData AR-T.07 → N/N + SHA → Quick Look → вкладка AR. Сохранить HTML/Exporto report/IDs, viewer JSON/USDZ и видео; затем T01 и независимая модель Revit. Старые AR4/AR5 и AR-T.03 не заменяют этот тест. Software checks и rel=ar сами по себе не подтверждают AR на телефоне.
