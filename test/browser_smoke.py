import json
import os
import shutil
import threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}/'
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
    assert page.locator('#start').is_disabled()
    assert page.locator('a-scene').count() == 0
    assert page.evaluate('window.cameraRequests') == 0
    results['invalid_qr_without_scene_or_camera'] = True
    page.wait_for_function("document.getElementById('offline').textContent.includes('Ресурсы сохранены')")
    results['offline_cache_complete'] = True
    ctx.set_offline(True)
    page.goto(base + 'index.html#AR1;cube;2000;2000;2000;scale=50')
    page.wait_for_function("!document.getElementById('start').disabled")
    assert page.evaluate('window.cameraRequests') == 0
    page.locator('#start').click()
    page.wait_for_selector('a-box', state='attached')
    page.wait_for_function('window.cameraRequests === 1')
    page.wait_for_function("document.getElementById('arjs-video')?.srcObject?.getVideoTracks().length > 0", timeout=20000)
    assert page.locator('a-box').evaluate('(box) => box.getAttribute("geometry").width') == 1
    assert float(page.locator('a-box').get_attribute('width')) == 1
    assert float(page.locator('a-box').get_attribute('height')) == 1
    results['offline_viewer_with_fake_camera_and_unit_cube'] = True
    page.goto(base + 'scan.html')
    page.wait_for_selector('#start')
    page.locator('#start').click()
    page.wait_for_function("document.getElementById('camera').srcObject?.getVideoTracks().length > 0")
    results['offline_scanner_with_fake_camera'] = True
    results['page_errors'] = errors
    results['external_requests'] = [url for url in requests if not url.startswith(base)]
    assert not errors, errors
    assert not results['external_requests'], results['external_requests']
    browser.close()
server.shutdown()
print(json.dumps(results, ensure_ascii=False, indent=2))
