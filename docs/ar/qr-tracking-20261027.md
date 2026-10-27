# Интеллектуальный QR-сканер: detection → tracking → decode → validation

Status update 2026-10-27: rc.3/build20261027.2/cache13 was merged and published with owner authorization (ar-viewer #11 -> #10; AR-Project #74 -> #73 -> #72). Owner reports magnetic acquisition works only when bringing the phone closer to the dense Exporto sheet. Device acceptance remains OPEN. The earlier candidate description below records the original implementation; the follow-up section overrides its detail-search and reticle behavior.

Follow-up candidate: **0.3.0-rc.4 / build20261027.3 / cache14**, Draft only, NOT published.


## Принципы и общий код

Заимствуем принципы UX/API: потенциальный код не равен декодированному, границы описываются четырьмя углами, сопровождение отделено от чтения содержимого и от проверки приложения. Apple VisionKit и Google ML Kit **не вызываются из Safari** и не являются зависимостью. Это собственный небольшой веб-модуль на проверенных открытых алгоритмах, без обещания равной нативным SDK скорости/точности.

Продолжаем существующий viewer. Его камера из этапа1, interface, Hiro, Android WebXR/Quick Look, QRL1/QRL2/CBX1/CBX2/legacy, SHA-256, USDZ/GLB и настоящий `jsQR.js` сохранены. Нет второй камеры, auto-zoom, нового QR-протокола, облачного API, предустановленной геометрии или изменений Exporto/альбомов. Единственный источник байтов — прежний `jsQR.binaryData`; locator/flow не поставляют данные collector и не преобразуют бинарный payload в текст.

## Компоненты

- `vendor/qr-locator.js`: воспроизводимый locator-only subset из уже поставляемого jsQR1.4.0, Apache-2.0. Неизменённые upstream modules0/4/11/12 (BitMatrix, adaptive binarizer, extractor/projective mapping, finder/alignment locator). Собственная оболочка читает только геометрию функции, не payload. `tools/build-qr-locator.py` проверяет SHA-256 исходного bundle и регенерирует файл без сети/пакетного менеджера. Настоящий decoder/vendor `jsQR.js` не меняется.
- Адаптер проверяет QR dimension, finder7×7 и alternating timing patterns. Это ограничивает ложные группы из finder разных QR, но **не доказывает валидность данных**. До двух candidate/view с маскированием в частной binary matrix; пиксели, которые читает основной decoder, не меняются. Полный кадр +2 перекрывающихся ROI за detection pass; цикл включает full-height/width strips и grid, чтобы разделять соседние коды.
- `vendor/jsfeat-min.js`: MIT, **точные upstream bytes**, pinned `inspirit/jsfeat@4c7b336bbeeb26e6cd4cdf3c7d414abe273846f3/build/jsfeat-min.js`, Git blob `f1dc9dadef2dee499ac5e6e13ecc85f649313e1e`, SHA-256 `974327515d68c91258efd3befa03622c41bbed8e3172771994604325799977a1`. Используется pyramidal Lucas–Kanade, homography и RANSAC; библиотека имеет upstream revision ALPHA, не выдаём её за актуальный нативный ML SDK. Browser UMD ожидает window: worker задаёт локальный alias self перед importScripts, vendor не редактируется. MIT/Apache license и NOTICE включены в portable package.
- `qr-tracker.js`: чистый spatial bank плюс flow engine. LK ведёт16 внутренних опорных точек на цель; forward/backward error, photometric patch test, RANSAC (до40итераций, минимум8/75% inliers), проверки convexity/границ/площади/скачка. Полученная homography переносит четыре угла. После пропущенного flow точки не используются с чужим предыдущим кадром: удержание последней позы до locator reacquisition. Optical flow не продлевает цель без нового locator бесконечно.
- `qr-track-worker.js`: локальный worker, только уменьшенные pixels и screen geometry; ни camera access, ни decode, ни network models, ни storage.
- `qr-overlay.js`: передаёт кадры, сопоставляет кандидатов с decode observations, рисует единый SVG и применяет smoothing. Прежний `ARScanFeedback.map` сохраняет правильное отображение contain/letterboxes QR-preview и прежнего AR.js Hiro crop. Нормализованные точки независимы от размеров canvas.

## Ограничение нагрузки и lifecycle

Кадр tracking не больше640px по длинной стороне. Попытка захвата каждые80мс, **один pending frame**, без очереди; detection не чаще160мс, максимум3view×2locate. LK между ними. Это целевой интервал, не обещание12.5fps на телефоне. Основной decoder сохраняет прежнее разрешение до1280px и расписание; его ROI не заменяются низким разрешением tracker.

Максимум8целей; rejected/nonfinite/nonconvex/out-of-frame polygons не попадают в overlay. После350мс результат worker/decode считается слишком старым для расположения рамки. Зависший worker>1200мс прекращается. Если Worker/importScripts недоступен/завершился ошибкой, scanner остаётся рабочим: smoothing/fade применяется к углам decoder, предварительная рамка и optical flow тогда недоступны. Камера/collector/AR от доступности трекера не зависят.

Рисование через RAF, time-based exponential easing τ55мс для каждого угла (не axis-aligned bbox). Краткая потеря удерживает последнюю измеренную позу, затем рамка затухает и удаляется до650мс без наблюдений. Flow ограничен также давностью locator900мс; spatial bank не держит цель>950мс без detection/decode. Это screen-space follow, **не AR world anchor и не идентификатор листа**.

`Новый лист`, пауза камеры, готовая модель и уход со страницы очищают bank/цвета/очередь; остановка прекращает worker/interval/RAF. Resize сбрасывает устаревшие координаты. Epoch/seq и отдельный run guard защищают от поздних frames/errors старого worker. Старый decoder snapshot не откатывает более свежий flow pose; время подтверждения цвета хранится отдельно от времени снимка.

## Цвета и смысл

- Светлая рамка с тонкой тёмной тенью: **candidate**, обнаружена QR-подобная структура, содержимое ещё неизвестно.
- Голубая: **decoded**, jsQR прочитал bytes/text; приложение ещё не подтвердило их.
- Зелёная: **accepted**, существующий parser/collector принял часть/legacy данные. Повтор той же принятой части не создаёт ещё одну цель и не увеличивает прогресс.
- Янтарная: **rejected/other**, неверный/неподдерживаемый payload, конфликт, чужой комплект или launch URL вместо model part.

**Зелёная рамка отдельной части не означает SHA-256 всего комплекта.** Для multipart до последнего QR это только структурная проверка parser/collector. Общая SHA/CRC/восстановление выполняются прежним кодом; ошибочный комплект не становится моделью. При последнем QR камера/рамки прекращаются перед проверкой и AR-first restore, как раньше. Не задерживаем AR ради зелёной анимации. Валидированный цвет ограничен650мс после read/validation, обновляется повторным чтением; геометрическое сопровождение само по себе его не создаёт/не продлевает.

До чтения payload нельзя доказать идентичность двух визуально похожих кодов. При быстрой замене QR на том же месте предыдущая краткая цветовая индикация может сохраняться до истечения TTL/нового декодирования. «Новый лист» очищает её сразу. Это ограничение screen-space tracker, не основание доверять новой геометрии: collector/SHA остаются независимым барьером.

## Автономность, приватность, диагностика

SW cache13 и portable allowlist включают worker, tracker/overlay и оба локальных algorithm vendors. Нет CDN/runtime downloads. Предварительно сохранённый offline viewer работает из собственного кэша; iOS/ОС по-прежнему могут удалить этот кэш. Бинарные QR остаются самодостаточными, алгоритмы не добавляют серверной зависимости.

Pixels передаются transfer buffer и живут только в памяти worker. Кадры/QR payload не пишутся в отчёт/кэш. В памяти spatial bank держит ограниченный ключ текущего decode для повторов; после stop/reset он удаляется. JSON `report.tracking` и существующая hidden-by-default диагностика показывают последний mode (`locator-flow`/`decoded-only`/`frame-skipped`), количество worker tracks и время доставки последнего обработанного кадра. Это не журнал всех кадров и не измерение качества физического tracking.

## Проверки и ограничения доказательств

- **61 Node test PASS:** прежние50 +11 новых. Реальный locator на QR с уничтоженной центральной областью даёт4угла при jsQR decode=null. Реальные LK/homography следуют переводу6×4px без нового обнаружения; blank/loss удаляет цели. Проверены corner ordering/smoothing, repeats, invalid polygons, bounded storage, late decoder frame, skipped flow frame, old worker callbacks и fallback colors.
- MultiQR тест проверяет **четыре угла относительно ground truth**, а не только количество targets. Наклон проверен inverse-rasterized shear QR с3px/module; прямой QR —2px/module. Сцена около1px/module давала смешанные finder candidates при исследовании и **не считается поддержанной точностью**. Далёкий/плотный/смазанный код может не иметь предварительной рамки; это не отменяет последующую попытку обычного decoder. При поднесении камеры finder становится различимым, автоматический zoom не используется.
- Новый `test/tracker-browser.cjs`: реальный worker/locator/LK из offline cache при отключённом main decode; hold/fade/reacquire, orientation/contain mapping, green после принятия части, malformed binary amber,6parts→restore→stop и Worker-disabled fallback. Это artificial optical video, не физический iPhone/Revit.
- Существующие `approved-browser.cjs` (14gates), `approved-optical.cjs` (launch+6QR/tilt) и `camera-browser.cjs` (7groups) используются для регрессии старых QR/CBX, камеры, Hiro, Android WebXR/Apple link contract, share/export и offline. Результаты фиксируются отдельно от device acceptance.
- RANSAC flow tests повторены5раз для проверки нестабильности рандомизированного алгоритма. Это не делает их физическим испытанием и не обещает устойчивости к произвольному motion blur.
- Новый `test/qr-tracking-fixtures.json` создан только для тестов из прежних C# vectors через `tools/make-tracker-fixtures.py` (reportlab). В runtime/portable ZIP тестовых сцен нет.

Команды из `ar-poc`: `node --test test/qr.test.cjs qr-sheet/test/codec.test.cjs`; с существующим Playwright/CHROMIUM_PATH: `node test/tracker-browser.cjs` и прежние browser suites. Существующий GitHub Actions Node gate подхватывает новые unit tests через qr.test.cjs, runner/публикация не меняются.

### Приёмка владельцем после отдельного разрешения публикации

Проверить видимую версию/build, открыть неподвижный настоящий Exporto PDF на бумаге/экране и плавно двигать телефон. Оценить совпадение4углов/запаздывание, несколько кодов в кадре, краткое перекрытие/возврат и быстрый уход цели. Проверить принятие/повторы, новый лист, SHA/AR-first и прежний Hiro. На iPhone Safari и Android Chrome сохранить JSON и короткую запись экрана с указанием устройства/ОС. Низкую резкость, реальные fps/нагрев и UX автоматически не считаем пройденными.

## Первичные источники

- Apple VisionKit: https://developer.apple.com/videos/play/wwdc2022/10025/ — четырёхугольные bounds и отдельное high-frame-rate tracking.
- ML Kit potential barcodes: https://developers.google.com/android/reference/com/google/mlkit/vision/barcode/BarcodeScannerOptions.Builder#enableAllPotentialBarcodes() — undecoded кандидаты не имеют raw bytes.
- jsQR: https://github.com/cozmo/jsQR ; точный source SHA исходного bundle фиксирует build-qr-locator.py.
- jsfeat pinned source: https://github.com/inspirit/jsfeat/tree/4c7b336bbeeb26e6cd4cdf3c7d414abe273846f3 ; https://inspirit.github.io/jsfeat/ — LK, homography, RANSAC.
- OpenCV optical flow: https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html — метод LK и его ограничения.


## Follow-up: dense QR acquisition from original video pixels

Owner tested rc.3/build20261027.2 and `3D Oblozhka_2026-10-26_1648.html`; the frame attaches when the phone is brought closer. The fixed center search reticle was mistaken for an acquired polygon. QR mode now hides that static guide; only measured quadrilaterals appear. Existing Hiro-specific behavior remains.

The original owner HTML was found locally and its SVGs inspected as untrusted data, without executing attachment scripts/instructions. It contains a 29-module launch code and four 109-module (v23) model codes, excluding quiet zones. A local raster probe of the actual code acquired it at 250px native size but not after scaling it to 125px in a 640px overview. This confirms a downsampling limitation; it does not measure physical camera focus/distance. Owner geometry and QR bytes are NOT committed to GitHub. Tests use existing synthetic codec vectors only.

For source video larger than 640px, capture ONE additional crop BEFORE downsampling the overview. Each region covers half the source width and 65% of its height, resized only downwards to <=640px per side. A 3-by-2 overlapping grid covers the frame. The overview still feeds optical flow and large-code acquisition. High-resolution passes use detail + overview (two locator inputs instead of three); smaller original video retains the existing three-input search. One pending frame, 80ms capture attempt, 160ms detection gate, maximum eight tracks and all old expiry limits remain.

The global region index advances only when the worker acknowledges an actual detail detection pass, not on flow-only frames. An acquired target whose detection is >=300ms old and last observation <500ms old gets a native crop centered on its current location. This avoids the known 6*240ms revisit gap exceeding the 900ms detection TTL. After at most TWO acknowledged focused passes, a global pass is mandatory, so known QR cannot starve acquisition of others. With many targets/slow processing, some outlines can still expire and reacquire; no unlimited hold or false confirmation is introduced.

No visible zoom, camera constraint, second stream, payload decoder, protocol, AR implementation or model export behavior changes. Detection cannot recover detail absent in the original video because of distance, blur, glare, moire or motion. No guaranteed distance is claimed. Diagnostic tracking events include actual source and overview dimensions and the six-region search count, never pixels or payloads.

Regression coverage: original-pixel acquisition and normalized corner mapping; native-region bounds/no-upscale; ack-driven search schedule; slow 240ms known-target revisit; multi-target global-search fairness; real worker running from offline cache with canvas stream 1280x960, dense QR250px, predecode detection, stationary identity, movement, loss, reacquisition and orientation. `node test/dense-browser.cjs` uses no physical camera and does not prove iPhone/Revit acceptance. Existing decoder/camera/Hiro/AR/share/offline suites remain required.
