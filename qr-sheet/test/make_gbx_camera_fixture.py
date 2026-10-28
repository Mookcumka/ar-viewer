"""Frozen C# QRL3 bytes -> actual QR -> software video, never production geometry."""
import base64,json,sys
from pathlib import Path
from reportlab.graphics.barcode import qrencoder
from PIL import Image
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
fixtures=json.loads((Path(__file__).parent/'gbx1-v1.json').read_text())
for fixture in fixtures:
 with (out/(fixture['Name']+'.y4m')).open('wb') as f:
  f.write(b'YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n')
  for encoded in fixture['Packets']:
   q=qrencoder.QRCode(None,qrencoder.QRErrorCorrectLevel.M);q.addData(qrencoder.QR8bitByte(base64.b64decode(encoded)));q.make();n=q.getModuleCount()
   image=Image.new('L',((n+8)*5,(n+8)*5),255)
   for y in range(n):
    for x in range(n):
     if q.isDark(y,x):image.paste(0,((x+4)*5,(y+4)*5,(x+5)*5,(y+5)*5))
   frame=Image.new('L',(640,480),255);frame.paste(image,((640-image.width)//2,(480-image.height)//2))
   frame.save(out/(fixture['Name']+'.png'))
   for _ in range(30):f.write(b'FRAME\n'+frame.tobytes()+bytes([128])*(640*480//2))
print('Created six C# optical vectors in',out)
