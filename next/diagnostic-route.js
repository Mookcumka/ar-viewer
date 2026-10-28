/* A route into the same application, not a second UI, scanner or renderer. */
(function () {
  const oldPublic = location.pathname.includes("/compare/qr-sheet-1/");
  const root = oldPublic ? new URL(location.pathname.endsWith("/qr-sheet/index.html") || location.pathname.endsWith("/qr-sheet/") ? "../../../" : "../../", location.href) : new URL("../",location.href);
  const target = new URL("index.html?diagnostics=1",root); target.hash=location.hash;
  location.replace(target.href);
})();
