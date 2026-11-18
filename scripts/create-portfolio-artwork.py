#!/usr/bin/env python3
"""Compose portfolio art from a real public dashboard capture and existing icon.

Requires Pillow. Run from any directory with --icon pointing at the original
Worklog app icon. The checked-in overview capture is the background source.
No invented UI, external fonts, or private local data are used.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--icon", type=Path, required=True)
    parser.add_argument("--font", type=Path, default=Path("/System/Library/Fonts/Menlo.ttc"))
    args = parser.parse_args()
    output = ROOT / "docs/images/portfolio"
    capture = Image.open(output / "worklog-website-overview.jpg").convert("RGB")
    background = ImageOps.fit(capture, (2500, 1600))
    background = background.rotate(12, resample=Image.Resampling.BICUBIC)
    background = ImageOps.fit(background, (1920, 1080))
    background = background.filter(ImageFilter.GaussianBlur(5))
    background = ImageEnhance.Color(background).enhance(0.6)
    background = Image.blend(background, Image.new("RGB", background.size, "#101410"), 0.57).convert("RGBA")

    # Extract the existing mint waveform, preserving its antialiasing; the
    # dashboard's green palette supplies the new tint, not a replacement logo.
    icon = Image.open(args.icon).convert("RGBA")
    mask = ImageChops.subtract(icon.getchannel("G"), icon.getchannel("R")).point(lambda value: max(0, min(255, (value - 25) * 4)))
    mask = ImageChops.multiply(mask, icon.getchannel("A"))
    mark = Image.new("RGBA", icon.size, "#bcf776")
    mark.putalpha(mask)
    mark = mark.crop(mask.getbbox())
    mark.thumbnail((220, 220), Image.Resampling.LANCZOS)

    font = ImageFont.truetype(str(args.font), 216, index=1)
    title = "Worklog"
    box = font.getbbox(title)
    width = mark.width + 48 + box[2] - box[0]
    x = (1920 - width) // 2
    foreground = Image.new("RGBA", background.size)
    foreground.alpha_composite(mark, (x, (1080 - mark.height) // 2))
    draw = ImageDraw.Draw(foreground)
    draw.text((x + mark.width + 48, 540 - (box[3] - box[1]) / 2 - box[1]), title, font=font, fill="#bcf776")
    shadow = Image.new("RGBA", background.size, "#000000")
    shadow.putalpha(foreground.getchannel("A").filter(ImageFilter.GaussianBlur(22)))
    background.alpha_composite(shadow)
    background.alpha_composite(foreground)
    banner = background.convert("RGB")
    banner.save(output / "worklog-banner-v2.png", optimize=True)
    ImageOps.fit(banner, (1200, 630), Image.Resampling.LANCZOS).save(output / "worklog-preview-v2.jpg", quality=94, subsampling=0)
    print("Created 1920×1080 banner and 1200×630 preview")


if __name__ == "__main__":
    main()
