#!/usr/bin/env python3
"""Draw the I Formation app icon (1024x1024 PNG, no alpha).

The motif is a bold slab-serif "I" with the I formation drawn into it like a
playbook diagram: the five offensive linemen are punched out of the top slab
under a gold line of scrimmage, the quarterback and fullback sit in the stem,
and the tailback is a gold dot in the bottom slab.

Usage: python3 scripts/make-app-icon.py [output.png]
Requires Pillow.
"""
import sys
from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersample factor for smooth edges
S = SIZE * SS

TOP = (18, 112, 64)      # field green, matches the accent colour family
BOTTOM = (12, 62, 38)
LINE = (255, 255, 255)
CHALK = (255, 255, 255)
GOLD = (246, 196, 69)


def px(v):
    return int(round(v * SS))


def main(out):
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)

    # Vertical gradient field.
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (S, y)], fill=c)

    # Faint yard lines across the field.
    faint = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(faint)
    for y in (64, 320, 576, 832):
        fd.rectangle([0, px(y - 3), S, px(y + 3)], fill=(255, 255, 255, 26))
    img.paste(faint, (0, 0), faint)
    d = ImageDraw.Draw(img)

    cx = 512
    # A bold slab-serif "I" in chalk white.
    bar_w, bar_h = 660, 168      # top and bottom slabs
    stem_w = 196
    top_y, bot_y = 204, 864      # outer edges of the letter
    rad = 34
    d.rounded_rectangle([px(cx - bar_w / 2), px(top_y), px(cx + bar_w / 2),
                         px(top_y + bar_h)], radius=px(rad), fill=CHALK)
    d.rounded_rectangle([px(cx - bar_w / 2), px(bot_y - bar_h),
                         px(cx + bar_w / 2), px(bot_y)], radius=px(rad),
                        fill=CHALK)
    d.rectangle([px(cx - stem_w / 2), px(top_y + bar_h - 1),
                 px(cx + stem_w / 2), px(bot_y - bar_h + 1)], fill=CHALK)

    def field_at(y):
        t = y / SIZE
        return tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))

    def hole(x, y, r, colour=None):
        d.ellipse([px(x - r), px(y - r), px(x + r), px(y + r)],
                  fill=colour or field_at(y))

    # Top slab: the five offensive linemen ("O"s punched out of the slab).
    line_y = top_y + bar_h / 2
    gap = 124
    r = 40
    for i in range(-2, 3):
        hole(cx + i * gap, line_y, r)
    # Stem: quarterback and fullback stacked behind the center.
    stem_top, stem_bot = top_y + bar_h, bot_y - bar_h
    for y in (stem_top + (stem_bot - stem_top) * 0.30,
              stem_top + (stem_bot - stem_top) * 0.72):
        hole(cx, y, r + 6)
    # Bottom slab: the tailback, gold, the one we're rooting for.
    hole(cx, bot_y - bar_h / 2, r + 10, GOLD)

    # Line of scrimmage in gold just above the letter.
    los_y = top_y - 46
    d.rounded_rectangle([px(cx - bar_w / 2), px(los_y - 9),
                         px(cx + bar_w / 2), px(los_y + 9)],
                        radius=px(9), fill=GOLD)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(out, "PNG", optimize=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else
         "ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
