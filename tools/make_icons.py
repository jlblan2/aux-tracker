"""Draw the app icons: python tools/make_icons.py (needs Pillow)."""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def make_icon(size, path):
    img = Image.new("RGBA", (size, size), (10, 25, 41, 255))
    d = ImageDraw.Draw(img)
    # a location pin under two radio arcs, inside the maskable safe zone
    cx, cy = size / 2, size * 0.47
    r = size * 0.16
    teal, orange, navy = (46, 196, 182, 255), (255, 159, 28, 255), (10, 25, 41, 255)
    w = max(3, size // 26)
    for k in (1.8, 2.5):
        d.arc([cx - r * k, cy - r * k, cx + r * k, cy + r * k], 205, 335, fill=teal, width=w)
    d.polygon([(cx - r * 0.93, cy + r * 0.38), (cx + r * 0.93, cy + r * 0.38), (cx, cy + r * 2.3)], fill=orange)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=orange)
    d.ellipse([cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42], fill=navy)
    img.save(path)


os.makedirs(os.path.join(HERE, "..", "icons"), exist_ok=True)
for s in (192, 512):
    make_icon(s, os.path.join(HERE, "..", "icons", f"icon-{s}.png"))
print("done")
