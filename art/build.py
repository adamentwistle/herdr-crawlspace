# Turns the raw generated art in art/raw into the game's files in mods/crawlspace/art.
# Run: uv run --no-project --with pillow --with numpy python art/build.py
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
OUT = ROOT.parent / "mods" / "crawlspace" / "art"
OUT.mkdir(parents=True, exist_ok=True)
TEX = 256
SPRITE = 256


def load(name):
    return Image.open(RAW / f"{name}.png").convert("RGBA")


def key_magenta(im):
    a = np.array(im).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    pink = (r - g > 70) & (b - g > 70) & (abs(r - b) < 90)
    a[..., 3] = np.where(pink, 0, a[..., 3])
    # Pull magenta fringe out of edge pixels next to the key.
    edge = np.zeros_like(pink)
    edge[1:, :] |= pink[:-1, :]; edge[:-1, :] |= pink[1:, :]; edge[:, 1:] |= pink[:, :-1]; edge[:, :-1] |= pink[:, 1:]
    fringe = edge & ~pink & (r > g + 25) & (b > g + 25)
    a[..., 0] = np.where(fringe, g + 20, r); a[..., 2] = np.where(fringe, g + 20, b)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), "RGBA")


def glow_alpha(im):
    a = np.array(im).astype(np.float32)
    lum = a[..., :3].max(axis=2) / 255
    a[..., 3] = (np.clip((lum - 0.32) / 0.4, 0, 1) ** 1.2) * 255
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def fit(cell, size, anchor="bottom"):
    box = cell.getbbox()
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if not box:
        return out
    part = cell.crop(box)
    scale = min(size / part.width, size / part.height)
    part = part.resize((max(1, round(part.width * scale)), max(1, round(part.height * scale))), Image.LANCZOS)
    y = size - part.height if anchor == "bottom" else (size - part.height) // 2
    out.paste(part, ((size - part.width) // 2, y))
    return out


def cells(im, cols, rows):
    w, h = im.width // cols, im.height // rows
    return [im.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)) for r in range(rows) for c in range(cols)]


def save(im, name):
    im.save(OUT / f"{name}.png", optimize=True)


for name, crop in {"block": None, "steel": None, "hive": None, "door": None, "hatch": None, "racks": (0, 0, 512, 512)}.items():
    im = load(name).convert("RGB")
    if crop:
        im = im.crop(crop)
    save(im.resize((TEX, TEX), Image.LANCZOS), f"wall-{name}")

FRAMES = ("idle", "walk", "attack", "dead")
for name in ("wasp", "beetle", "queen"):
    for frame, cell in zip(FRAMES, cells(key_magenta(load(name)), 2, 2)):
        save(fit(cell, SPRITE), f"{name}-{frame}")
for frame, cell in zip(FRAMES, cells(load("mite_cut"), 2, 2)):
    save(fit(cell, SPRITE), f"mite-{frame}")

for name in ("rivet", "zapper"):
    for frame, cell in zip(("rest", "fire"), cells(key_magenta(load(name)), 2, 1)):
        box = cell.getbbox()
        part = cell.crop((box[0], box[1], box[2], cell.height))
        scale = min(420 / part.height, 600 / part.width)
        part = part.resize((round(part.width * scale), round(part.height * scale)), Image.LANCZOS)
        canvas = Image.new("RGBA", (600, 420), (0, 0, 0, 0))
        canvas.paste(part, ((600 - part.width) // 2, 420 - part.height))
        save(canvas, f"gun-{name}-{frame}")

ITEMS = ("health", "rivets", "battery", "keyred", "keyblue", "helmet")
for name, cell in zip(ITEMS, cells(key_magenta(load("items")), 3, 2)):
    save(fit(cell, 128), f"item-{name}")

for name, cell in zip(("acid", "spark", "splat", "zap"), cells(glow_alpha(load("fx")), 2, 2)):
    save(fit(cell, 128, "centre"), f"fx-{name}")

load("backdrop").convert("RGB").resize((960, 540), Image.LANCZOS).save(OUT / "backdrop.jpg", quality=82)
load("title").convert("RGB").resize((1280, 720), Image.LANCZOS).save(OUT / "title.jpg", quality=84)
