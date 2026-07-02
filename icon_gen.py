# Build item sprite data for minecraft.html: all six sprites (stick, sword,
# pickaxe, axe, shovel, hoe) sampled from the real game textures (1.21.4
# assets, textures/item/*.png), emitted as 16-row palette-char strings + JS.
from PIL import Image

VAN = {
    'stick': '_stick.png',
    'sword': '_wooden_sword.png',
    'pickaxe': '_wooden_pickaxe.png',
    'axe': '_wooden_axe.png',
    'shovel': '_wooden_shovel.png',
    'hoe': '_wooden_hoe.png',
}
# assign chars to colors as encountered
van_pal = {}
CHARS = list('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')

def png_to_rows(path):
    im = Image.open(path).convert('RGBA')
    assert im.size == (16, 16), path
    rows = []
    for y in range(16):
        r = ''
        for x in range(16):
            p = im.getpixel((x, y))
            if p[3] < 128:
                r += '.'
            else:
                rgb = p[:3]
                if rgb not in van_pal:
                    van_pal[rgb] = CHARS[len(van_pal)]
                r += van_pal[rgb]
        rows.append(r)
    return rows

ART = {n: png_to_rows(f) for n, f in VAN.items()}
full_pal = {ch: rgb for rgb, ch in van_pal.items()}

# ---- preview sheet ----
def render(rows, scale=16):
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch != '.':
                img.putpixel((x, y), tuple(full_pal[ch]) + (255,))
    return img.resize((16 * scale, 16 * scale), Image.NEAREST)

names = ['sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'stick']
sheet = Image.new('RGBA', (256 * len(names), 256), (200, 200, 200, 255))
for i, n in enumerate(names):
    sheet.paste(render(ART[n]), (i * 256, 0), render(ART[n]))
sheet.save('icon_preview.png')

# ---- emit JS ----
def hexc(rgb):
    return '#%02x%02x%02x' % rgb

js = []
js.append('const ITEM_PAL={' + ','.join(
    f"{ch}:'{hexc(tuple(rgb))}'" for ch, rgb in full_pal.items()) + '};')
ids = {'stick': 'STICK_I', 'sword': 'WSWORD_I', 'axe': 'WAXE_I',
       'pickaxe': 'WPICK_I', 'shovel': 'WSHOVEL_I', 'hoe': 'WHOE_I'}
js.append('const ITEM_ART={')
for n in ['stick', 'sword', 'pickaxe', 'axe', 'shovel', 'hoe']:
    js.append(f'  [{ids[n]}]:[' + ','.join(f"'{r}'" for r in ART[n]) + '],')
js.append('};')
open('_item_art.js', 'w').write('\n'.join(js))
print('rows written; palette size', len(full_pal))
