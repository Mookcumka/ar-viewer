# AR Viewer 0.2.0-rc.1 · build20261026.1

Draft: видимая версия и Android WebXR добавлены в единый viewer. Ещё не опубликовано и не проверено на реальном Android. iPhone Quick Look, legacy Hiro и протоколы QR сохранены.

[Контракт, версии, lifecycle, ограничения и приёмка](docs/ar/android-version-20261026.md).

Общие collector/SHA/CBX1/2/meshoptimizer/THREE.Group, без моделей на сервере. Android AR использует стандартный WebXR/ARCore; нужны совместимое устройство, браузер и Google Play Services for AR. На неподдерживаемом устройстве честный отказ, без подмены AR на3D. Размер35см — явный display scale, не1:1 или drawing alignment.

Проверки: Node42PASS; browser WebXR session doubles, reference reset и cancellation races PASS. Физическая Android/iPhone AR-приёмка с настоящим Exporto QR открыта. Публикация только по отдельному разрешению владельца.
