"""Draws the «AR» sheet marker and its AR.js pattern file.

Outputs (deterministic, no fonts needed):
  plugin/assets/ar-marker.png  1200 × 1200 px: black frame 1000 px (= 40 mm on the sheet),
                                white margin 100 px on every side, so the frame is centred.
  ar-poc/marker-ar.patt         AR.js pattern: inner 50 % (patternRatio 0.5) as 16 × 16,
                                four orientations, channels B, G, R — the layout of vendor/patt.hiro.

The encoding was checked against vendor/patt.hiro: encoding the bundled HIRO.jpg the same way
correlates 0.88 with the official file in all four orientations and in the same order.

Usage: python3 ar-poc/tools/make-ar-marker.py  (from the repository root)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SIZE, MARGIN, FRAME = 1200, 100, 1000
INNER = FRAME // 2  # patternRatio 0.5


def letters(size):
    """Bold geometric «AR» on a white square of side `size` (coordinates drawn on a 500 grid)."""
    k = size / 500
    image = Image.new("RGB", (size, size), "white")
    d = ImageDraw.Draw(image)
    p = lambda pts: [(x * k, y * k) for x, y in pts]
    # A: outer outline, triangular counter.
    d.polygon(p([(40, 400), (105, 100), (165, 100), (230, 400), (180, 400), (166, 330), (104, 330), (90, 400)]), fill="black")
    d.polygon(p([(114, 285), (156, 285), (135, 180)]), fill="white")
    # R: bowl with a counter, stem, leg.
    d.rounded_rectangle([270 * k, 100 * k, 450 * k, 262 * k], radius=80 * k, fill="black", corners=(False, True, True, False))
    d.rounded_rectangle([290 * k, 146 * k, 402 * k, 216 * k], radius=34 * k, fill="white", corners=(False, True, True, False))
    d.rectangle([270 * k, 100 * k, 322 * k, 400 * k], fill="black")
    d.polygon(p([(352, 250), (408, 250), (468, 400), (408, 400)]), fill="black")
    return image


def marker():
    image = Image.new("RGB", (SIZE, SIZE), "white")
    ImageDraw.Draw(image).rectangle([MARGIN, MARGIN, MARGIN + FRAME - 1, MARGIN + FRAME - 1], fill="black")
    offset = MARGIN + (FRAME - INNER) // 2
    image.paste(letters(INNER), (offset, offset))
    return image


def pattern(inner):
    small = inner.resize((16, 16), Image.BILINEAR)
    blocks = []
    for turn in range(4):
        pixels = small.rotate(90 * turn).load()
        rows = []
        for channel in (2, 1, 0):
            for y in range(16):
                rows.append(" ".join(f"{pixels[x, y][channel]:3d}" for x in range(16)))
        blocks.append("\n".join(rows))
    return "\n\n".join(blocks) + "\n"


if __name__ == "__main__":
    marker().save(ROOT / "plugin/assets/ar-marker.png", optimize=True)
    (ROOT / "ar-poc/marker-ar.patt").write_text(pattern(letters(INNER)), newline="\n")
    print("ar-marker.png, marker-ar.patt written")
