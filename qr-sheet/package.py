"""Package the ONE existing AR viewer, never scenes/tests. Does not publish anything."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ['index.html','scan.html','ar-data.js','qr-geometry.js','gbx-geometry.js','viewer.js', 'camera.js','qr-tracker.js','qr-overlay.js','qr-track-worker.js','version.js','webxr.js','object-view.js','model-files.js','scan-feedback.js','usdz.js','offline.js','sw.js',
    'manifest.webmanifest','icon.svg','quicklook.svg','diagnostic-route.js','qr-sheet/index.html','qr-sheet/sw.js'] + \
    ['vendor/'+name for name in ('gbx-earcut.js','jsQR.js','jsfeat-min.js','qr-locator.js','meshopt_decoder.js','aframe.min.js','aframe-ar.js','patt.hiro','camera_para.dat')]

def package(destination, viewer_url=None):
    content = {name: (ROOT/name).read_bytes() for name in FILES}
    content['docs/ar/safari-qr-sheet.md'] = (ROOT.parent/'docs/ar/safari-qr-sheet.md').read_bytes()
    content['docs/ar/unified-viewer.md'] = (ROOT.parent/'docs/ar/unified-viewer.md').read_bytes()
    content['docs/ar/gbx1-20261027.md'] = (ROOT.parent/'docs/ar/gbx1-20261027.md').read_bytes()
    content['docs/ar/qr-tracking-20261027.md'] = (ROOT.parent/'docs/ar/qr-tracking-20261027.md').read_bytes()
    content['docs/ar/camera-preview-20261027.md'] = (ROOT.parent/'docs/ar/camera-preview-20261027.md').read_bytes()
    content['docs/ar/approved-viewer-20261026.md'] = (ROOT.parent/'docs/ar/approved-viewer-20261026.md').read_bytes()
    content['docs/ar/android-version-20261026.md'] = (ROOT.parent/'docs/ar/android-version-20261026.md').read_bytes()
    content['docs/ar/scan-feedback-20261026.md'] = (ROOT.parent/'docs/ar/scan-feedback-20261026.md').read_bytes()
    content['licenses/jsQR-LICENSE.txt'] = (ROOT/'qr-sheet/jsQR-LICENSE.txt').read_bytes()
    for license in (ROOT/'licenses').glob('*.txt'):
        content['licenses/'+license.name] = license.read_bytes()
    content['NOTICE.txt'] = ('jsQR 1.4.0 (cozmo/jsQR). Apache License 2.0.\n'
        'Source/license: https://github.com/cozmo/jsQR\n'
        'Versioned package: https://cdn.jsdelivr.net/npm/jsqr@1.4.0/LICENSE\n'
        'Existing vendored dist reused byte-for-byte, no changes. See licenses/jsQR-LICENSE.txt.\n'
        'A-Frame 1.6.0 MIT: https://github.com/aframevr/aframe/tree/v1.6.0\n'
        'AR.js 3.4.7 MIT: https://github.com/AR-js-org/AR.js/tree/3.4.7\n'
        'ARToolkit5-js 0.3.1 LGPLv3 with additional permission: https://github.com/AR-js-org/artoolkit5-js/tree/0.3.1\n'
        'Three.js r164 MIT: https://github.com/mrdoob/three.js/tree/r164\n'
        'Existing vendors reused unchanged. Source/build details: ar-poc/vendor-local.ps1 in AR-Project.\n'
        'See licenses/ for the upstream terms, including LGPL/GPL and linking exception.\n'
        'meshoptimizer 0.23 MIT: https://github.com/zeux/meshoptimizer/tree/v0.23; self-contained WASM decoder.\n'
        'jsfeat MIT, pinned commit 4c7b336bbeeb26e6cd4cdf3c7d414abe273846f3; locator subset from existing jsQR 1.4.0 Apache-2.0.\n'
        'Three.js r164 Earcut port: MIT; original mapbox/earcut 2.2.4: ISC. Local triangulation only; see licenses/.\n'
        'USDZ writer and viewer: Mookcumka/AR-Project.\n').encode()
    manifest = {name: hashlib.sha256(data).hexdigest() for name,data in content.items()}
    content['source-manifest.json'] = (json.dumps({'schema':'Exporto-portable-viewer-1','sha256':manifest},indent=2)+'\n').encode()
    content['README.txt'] = ('Exporto AR Viewer. Serve the entire folder via HTTPS.\n'
        'Entry: index.html (same existing AR Style interface). Optional diagnostics: index.html?diagnostics=1.\n'
        'No second app, model fixtures, CDN or developer account required.\n'
        'First visit needs the viewer server. Later offline cache is conditional and may be evicted.\n'
        'This package does not prove iPhone AR or Revit integration. See docs/ar/unified-viewer.md.\n'
        'Shared USDZ writer: Mookcumka/AR-Project; jsQR 1.4.0 Apache-2.0 license and notice included.\n').encode()
    if viewer_url:
        url=urlsplit(viewer_url)
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('Use an HTTPS viewer URL without credentials, query, or fragment; no geometry is put in the launch QR')
        # Build-time tool only. Runtime has no encoder dependency and continues to read existing binary QRL1.
        from reportlab.graphics.barcode import qrencoder
        qr=qrencoder.QRCode(None,qrencoder.QRErrorCorrectLevel.M)
        qr.addData(qrencoder.QR8bitByte(viewer_url.encode('utf-8'))); qr.make()
        n=qr.getModuleCount()
        rects=''.join(f'<path d="M{x+4} {y+4}h1v1h-1z"/>' for y in range(n) for x in range(n) if qr.isDark(y,x))
        content['launch.svg']=(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n+8} {n+8}" shape-rendering="crispEdges"><path fill="white" d="M0 0h{n+8}v{n+8}H0z"/><g fill="black">{rects}</g></svg>').encode()
        content['launch-url.txt']=(viewer_url+'\nLaunch code only; scan the model parts inside Safari.\n').encode()
    destination.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,data in content.items():
            info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0)); info.external_attr=0o644<<16
            archive.writestr(info,data,compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
    return {'files':list(content),'zipBytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('output',type=Path); p.add_argument('--viewer-url')
    a=p.parse_args(); print(json.dumps(package(a.output,a.viewer_url),indent=2))
