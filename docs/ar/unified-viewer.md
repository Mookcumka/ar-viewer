# Единый ar-viewer: интеграция геометрии Exporto

26.10.2026. Владелец согласовал [конкретный план в Draft72](https://github.com/Mookcumka/AR-Project/pull/72#issuecomment-6411175832): развивать существующий основной viewer; отдельную страницу PR4 не превращать во второе приложение. Первая версия Draft72 и публичный ar-viewer PR4 были изолированным опытом. Эта переработка заменяет вторую оболочку общим кодом. Публикация/merge новой версии ещё не разрешены. Нативные PR67/71 в интеграцию не включаются.

## Один источник и один экран

Исходник — `AR-Project/ar-poc/`, как уже указано в README публичного ar-viewer. Перед интеграцией SHA шести исходных файлов index/viewer/ar-data/usdz/offline/sw совпадали с корнем публичного main `ccbc74f953129418e2cc538398cd2e7b39574143`. Старые стеклянные панели, цвета, типографика, chip/reticle/toast/start/stop/QuickLook остаются. Прогресс1/3/6QR показывается в существующих title/sheet/status. «Новый лист» появляется для сброса новой сцены/сборки частей; журнал и HTML-file import доступны только через `index.html?diagnostics=1` внутри того же интерфейса.

Удалены самостоятельные `qr-sheet/viewer.js`, `style.css`, `ar-button.svg`, `codec.js`. Общий декодер перемещён без изменения wire protocol в `qr-geometry.js`. `qr-sheet/index.html` — только совместимый маршрут в основной index, без своего UI/камеры/рендерера. `qr-sheet/sw.js` — миграционный worker, не второй cache/runtime. Прежняя команда browser-smoke вызывает новые тесты основного приложения.

## Геометрия и AR-механизмы

`viewer.js/startScanning()` получает кадры **единственного video AR.js**. `jsQR.binaryData` с magic QRL1 идёт в общий Collector/SHA/gzip/CBX1; прежние строки AR1/AR4/AR5 и HTTPS fragments — в `ARCubeData`. Нет преобразования бинарных данных через текст, подмены QRL1 кубом или распознавания по имени тестового альбома. Старые параметрические генераторы остаются только для своих явно распознанных legacy-контрактов, без fallback для нового mesh.

Для QRL1 используется `THREE.BufferGeometry` из проверенных позиций/индексов и существующая material-функция. Один `model`/`usdzFor(group)`/`ARUsdz`/QuickLook link для всех форматов. Opt-in sRGB→linear, alpha и float32 precision/degenerate/winding guards из первой версии72 сохранены. Существующий legacy USDA остаётся прежним. Прежние модели/материалы/geometry/Blob освобождаются при смене; новая модель фиксируется только после SHA/валидации. Плохой неизвестный QR сам по себе не уничтожает текущую модель.

Параметры **Hiro40мм, AR.js, camera calibration, smoothCount6, tolerance0.01, threshold3 и ar-follow коэффициенты не менялись**. QRL1 не получает вымышленную позу Hiro: CBX1 не содержит placement, `scale` уже baked в координатах и не равен legacy знаменателю1:N. Для QRL1 поле holder отсутствует: модель предлагается через **имеющуюся кнопку Quick Look**, с ручным размещением на поверхности. Экран камеры при этом остаётся экраном того же viewer; он не выдаётся за AR с привязанной QRL1-геометрией. Позиционирование legacy по Hiro сохраняется. Автоматическое совмещение нового mesh с листом — отдельный несогласованный этап, без изменения протокола сейчас.

Повторные QR частей принятого AR5 не удаляют модель. Есть защита async-load generation и блокирование прежней identity при «Новый лист», включая partial QRL1. После ошибки проверки разрешён повтор; явный выбор HTML может повторить предыдущую сцену. Принятие новой identity сбрасывает per-scene diagnostic flags, поэтому camera A → file B не выдаётся за оптическое чтение B.

Для паузы/продолжения камеры переиспользован ранее проверенный механизм owned-video из camera-1 (не весь session/интерфейс/ARKit-код). Один getUserMedia отдаёт поток единственному AR.js video; AR.js sourceType=video не открывает второй поток. На resume сохраняются scene/ARController/marker bindings; калибровка и сглаживание не переписаны. Поздний ответ на отменённый запрос разрешения останавливается. Stop/background прекращают camera tracks, отменяют незавершённую проверку; возврат из Quick Look требует явного возобновления. Модель/USDZ сохраняются при обычной паузе, Stop больше не требует перезагрузки страницы.

## Кэш и существующие ссылки

Общий `sw.js` v7 кэширует основной index и qr-geometry вместе со старыми библиотеками. Readiness проверяет собственные scope/version. Модели/HTML/кадры не сохраняются в Cache API. Чужие приложения и кэши других scope не удаляются. Первый запуск всё ещё требует HTTPS-кода; iOS может удалить offline cache. Установка приложения/PWA не обязательна, старый manifest сохранён для совместимости.

Уже опубликованный QR ведёт на `compare/qr-sheet-1/qr-sheet/index.html`. Будущий публичный Draft сохраняет этот адрес как перенаправление к основному `index.html?diagnostics=1`, загружая общий root code. Поскольку уже установленный cache-first childSW способен игнорировать новый HTML, по его прежнему scriptURL готовится migration worker: удаляет только свой старый exporto-qr-sheet cache, переводит только клиентов своего scope в root и перенаправляет будущие navigation. Он не получает новую камеру, renderer или свой cache. Другие клиенты не навигируются. Root SW также понимает диагностические aliases, в том числе offline.

Старый root cache v6 может показать старый документ до установки v7: после обновления нужно один раз явно перезагрузить страницу; не принуждаем активного пользователя к потере текущего сеанса. Для физического теста сначала проверить diagnostics build `unified-20261026-1`. Сам факт сохранения кэша не подтверждает физический офлайн AR.

## Проверки и открытая приёмка

Локально пройдено **23/23 Node**: `node --test ar-poc/test/qr.test.cjs ar-poc/qr-sheet/test/codec.test.cjs`. Прежние1/3/6QRL1/CBX1 векторы C# encoder `6e2e11f` сохранены в numeric arrays; это unit fixtures, не новый экспорт Revit. Checks: metadata/bounds/SHA/gzip/нормализация/float32/RGBA, legacy wire, CRC/USDZ64-byte alignment, cache isolation. Synthetic geometry разрешена только в тестах.

Локально пройдено **13 browser software gates**: `python3 ar-poc/qr-sheet/test/make_camera_fixture.py /tmp/ar-viewer-unified-test /path/to/hiro.jpg` (существующий `plugin/assets/hiro.jpg`, либо неизменённый публичный camera-1/comparison/hiro.jpg), затем `node ar-poc/test/unified-browser.cjs` с Playwright/Chromium. Используются настоящие неизменённые vendor AR.js/A-Frame и искусственное видео, **не iPhone**. Проверки включают legacy AR1/AR4/AR5 и reread частей, legacy↔mesh и отзыв Blob, отмену чтения файла/позднего boot decode, offline6parts, миграцию cache-first childSW с сохранением root/unrelated cache,6QRL1 через один настоящий AR.js video/stream/controller, pause/resume и camera→file диагностические флаги, тот же legacy QR после binary-сцены, видимость прежней модели на Hiro после partial AR5→single AR1. Последняя проверка использует настоящий AR.js с кадрами прежнего Hiro, но не доказывает физическую устойчивость. Обычный 3D, mock rel=ar и нажатие ссылки не объявляются успешным AR.

Переносимый пакет содержит одно приложение без тестовых сцен, манифест SHA-256 и upstream licenses/notices для jsQR, A-Frame, AR.js, ARToolKit и Three.js; версии библиотек не менялись.

Сборка/отдельный Draft публичного ar-viewer готовятся без установки и запуска Revit/Parallels. После отдельного разрешения публикации нужна физическая проверка владельцем: штатная Camera iPhone → Safari → **основной viewer** → новые QRL1 из настоящей SceneData Exporto71 AR-T.07 → SHA → Quick Look → вкладка AR/поверхность. Далее настоящий T01 и модель вне альбомов без изменения алгоритма. Старые QR AR4/AR5 и параметрический AR-T.03 не заменяют экспорт SceneData. Сохранить исходный HTML/Exporto report/ID, viewer report/USDZ и видео. **Эта реальная приёмка пока не выполнена.**

До владельческого решения оба интеграционных PR остаются Draft, production/public copy не меняются. Подготовленные software checks и статическое review не являются разрешением на merge или публикацию.
