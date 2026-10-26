# AR Viewer — история версий

## 0.2.0-rc.1 · 20261026.1 (Draft)

- Первая видимая semver/build identity в верхней плашке и JSON.
- Android WebXR/ARCore из общей восстановленной QR-сцены; без сервера моделей.
- Явные поиск поверхности, размещение, размер просмотра, потеря tracking и повторное размещение после reference reset.
- Изолированный lifecycle сессий и передача camera ownership от сканера к WebXR.
- Cache10 проверяет identity worker/page; переносимый runtime включает новые модули.
- iPhone Quick Look, legacy Hiro, QRL1/2 и CBX1/2 сохранены.

Software проверки не заменяют реальную приёмку Android/iPhone с QR из Revit. Не опубликовано. Правила повышения версии и приёмка: ../docs/ar/android-version-20261026.md.

## До семантической версии

Публикация ar-viewer PR7: внутренний build unified-scan-ux-20261026-3, cache9. Прежние версии фиксировались commit/build, без видимой общей semver. Номера им задним числом не присваиваются.
