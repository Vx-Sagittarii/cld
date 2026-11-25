# Génère l'illustration animée (SVG) "iwi2me" : scène nocturne façon anime.
import random, math
random.seed(11)
OUT = "#2B1646"          # couleur des contours (aubergine foncé)
o = []
add = o.append

CSS = """
.tw{animation:tw 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes tw{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1.2)}}
.bob{animation:bob 2.8s ease-in-out infinite alternate}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-6px)}}
.sway{animation:sway 3.4s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 0}
@keyframes sway{from{transform:rotate(-2.5deg)}to{transform:rotate(2.5deg)}}
.blink{animation:blink 5.5s infinite;transform-box:fill-box;transform-origin:center}
@keyframes blink{0%,91%,100%{transform:scaleY(1)}94%{transform:scaleY(.08)}}
.cloud{animation:cloud linear infinite}
@keyframes cloud{from{transform:translateX(-520px)}to{transform:translateX(2150px)}}
.bulb{animation:bulb 2.2s ease-in-out infinite alternate}
@keyframes bulb{from{opacity:.4}to{opacity:1}}
.fly{animation:fly ease-in-out infinite alternate}
@keyframes fly{0%{transform:translate(0,0);opacity:.15}50%{opacity:1}100%{transform:translate(var(--dx),var(--dy));opacity:.25}}
.petal{animation:petal linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes petal{from{transform:translate(0,-80px) rotate(0)}to{transform:translate(-300px,1120px) rotate(600deg)}}
.shoot{animation:shoot 11s linear infinite}
@keyframes shoot{0%,58%{opacity:0;transform:translate(0,0)}60%{opacity:1}70%{opacity:0;transform:translate(-560px,280px)}100%{opacity:0}}
.sh{animation:sh 3.6s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
@keyframes sh{from{transform:translateX(-14px) scaleX(.85);opacity:.45}to{transform:translateX(14px) scaleX(1.05);opacity:.9}}
.moonpulse{animation:mp 5s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
@keyframes mp{from{opacity:.7;transform:scale(.96)}to{opacity:1;transform:scale(1.06)}}
.ltr{animation:ltr 2.6s ease-in-out infinite alternate}
@keyframes ltr{from{transform:translateY(0)}to{transform:translateY(-11px)}}
.wave{animation:wave 1.3s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
@keyframes wave{from{transform:rotate(-14deg)}to{transform:rotate(12deg)}}
.glow{animation:glow 2s ease-in-out infinite alternate}
@keyframes glow{from{opacity:.5}to{opacity:1}}
.laugh{animation:laugh .55s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
@keyframes laugh{from{transform:translateY(0) rotate(-1.5deg)}to{transform:translateY(-4px) rotate(1.5deg)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
"""


def hat(top, rx=62, tilt=-6):
    return (f'<g transform="translate(4 {top}) rotate({tilt})"><path d="M{-rx+8} 8 Q-6 -46 {rx-34} -84 Q{rx-4} -34 {rx-8} 8Z" fill="#E23B4E" stroke="{OUT}" stroke-width="4" stroke-linejoin="round"/>'
            f'<path d="M{-rx+16} -4 Q-4 -34 {rx-40} -60" fill="none" stroke="#FF8A96" stroke-width="5" stroke-linecap="round" opacity=".7"/>'
            f'<circle cx="{rx-30}" cy="-88" r="14" fill="#fff" stroke="{OUT}" stroke-width="4"/>'
            f'<ellipse cx="0" cy="10" rx="{rx}" ry="15" fill="#fff" stroke="{OUT}" stroke-width="4"/></g>')

def tree(x, y, sc=1.0):
    t = [f'<g transform="translate({x} {y}) scale({sc})">']
    t.append(f'<rect x="-14" y="-16" width="28" height="40" rx="4" fill="#6B3F24" stroke="{OUT}" stroke-width="4"/>')
    for k, (w, yy) in enumerate([(120, -20), (96, -70), (72, -118)]):
        t.append(f'<path d="M{-w} {yy} Q0 {yy-70} {w} {yy} Q0 {yy+22} {-w} {yy}Z" fill="#1E9B62" stroke="{OUT}" stroke-width="4" stroke-linejoin="round"/>')
        t.append(f'<path d="M{-w+14} {yy-4} Q0 {yy-52} {w-30} {yy-24}" fill="none" stroke="#5CE0A0" stroke-width="5" stroke-linecap="round" opacity=".6"/>')
    t.append('<path class="tw" d="M0 -208 l9 24 26 2 -20 17 7 25 -22 -14 -22 14 7 -25 -20 -17 26 -2Z" fill="#FFE08A" stroke="#E69B2E" stroke-width="3" stroke-linejoin="round"/>')
    for (bx, by, c, d) in [(-52,-44,"#FF4D5E",0),(40,-60,"#FFE08A",.5),(-22,-96,"#FFFFFF",1.0),(30,-112,"#FF4D5E",.3),(-8,-150,"#FFE08A",.8),(60,-30,"#B98CFF",1.3),(-70,-30,"#FFE08A",.2)]:
        t.append(f'<g class="bulb" style="animation-delay:{d}s;color:{c}"><circle cx="{bx}" cy="{by}" r="16" fill="url(#bulbg)"/><circle cx="{bx}" cy="{by}" r="6" fill="{c}" stroke="{OUT}" stroke-width="2"/></g>')
    t.append('</g>')
    return "".join(t)

def gift(x, y, w, h, c1, c2):
    return (f'<g transform="translate({x} {y})"><rect x="0" y="0" width="{w}" height="{h}" rx="5" fill="{c1}" stroke="{OUT}" stroke-width="4"/>'
            f'<rect x="{w/2-6}" y="0" width="12" height="{h}" fill="{c2}" stroke="{OUT}" stroke-width="3"/>'
            f'<path d="M{w/2} 0 q-24 -26 -26 -6 q14 8 26 6 q12 2 26 -6 q-2 -20 -26 6Z" fill="{c2}" stroke="{OUT}" stroke-width="3" stroke-linejoin="round"/></g>')

def sparkle(x, y, s, fill="#fff", delay=0, cls="tw"):
    return (f'<g transform="translate({x} {y}) scale({s})"><path class="{cls}" style="animation-delay:{delay}s" fill="{fill}" '
            f'd="M0 -1 Q.14 -.14 1 0 Q.14 .14 0 1 Q-.14 .14 -1 0 Q-.14 -.14 0 -1Z"/></g>')

# ------------------------------------------------------------ DEFS
add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">')
add(f'<style>{CSS}</style>')
add('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0" stop-color="#150B3A"/><stop offset=".34" stop-color="#3A1C80"/>
 <stop offset=".58" stop-color="#9A3FA0"/><stop offset=".74" stop-color="#FF7A55"/><stop offset="1" stop-color="#FFB45C"/></linearGradient>
<radialGradient id="moonglow"><stop offset="0" stop-color="#FFE9B8" stop-opacity=".85"/><stop offset=".35" stop-color="#FFC48A" stop-opacity=".35"/><stop offset="1" stop-color="#FFB070" stop-opacity="0"/></radialGradient>
<linearGradient id="river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A47A8"/><stop offset="1" stop-color="#2A1458"/></linearGradient>
<linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23545C"/><stop offset="1" stop-color="#0E2A3A"/></linearGradient>
<radialGradient id="fly"><stop offset="0" stop-color="#FFF3A8"/><stop offset=".35" stop-color="#FFD76A" stop-opacity=".7"/><stop offset="1" stop-color="#FFD76A" stop-opacity="0"/></radialGradient>
<radialGradient id="bulbg"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#1B0B3D" stop-opacity="0"/><stop offset="1" stop-color="#1B0B3D" stop-opacity=".55"/></radialGradient>
<radialGradient id="phoneglow"><stop offset="0" stop-color="#BDE6FF" stop-opacity=".9"/><stop offset="1" stop-color="#BDE6FF" stop-opacity="0"/></radialGradient>
<linearGradient id="tail" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse"><rect width="42" height="42" fill="#F8C9D9"/><path d="M0 0H42M0 0V42" stroke="#E896B4" stroke-width="3"/></pattern>
<pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="2.2" fill="#fff" opacity=".08"/></pattern>
</defs>''')

# ------------------------------------------------------------ CIEL
add('<rect width="1600" height="760" fill="url(#sky)"/>')
add('<rect width="1600" height="760" fill="url(#dots)"/>')
add('<rect width="1600" height="760" fill="#0B3A7A" opacity=".2"/>')            # trame "manga" très légère
for _ in range(90):
    x, y = random.randint(20, 1580), random.randint(15, 560)
    r = random.choice([1.6, 2, 2.4, 3])
    add(f'<circle class="tw" style="animation-delay:{random.uniform(0,3.2):.2f}s;animation-duration:{random.uniform(2.2,4.5):.1f}s" cx="{x}" cy="{y}" r="{r}" fill="#FFF6E0"/>')
for (x, y, s, d) in [(260,210,16,.2),(1010,150,12,1.1),(1480,420,14,.6),(640,500,12,1.9),(120,560,10,.9),(900,410,11,2.3)]:
    add(sparkle(x, y, s, "#FFF1C9", d))

# étoile filante
add('<g class="shoot"><g transform="translate(1180 110) rotate(27)"><rect x="0" y="-2.5" width="190" height="5" rx="2.5" fill="url(#tail)"/><circle cx="0" cy="0" r="6" fill="#fff"/></g></g>')

# lune + halo
MX, MY = 1075, 150
add(f'<circle class="moonpulse" cx="{MX}" cy="{MY}" r="260" fill="url(#moonglow)"/>')
add(f'<circle cx="{MX}" cy="{MY}" r="88" fill="#FFF3D2" stroke="#FFE2A6" stroke-width="6"/>')
add(f'<path d="M{MX+10} {MY-88} A88 88 0 0 1 {MX+10} {MY+88} A66 88 0 0 0 {MX+10} {MY-88}Z" fill="#F6DDAA" opacity=".55"/>')
for (cx, cy, r) in [(MX-30,MY-26,14),(MX+28,MY+30,19),(MX+14,MY-44,9),(MX-28,MY+36,10)]:
    add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#F0D199" opacity=".7"/>')

# nuages (dérivent lentement)
def cloud(y, scale, dur, delay, color="#7B45AD", hl="#D58FD0"):
    s = scale
    return (f'<g class="cloud" style="animation-duration:{dur}s;animation-delay:-{delay}s"><g transform="translate(0 {y}) scale({s})">'
            f'<g fill="{color}" opacity=".9"><ellipse cx="0" cy="0" rx="150" ry="30"/><circle cx="-60" cy="-20" r="46"/><circle cx="-5" cy="-42" r="58"/><circle cx="62" cy="-20" r="44"/></g>'
            f'<g fill="{hl}" opacity=".75"><path d="M-95 -22 Q-60 -62 -20 -42 Q-50 -50 -95 -22Z"/><path d="M10 -78 Q50 -92 72 -44 Q50 -66 10 -78Z"/></g>'
            f'<ellipse cx="10" cy="22" rx="130" ry="9" fill="#FF9A6A" opacity=".5"/></g></g>')
add(cloud(470, 1.0, 110, 20)); add(cloud(380, .7, 150, 95, "#6A3A9D", "#C57FCB")); add(cloud(560, .85, 130, 60))

# ------------------------------------------------------------ VILLE
x = -10
add('<g fill="#2B1560">')
bld = []
while x < 1620:
    w = random.randint(46, 96); h = random.choice([70, 90, 110, 130, 150, 190])
    bld.append((x, w, h)); add(f'<rect x="{x}" y="{712-h}" width="{w}" height="{h+10}"/>'); x += w + random.randint(0, 8)
add('</g>')
add('<g fill="#3A1D75" opacity=".8">')
for (x, w, h) in bld[::3]:
    add(f'<rect x="{x+w-10}" y="{712-h}" width="10" height="{h+10}"/>')
add('</g>')
for (x, w, h) in bld:
    for _ in range(int(w * h / 900)):
        wx, wy = x + random.randint(6, max(7, w - 14)), 712 - h + random.randint(10, max(11, h - 10))
        add(f'<rect {"class=\"tw\" style=\"animation-delay:%.1fs\"" % random.uniform(0,4) if random.random()<.25 else ""} x="{wx}" y="{wy}" width="6" height="8" fill="#FFB35A" opacity=".85"/>')
add('<rect x="0" y="702" width="1600" height="20" fill="#22104A"/>')
for x in range(10, 1600, 54):
    add(f'<circle class="bulb" style="animation-delay:{random.uniform(0,2):.1f}s;color:#FFB35A" cx="{x}" cy="708" r="3.5" fill="#FFC477"/>')

# ------------------------------------------------------------ RIVIÈRE
add('<rect x="0" y="718" width="1600" height="100" fill="url(#river)"/>')
for i, w in enumerate([120, 96, 78, 60, 46, 34]):
    add(f'<rect class="sh" style="animation-delay:{i*.35:.2f}s" x="{MX-w/2}" y="{728+i*14}" width="{w}" height="6" rx="3" fill="#FFE9B8"/>')
for _ in range(34):
    x, y, w = random.randint(0, 1560), random.randint(726, 800), random.randint(30, 90)
    add(f'<rect class="sh" style="animation-delay:{random.uniform(0,3.5):.2f}s;animation-duration:{random.uniform(2.5,5):.1f}s" x="{x}" y="{y}" width="{w}" height="3" rx="1.5" fill="#FFC9A3" opacity=".6"/>')

# ------------------------------------------------------------ ARBRES (coins) + GUIRLANDE
def foliage(circles, mirror=False):
    g = []
    for (cx, cy, r) in circles:
        g.append(f'<circle cx="{cx+7}" cy="{cy+11}" r="{r}" fill="#FF8A3D" opacity=".38"/>')
    for (cx, cy, r) in circles:
        g.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#1A0D40"/>')
    for (cx, cy, r) in circles:
        g.append(f'<circle cx="{cx-14}" cy="{cy-16}" r="{r*.62:.0f}" fill="#2C1670" opacity=".85"/>')
    return "".join(g)
add('<polygon points="70,300 126,300 142,800 52,800" fill="#150A33"/>')
add('<polygon points="1476,290 1530,290 1548,800 1462,800" fill="#150A33"/>')
add(foliage([(30,70,150),(190,40,118),(90,235,118),(236,205,88),(-40,335,108)]))
add(foliage([(1570,60,150),(1410,40,118),(1515,225,118),(1372,195,88),(1640,325,108)]))
P0, P1, P2 = (130, 335), (800, 640), (1474, 328)
add(f'<path d="M{P0[0]} {P0[1]} Q{P1[0]} {P1[1]} {P2[0]} {P2[1]}" fill="none" stroke="#120830" stroke-width="3"/>')
cols = ["#FF4D5E", "#3DDC97", "#FFE08A", "#FFFFFF"]
for i in range(24):
    t = .04 + i * (.92 / 23)
    bx = (1-t)**2*P0[0] + 2*(1-t)*t*P1[0] + t*t*P2[0]
    by = (1-t)**2*P0[1] + 2*(1-t)*t*P1[1] + t*t*P2[1]
    c = cols[i % 4]
    add(f'<g class="bulb" style="animation-delay:{(i%6)*.35:.2f}s;color:{c}"><circle cx="{bx:.1f}" cy="{by+12:.1f}" r="22" fill="url(#bulbg)"/>'
        f'<ellipse cx="{bx:.1f}" cy="{by+11:.1f}" rx="6" ry="8" fill="{c}" stroke="#120830" stroke-width="2"/></g>')

# ------------------------------------------------------------ SOL
add('<path d="M0 806 Q200 772 410 796 T820 786 T1230 800 T1600 778 V1000 H0Z" fill="url(#grass)"/>')
add('<path d="M0 806 Q200 772 410 796 T820 786 T1230 800 T1600 778 V792 Q1400 806 1230 812 T820 800 T410 810 T0 820Z" fill="#EAF4FF" opacity=".92"/>')
add('<path d="M0 806 Q200 772 410 796 T820 786 T1230 800 T1600 778" fill="none" stroke="#FF9A5C" stroke-width="5" opacity=".45"/>')
for x in range(10, 1600, 38):
    y = 800 - 12 * math.sin(x / 190.0) + random.randint(-4, 6)
    h = random.randint(18, 40)
    add(f'<g class="sway" style="animation-delay:{random.uniform(0,3):.1f}s"><path d="M{x} {y} q{random.randint(-8,8)} {-h*.6:.0f} {random.randint(-10,10)} {-h}" stroke="#2F7B72" stroke-width="5" stroke-linecap="round" fill="none"/></g>')

# ------------------------------------------------------------ COUVERTURES
add(tree(215, 812, .9)); add(gift(120, 796, 52, 40, '#E23B4E', '#FFE08A')); add(gift(300, 800, 44, 34, '#3DDC97', '#fff'))
add(f'<polygon points="290,818 1310,818 1496,982 104,982" fill="#F6E8D2" stroke="{OUT}" stroke-width="8" stroke-linejoin="round"/>')
add('<polygon points="326,832 1274,832 1450,968 150,968" fill="none" stroke="#E8793A" stroke-width="5" stroke-dasharray="4 16" stroke-linecap="round"/>')
add(f'<polygon points="420,842 1180,842 1330,962 270,962" fill="url(#grid)" stroke="{OUT}" stroke-width="6" stroke-linejoin="round"/>')

# ------------------------------------------------------------ OUTILS DE DESSIN
def limb(d, w, color, shade=None):
    return (f'<path d="{d}" fill="none" stroke="{OUT}" stroke-width="{w+8}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')
def hand(x, y, skin, r=11):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{skin}" stroke="{OUT}" stroke-width="4"/>'
def eye_open(cx, cy, iris):
    return (f'<g class="blink"><ellipse cx="{cx}" cy="{cy}" rx="13" ry="17" fill="#fff"/>'
            f'<ellipse cx="{cx}" cy="{cy+2}" rx="10" ry="14" fill="{iris}"/><ellipse cx="{cx}" cy="{cy+3}" rx="5" ry="8" fill="#1B1030"/>'
            f'<circle cx="{cx-4}" cy="{cy-5}" r="4.5" fill="#fff"/><circle cx="{cx+4}" cy="{cy+8}" r="2.2" fill="#fff"/>'
            f'<path d="M{cx-14} {cy-4} Q{cx} {cy-24} {cx+14} {cy-4}" fill="none" stroke="{OUT}" stroke-width="5" stroke-linecap="round"/></g>')
def eye_happy(cx, cy):
    return f'<path d="M{cx-13} {cy+5} Q{cx} {cy-13} {cx+13} {cy+5}" fill="none" stroke="{OUT}" stroke-width="5.5" stroke-linecap="round"/>'
def eye_sleepy(cx, cy):
    return f'<path d="M{cx-12} {cy} Q{cx} {cy+10} {cx+12} {cy}" fill="none" stroke="{OUT}" stroke-width="5" stroke-linecap="round"/>'
def blush(y=20):
    return f'<ellipse cx="-36" cy="{y}" rx="11" ry="6.5" fill="#FF6F9C" opacity=".5"/><ellipse cx="36" cy="{y}" rx="11" ry="6.5" fill="#FF6F9C" opacity=".5"/>'
def mouth_laugh(y=26):
    return (f'<path d="M-19 {y} Q0 {y+36} 19 {y} Z" fill="#7E1A3A" stroke="{OUT}" stroke-width="3.5" stroke-linejoin="round"/>'
            f'<path d="M-16 {y+1} Q0 {y+8} 16 {y+1} L15 {y+6} Q0 {y+13} -15 {y+6}Z" fill="#fff"/>'
            f'<ellipse cx="0" cy="{y+21}" rx="9" ry="6" fill="#FF7F9E"/>')
def mouth_smile(y=30):
    return f'<path d="M-8 {y} Q0 {y+9} 8 {y}" fill="none" stroke="{OUT}" stroke-width="4" stroke-linecap="round"/>'
def mouth_o(y=32):
    return f'<ellipse cx="0" cy="{y}" rx="6" ry="8" fill="#7E1A3A" stroke="{OUT}" stroke-width="3"/>'
def head(skin, shade, uid):
    return (f'<clipPath id="hc{uid}"><ellipse cx="0" cy="0" rx="60" ry="56"/></clipPath>'
            f'<ellipse cx="0" cy="0" rx="60" ry="56" fill="{shade}"/>'
            f'<g clip-path="url(#hc{uid})"><ellipse cx="-7" cy="-9" rx="60" ry="56" fill="{skin}"/></g>'
            f'<ellipse cx="-60" cy="8" rx="9" ry="13" fill="{skin}" stroke="{OUT}" stroke-width="4"/><ellipse cx="60" cy="8" rx="9" ry="13" fill="{skin}" stroke="{OUT}" stroke-width="4"/>'
            f'<ellipse cx="0" cy="0" rx="60" ry="56" fill="none" stroke="{OUT}" stroke-width="4.5"/>')
def curls(color, hl, n=11, r=26, cy=-14, spread=62, rows=1):
    s = []
    for i in range(n):
        a = math.pi + i * math.pi / (n - 1)
        s.append((spread * math.cos(a), cy + 40 * math.sin(a)))
    sh = "".join(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill="{color}" stroke="{OUT}" stroke-width="4"/>' for x, y in s)
    hh = "".join(f'<circle cx="{x-6:.0f}" cy="{y-7:.0f}" r="{r*.38:.0f}" fill="{hl}" opacity=".75"/>' for x, y in s)
    return sh + hh

def torso(fill, shade, w=48):
    return (f'<path d="M-{w} 50 Q-{w+8} 120 -{w-6} 146 L{w-6} 146 Q{w+8} 120 {w} 50 Z" fill="{fill}" stroke="{OUT}" stroke-width="4.5" stroke-linejoin="round"/>'
            f'<path d="M{w-14} 52 Q{w+4} 120 {w-8} 144 L{w-6} 146 Q{w+8} 120 {w} 50Z" fill="{shade}" opacity=".55"/>')
def legs(pants, shoes):
    return (f'<ellipse cx="-40" cy="152" rx="48" ry="21" fill="{pants}" stroke="{OUT}" stroke-width="4.5"/>'
            f'<ellipse cx="40" cy="152" rx="48" ry="21" fill="{pants}" stroke="{OUT}" stroke-width="4.5"/>'
            f'<ellipse cx="-12" cy="160" rx="20" ry="11" fill="{shoes}" stroke="{OUT}" stroke-width="4"/>'
            f'<ellipse cx="12" cy="160" rx="20" ry="11" fill="{shoes}" stroke="{OUT}" stroke-width="4"/>')

# ------------------------------------------------------------ PERSONNAGE A : sweat violet, cheveux noirs, carnet
def char_a(x, y):
    skin, shade = "#F8D6BF", "#E6AE90"
    g = [f'<g transform="translate({x} {y})"><g class="bob" style="animation-delay:.2s">']
    g.append(f'<ellipse cx="0" cy="-4" rx="68" ry="64" fill="#1F1830" stroke="{OUT}" stroke-width="4"/>')
    g.append(legs("#2D3270", "#F3E8FD"))
    g.append(torso("#9460D0", "#6B3FAA"))
    g.append(f'<ellipse cx="0" cy="52" rx="50" ry="15" fill="#7B4DB8" stroke="{OUT}" stroke-width="4"/>')
    g.append(f'<path d="M-11 64 L-13 96 M12 64 L14 94" stroke="#F3E8FD" stroke-width="3.5" stroke-linecap="round"/>')
    g.append(limb("M-44 70 Q-72 108 -34 130", 24, "#9460D0")); g.append(limb("M44 70 Q72 108 34 130", 24, "#9460D0"))
    g.append(f'<g transform="rotate(-4 0 130)"><rect x="-42" y="106" width="84" height="56" rx="6" fill="#fff" stroke="{OUT}" stroke-width="4"/>'
             f'<path d="M-30 124 q12 -14 24 0 t24 0" stroke="#4AA3FF" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="26" cy="124" r="6" fill="#FFD54A"/>'
             f'<path d="M-24 144 h30" stroke="#E8478C" stroke-width="4" stroke-linecap="round"/></g>')
    g.append(hand(-34, 130, skin)); g.append(hand(34, 130, skin))
    g.append(head(skin, shade, "a"))
    g.append(eye_open(-23, 6, "#5A3A2E") + eye_open(23, 6, "#5A3A2E"))
    g.append(f'<path d="M-36 -18 Q-24 -26 -12 -20 M12 -20 Q24 -26 36 -18" fill="none" stroke="{OUT}" stroke-width="4" stroke-linecap="round"/>')
    g.append(mouth_o(33) + blush(22))
    g.append(f'<path d="M-64 -6 Q-62 -66 0 -68 Q62 -66 64 -6 Q46 -34 26 -30 Q16 -8 4 -34 Q-8 -8 -24 -32 Q-48 -30 -64 -6Z" fill="#1F1830" stroke="{OUT}" stroke-width="4" stroke-linejoin="round"/>')
    g.append('<path d="M-40 -50 Q-8 -64 26 -52" fill="none" stroke="#7A68AE" stroke-width="6" stroke-linecap="round" opacity=".85"/>')
    g.append(hat(-48))
    g.append('</g></g>')
    return "".join(g)

# ------------------------------------------------------------ PERSONNAGE B : pull rayé, lunettes, boucles, pinceau
def char_b(x, y):
    skin, shade = "#BC7E57", "#9A6140"
    g = [f'<g transform="translate({x} {y})"><g class="bob" style="animation-delay:.9s">']
    g.append(curls("#2B1B1B", "#6A4A4A", n=11, r=27, cy=-12, spread=64))
    g.append(legs("#3A2F66", "#FFB347"))
    g.append(torso("#8A49A0", "#5E2F78"))
    g.append(f'<clipPath id="tb"><path d="M-48 50 Q-56 120 -42 146 L42 146 Q56 120 48 50Z"/></clipPath><g clip-path="url(#tb)">'
             + "".join(f'<rect x="-60" y="{58+i*26}" width="120" height="12" fill="#D9B8F0" opacity=".9"/>' for i in range(4)) + '</g>')
    g.append(f'<path d="M-48 50 Q-56 120 -42 146 L42 146 Q56 120 48 50Z" fill="none" stroke="{OUT}" stroke-width="4.5"/>')
    g.append(limb("M-44 70 Q-70 108 -36 134", 24, "#8A49A0")); g.append(hand(-36, 134, skin))
    g.append('<g class="wave" style="animation-delay:.1s">' + limb("M44 70 Q78 52 84 12", 24, "#8A49A0") + hand(84, 8, skin)
             + f'<rect x="80" y="-52" width="9" height="56" rx="4" fill="#E8B26A" stroke="{OUT}" stroke-width="3"/><path d="M80 -52 L84.5 -76 L89 -52Z" fill="#FF6FA8" stroke="{OUT}" stroke-width="3" stroke-linejoin="round"/></g>')
    g.append(head(skin, shade, "b"))
    g.append(eye_happy(-24, 4) + eye_happy(24, 4))
    g.append('<circle cx="-24" cy="6" r="21" fill="#fff" opacity=".18"/><circle cx="24" cy="6" r="21" fill="#fff" opacity=".18"/>')
    g.append('<circle cx="-24" cy="6" r="21" fill="none" stroke="#E69B2E" stroke-width="4.5"/><circle cx="24" cy="6" r="21" fill="none" stroke="#E69B2E" stroke-width="4.5"/><path d="M-3 4 Q0 0 3 4" fill="none" stroke="#E69B2E" stroke-width="4"/>')
    g.append('<path d="M-40 -26 Q-26 -34 -12 -28 M12 -28 Q26 -34 40 -26" fill="none" stroke="#2B1B1B" stroke-width="5" stroke-linecap="round"/>')
    g.append(f'<g class="laugh">{mouth_laugh(26)}</g>' + blush(24))
    for cx in (-40, -16, 8, 32, 52):
        g.append(f'<circle cx="{cx}" cy="-44" r="15" fill="#2B1B1B" stroke="{OUT}" stroke-width="4"/>')
    g.append('<circle cx="-12" cy="-50" r="5" fill="#6A4A4A" opacity=".8"/><circle cx="36" cy="-50" r="5" fill="#6A4A4A" opacity=".8"/>')
    g.append(hat(-42))
    g.append('</g></g>')
    return "".join(g)

# ------------------------------------------------------------ PERSONNAGE C : locks, cardigan, palette, grand rire
def char_c(x, y):
    skin, shade = "#CC946B", "#A8734F"
    g = [f'<g transform="translate({x} {y})"><g class="bob" style="animation-delay:1.5s">']
    cols = ["#4B2C20", "#6B3F24", "#B8742F", "#4B2C20", "#8A5428"]
    for i in range(13):
        sx = -62 + i * (124 / 12); ex = sx * 1.22 + random.randint(-6, 6)
        g.append(f'<g class="sway" style="animation-delay:{(i%5)*.3:.1f}s"><path d="M{sx:.0f} -20 Q{sx*1.18:.0f} 60 {ex:.0f} {132+random.randint(0,18)}" fill="none" stroke="{OUT}" stroke-width="20" stroke-linecap="round"/>'
                 f'<path d="M{sx:.0f} -20 Q{sx*1.18:.0f} 60 {ex:.0f} {132+random.randint(0,18)}" fill="none" stroke="{cols[i%5]}" stroke-width="13" stroke-linecap="round"/></g>')
    g.append(legs("#E8C98A", "#F3E8FD"))
    g.append(torso("#6B8DB5", "#456A93"))
    g.append(f'<path d="M-18 50 L0 92 L18 50Z" fill="#FFF6EC" stroke="{OUT}" stroke-width="3.5" stroke-linejoin="round"/>')
    g.append('<path d="M-44 104 l12 -10 l12 10 l12 -10 l12 10 l12 -10 l12 10" fill="none" stroke="#C99A6A" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>')
    g.append(limb("M-44 70 Q-72 106 -38 132", 24, "#6B8DB5")); g.append(hand(-38, 132, skin))
    g.append('<g class="wave" style="animation-delay:.4s">' + limb("M44 70 Q80 54 88 14", 24, "#6B8DB5") + hand(88, 10, skin)
             + f'<g transform="rotate(-18 96 -22)"><ellipse cx="96" cy="-22" rx="46" ry="30" fill="#fff" stroke="{OUT}" stroke-width="4"/>'
             '<circle cx="76" cy="-30" r="8" fill="#E8478C"/><circle cx="94" cy="-40" r="8" fill="#FF8A3D"/><circle cx="114" cy="-32" r="8" fill="#FFD54A"/><circle cx="108" cy="-12" r="8" fill="#4AA3FF"/><circle cx="84" cy="-10" r="8" fill="#8B45D9"/>'
             f'<ellipse cx="124" cy="-18" rx="6" ry="4" fill="#F3E8FD" stroke="{OUT}" stroke-width="2"/></g></g>')
    g.append('<g class="laugh" style="animation-delay:.1s">')
    g.append(head(skin, shade, "c"))
    g.append(eye_happy(-24, 2) + eye_happy(24, 2))
    g.append('<path d="M-38 -24 Q-26 -32 -12 -26 M12 -26 Q26 -32 38 -24" fill="none" stroke="#4B2C20" stroke-width="5" stroke-linecap="round"/>')
    g.append(mouth_laugh(24) + blush(22))
    g.append(f'<circle cx="-63" cy="30" r="9" fill="none" stroke="#FFB000" stroke-width="4"/>')
    for i in range(9):
        sx = -50 + i * 12.5
        g.append(f'<path d="M{sx:.0f} -52 Q{sx+(-8 if sx<0 else 8):.0f} -34 {sx*1.12:.0f} -14" fill="none" stroke="{OUT}" stroke-width="15" stroke-linecap="round"/>'
                 f'<path d="M{sx:.0f} -52 Q{sx+(-8 if sx<0 else 8):.0f} -34 {sx*1.12:.0f} -14" fill="none" stroke="{cols[i%5]}" stroke-width="9" stroke-linecap="round"/>')
    g.append('<path d="M-42 -54 Q-6 -70 40 -54" fill="none" stroke="#C98A3D" stroke-width="6" stroke-linecap="round" opacity=".9"/>')
    g.append(hat(-54))
    g.append('</g></g></g>')
    return "".join(g)

# ------------------------------------------------------------ PERSONNAGE D : allongé, col marin, téléphone qui brille
def char_d(x, y):
    skin, shade = "#F4D2BC", "#E2AA8C"
    g = [f'<g transform="translate({x} {y})"><g class="bob" style="animation-delay:1.1s">']
    g.append(f'<rect x="-420" y="22" width="190" height="46" rx="22" fill="#1F2750" stroke="{OUT}" stroke-width="4.5"/>')
    g.append(f'<ellipse cx="-424" cy="46" rx="18" ry="24" fill="#F3E8FD" stroke="{OUT}" stroke-width="4"/>')
    g.append(f'<rect x="-262" y="10" width="210" height="64" rx="30" fill="#2F4290" stroke="{OUT}" stroke-width="4.5"/>')
    g.append(f'<path d="M-92 14 L-60 14 L-52 62 L-100 70Z" fill="#fff" stroke="{OUT}" stroke-width="3.5" stroke-linejoin="round"/><path d="M-90 26 L-58 26 M-92 38 L-56 38" stroke="#E8478C" stroke-width="3.5"/>')
    g.append(limb("M-30 70 Q-6 76 40 66", 22, "#2F4290"))
    g.append(f'<ellipse cx="86" cy="70" rx="44" ry="42" fill="url(#phoneglow)" class="glow"/>')
    g.append(f'<g transform="rotate(12 60 56)"><rect x="46" y="30" width="30" height="46" rx="6" fill="#EAF6FF" stroke="{OUT}" stroke-width="3.5"/><rect x="51" y="36" width="20" height="30" rx="3" fill="#8FD0FF"/></g>')
    g.append(hand(52, 68, skin, 10))
    g.append('<g transform="rotate(8)">')
    g.append(limb("M20 78 L20 44", 22, "#2F4290"))
    g.append(head(skin, shade, "d"))
    g.append(eye_sleepy(-23, 4) + eye_sleepy(23, 4))
    g.append('<path d="M-36 -18 Q-24 -24 -12 -19 M12 -19 Q24 -24 36 -18" fill="none" stroke="#6B4A2E" stroke-width="4" stroke-linecap="round"/>')
    g.append(mouth_smile(30) + blush(22))
    g.append(hand(12, 58, skin, 13))
    g.append(curls("#7A5434", "#C99A66", n=9, r=24, cy=-22, spread=58))
    g.append('</g></g></g>')
    return "".join(g)

# ------------------------------------------------------------ OBJETS SUR LA COUVERTURE
def items():
    s = []
    # palette de peinture
    s.append(f'<g transform="translate(965 905) rotate(-8)"><ellipse rx="74" ry="28" fill="#fff" stroke="{OUT}" stroke-width="4.5"/><ellipse cx="46" cy="4" rx="9" ry="6" fill="#F3E8FD" stroke="{OUT}" stroke-width="3"/>'
             '<circle cx="-40" cy="-6" r="10" fill="#E8478C"/><circle cx="-16" cy="-12" r="10" fill="#FF8A3D"/><circle cx="10" cy="-10" r="10" fill="#FFD54A"/><circle cx="-26" cy="12" r="10" fill="#4AA3FF"/><circle cx="2" cy="10" r="10" fill="#8B45D9"/></g>')
    # bocal d'eau + pinceaux
    s.append(f'<g transform="translate(790 932)"><path d="M-8 -52 L-14 -88 M2 -52 L8 -92 M10 -52 L26 -84" stroke="{OUT}" stroke-width="5" stroke-linecap="round"/><path d="M-8 -52 L-14 -88 M2 -52 L8 -92 M10 -52 L26 -84" stroke="#E8B26A" stroke-width="2.5" stroke-linecap="round"/>'
             f'<rect x="-26" y="-52" width="52" height="58" rx="10" fill="#BFE6FF" opacity=".8" stroke="{OUT}" stroke-width="4.5"/><rect x="-22" y="-26" width="44" height="28" rx="6" fill="#7FC3F5" opacity=".75"/></g>')
    # carnet avec dessins (dauphin, fleur, soleil)
    s.append(f'<g transform="translate(1262 918) rotate(7)"><rect x="-82" y="-54" width="164" height="108" rx="8" fill="#fff" stroke="{OUT}" stroke-width="4.5"/>'
             + "".join(f'<circle cx="{-70+i*20}" cy="-54" r="3.5" fill="{OUT}"/>' for i in range(8)) +
             '<path d="M-60 6 q22 -40 54 -14 q-10 4 -14 14 q16 -2 24 8 q-34 12 -64 -8z" fill="#4AA3FF" stroke="#1E6FC4" stroke-width="2.5" stroke-linejoin="round"/>'
             '<circle cx="42" cy="-14" r="10" fill="#FFD54A"/><g stroke="#FF9A3D" stroke-width="3" stroke-linecap="round"><path d="M42 -34v-6M42 6v6M22 -14h-6M62 -14h6"/></g>'
             '<g transform="translate(52 22)"><circle r="6" fill="#FF8FB5"/><circle cx="-8" cy="-6" r="5" fill="#FF8FB5"/><circle cx="8" cy="-6" r="5" fill="#FF8FB5"/><circle cx="-6" cy="6" r="5" fill="#FF8FB5"/><circle cx="6" cy="6" r="5" fill="#FF8FB5"/><circle r="4" fill="#FFD54A"/></g></g>')
    # tubes de peinture
    for i, c in enumerate(["#E8478C", "#FFD54A", "#4AA3FF"]):
        s.append(f'<g transform="translate({600+i*36} 946) rotate({-20+i*18})"><rect x="-8" y="-24" width="16" height="48" rx="4" fill="{c}" stroke="{OUT}" stroke-width="3.5"/><rect x="-5" y="-32" width="10" height="10" rx="2" fill="#F3E8FD" stroke="{OUT}" stroke-width="3"/></g>')
    # bouteille
    s.append(f'<g transform="translate(1385 870)"><rect x="-17" y="-60" width="34" height="86" rx="12" fill="#FFB347" stroke="{OUT}" stroke-width="4.5"/><rect x="-9" y="-80" width="18" height="22" rx="4" fill="#F3E8FD" stroke="{OUT}" stroke-width="4"/><rect x="-17" y="-26" width="34" height="22" fill="#fff" opacity=".8"/></g>')
    return "".join(s)

add(items.__call__() if False else "")
add(char_a(450, 722)); add(char_b(790, 712)); add(char_c(1140, 722))
add(items())
add(char_d(790, 896))

# ------------------------------------------------------------ TITRE : lettres dessinées à la main
LET = {
  "I": ("M0 0 L0 150", 0),
  "W": ("M0 0 L28 150 L56 44 L84 150 L112 0", 112),
  "2": ("M0 40 C0 -16 82 -16 82 40 C82 80 20 108 0 150 L88 150", 88),
  "M": ("M0 150 L0 0 L42 88 L84 0 L84 150", 84),
  "E": ("M72 0 L0 0 L0 150 L72 150 M0 75 L56 75", 72),
}
seq = "IWI2ME"; gap = 96; x = 0; parts = []
for i, ch in enumerate(seq):
    d, w = LET[ch]; parts.append((x, d, i)); x += w + gap
total = x - gap
sc, tx, ty = 1.12, 800 - (total * 1.12) / 2, 246
add(f'<g transform="translate({tx:.0f} {ty}) scale({sc})">')
for (x0, d, i) in parts:
    add(f'<g transform="translate({x0} 0)"><g class="ltr" style="animation-delay:{i*.22:.2f}s">'
        f'<path d="{d}" transform="translate(8 11)" fill="none" stroke="#FF8A3D" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{d}" fill="none" stroke="#3A1470" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{d}" fill="none" stroke="#FFFFFF" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="{d}" transform="translate(-6 -7)" fill="none" stroke="#F3E3FF" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/></g></g>')
add('</g>')
add('<path id="arc" d="M330 200 Q540 128 790 140" fill="none"/>')
add(f'<text font-family="Trebuchet MS, Verdana, sans-serif" font-weight="700" font-size="34" letter-spacing="8" fill="#fff" stroke="#3A1470" stroke-width="7" paint-order="stroke" stroke-linejoin="round"><textPath href="#arc" startOffset="2%">XMAS SESSION</textPath></text>')
add(f'<text x="150" y="92" font-family="Trebuchet MS, Verdana, sans-serif" font-weight="700" font-size="32" letter-spacing="5" fill="#fff" stroke="#2B1646" stroke-width="7" paint-order="stroke" stroke-linejoin="round">QUAI CHARLES PASQUA</text>')
add(f'<text x="1450" y="96" text-anchor="end" font-family="Trebuchet MS, Verdana, sans-serif" font-weight="700" font-size="42" letter-spacing="5" fill="#FFE2A6" stroke="#2B1646" stroke-width="7" paint-order="stroke" stroke-linejoin="round">24.12.26</text>')
for (x, y, s, d) in [(380,265,22,.3),(1235,300,18,1.2),(820,215,15,2.1),(1190,405,13,.8)]:
    add(sparkle(x, y, s, "#fff", d))

# ------------------------------------------------------------ LUCIOLES, PÉTALES, VIGNETTE
for i in range(16):
    x, y = random.randint(40, 1560), random.randint(560, 930)
    dx, dy = random.randint(-90, 90), random.randint(-110, 40)
    add(f'<g class="fly" style="--dx:{dx}px;--dy:{dy}px;animation-duration:{random.uniform(4,8):.1f}s;animation-delay:-{random.uniform(0,6):.1f}s"><circle cx="{x}" cy="{y}" r="15" fill="url(#fly)"/></g>')
for i in range(90):
    x = random.randint(-100, 1900); r = random.choice([2.2, 3, 3.8, 5, 6.5])
    add(f'<g class="petal" style="animation-duration:{random.uniform(7,16):.1f}s;animation-delay:-{random.uniform(0,16):.1f}s"><circle cx="{x}" cy="0" r="{r}" fill="#fff" opacity="{random.uniform(.55,.95):.2f}"/></g>')
add('<rect width="1600" height="1000" fill="url(#vig)"/>')
add('</svg>')

svg = "".join(o)
open("/home/claude/couple-app/img/scene-noel.svg", "w", encoding="utf-8").write(svg)
print(len(svg) // 1024, "Ko")
