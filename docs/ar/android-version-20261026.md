# AR Viewer: версия приложения и Android WebXR

Статус: экспериментальная реализация для Draft PR, не опубликована и не принята на Android. Источник — единый `ar-poc/` AR-Project; публичный ar-viewer получает ту же копию runtime. Exporto PR71 и протоколы QRL1/2, CBX1/2 не меняются. Нативный iOS эксперимент не является целевым приложением.

## Версионирование

`ar-poc/version.js` — один источник `version`, `build`, `cacheVersion`. Первая явно отображаемая версия: **0.2.0-rc.1**, сборка **20261026.1**, поколение cache10. Это не ретроспективное присвоение номеров прежним опубликованным прототипам.

- Семантическая версия относится только к AR Viewer. Исправления повышают patch, совместимые новые функции minor, несовместимый пользовательский контракт major; до стабилизации используем prerelease rc.N.
- Build `YYYYMMDD.N` увеличивать для каждой публикуемой ревизии runtime, в том числе исправлений между кандидатами. Не менять код уже опубликованной сборки под прежним номером.
- Версии QR, Exporto, AR Style и поколение cache независимы. Ссылка и протокол QR не получают номер приложения.
- В верхней плашке всегда видны версия и build, независимо от выбранной модели/камеры. В JSON `app` содержит ту же identity; legacy `build` также берётся из неё.
- SW импортирует тот же version.js, имя cache содержит version+build+cacheVersion. Запрос CACHE_STATUS сообщает все поля. Регистрация использует updateViaCache:none. Offline UI и JSON `readyForThisBuild` проверяют identity и scope; комплектный старый cache не выдаётся за текущий. `ready` в raw ответе означает только наличие entries.
- Это обнаружение несовместимой identity worker/page и отсутствующих ресурсов, **не SHA-проверка каждого исполняемого скрипта**. После обновления перезагрузить страницу с интернетом. Для соответствия исходной/публичной копии дополнительно используется source-manifest SHA-256.
- В standalone ZIP обязательны version.js и webxr.js; нет runtime fixtures или моделей. Хранение в cache условно: ОС может его удалить. Работу Android AR без сети после установки ARCore проверять отдельно.

## Один просмотрщик, два платформенных адаптера

Общий путь: настоящий Exporto SceneData → QRL1/2 → камера/HTML → общий bounded collector, SHA-256, CBX1/2 decoder → buildMeshes → существующая THREE.Group. Камера и UI общие. Синтетические vectors присутствуют только в тестах, не в runtime или переносимом архиве.

- iPhone: прежние USDZ/rel=ar/Apple Quick Look. Контракт одного IMG в ссылке сохранён.
- Android: способность проверяется `isSessionSupported('immersive-ar')`, а не UA. По явному нажатию запускается WebXR immersive-ar, обязательные local/hit-test, необязательный dom-overlay. Требуются поддерживаемое устройство, Chrome/совместимый браузер и Google Play Services for AR. Наша установка приложения не нужна; системный AR runtime может потребовать установки/обновления.
- До запроса XR синхронно освобождается getUserMedia сканера и приостанавливается AR.js. Одна camera owner в каждый момент. После выхода сканер не включается сам; пользователь может открыть модель ещё раз или читать новый лист.
- webxr.js — адаптер стандартного системного world tracking. Он использует vendored AFRAME.THREE, без нового движка/CDN. Сцена WebXR имеет свой временный renderer/context, пока AR.js приостановлен. Не создаётся второй просмотрщик, AR.js/Hiro не переписываются.
- В WebXR клонируется только группа восстановленной модели, с общими неизменяемыми geometry/materials. Данные модели не передаются серверу, GLB/Scene Viewer не требуются. Reticle-кольцо — служебная графика положения, не подменная модель.
- На неподдерживаемом браузере отображается конкретное ограничение. Универсальный обычный 3D fallback в этом PR не добавлен; восстановление байтов не называется AR.

## Размещение и масштаб

Показываем кольцо на горизонтальной поверхности. Тап вне HTML-кнопок/ползунка размещает модель; управляющие DOM события не должны одновременно давать XR select. После этого последующие hit-test результаты её не двигают. «Разместить заново» явно разрешает новый выбор. Это фиксированное преобразование в local reference space WebXR, **не QR/Hiro registration и не доказанная точность ARCore якоря**.

Визуальный макет по умолчанию вписан в габарит35см по наибольшей стороне. Ползунок5–100см явно подписан «Размер просмотра», основание на поверхности, горизонтальный центр под точкой размещения. Это не1:1 и не физический размер чертежа. Исходные координаты/геометрия не переписываются; display transform только в родителе. При потере viewer pose модель скрывается, после восстановления возвращается с прежней матрицей. При событии reference-space reset прежнее размещение отменяется: модель скрывается, пользователь получает просьбу разместить её заново. Старая матрица не применяется к новому origin. Сохранение положения между сессиями не реализовано.

Без dom-overlay работают нативный выход и select; HTML ползунок/повторное размещение могут быть недоступны. Это ограничение optional feature, не обещание полного UI на любом браузере. iPhone Quick Look масштабирование не меняется.

## Lifecycle и журнал

Каждый запрос XR владеет своим объектом ресурсов. Поздние завершения/ошибки отменённой сессии не закрывают следующую. Cleanup идемпотентный и best-effort, даже если native cancel уже недействителен. Ошибка/отказ разрешения не портит модель и допускает повтор. Исходные geometry/materials не dispose при выходе из XR.

Отчёт содержит версию, build, capabilities, факт request, software placement, состояния request/search/surface/placed/tracking-lost/end/error. Нет кадров, геометрии или deviceId. `webxrPlaced:true` означает обработанный select, а не физическую приёмку. Поля actualAR/realRevitProvenance сохраняют требование owner verification.

## Проверки и ручная приёмка

Node проверяет старые протоколы/контроль данных, capability detection, видимую версию, identity cache и отказ старого cache. `test/webxr-browser.cjs` использует настоящую vendored THREE, программные XR sessions/pose и test-only C# vectors. Проверяет неизменность source geometry/materials, освобождение camera перед XR, placement без следования новым hits, tracking loss, reset/size/end, отказ/повтор, конкурирующие запросы и offline version. Это **не Android, не Revit, не ARCore tracking test**.

Прежний `test/unified-browser.cjs` проверяет iPhone-контракт Quick Look, QRL1/2, legacy AR1/4/5/Hiro, тот же фиксированный лист на бумаге/экране и offline. Скорость, фокус и нагрев телефона не моделируются.

После отдельной публикации владелец должен проверить реальный QR из Revit на ARCore Android: номер версии; полноту частей; вход/отказ/повтор AR; размещение на столе; обход; потерю/возврат tracking; изменение размера; повторное размещение; выход/новый лист; сохранённый JSON. Проверить прежний iPhone сценарий тем же листом. Экран ноутбука имитирует бумагу, отдельного режима экрана/слайд-шоу нет. Приёмка требует настоящей восстановленной модели, а не test vectors.

## Первичные источники

- Google WebXR requirements: https://developers.google.com/ar/develop/webxr/requirements
- Google WebXR/ARCore capabilities: https://developers.google.com/ar/develop/webxr/arcore-comparison
- WebXR hit-test sample: https://github.com/immersive-web/webxr-samples/blob/main/hit-test.html
- DOM overlay beforexrselect: https://immersive-web.github.io/dom-overlays/#onbeforexrselect
- Three.js WebXRManager: https://threejs.org/docs/pages/WebXRManager.html
