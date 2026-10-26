"""Optical software fixture only: C# encoder vectors -> v24/M QR -> fake camera video. Not Revit/iPhone evidence."""
import json
from pathlib import Path
import sys
from reportlab.graphics.barcode import qrencoder
from PIL import Image

vectors = json.loads((Path(__file__).parent / 'exporto-vectors.json').read_text())
target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
chroma = bytes([128]) * (320 * 240 * 2)
for vector in vectors:
    path = target / (vector['name'] + '.y4m')
    with path.open('wb') as out:
        out.write(b'YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n')
        for i, packet in enumerate(reversed(vector['packets'])):
            qr = qrencoder.QRCode(24, qrencoder.QRErrorCorrectLevel.M)
            qr.addData(qrencoder.QR8bitByte(bytes(packet)))
            qr.make()
            n = qr.getModuleCount()
            image = Image.new('L', ((n+8)*3, (n+8)*3), 255)
            for y in range(n):
                for x in range(n):
                    if qr.isDark(y,x):
                        image.paste(0, ((x+4)*3, (y+4)*3, (x+5)*3, (y+5)*3))
            frame = Image.new('L', (640,480), 255)
            frame.paste(image, ((640-image.width)//2, (480-image.height)//2))
            if i == 0:
                frame.save(target / (vector['name'] + '.png'))
            for _ in range(18):
                out.write(b'FRAME\n' + frame.tobytes() + chroma)
    print(path)

# Same legacy QR before and after a binary scene, in one video stream (software only).
path=target/'mixed.y4m'
with path.open('wb') as out:
    out.write(b'YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n')
    legacy=b'https://example.test/#AR1;cube;2000;2000;2000;scale=50;c=2F6F73;s=AR-T.03'
    for data in (legacy,bytes(vectors[0]['packets'][0]),legacy):
        qr=qrencoder.QRCode(24,qrencoder.QRErrorCorrectLevel.M);qr.addData(qrencoder.QR8bitByte(data));qr.make();n=qr.getModuleCount()
        image=Image.new('L',((n+8)*3,(n+8)*3),255)
        for y in range(n):
            for x in range(n):
                if qr.isDark(y,x):image.paste(0,((x+4)*3,(y+4)*3,(x+5)*3,(y+5)*3))
        frame=Image.new('L',(640,480),255);frame.paste(image,((640-image.width)//2,(480-image.height)//2))
        for _ in range(30):out.write(b'FRAME\n'+frame.tobytes()+chroma)
print(path)

# Existing Hiro marker, not model geometry. Supply its image as the second argument.
if len(sys.argv) > 2:
    marker=Image.open(sys.argv[2]).convert('L').crop((58,31,492,465)).resize((240,240))
    frame=Image.new('L',(640,480),255);frame.paste(marker,(200,120))
    with (target/'hiro.y4m').open('wb') as out:
        out.write(b'YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n')
        for _ in range(200):out.write(b'FRAME\n'+frame.tobytes()+chroma)
    print(target/'hiro.y4m')
