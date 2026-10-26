# QR-экспорт: meshoptimizer, запуск общего viewer и тестовый EXE

26.10.2026. Межпроектная копия спецификации из Exporto docs/ar-qr-optimization.md. Продолжение Draft Exporto71, AR72 и опубликованного ar-viewer5. Владелец подтвердил: настоящая квартира без мебели восстановилась через ручной импорт HTML; считывание всех шести QR камерой не получилось. Это подтверждение **ручного 3D-просмотра**, не приёмка оптического чтения или Quick Look AR. Экспорт не содержал QR запуска viewer. Сохраняем ручной импорт, прежние форматы и общий viewer, без дополнительного приложения или сервера моделей.

## Выбранное решение

Используется готовый **meshoptimizer 0.23**, MIT; кодек не переписан. NuGet `Evergine.Bindings.MeshOptimizer [2025.5.22.7]`, net8, без транзитивных зависимостей; native binaries Windows x64/ARM64, macOS ARM64 и Linux входят в пакет. Происхождение binding: commit `4666950cd7d9ce3323f7f0d1e0802a0cfb92e24e`, его header и README указывают upstream0.23. Runtime вызывается по абсолютному пути собственной установленной DLL `runtimes/<process RID>/native/meshoptimizer.*`. PATH/сервер/пользовательские настройки не используются. При отсутствии зависимости — явная ошибка ремонта установки. Существующий EXE/ZIP уже рекурсивно включает runtimes; процесс установки не заменяется. Upstream licenses копируются в Codecs/.

Подготовка SceneData, материалов, единиц feet→m/Y-up и групп по RGBA прежняя. 16-bit XYZ и проверки collapse/winding сохранены. Затем upstream optimizeVertexCacheStrip и optimizeVertexFetchRemap меняют только порядок треугольников/вершин. Upstream encodeVertexBuffer(v0, stride8: XYZushort+zero padding) и encodeIndexBuffer(v1) кодируют потоки без потерь. Поворот индексов внутри треугольника циклический: winding и геометрия сохраняются. Нового quantization, LOD, упрощения, удаления деталей или текстурного baking нет. Исключения UV/PBR прежние и явные.

Для каждой сцены сравниваются **полные gzip payload**, включая метаданные, с прежним CBX1+gzip. Если CBX2 не меньше или вышел за caps, сохраняется CBX1. Не обещаем выигрыш на каждой сцене. Независимо от выбранного payload новый QRL2 использует минимальное `ceil(bytes/857)` от1до6, вместо старого ряда1/3/6. `LegacyFitsBudget=false`, `LegacyQrCount=0` означают, что старый экспорт вообще отказал бы по budget, а не «было6QR».

## Версионирование

QRL1 и QRL2 имеют прежние48байт заголовка: magic4, SHA-256gzip32, full size u32LE, index/count u16LE, part length u32LE, binary body≤857. QRL1 count1/3/6 остаётся валидным; QRL2 count1..6. SHA/полнота/конфликты проверяются до создания модели. Смешение версий/identity отвергается.

Gzip содержит CBX1 либо новый CBX2. CBX2: magic4, JSON length u32LE, JSON, последовательно encoded vertex/index streams. Старые bits16/units m/up Y/originMeters/scale/nodes/excluded/min/max/vertices/indices/width/rgba сохраняются. Profile `Exporto-AR-meshopt-2`, codec `meshopt-0.23`; mesh offset указывает в compressed geometry section, vertexBytes/indexBytes задают длины. Метаданные≤2MiB, raw≤32MiB, browser≤50000triangles, общий QRbudget5142 прежние.

В едином viewer официальный self-contained JS/WASM decoder0.23 лежит в vendor и root cachev8. CBX2 после bounded validation преобразуется к тому же каноническому CBX1 и проходит прежний semantic/index validator и USDZ builder. SHA, old HTML/AR1/4/5/Hiro/Quick Look/manual import сохранены. JSON-отчёт добавляет версию пакета, codec и время декодирования. Отсутствующий decoder даёт явное сообщение об обновлении. Никаких моделей, native iOS-приложений или сетевого получения геометрии.

**Новая EXE-ветка требует публикации обновлённого viewer после отдельного решения владельца.** Опубликованный ar-viewer5 знает только QRL1. Изменения viewer оформляются в AR72 и связанном Draft public PR; ничего автоматически не сливается. Старые файлы продолжают работать и в новой версии.

## Измерения на реальных прежних HTML владельца

Исходные модели/HTML не отправлялись в GitHub; проверка повторно использует существующие QR-байты, а не является новым запуском Revit. Сравниваем одинаковую исходную q16-геометрию и RGBA. После C# native→browser WASM совпали multiset ориентированных треугольников/координат/RGBA, origin/scale. Дополнительная геометрическая ошибка **0 относительно прежнего q16**; это не нулевая ошибка прежнего квантования относительно исходного Revit.

| Сцена | vertices/triangles | Старый gzip / QR | Новый .NET gzip / QR | Полные пакеты было→стало |
|---|---|---|---|---|
| A, большая |440/530|4056 /6|3173 /4|4344→3365 bytes|
| B |80/68|1101 /3|1054 /2|1245→1150|
| C |35/64|822 /1|766 /1|870→814|
| D |202/304|2319 /3|1784 /3|2463→1928|

Один QR для A невозможен при сохранённых точности/профиле:3173>857. Дополнительный QR запуска учитывается отдельно от QR модели: новая A имеет4QR данных+1URLQR. Он не несёт геометрию и не входит в data budget.

Сравнение **официальных WASM encode реализаций** на тех же q16 (Draco1.5.7, POSITION16, speed5; meshoptimizer0.23 с cache/fetch) и одинаковой JS gzip9 упаковке дало для A: meshopt3255bytes/4QR, Draco3276/4; B1072/2 против1152/2; C782/1 против792/1; D1818/3 против1799/3. Для A первые encode замеры около3.3ms и14.1ms соответственно на этом Mac после готовности WASM. Эти измерения не являются временем iPhone; реализации .NET gzip и Node gzip дают немного разные размеры, поэтому таблица выше основана на итоговом C# производственном кодеке. Draco не доминирует на корпусе, а meshopt сохраняет существующие q16 без дополнительной quantization и имеет совместимую net8 native-поставку. Фиксируем выбор для этого опыта, не объявляем универсального победителя.

Новые decoded scene software замеры для A/B/C/D около3.2/0.8/0.5/0.6ms на desktop, включая SHA+gzip+restore при готовом decoder. Native first-use init/JIT заметно дороже; нельзя обещать эти задержки на телефоне. Оптическое время и новые QR на iPhone пока не измерены.

## Лист, UI и проверка

На A4 сверху отдельная launch-card с чёрно-белым URLQR32mm и подписью «Открыть AR Viewer» → `https://mookcumka.github.io/ar-viewer/`. URL не содержит модели. Затем QRданных65mm с обязательной quietzone. Инструкция явно требует двух шагов: открыть Safari, затем собрать части внутри viewer; автоматической загрузки модели по URL не обещает. CSP/no-script, safe title и data-packet HTML import сохранены. Длинный title при печати однострочный с ellipsis; данные не обрезаются. Отчёт на следующей странице.

Иконка **пункта меню ArSheetQr**, не вагон: лист+QR, прежняя32unit/28px система, динамический IconBrush обеих тем. Остальные форматы и поезд не изменены. WPF-тест использует исходный MenuItem.Icon/Style и скомпилированные theme resources, рендерит PNG в dist существующего artifact. Это проверка WPF вне Revit, **не подтверждение реального dropdown в Revit**.

CI остаётся Release-R25/R26/R27, self-hosted Windows ARM64 exporto runner, .NET x64, DeployRevitAddinOnBuild=false, version пустая, тестовый EXE в Actions Artifacts. Никакого запуска/установки в Revit, Parallels, merge или release агентом. Финальная передача требует успешных tests/installer/upload и фактического наличия EXE, а не только исходников.
