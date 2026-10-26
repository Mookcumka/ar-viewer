# AR Viewer — история версий

## 0.3.0-rc.1 · 20261026.2 (Draft)

- Реализация Issue9: камера без большой панели, номера без галочек, однокнопочный reset справа сверху.
- Удалены HTML import, Stop и управление звуком.
- AR-first после последней части; честный gesture fallback. Android AR/3D, native iPhone Quick Look switch.
- Локальные самостоятельные USDZ/GLB с общими материалами/child transforms и системным share/download.
- Старые QR и WebXR adapter сохранены, cache11 и portable runtime обновлены.
- Реальные устройства/Revit→PDF ещё требуют owner acceptance. Не опубликовано.

## 0.2.0-rc.1 · 20261026.1 (опубликована26.10.2026, ar-viewer #8)

- Первая видимая semver/build identity в верхней плашке и JSON.
- Android WebXR/ARCore из общей восстановленной QR-сцены; без сервера моделей.
- Явные поиск поверхности, размещение, размер просмотра, потеря tracking и повторное размещение после reference reset.
- Изолированный lifecycle сессий и передача camera ownership от сканера к WebXR.
- Cache10 проверяет identity worker/page; переносимый runtime включает новые модули.
- iPhone Quick Look, legacy Hiro, QRL1/2 и CBX1/2 сохранены.

Software проверки не заменяют реальную приёмку Android/iPhone с QR из Revit. Версия0.2 опубликована по отдельному разрешению владельца. Правила повышения версии и приёмка: ../docs/ar/android-version-20261026.md.

## До семантической версии

Публикация ar-viewer PR7: внутренний build unified-scan-ux-20261026-3, cache9. Прежние версии фиксировались commit/build, без видимой общей semver. Номера им задним числом не присваиваются.
