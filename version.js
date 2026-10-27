/* Application identity: independent of Exporto, QR schema and service-worker cache generation.
   Change version for product changes; build for every distributed revision. */
(function (root) {
  const value = Object.freeze({ version: "0.3.0-rc.4", build: "20261027.3", cacheVersion: 14 });
  root.ARViewerVersion = value;
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root.document) {
    const label = root.document.getElementById("app-version");
    if (label) label.textContent = "v" + value.version + " · " + value.build;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
