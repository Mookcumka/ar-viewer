# Камера AR Viewer: полный кадр QR и фактические параметры

27.10.2026. Задание владельца «камера первым». Продолжение Draft ar-viewer #10 / AR-Project #73. Кандидат **0.3.0-rc.2, build20261027.1, cache12**. Ничего не опубликовано. Физические iPhone/Android не проверены; нельзя объявлять проблему резкости/объектива принятой только по software tests.

## Подтверждённая причина и изменение

В поставляемом `vendor/aframe-ar.js` функция `onResizeElement` реализует cover: видео увеличивается до заполнения viewport и получает отрицательный marginLeft/marginTop. В портрете у landscape потока значительная часть кадра за экраном. `copyElementSizeTo` дополнительно использует 4:3 в портрете для Hiro renderer. Это программная обрезка, а не доказательство цифрового/оптического зума физического телефона. Ранее jsQR декодировал полный intrinsic frame, который не совпадал с видимой пользователю областью.

- QR теперь читает `#camera-preview`: fixed viewport, `object-fit:contain`, centered, без transform/отрицательных margin. Показан **весь** исходный кадр без растяжения пропорций; если aspect ratio отличается от экрана, остаются поля. Никакой cover или увеличенного QR crop в preview. ROI декодера по-прежнему лишь поиск в снимке, не изменение картинки камеры.
- Один `getUserMedia` владеет одним stream. QR-only не создаёт A-Frame scene и ARController. При явном переходе в прежний Hiro создаётся существующий AR.js `sourceType:video` bridge. Он получает **тот же объект MediaStream**, не открывает вторую камеру. Hiro сохраняет прежний crop, калибровку, marker/follower/smoothing; новый preview в этом режиме скрыт. AR.js vendor не меняется.
- `Новый лист` из Hiro скрывает/приостанавливает AR.js и возвращает полный QR-preview на имеющемся потоке. При готовности модели/уходе со страницы треки останавливаются, перед WebXR камера освобождена. Поздний getUserMedia/applyConstraints не возвращает уже остановленный stream. Глобальные camera-error события AR.js webcam не управляют принадлежащим viewer потоком: bridge здесь video-only, getUserMedia/play/track-ended обрабатывает владелец потока.
- UI, native Quick Look, Android WebXR, декодеры QRL1/QRL2/legacy, USDZ/GLB и геометрия не переписываются. Exporto/PDF/генераторы не затронуты.

## Выбор камеры, фокус и зум

Общий `camera.js` запрашивает `facingMode:{ideal:'environment'}`, разрешение 1280×960 как **предпочтение**, без mandatory aspect ratio viewport. `resizeMode:{ideal:'none'}` добавляется только при объявленной поддержке, чтобы предпочесть native кадр вместо crop-and-scale. Реальное разрешение/ratio может отличаться: источником истины служат `getSettings` и `videoWidth/videoHeight`.

`environment` — предпочтение задней камеры, а не стандартизованный выбор main/wide/ultrawide/telephoto. Веб-API не гарантирует тип физического объектива, его фокусное расстояние или минимальную дистанцию фокусировки. По непереносимым label/deviceId объектив не угадываем, повторные потоки/автоматические переключения линз не создаём. Если settings явно сообщает `user`, показываем ошибку выбора передней камеры. Если facingMode отсутствует, не утверждаем, что задняя линза подтверждена.

После открытия читаем capabilities/support:

1. Только если `getSupportedConstraints().focusMode` и `getCapabilities().focusMode` объявляют `continuous`, запрашиваем continuous autofocus. Никогда не устанавливаем manual/focusDistance или несуществующий режим. При отсутствии API/режима оставляем управление фокусом ОС/браузеру.
2. Только при supported zoom и валидном advertised диапазоне задаём поддерживаемое значение: 1, если оно в диапазоне, иначе минимум; учитываем min/max/step. Это устранение заданного цифрового увеличения в доступном API, **не обещание физической основной линзы/оптического 1×**. У ряда устройств шкала zoom имеет другой смысл.
3. Настройки независимы; отказ фокуса не блокирует zoom или preview. Сохраняем исходные track constraints и ранее успешно запрошенные controls. `applyConstraints` используется с optional advanced, поэтому resolved **не равно применено**. В лог пишутся requested value, result resolved/rejected, observed значение `getSettings`; отсутствующее observed не выдумывается.
4. Нет непрерывного повторного applyConstraints, принудительного focusDistance, нестандартных vendor constraints или автоматического нарастания зума.

Если ОС/браузер не даёт autofocus control, приложение не может программно гарантировать резкость вблизи. Проверка на реальном телефоне обязательна. Не добавляем неподтверждённый «фиксированный правильный» сантиметраж.

## Диагностика

В обычном UI нет новой панели. Через существующий `?diagnostics=1` → «Диагностика» → «Сохранить отчёт»:

- `camera-start`: supportedControls и безопасные settings/capabilities/constraints;
- `camera-control`: requested name/value, resolved/rejected и observed;
- `camera-parameters`: фактические настройки после попыток;
- `camera-display` и `report.camera`: width/height/aspectRatio/frameRate/facingMode/resizeMode/focusMode/zoom, intrinsic video, viewport box, видимая content область, `fit:contain`, `cropped:false` для QR-preview, display=qr-source/hiro-arjs;
- mute/unmute/stop фиксируются, при аппаратном ended пользователь может открыть камеру снова.

Диагностика preview описывает **QR element**, в режиме hiro-arjs он скрыт; она не утверждает отсутствия crop у AR.js. Данные обновляются на metadata/resize/поворот/сохранение отчёта. Не записываем кадры, deviceId/groupId, labels устройств или геометрию.

## Воспроизводимые проверки

- Node `node --test test/qr.test.cjs qr-sheet/test/codec.test.cjs`: 50 tests PASS, включая capability policy, отсутствующие API/режимы, диапазоны/шаг zoom, отказ фокуса, отмену и privacy. Включены в существующий GitHub Actions gate (без изменения runner/установки плагина).
- `node test/camera-browser.cjs`: virtual camera + реальные Chromium/AR.js; supported/missing/rejected controls, отказ capability probe, сохранение предупреждения front camera после первого кадра/Нового листа, portrait/landscape/full-frame corner mapping, pagehide/reopen, cancellation race, настоящее распознавание **изображения Hiro** прежним трекером, один активный поток при Hiro и возврате QR. Hardware controls в этом suite — doubles, не измерение реального autofocus.
- `node test/approved-browser.cjs`: 14 прежних интеграционных software gates (QRL1/QRL2, офлайн, WebXR/AR↔3D, Apple link contract, export/share/reset/lifecycle) PASS.
- `node test/approved-optical.cjs`: настоящий jsQR, прежний artificial fixed-sheet video с launch+6 QR и наклоном; сборка всех частей, отсутствие UI/AR-preview регрессий PASS. Ожидание «видео обязано заполнить экран с crop» заменено требованием полного кадра. Тестовые сцены остаются только в test fixtures.
- Playwright нужен только тестам; не runtime dependency. Для запуска CHROMIUM_PATH/NODE_PATH и CAMERA_FIXTURES задаются окружением, как в предыдущих suites. Portable allowlist и offline cache включают camera.js; перед передачей Draft PR экземпляры runtime сверяются побайтно по source-manifest с SHA исходного коммита.

## Приёмка на телефонах после отдельного разрешения публикации

1. Проверить видимую версию/build. Открыть обычную камеру viewer, не WebXR. Показать неподвижный реальный Exporto PDF и сравнить видимые границы кадра; поворот телефона не должен обрезать исходное видео. Поля допустимы.
2. Поднести/отвести телефон, оценить, стабильно ли фокусируются QR. Не закрывать системный объектив рукой. Считать все части, проверить зелёные номера и переход в AR; экспорт/сохранение USDZ/GLB и Новый лист сохраняются.
3. На iPhone Safari и Android Chrome сохранить diagnostic JSON **до считывания последней части**, пока поток активен. Записать модель телефона/версию ОС/браузера и приложить короткую запись поведения камеры; отчёт не доказывает визуальную резкость.
4. Проверить старый лист Hiro через прежний diagnostic control; та же модель должна отслеживаться без второго потока.

Результат пока — рабочая Draft реализация и воспроизводимая браузерная регрессия. Публикации, установки и физической приёмки нет.

## Первичные источники

- W3C Media Capture: https://w3c.github.io/mediacapture-main/getusermedia.html
- W3C Image Capture (capabilities/settings/constraints, focusMode/zoom): https://w3c.github.io/mediacapture-image/
- Chrome Image Capture: https://developer.chrome.com/blog/imagecapture
- Конкретная cover-реализация: `ar-poc/vendor/aframe-ar.js`, `onResizeElement`/`copyElementSizeTo`, поставляемая ранее в PR #73 (vendor побайтно сохранён).
