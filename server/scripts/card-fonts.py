#!/usr/bin/env python3
"""Builds server/fonts/: the static, subset fonts the link-preview images are drawn with.

The sources are the variable fonts from https://github.com/google/fonts (all SIL OFL 1.1):

  ofl/archivo/Archivo[wdth,wght].ttf
  ofl/jetbrainsmono/JetBrainsMono[wght].ttf
  ofl/notosans/NotoSans[wdth,wght].ttf
  ofl/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf
  ofl/notosanssc/NotoSansSC[wght].ttf
  ofl/notosansjp/NotoSansJP[wght].ttf

Usage (from server/): uv run --with fonttools python scripts/card-fonts.py <dir with the sources>

Every weight is its own static instance under its own family name: smaller than the variable
fonts, and the cards pick a face by its family alone. Chinese and Japanese keep the level-1 characters of GB 2312 and JIS X 0208 (the
common ones, about 1.2 MB each); their bold faces only the characters of src/card-copy.ts.
Anything else a review contains is left out of the picture (see src/card.ts). The licence and
copyright notices are in fonts/OFL.txt.
"""

import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / 'fonts'

LATIN = [*range(0x20, 0x7F), *range(0xA0, 0x250), *range(0x2C6, 0x2DD), *range(0x2000, 0x2070),
         0x20AC, 0x20BD, 0x20B9, 0x2116, 0x2122, *range(0x2190, 0x2194), 0x2212, 0x2713, 0x2717]
CYRILLIC = [*range(0x400, 0x460), 0x490, 0x491]
DEVANAGARI = [*range(0x900, 0x980), *range(0xA8E0, 0xA900), 0x200C, 0x200D, 0x25CC, 0x20B9]
CJK_PUNCT = [*range(0x3000, 0x3040), *range(0xFF00, 0xFFF0), 0x30FB, 0x2026, 0x2014, 0x201C, 0x201D, 0x2018, 0x2019]


def gb2312_level1():
    rows = [*range(0xA1, 0xAA), *range(0xB0, 0xD8)]
    return chars_of(rows, 'gb2312')


def jis_level1():
    rows = [*range(0xA1, 0xA9), *range(0xB0, 0xD0)]
    return chars_of(rows, 'euc_jp')


def chars_of(rows, codec):
    out = set()
    for b1 in rows:
        for b2 in range(0xA1, 0xFF):
            try:
                out.add(ord(bytes([b1, b2]).decode(codec)))
            except UnicodeDecodeError:
                pass
    return out


def card_copy_chars():
    text = (HERE / 'src' / 'card-copy.ts').read_text('utf8')
    return {ord(c) for s in re.findall(r"'([^'\n]*)'", text) for c in s}


def build(src, out, family, axes, unicodes):
    font = TTFont(src)
    if 'fvar' in font:
        font = instancer.instantiateVariableFont(font, axes)
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.hinting = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    # One family per file: the SVG picks faces by family name alone.
    names = font['name']
    for rec in list(names.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            names.removeNames(nameID=rec.nameID)
    ps = family.replace(' ', '')
    for nid, value in ((1, family), (2, 'Regular'), (3, ps), (4, family), (6, ps)):
        names.setName(value, nid, 3, 1, 0x409)
    font['OS/2'].usWeightClass = 400
    font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~0b1100001) | 0b1000000
    font['head'].macStyle = 0
    for t in ('STAT', 'DSIG'):
        if t in font:
            del font[t]
    font.save(OUT / out)
    print(f'{out}: {(OUT / out).stat().st_size // 1024} KB')


def main():
    src = Path(sys.argv[1])
    OUT.mkdir(exist_ok=True)
    copy = card_copy_chars()
    ascii_digits = set(range(0x20, 0x7F))
    archivo = src / 'Archivo[wdth,wght].ttf'
    build(archivo, 'archivo-medium.ttf', 'W755 Archivo', {'wght': 500, 'wdth': 100}, LATIN)
    build(archivo, 'archivo-bold.ttf', 'W755 Archivo Bold', {'wght': 700, 'wdth': 100}, LATIN)
    build(archivo, 'archivo-black-cond.ttf', 'W755 Archivo Cond', {'wght': 850, 'wdth': 62}, LATIN)
    build(src / 'JetBrainsMono[wght].ttf', 'jetbrains-mono-semibold.ttf', 'W755 Mono', {'wght': 600}, LATIN + CYRILLIC)
    noto = src / 'NotoSans[wdth,wght].ttf'
    build(noto, 'noto-sans-medium.ttf', 'W755 Noto', {'wght': 500, 'wdth': 100}, LATIN + CYRILLIC)
    build(noto, 'noto-sans-bold.ttf', 'W755 Noto Bold', {'wght': 700, 'wdth': 100}, LATIN + CYRILLIC)
    build(noto, 'noto-sans-black-cond.ttf', 'W755 Noto Cond', {'wght': 850, 'wdth': 62.5}, LATIN + CYRILLIC)
    deva = src / 'NotoSansDevanagari[wdth,wght].ttf'
    build(deva, 'noto-devanagari-medium.ttf', 'W755 Deva', {'wght': 500, 'wdth': 100}, DEVANAGARI + list(ascii_digits))
    build(deva, 'noto-devanagari-bold.ttf', 'W755 Deva Bold', {'wght': 700, 'wdth': 100}, DEVANAGARI + list(ascii_digits))
    sc = src / 'NotoSansSC[wght].ttf'
    build(sc, 'noto-sc-medium.ttf', 'W755 SC', {'wght': 500}, sorted(gb2312_level1() | set(CJK_PUNCT) | ascii_digits | copy))
    build(sc, 'noto-sc-bold.ttf', 'W755 SC Bold', {'wght': 700}, sorted(set(CJK_PUNCT) | ascii_digits | copy))
    jp = src / 'NotoSansJP[wght].ttf'
    build(jp, 'noto-jp-medium.ttf', 'W755 JP', {'wght': 500}, sorted(jis_level1() | set(CJK_PUNCT) | ascii_digits | copy))
    build(jp, 'noto-jp-bold.ttf', 'W755 JP Bold', {'wght': 700}, sorted(set(CJK_PUNCT) | ascii_digits | copy))


if __name__ == '__main__':
    main()
