#!/usr/bin/env python3
"""Regenerate the app icons from a single source image.

macOS does not crop or pad app icons for you: whatever the file contains is
drawn at full tile size. A full-bleed square therefore renders visibly larger
than every well-behaved neighbour in the Dock, because those follow Apple's
template — artwork inset to 824/1024 of the canvas, with a ~18% corner radius.

This script applies that template and rebuilds every derived size, including a
hand-written .icns (the `iconutil` CLI is macOS-only, and the container format
is simple enough to emit directly).

Usage:
    python3 scripts/make-icons.py [source.png]

Default source is src-tauri/icons/icon-source.png, falling back to the current
icon.png. Originals are backed up to src-tauri/icons/original/ on first run.
"""

from __future__ import annotations

import shutil
import struct
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
BACKUP = ICONS / "original"

# Apple's macOS app icon template, in units of a 1024px canvas.
CANVAS = 1024
ART = 824
RADIUS = 185

PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

# ICNS entry types, mapped to the pixel size each one holds.
ICNS_TYPES = [
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
]


def rounded_mask(size: int, radius: int) -> Image.Image:
    """Antialiased rounded-rectangle mask, drawn 4x then downsampled."""
    scale = 4
    mask = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return mask.resize((size, size), Image.LANCZOS)


def build_master(source: Path) -> Image.Image:
    """Source artwork, inset and corner-rounded on a transparent canvas."""
    art = Image.open(source).convert("RGBA")

    # A source that already has transparent margins is trimmed first, so the
    # inset below is applied to the artwork itself rather than to the padding.
    bbox = art.getchannel("A").getbbox()
    if bbox and (bbox[2] - bbox[0]) < art.width * 0.98:
        art = art.crop(bbox)

    art = art.resize((ART, ART), Image.LANCZOS)
    art.putalpha(rounded_mask(ART, round(RADIUS * ART / CANVAS)))

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    offset = (CANVAS - ART) // 2
    canvas.paste(art, (offset, offset), art)
    return canvas


def write_icns(master: Image.Image, path: Path) -> None:
    """Emit an .icns container: 8-byte header, then typed PNG entries."""
    entries = []
    for kind, size in ICNS_TYPES:
        buffer = BytesIO()
        master.resize((size, size), Image.LANCZOS).save(buffer, format="PNG")
        payload = buffer.getvalue()
        entries.append(kind + struct.pack(">I", len(payload) + 8) + payload)

    body = b"".join(entries)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else ICONS / "icon-source.png"
    if not source.exists():
        source = ICONS / "icon.png"
    if not source.exists():
        print(f"nenhuma imagem de origem encontrada em {source}", file=sys.stderr)
        return 1

    if not BACKUP.exists():
        BACKUP.mkdir(parents=True)
        for f in ICONS.glob("*.*"):
            if f.is_file():
                shutil.copy2(f, BACKUP / f.name)
        print(f"originais salvos em {BACKUP.relative_to(ROOT)}/")

    # Always regenerate from the untouched original, so running this twice does
    # not inset an already-inset icon.
    pristine = BACKUP / source.name
    master = build_master(pristine if pristine.exists() else source)

    for name, size in PNG_SIZES.items():
        master.resize((size, size), Image.LANCZOS).save(ICONS / name)

    write_icns(master, ICONS / "icon.icns")

    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    master.resize((256, 256), Image.LANCZOS).save(ICONS / "icon.ico", sizes=ico_sizes)

    print(f"gerados {len(PNG_SIZES)} PNGs + icon.icns + icon.ico")
    print(f"arte com {100 * ART / CANVAS:.1f}% do canvas, raio {RADIUS / CANVAS:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
