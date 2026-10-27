# AR Viewer — реализация Issue9, AR-first и самостоятельные файлы

Источник требований: [ar-viewer #9](https://github.com/Mookcumka/ar-viewer/issues/9) и задание владельца26.10.2026. Статус: код в Draft PR, **не опубликован и не принят на реальных устройствах**. Кандидат **0.3.0-rc.2 / build20261027.1 / cache12**. Опубликованная предыдущая версия0.2.0-rc.1 остаётся рабочей до отдельного разрешения.

## Один источник и границы

Изменения исходного `AR-Project/ar-poc/` копируются побайтно в public ar-viewer. Android WebXR взят из опубликованного #8 (source9c1c72d), **webxr.js не переписывается**. Общие bounded collector/декодеры QRL1/QRL2/CBX1/CBX2, SHA-256, meshoptimizer0.23, legacy AR1/4/5, AFRAME.THREE и AR.js остаются. Данные поступают из QR, без встроенных моделей и облачных URI.

Exporto, его PR71/Issue72, генераторы Revit и PDF не изменяются. PDF является печатным контейнером тех же QR. Viewer читает камерой изображение кодов, а не загружает PDF или геометрию с сервера. Экран ноутбука имитирует неподвижную бумагу; отдельного режима экрана/слайд-шоу нет.

## Экран сканирования

Камера занимает экран с сохранением полного кадра (`object-fit:contain`, возможны поля); нет большой панели с текстом. Вверху слева компактные имя/версия, справа кнопка44×44 с пиктограммой сканирования и доступным именем «Новый лист». Строка1…N определяется фактическими частями. Принятый номер зеленеет, **без галочки**. Нет «QR принят», «Приняты», «Остались», длинных постоянных инструкций. Доступные screen-reader labels и role=list сохраняются.

Один тап по «Новый лист» очищает collector/parts/indicators/model/files, отменяет незавершённый decode и активный AR/3D. Во время частичной сборки уже открытая камера сохраняется. После готовности/AR камера открывается снова. Повторно читать тот же лист разрешено: старый hash не блокируется. Нет confirm.

Удалены Stop, sound controls, HTML file input и обработчик ручного импорта, включая diagnostic UI. Чистый helper `htmlPackets` пока остаётся внутри qr-geometry для регрессии старых unit vectors, **пользовательского пути загрузки HTML нет**. Старые напечатанные QR не зависят от этого пути.

Диагностика доступна только с `?diagnostics=1`: JSON отчёт, без кадров/геометрии; legacy Hiro controls — только там. При открытии Hiro текущий WebXR заканчивается до getUserMedia. Нормальный URL не показывает diagnostic controls.

## Последняя часть → AR

1. Проверить, что QR-комплект полный. Неполный/повреждённый комплект не запускает AR.
2. Остановить interval QR и освободить camera tracks **до** асинхронного восстановления CBX или legacy walls.
3. Проверить SHA/CRC, восстановить исходную геометрию, локально подготовить USDZ/GLB.
4. Выполнить одну автоматическую попытку открыть AR. Не создавать обычный3D renderer до явного выбора3D.

**iPhone:** используется прежний настоящий `rel=ar` anchor с единственным IMG и локальным USDZ Blob. Выполняется `.click()` с обычными правилами Safari. Если браузер требует жест, остаётся одна основная CTA «Открыть AR»; обхода user activation нет. Нельзя надёжно узнать из JavaScript, вошёл ли пользователь в системный AR: отчёт фиксирует attempt/request, не успешный AR. Quick Look предоставляет собственный AR/«Объект» switch; кастомный AR/3D switch на iPhone скрыт. Начальную вкладку/поведение системного Quick Look и auto-open необходимо принять на реальном Safari. Не подменяем AR автоматическим web3D preview.

**Android:** используется существующий WebXR/ARCore adapter. Попытка без user activation может быть отвергнута — остаётся компактная CTA, явное нажатие вызывает requestSession до awaited операций. System runtime/поддержка определяются через capability API. Если AR недоступен, сообщаем это честно, 3D доступен отдельным явным действием.

## AR ↔ 3D

На Android в существующем нижнем управлении компактный switch AR/3D. Переход в3D завершает XR и создаёт временный обычный renderer той же vendored THREE с clone текущей восстановленной группы. Никакой загрузки GLB/модели/другой страницы не требуется. Drag вращает, pinch/wheel меняет размер. Начальная камера вписывает bounding sphere с учётом узкого FOV портрета; resize сохраняет относительный пользовательский zoom. Геометрия/материалы оригинала не изменяются и не dispose при закрытии режима.

Возврат вAR закрывает обычный renderer и запускает прежний WebXR. Уход/возврат через BFCache восстанавливает выбранный3D renderer или явно сообщает ошибку; пустого экрана с ложным selected3D не остаётся. По одному runtime камеры и view renderer в каждый момент. Epoch/generation guards защищают поздние restore/end callbacks.

Положение Android остаётся surface/local-space, как в #8: это **не автоматическое совмещение с линиями чертежа**, не обещание физического1:1 и не изменение трекера. Прежний slider размера просмотра и reference-reset policy сохраняются.

## Сохранение без сервера

После восстановления доступна одна пиктограмма «Сохранить модель» с двумя короткими вариантами USDZ/GLB. Предпочтительный платформе формат первым. File объекты подготовлены до пользовательского тапа, поэтому `navigator.share({files:[File]})` вызывается непосредственно в обработчике выбора. AbortError закрывает share без принудительного скачивания. Если file sharing недоступен или отказал по иной причине — download реального Blob с правильным расширением/MIME. Нет URL-wrapper, ссылки на PDF, QR или сайт вместо модели.

- USDZ: прежний локальный ARUsdz writer, валидный stored ZIP с выравниванием64байта. Открывается независимо от QR/сайта. «Сохранить в Файлы» предоставляет iOS share sheet; физическое поведение Safari надо проверить.
- GLB: glTF2 Binary, один JSON chunk и embedded BIN, позиции/нормали float32, метры/Y-up, baseColorFactor в linear RGB, alpha/двусторонность/roughness/metalness в пределах восстановленного материала. Никаких внешних buffer/image URI. Сам GLB не гарантирует AR в каждом системном Android file viewer — AR отдельно обеспечивает WebXR.
- Общий extractor переводит child transforms в локальные модельные координаты и исключает Hiro/бумажный holder1:N. Отражённые child transforms меняют winding. Source buffers/materials остаются неизменными. Legacy AR1 opacity0.85 теперь одинаково сохраняется обоими файлами.
- QR текущего контракта содержит треугольники и постоянные RGBA, **не BIM-свойства, исходные textures/UV или исходные Revit normals**. Утраченные ещё при экспорте данные viewer не выдумывает. GLB выводит геометрические face normals. Модель не упрощается/не обрезается; неконечные/схлопнувшиеся float32 треугольники и файлы>32МиБ дают явную ошибку.

## Офлайн и версии

Один version.js остаётся источником semver/build/cache identity. Root worker/cache12 включает model-files.js/object-view.js/camera.js. Portable allowlist включает их и документацию; тестовых сцен в ZIP нет. Обновление потребует загрузки ресурсов с интернетом; затем QR restore/сохранение файлов локальны. Хранение cache условно: ОС может удалить его, тогда нужен независимый совместимый источник кода. Offline AR/системные share surfaces на реальном устройстве ещё не измерены.

## Проверки и честные границы

- Node: существующие QRL/CBX/CRC/SHA/legacy/cache tests плюс GLB container/accessors/materials и отказ неправильной геометрии. Чистый HTML helper test — внутренний, не тест удалённого UI.
- Новый `test/approved-browser.cjs`: настоящие vendored THREE/AR.js, fake camera + injected decoder hits/test-only vectors и XR sessions/setSession doubles. Проверяет controls/numbers/reset, auto-attempt без3D preview, user CTA, File share, AR↔3D/fit/BFCache, camera ownership/Hiro, старые AR4/AR5 с проёмом, corruption/cancellation/retry, QRL2/WASM offline, честный report. Не является iOS/ARCore acceptance.
- `test/approved-optical.cjs`: настоящий jsQR на artificial camera video одного фиксированного листа (URL launch +6 data QR), camera approach/наклон, camera release, никаких галочек/большой панели. Это software optical, не печать/Revit/iPhone.
- GLB проверяется независимым **Khronos glTF Validator2.0.0-dev.3.10** только как временным test tool, не runtime dependency. Восемь C#unit scenes: errors0/warnings0. Реальные сохранённые browser files проверяются отдельно.
- Прежние browser entry points сохранены как wrappers текущего suite: ожидания ручного HTML UI заменены по явному решению владельца; unit проверки кодеков не удалялись.

### Ручная приёмка владельцем после отдельной публикации

Открыть viewer нужной версии с интернетом, затем PDF настоящего Exporto экспорта на бумаге/неподвижном экране. Считать части в любом порядке; увидеть зелёные номера без текстовой панели. После последнегоQR камера сканера должна погаснуть, должен открыться AR или единственная CTA при browser restriction. На iPhone проверить native AR/Объект и сохранение USDZ вFiles; на Android — AR/3D/AR, движение камеры, новый лист. Сохранить оба формата, закрыть сайт/сеть и независимо открыть реальные файлы, сверить объём/проёмы/цвет/масштаб. Проверить старые AR1/4/5 и JSON отчёт.

Без такого испытания не объявлять criterion Revit→PDF→phoneAR принятым. Draft PR и software tests — подготовка к приёмке, а не её замена. Ничего не устанавливалось, Revit/Parallels не запускались, GitHub Pages не менялся.

## Первичные технические источники

- https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/
- https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look
- https://developers.google.com/ar/develop/webxr/requirements
- https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc
- https://github.com/KhronosGroup/glTF-Validator

## Доработка камеры 27.10.2026

См. [полный контракт camera preview](camera-preview-20261027.md): QR больше не использует cover-видео AR.js. Один owned stream, ленивый прежний Hiro bridge, capability-gated focus/zoom, фактические settings и новая браузерная регрессия.
