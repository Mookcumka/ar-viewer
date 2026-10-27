"""Test-only QR matrices from existing C# byte vectors. No model/fixture in runtime."""
from pathlib import Path
import json
from reportlab.graphics.barcode import qrencoder
r=Path(__file__).resolve().parents[1]
v=next(v for v in json.loads((r/'qr-sheet/test/exporto-vectors.json').read_text()) if len(v['packets'])==6)
items=[]
for i,packet in enumerate(v['packets'][:2]):
 q=qrencoder.QRCode(24,qrencoder.QRErrorCorrectLevel.M);q.addData(qrencoder.QR8bitByte(bytes(packet)));q.make();n=q.getModuleCount()
 items.append({'packetIndex':i,'rows':[''.join('1' if q.isDark(y,x) else '0' for x in range(n)) for y in range(n)]})
(r/'test/qr-tracking-fixtures.json').write_text(json.dumps(items,separators=(',',':'))+'\n')
