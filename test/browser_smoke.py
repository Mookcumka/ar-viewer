import base64
import gzip
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/'


def ar4():
    # One 3 m wall with a window, same layout as plugin/src/ArWallSolidPayload.cs.
    body = bytes([4]) + struct.pack('<H', 1) + struct.pack('<7i', 0, 0, 3000, 0, 0, 2700, 200) + bytes([185, 185, 185, 1])
    body += struct.pack('<4i', 1100, 1800, 900, 1900)
    return base64.urlsafe_b64encode(gzip.compress(body)).decode().rstrip('=')


def qr_video(text):
    """Two seconds of Y4M with the QR on white, for Chromium's fake camera. Needs segno and Pillow."""
    try:
        import io
        import segno
        from PIL import Image
    except ImportError:
        return None
    buffer = io.BytesIO()
    segno.make(text, error='m').save(buffer, kind='png', scale=8, border=4)
    qr = Image.open(io.BytesIO(buffer.getvalue())).convert('L')
    frame = Image.new('L', (640, 480), 255)
    qr.thumbnail((400, 400))
    frame.paste(qr, ((640 - qr.width) // 2, (480 - qr.height) // 2))
    path = Path(tempfile.mkdtemp()) / 'qr.y4m'
    chroma = bytes([128]) * (320 * 240 * 2)
    with open(path, 'wb') as f:
        f.write(b'YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n')
        for _ in range(20):
            f.write(b'FRAME\n' + frame.tobytes() + chroma)
    return str(path)


walls = 'AR4;walls;scale=50;c=7A5C9E;s=AR-T.05;data=' + ar4()
cube = 'AR1;cube;2000;2000;2000;scale=50;c=2F6F73;s=AR-T.03'
results = {}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=[
        '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    ctx = browser.new_context(permissions=['camera'])
    page = ctx.new_page()
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.add_init_script('''window.cameraRequests = 0;
const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = (...args) => { window.cameraRequests++; return original(...args); };''')
    page.goto(base + 'index.html#bad')
    page.wait_for_function("document.getElementById('status').textContent.includes('не содержит')")
    assert page.locator('a-scene').count() == 0
    assert page.evaluate('window.cameraRequests') == 0
    results['invalid_qr_without_scene_or_camera'] = True
    page.wait_for_function("document.getElementById('offline').textContent.includes('Ресурсы сохранены')")
    results['offline_cache_complete'] = True
    ctx.set_offline(True)
    page.goto(base + 'index.html#' + quote(cube))
    page.wait_for_function("document.getElementById('sheet').textContent === 'Лист AR-T.03'")
    assert page.evaluate('window.cameraRequests') == 0
    assert page.evaluate("getComputedStyle(document.getElementById('dot')).backgroundColor") == 'rgb(47, 111, 115)'
    page.locator('#start').click()
    page.wait_for_function('window.cameraRequests === 1')
    page.wait_for_function("document.getElementById('arjs-video')?.srcObject?.getVideoTracks().length > 0", timeout=20000)
    page.wait_for_function("document.querySelector('[ar-follow]')?.object3D?.children.length === 1")
    # Metres inside the holder; the holder turns them into marker units (2 m at 1:50 = 40 mm = one marker).
    size = page.evaluate('''(() => { const m = ARViewer.model(), g = m.group.children[0].geometry; g.computeBoundingBox();
      const b = g.boundingBox; return [b.max.x - b.min.x, b.max.y - b.min.y, m.group.children[0].position.y, m.holder.scale.x]; })()''')
    assert [round(x, 3) for x in size] == [2, 2, 1, 0.5], size
    results['offline_camera_and_cube_2m_at_1_50'] = True
    page.evaluate('window.sameDocument = true')
    page.evaluate(f'location.hash = {json.dumps(quote(walls))}')
    page.wait_for_function("document.getElementById('sheet').textContent === 'Лист AR-T.05'")
    assert page.evaluate('window.sameDocument') is True
    assert page.evaluate('window.cameraRequests') == 1
    assert page.evaluate("document.querySelector('[ar-follow]').object3D.children.length") == 1
    assert page.evaluate("document.getElementById('toast').textContent").startswith('Лист AR-T.05')
    results['new_qr_swaps_model_without_reload_or_new_camera'] = True
    usdz = page.evaluate('ARViewer.usdz().arrayBuffer().then(b => btoa(String.fromCharCode(...new Uint8Array(b))))')
    page.goto(base + 'scan.html#' + quote(cube))
    page.wait_for_url('**/index.html#*')
    results['scan_html_redirects_to_viewer'] = True
    results['page_errors'] = errors
    results['external_requests'] = [url for url in requests if not url.startswith(base)]
    assert not errors, errors
    assert not results['external_requests'], results['external_requests']
    # A fake camera that films a printed QR of another sheet: the model must change while the camera keeps running.
    video = qr_video('https://example.test/ar/index.html#' + quote('AR1;cube;3000;1000;600;scale=50;c=C07A3A;s=AR-T.04'))
    if video:
        scanner = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=[
            '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={video}',
            '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = scanner.new_context(permissions=['camera']).new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + 'index.html#' + quote(cube))
        page.wait_for_function("document.getElementById('sheet').textContent === 'Лист AR-T.03'")
        page.locator('#start').click()
        page.wait_for_function("document.getElementById('sheet').textContent === 'Лист AR-T.04'", timeout=20000)
        assert page.evaluate("ARViewer.model().data.w") == 3000
        assert page.locator('a-scene').count() == 1
        results['camera_reads_next_sheet_qr_and_swaps_model'] = True
        scanner.close()
        assert not errors, errors
    browser.close()
server.shutdown()
# Pixar USD opens the archive when usd-core is installed (pip install usd-core).
out = Path(tempfile.mkdtemp()) / 'walls.usdz'
out.write_bytes(base64.b64decode(usdz))
try:
    from pxr import Sdf, Usd, UsdGeom, UsdShade
except ImportError:
    results['usd_core'] = 'not installed, skipped'
else:
    archive = Sdf.ZipFile.Open(str(out))
    assert archive.GetFileNames() == ['model.usda'], archive.GetFileNames()
    assert archive.GetFileInfo('model.usda').dataOffset % 64 == 0
    stage = Usd.Stage.Open(str(out))
    assert UsdGeom.GetStageUpAxis(stage) == 'Y' and UsdGeom.GetStageMetersPerUnit(stage) == 1
    meshes = [p for p in stage.Traverse() if p.IsA(UsdGeom.Mesh)]
    assert len(meshes) == 1
    bound = UsdShade.MaterialBindingAPI(meshes[0]).ComputeBoundMaterial()[0]
    assert bound, 'material is bound'
    box = UsdGeom.Imageable(meshes[0]).ComputeWorldBound(Usd.TimeCode.Default(), 'default').ComputeAlignedRange()
    size = [round(box.GetSize()[i], 3) for i in range(3)]
    assert size == [3, 2.7, 0.2], size
    results['usdz_1_to_1_wall_3_x_2_7_x_0_2_m'] = True
print(json.dumps(results, ensure_ascii=False, indent=2))
