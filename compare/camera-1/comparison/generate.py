"""Requires segno and Pillow. Generated PNGs are shared, byte-identical references for Safari and ARKit."""
import json
from pathlib import Path
from urllib.parse import quote
import segno
from PIL import Image
root = Path(__file__).resolve().parent
fixtures = [
    dict(id='A', payload='AR1;cube;2000;2000;2000;scale=50;c=2F6F73;s=COMPARE.A', image='sheet-a', widthMM=40, dimensionsMM=[2000,2000,2000], color=[47,111,115]),
    dict(id='B', payload='AR1;cube;3000;1000;600;scale=50;c=C07A3A;s=COMPARE.B', image='sheet-b', widthMM=40, dimensionsMM=[3000,1000,600], color=[192,122,58]),
]
for fixture in fixtures:
    text = 'https://mookcumka.github.io/ar-viewer/index.html#' + quote(fixture['payload'], safe='')
    destination = root / (fixture['image'] + '.png')
    segno.make(text, error='m', boost_error=False, micro=False).save(destination, scale=8, border=4)
    with Image.open(destination) as image:
        image.convert('L').save(destination)
(root / 'fixtures.json').write_text(json.dumps(fixtures, indent=2) + '\n')
