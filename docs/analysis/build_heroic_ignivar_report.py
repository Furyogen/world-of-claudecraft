"""Build the Heroic Ignivar's Forge parse-analysis PDF."""

import json
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.graphics.shapes import Drawing, Line, Rect, String, PolyLine, Polygon

SCRATCH = os.path.dirname(os.path.abspath(__file__))
CURVES = json.load(open(os.path.join(SCRATCH, "heroic_ignivar_curves.json")))
OUTPUT = os.path.join(SCRATCH, "heroic-ignivar-forge-parse-analysis.pdf")

# ----------------------------------------------------------------------------
# Palette
# ----------------------------------------------------------------------------
INK = colors.HexColor("#1a1614")
MUTED = colors.HexColor("#6b625c")
RULE = colors.HexColor("#d8d0c8")
PAPER = colors.HexColor("#faf7f3")
BAND = colors.HexColor("#f0e9e1")
EMBER = colors.HexColor("#c2410c")
EMBER_L = colors.HexColor("#fb923c")
STEEL = colors.HexColor("#3f6b8a")
GOOD = colors.HexColor("#2f7d4f")
BAD = colors.HexColor("#a3271c")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

# ----------------------------------------------------------------------------
# Styles
# ----------------------------------------------------------------------------
_ss = getSampleStyleSheet()


def style(name, **kw):
    base = dict(
        name=name,
        fontName="Helvetica",
        fontSize=9.5,
        leading=14,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    base.update(kw)
    return ParagraphStyle(**base)


S = {
    "title": style("title", fontName="Helvetica-Bold", fontSize=27, leading=30,
                   textColor=INK, spaceAfter=2),
    "subtitle": style("subtitle", fontSize=11.5, leading=15, textColor=MUTED),
    "h1": style("h1", fontName="Helvetica-Bold", fontSize=15, leading=18,
                textColor=INK, spaceAfter=5),
    "h2": style("h2", fontName="Helvetica-Bold", fontSize=11, leading=14,
                textColor=EMBER, spaceAfter=4),
    "body": style("body", fontSize=9.5, leading=14.5, spaceAfter=7),
    "lead": style("lead", fontSize=11, leading=16.5, spaceAfter=8),
    "small": style("small", fontSize=8.2, leading=11.5, textColor=MUTED),
    "cap": style("cap", fontSize=8, leading=11, textColor=MUTED, spaceAfter=0),
    "cell": style("cell", fontSize=8.6, leading=11.5),
    "cellb": style("cellb", fontName="Helvetica-Bold", fontSize=8.6, leading=11.5),
    "cellh": style("cellh", fontName="Helvetica-Bold", fontSize=8, leading=10.5,
                   textColor=colors.white),
    "kpin": style("kpin", fontName="Helvetica-Bold", fontSize=22, leading=24),
    "kpil": style("kpil", fontSize=7.6, leading=10, textColor=MUTED),
    "pull": style("pull", fontName="Helvetica-Bold", fontSize=11.5, leading=16,
                  textColor=INK),
}


def P(t, s="body"):
    return Paragraph(t, S[s])


def bullets(items, style_name="body"):
    """Return a table of bulleted rows so bullets align cleanly."""
    rows = [[Paragraph("&bull;", S[style_name]), Paragraph(t, S[style_name])]
            for t in items]
    t = Table(rows, colWidths=[5 * mm, None])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


# ----------------------------------------------------------------------------
# Chart helpers (pure reportlab.graphics)
# ----------------------------------------------------------------------------
def hp_chart(width, height, series, xmax, title, note=None, markers=None):
    """series: list of (label, color, [[sec, pct], ...], dashed)"""
    d = Drawing(width, height)
    pad_l, pad_r, pad_t, pad_b = 30, 8, 32, 26
    pw = width - pad_l - pad_r
    ph = height - pad_t - pad_b

    d.add(Rect(pad_l, pad_b, pw, ph, fillColor=PAPER, strokeColor=RULE,
               strokeWidth=0.5))
    d.add(String(0, height - 9.5, title, fontName="Helvetica-Bold", fontSize=8.5,
                 fillColor=INK))

    def px(s):
        return pad_l + pw * (s / xmax)

    def py(p):
        return pad_b + ph * (p / 100.0)

    # gridlines
    for pct in (0, 25, 50, 75, 100):
        y = py(pct)
        d.add(Line(pad_l, y, pad_l + pw, y,
                   strokeColor=colors.HexColor("#8a7f76") if pct == 50 else RULE,
                   strokeWidth=0.9 if pct == 50 else 0.4,
                   strokeDashArray=[2, 2] if pct == 50 else None))
        d.add(String(pad_l - 5, y - 2.6, "%d%%" % pct, fontSize=6.6,
                     fillColor=MUTED, textAnchor="end"))

    step = 30 if xmax <= 200 else 60
    t = 0
    while t <= xmax:
        x = px(t)
        d.add(Line(x, pad_b, x, pad_b + ph, strokeColor=RULE, strokeWidth=0.3))
        d.add(String(x, pad_b - 9, "%ds" % t, fontSize=6.6, fillColor=MUTED,
                     textAnchor="middle"))
        t += step

    # event markers
    for m in (markers or []):
        sec, label, col = m
        x = px(sec)
        d.add(Line(x, pad_b, x, pad_b + ph, strokeColor=col, strokeWidth=0.8,
                   strokeDashArray=[3, 2]))
        d.add(String(x + 2.5, pad_b + ph - 8, label, fontSize=6.4, fillColor=col))

    for label, col, pts, dashed in series:
        flat = []
        for sec, pct in pts:
            if sec > xmax:
                break
            flat.extend([px(sec), py(pct)])
        if len(flat) >= 4:
            d.add(PolyLine(flat, strokeColor=col, strokeWidth=1.6,
                           strokeDashArray=[3, 2] if dashed else None,
                           strokeLineJoin=1))

    # legend
    lx = pad_l + 3
    ly = pad_b + ph + 7
    for label, col, pts, dashed in series:
        d.add(Line(lx, ly + 2.5, lx + 11, ly + 2.5, strokeColor=col,
                   strokeWidth=1.8, strokeDashArray=[3, 2] if dashed else None))
        d.add(String(lx + 14, ly, label, fontSize=7, fillColor=INK))
        lx += 14 + len(label) * 3.7 + 16

    if note:
        d.add(String(pad_l, 2, note, fontSize=6.6, fillColor=MUTED))
    return d


def leak_chart(width, height, rows):
    """rows: [(fight_label, leak_pct)] in chronological order."""
    d = Drawing(width, height)
    pad_l, pad_r, pad_t, pad_b = 30, 8, 18, 30
    pw = width - pad_l - pad_r
    ph = height - pad_t - pad_b
    d.add(Rect(pad_l, pad_b, pw, ph, fillColor=PAPER, strokeColor=RULE,
               strokeWidth=0.5))
    d.add(String(0, height - 10, "Health handed back to Varkhul, attempt by attempt "
                 "(23 heroic pulls, chronological)",
                 fontName="Helvetica-Bold", fontSize=8.5, fillColor=INK))

    ytop = 56.0
    for pct in (0, 25, 50):
        y = pad_b + ph * (pct / ytop)
        d.add(Line(pad_l, y, pad_l + pw, y, strokeColor=RULE, strokeWidth=0.4))
        d.add(String(pad_l - 5, y - 2.6, "%d%%" % pct, fontSize=6.6,
                     fillColor=MUTED, textAnchor="end"))

    n = len(rows)
    slot = pw / n
    bw = slot * 0.62
    for i, (lab, leak) in enumerate(rows):
        x = pad_l + slot * i + (slot - bw) / 2
        h = ph * (leak / ytop)
        col = BAD if leak >= 45 else (EMBER_L if leak >= 20 else GOOD)
        d.add(Rect(x, pad_b, bw, max(h, 0.6), fillColor=col, strokeColor=None))
        d.add(String(x + bw / 2, pad_b - 9, lab, fontSize=5.4, fillColor=MUTED,
                     textAnchor="middle"))
    d.add(String(pad_l, 3,
                 "Green: some health leaked back.  Orange: most of it.  "
                 "Red: the boss returned to full. Bar height caps at 50 percent, "
                 "which is a complete reset.",
                 fontSize=6.4, fillColor=MUTED))
    return d


def damage_split_chart(width):
    segs = [("Varkhul, who healed every point of it back", 100000, STEEL),
            ("Ember Sentinels and Crucible Wardens", 51767,
             colors.HexColor("#9a8f86")),
            ("Cinder Artificers, the only targets that mattered", 2676, BAD)]
    total = sum(s[1] for s in segs)
    bar_h = 21
    title_h = 13
    legend_h = 11 * len(segs)
    note_h = 11
    height = title_h + bar_h + 7 + legend_h + note_h
    d = Drawing(width, height)

    y = height - title_h + 2
    d.add(String(0, y, "Where the raid's 154,443 damage went on the final pull",
                 fontName="Helvetica-Bold", fontSize=8.5, fillColor=INK))

    bar_y = height - title_h - bar_h
    x = 0
    for label, val, col in segs:
        w = width * val / total
        d.add(Rect(x, bar_y, w, bar_h, fillColor=col, strokeColor=colors.white,
                   strokeWidth=0.8))
        if w > 42:
            d.add(String(x + w / 2, bar_y + 7, "%.1f%%" % (100 * val / total),
                         fontSize=8.5, fillColor=colors.white, textAnchor="middle",
                         fontName="Helvetica-Bold"))
        x += w

    ly = bar_y - 14
    for label, val, col in segs:
        d.add(Rect(0, ly - 1, 7, 7, fillColor=col, strokeColor=None))
        d.add(String(11, ly, "%s   %s damage  (%.1f%%)"
                     % (label, "{:,}".format(val), 100 * val / total),
                     fontSize=7.4, fillColor=INK))
        ly -= 11
    d.add(String(0, ly - 1,
                 "All three Artificers survived. They out-healed the raid on "
                 "1.7 percent of its attention.",
                 fontSize=6.8, fillColor=MUTED))
    return d


# ----------------------------------------------------------------------------
# Table helper
# ----------------------------------------------------------------------------
def make_table(header, rows, widths, aligns=None, highlight=None):
    data = [[Paragraph(h, S["cellh"]) for h in header]]
    for r in rows:
        data.append([c if isinstance(c, Paragraph) else Paragraph(str(c), S["cell"])
                     for c in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 1), (-1, -2), 0.35, RULE),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), PAPER))
    for col, al in (aligns or {}).items():
        cmds.append(("ALIGN", (col, 0), (col, -1), al))
    for row, col in (highlight or []):
        cmds.append(("BACKGROUND", (col, row), (col, row),
                     colors.HexColor("#fde7e3")))
    t.setStyle(TableStyle(cmds))
    return t


def kpi_row(items, width):
    cells = []
    for num, lab, col in items:
        inner = Table([[Paragraph('<font color="%s">%s</font>' % (col.hexval(), num),
                                  S["kpin"])],
                       [Paragraph(lab, S["kpil"])]],
                      colWidths=[width / len(items) - 4 * mm])
        inner.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (0, 0), 1),
        ]))
        cells.append(inner)
    t = Table([cells], colWidths=[width / len(items)] * len(items))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEABOVE", (0, 0), (-1, 0), 0.8, RULE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, RULE),
    ]))
    return t


def callout(title, body_html, accent=EMBER):
    head = ParagraphStyle("co_h", parent=S["h2"], textColor=accent)
    inner = Table([[Paragraph(title, head)], [Paragraph(body_html, S["body"])]],
                  colWidths=[PAGE_W - 2 * MARGIN - 12 * mm])
    inner.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 2),
        ("BOTTOMPADDING", (0, 1), (0, 1), 0),
    ]))
    t = Table([[inner]], colWidths=[PAGE_W - 2 * MARGIN])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BAND),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 8 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


# ----------------------------------------------------------------------------
# Page furniture
# ----------------------------------------------------------------------------
COVER_BAND = 74 * mm


def decorate(canvas, doc, cover=False):
    canvas.saveState()
    if cover:
        top = PAGE_H - COVER_BAND
        canvas.setFillColor(INK)
        canvas.rect(0, top, PAGE_W, COVER_BAND, stroke=0, fill=1)
        canvas.setFillColor(EMBER)
        canvas.rect(0, top, PAGE_W, 2.2 * mm, stroke=0, fill=1)

        canvas.setFillColor(EMBER_L)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(MARGIN, PAGE_H - 20 * mm,
                          "R A I D   P A R S E   A N A L Y S I S")

        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 26)
        canvas.drawString(MARGIN, PAGE_H - 34 * mm, "What is happening in")
        canvas.drawString(MARGIN, PAGE_H - 45 * mm, "Heroic Ignivar's Forge")

        canvas.setFillColor(colors.HexColor("#b9aea6"))
        canvas.setFont("Helvetica", 10.5)
        canvas.drawString(MARGIN, PAGE_H - 56 * mm,
                          "Every recorded heroic pull on Claudemoon, and the one "
                          "mechanic that is ending the night")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#8b807a"))
        canvas.drawString(MARGIN, PAGE_H - 65 * mm,
                          "Realm Claudemoon   |   build 0.41.1   |   "
                          "1 September 2026   |   source: Parses, environment prod")
    else:
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, PAGE_H - 13 * mm, PAGE_W - MARGIN, PAGE_H - 13 * mm)
        canvas.setFont("Helvetica", 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, PAGE_H - 11.2 * mm,
                          "Heroic Ignivar's Forge   |   parse analysis")
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 11.2 * mm,
                               "Claudemoon   |   build 0.41.1   |   1 September 2026")
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(PAGE_W / 2, 10 * mm, str(doc.page))
    canvas.restoreState()


class Doc(BaseDocTemplate):
    def __init__(self, path):
        BaseDocTemplate.__init__(self, path, pagesize=A4,
                                 leftMargin=MARGIN, rightMargin=MARGIN,
                                 topMargin=MARGIN, bottomMargin=MARGIN,
                                 title="Heroic Ignivar's Forge Parse Analysis",
                                 author="World of ClaudeCraft parse review")
        fw = PAGE_W - 2 * MARGIN
        cover_frame = Frame(MARGIN, MARGIN, fw,
                            PAGE_H - MARGIN - COVER_BAND - 12 * mm,
                            id="cover", leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0)
        body_frame = Frame(MARGIN, MARGIN, fw, PAGE_H - 2 * MARGIN - 6 * mm,
                           id="body", leftPadding=0, rightPadding=0,
                           topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[cover_frame],
                         onPage=lambda c, d: decorate(c, d, cover=True)),
            PageTemplate(id="body", frames=[body_frame],
                         onPage=lambda c, d: decorate(c, d, cover=False)),
        ])


# ----------------------------------------------------------------------------
# Content
# ----------------------------------------------------------------------------
FW = PAGE_W - 2 * MARGIN
story = []

# ============================ COVER =========================================
story.append(Spacer(1, 1 * mm))
story.append(P(
    "The raid is not short on damage, and it is not dying to anything it cannot heal. "
    "It is losing to a single unpressured cast. Varkhul, Forgefather of the Last Flame, "
    "seals himself at 50 percent health and summons an Assembly. Three Cinder Artificers "
    "inside that Assembly channel a six second cast that heals him for 3 percent each "
    "time it lands. On every pull inspected the raid interrupted that cast zero times "
    "and killed zero Artificers. Varkhul has never been pushed below 50.0 percent, and "
    "in the last ten attempts he was back at full health before the raid died.",
    "lead"))

story.append(Spacer(1, 3 * mm))
story.append(kpi_row([
    ("23", "HEROIC PULLS ON VARKHUL", INK),
    ("0", "KILLS", BAD),
    ("50.0%", "BEST HEALTH REACHED, EVERY PULL", EMBER),
    ("0", "INTERRUPTS ON ANY PULL INSPECTED", BAD),
], FW))
story.append(Spacer(1, 6 * mm))

story.append(P("The night, encounter by encounter", "h1"))
story.append(Spacer(1, 1 * mm))
story.append(make_table(
    ["Time (UTC)", "Encounter", "Type", "Result", "Reading"],
    [
        ["12:15", Paragraph("Forge Approach", S["cellb"]), "Trash", "1 clear",
         "Walked through. No obstacle."],
        ["12:53 to 13:50", Paragraph("Ignivar, Herald of the Last Flame", S["cellb"]),
         "Boss", Paragraph('<font color="%s"><b>1 kill, 19 wipes</b></font>'
                           % GOOD.hexval(), S["cell"]),
         "A damage race. Solved, narrowly, on the twentieth try."],
        ["13:56", Paragraph("Molten Assembly", S["cellb"]), "Trash", "2 clears",
         "Walked through. No obstacle."],
        ["14:03 to 16:24", Paragraph("Varkhul, Forgefather of the Last Flame", S["cellb"]),
         "Boss", Paragraph('<font color="%s"><b>0 kills, 23 wipes</b></font>'
                           % BAD.hexval(), S["cell"]),
         "The wall. Two hours and twenty minutes, no progress past 50 percent."],
    ],
    [24 * mm, 46 * mm, 14 * mm, 24 * mm, None],
))
story.append(Spacer(1, 4 * mm))
story.append(P(
    "Sources: the Parses service, environment prod, realm Claudemoon, game build 0.41.1. "
    "Every figure in this report comes from recorded fight data. Timings are converted "
    "from game ticks at 20 ticks per second.", "small"))

# ============================ PAGE 2 ========================================
story.append(NextPageTemplate("body"))
story.append(PageBreak())

story.append(P("The wall: Varkhul and the Master's Assembly", "h1"))
story.append(P(
    "Varkhul has 200,000 health on heroic. The raid burns him down at a steady, "
    "healthy pace and reaches 50 percent in roughly 90 seconds. That part is fine. "
    "Everything that decides the pull happens afterwards.",
    "body"))

story.append(P("At exactly 100,000 health, three things happen at once:", "body"))
story.append(bullets([
    "Varkhul stops taking damage. In all 23 attempts his health never moved below "
    "100,000, not by a single point.",
    "He gains a buff the log names <b>The Master's Assembly</b>, applied once and "
    "never removed for the rest of the pull.",
    "Waves of adds spawn: Ember Sentinels, Crucible Wardens, and, critically, "
    "<b>Cinder Artificers</b>.",
]))
story.append(Spacer(1, 3 * mm))

story.append(callout(
    "The mechanic the raid is missing",
    "Cinder Artificers channel <b>Cinder Recalibrate</b>, a six second cast. Every "
    "time it completes, Varkhul heals for 6,000 health, which is 3 percent of his "
    "maximum. Three Artificers channel it on a loop with about a two second gap "
    "between casts. Left alone, they restore the entire 50 percent in around forty "
    "seconds. A six second cast is one of the longest and most interruptible casts "
    "in the encounter, and the raid never once contested it.", BAD))
story.append(Spacer(1, 5 * mm))

story.append(hp_chart(
    FW, 62 * mm,
    [("Heroic, final attempt (wipe)", BAD, CURVES["heroic_66500"], False),
     ("Normal, a clean kill", GOOD, CURVES["normal_67212"], False)],
    175,
    "Varkhul's health through a pull: the heroic wipe against a normal-mode kill",
    note="Heroic pull 66500 (169s, wipe) and normal pull 67212 (164s, kill). "
         "Both shown as a percentage of the boss's own maximum health.",
    markers=[(96, "50% seal", MUTED)],
))
story.append(Spacer(1, 4 * mm))

story.append(P(
    "The two curves are the whole story. Both raids reach the seal at 50 percent and "
    "both enter the Assembly. The normal-mode group kills all three Artificers within "
    "60 seconds, so only four Recalibrate casts land and the boss creeps up to 58 "
    "percent before the phase releases and he dies. The heroic group kills none, "
    "seventeen casts land, and Varkhul is restored to 200,000 health with the raid "
    "still standing in the room.", "body"))

story.append(Spacer(1, 2 * mm))
story.append(make_table(
    ["", "Normal (kill)", "Heroic (wipe)"],
    [
        [Paragraph("Boss maximum health", S["cellb"]), "120,000", "200,000"],
        [Paragraph("Heal per Cinder Recalibrate", S["cellb"]), "2,400  (2%)",
         Paragraph('<b>6,000  (3%)</b>', S["cell"])],
        [Paragraph("Casts that landed", S["cellb"]), "4",
         Paragraph('<b>17</b>', S["cell"])],
        [Paragraph("Health handed back", S["cellb"]),
         Paragraph('<font color="%s">+9,600  (8%%)</font>' % GOOD.hexval(), S["cell"]),
         Paragraph('<font color="%s"><b>+100,000  (50%%)</b></font>' % BAD.hexval(),
                   S["cell"])],
        [Paragraph("Cinder Artificers killed", S["cellb"]),
         Paragraph('<font color="%s">3 of 3</font>' % GOOD.hexval(), S["cell"]),
         Paragraph('<font color="%s"><b>0 of 3</b></font>' % BAD.hexval(), S["cell"])],
        [Paragraph("Outcome", S["cellb"]),
         Paragraph('<font color="%s">Boss dead at 164s</font>' % GOOD.hexval(), S["cell"]),
         Paragraph('<font color="%s">Raid dead at 169s</font>' % BAD.hexval(), S["cell"])],
    ],
    [58 * mm, None, None],
    aligns={1: "CENTER", 2: "CENTER"},
))

# ============================ PAGE 3 ========================================
story.append(PageBreak())
story.append(P("The evidence, from the final pull", "h1"))
story.append(P(
    "Attempt 23 is the cleanest example because the raid survived longest in the "
    "Assembly. It ran 169 seconds and ended with all ten players dead and the boss "
    "at full health.", "body"))

story.append(Spacer(1, 1 * mm))
story.append(damage_split_chart(FW))
story.append(Spacer(1, 5 * mm))

story.append(P(
    "Roughly 100,000 of that damage went into a boss who gave every point of it back. "
    "Another 51,767 went into Ember Sentinels and Crucible Wardens, the adds that do "
    "not matter, and eleven of them died. The three Cinder Artificers, the only "
    "targets whose deaths would have ended the healing, absorbed <b>2,676 damage "
    "between them and all three survived</b>. For scale, an Ember Sentinel in this "
    "pull died after about 3,400 damage and a Crucible Warden after about 4,100. The "
    "busiest Artificer took 1,453, so it was somewhere near halfway dead. The other "
    "two were barely scratched. These were not tough targets. They were untouched "
    "ones.", "body"))

story.append(P("The cast log", "h2"))
story.append(P(
    "From the moment the Assembly formed to the moment the last player died, the "
    "Artificers cast Cinder Recalibrate continuously. Fourteen casts completed. One "
    "shows as interrupted, and that interruption is the fight ending, not a player "
    "acting. No participant in the pull recorded a single interrupt or a single "
    "dispel.", "body"))

story.append(callout(
    "The raid was not short of interrupts",
    "The ten players on that pull were two rogues, five warriors, one fire mage and "
    "two holy priests. Three of the warriors were talented into Storm Bolt. Between "
    "the rogues, the warriors and the mage there were roughly eight interrupt "
    "effects available against a six second cast repeating on a loop for over a "
    "minute. The recorded count for the pull is zero.", EMBER))

story.append(Spacer(1, 3 * mm))
death_block = [P("How the raid actually died", "h2"), P(
    "The wipe itself is quick and it comes at the end. For 146 of the 169 seconds "
    "nobody was in danger. Then, in 27 seconds:", "body"), make_table(
    ["Time", "Who", "Killed by", "Note"],
    [
        ["141.1s", "Kokolina, holy priest", "Crucible Beam",
         "The first player death of the pull is a healer."],
        ["153.1s", "SirChargeALot, fury warrior", "Crucible Beam", ""],
        ["163.1s", "Grohnk, fury warrior", "Crucible Beam", ""],
        ["166.1s", "Gnotib, fury warrior", "Forge Meltdown", "1,577 damage in one hit."],
        ["168.1s", Paragraph("Priestdim, Veso and Hellscream", S["cell"]),
         "Forge Meltdown",
         Paragraph("<b>Three players in the same instant.</b>", S["cell"])],
        ["168.2s", "HanzoKal and Sir Backstab, rogues", "Add melee",
         "Finished off by the adds nobody could hold any more."],
    ],
    [16 * mm, 44 * mm, 30 * mm, None],
)]
story.append(KeepTogether(death_block))
story.append(Spacer(1, 3 * mm))
story.append(P(
    "This ordering matters. Losing the healer first, then four players to one "
    "Forge Meltdown, reads like a healing failure, and a raid reviewing the death "
    "log alone would reasonably go looking for more healing. It is not a healing "
    "failure. By that point the raid had spent more than a minute fighting a boss "
    "at full health with an add pack that keeps growing, and no amount of throughput "
    "changes that arithmetic. The two priests were already overhealing 58 percent of "
    "everything they cast.", "body"))

# ============================ PAGE 4 ========================================
story.append(PageBreak())
story.append(P("Twenty-three attempts, and the trend is backwards", "h1"))
story.append(P(
    "The natural read on a progression night is that wipes get better. Here they get "
    "worse, and the reason is instructive. Because nobody is stopping the healing, "
    "surviving longer in the Assembly simply means the boss recovers more. Improving "
    "at staying alive actively made the results look worse.", "body"))

story.append(Spacer(1, 3 * mm))
leak_rows = [
    ("1", 12.0), ("2", 0.0), ("3", 18.0), ("4", 30.0), ("5", 3.0), ("6", 27.0),
    ("7", 30.0), ("8", 33.0), ("9", 50.0), ("10", 50.0), ("11", 50.0), ("12", 50.0),
    ("13", 50.0), ("14", 50.0), ("15", 50.0), ("16", 3.0), ("17", 45.0), ("18", 50.0),
    ("19", 50.0), ("20", 50.0), ("21", 50.0), ("22", 50.0), ("23", 50.0),
]
story.append(leak_chart(FW, 52 * mm, leak_rows))
story.append(Spacer(1, 4 * mm))

story.append(P(
    "Attempts 2 and 16 leaked almost nothing, but not because they were played well. "
    "Those pulls ended early, so the Assembly barely had time to channel. From "
    "attempt 9 onward the pattern is fixed: the raid reaches the seal at around 90 "
    "seconds, holds for another 50 to 70 seconds, and hands back the full 50 percent "
    "in the process.", "body"))

story.append(Spacer(1, 2 * mm))
story.append(make_table(
    ["Measure", "Across all 23 heroic attempts"],
    [
        [Paragraph("Lowest health Varkhul ever reached", S["cellb"]),
         Paragraph('<b>Exactly 50.0 percent, in every single attempt. '
                   'The value is 100,000 of 200,000 to the point.</b>', S["cell"])],
        [Paragraph("Time to reach the seal", S["cellb"]),
         "Between 72.8 and 100.5 seconds. Consistent and comfortable."],
        [Paragraph("Attempt length", S["cellb"]),
         "110.5 to 169.2 seconds. Trending longer as the night went on."],
        [Paragraph("Attempts ending with the boss at full health", S["cellb"]),
         Paragraph('<b>14 of 23, including 8 of the last 9.</b>', S["cell"])],
        [Paragraph("Interrupts and dispels", S["cellb"]),
         "Zero on attempts 1, 12 and 23, across all 30 participant rows."],
    ],
    [62 * mm, None],
))
story.append(Spacer(1, 5 * mm))

story.append(callout(
    "What this means in practice",
    "The raid has never seen the second half of this encounter. Everything past 50 "
    "percent, including whatever Varkhul does when the Assembly is actually broken, "
    "is unexplored. This is not a tuning problem or a gear problem, and more damage "
    "on the boss will not help: it all gets refunded. It is one target-priority call "
    "and one interrupt rotation.", GOOD))

# ============================ PAGE 5 ========================================
story.append(PageBreak())
story.append(P("Ignivar, for contrast: a fight the raid solved", "h1"))
story.append(P(
    "Before hitting the Varkhul wall the raid spent an hour on Ignivar, Herald of the "
    "Last Flame, and killed him on the twentieth attempt. Worth reading, because it "
    "shows the group is capable and confirms that Varkhul is a knowledge problem "
    "rather than a capability one.", "body"))

story.append(Spacer(1, 3 * mm))
story.append(hp_chart(
    FW, 58 * mm,
    [("The kill, attempt 20", GOOD, CURVES["arena_kill_66110"], False),
     ("The best wipe, attempt 16", BAD, CURVES["arena_wipe_66066"], True)],
    250,
    "Ignivar: a clean damage race with no reset and no seal",
    note="Kill 66110 (199s) and wipe 66066 (243s). Ignivar has 210,000 health on "
         "heroic. Note the absence of any upward step in either line.",
))
story.append(Spacer(1, 4 * mm))

story.append(P(
    "Ignivar's health only ever goes down. There is no seal, no add phase and no "
    "healing to contest, so the encounter is an endurance check against a rising "
    "damage profile. Both lines descend steadily. The kill simply descended faster "
    "and finished in 199 seconds with the boss on 311 health, which is 0.15 percent. "
    "It was close.", "body"))

story.append(P(
    "The wipe took the boss to 11.7 percent over 243 seconds and then met two "
    "abilities that never appear in the kill at all: <b>Chains of the Forge</b> and "
    "<b>Last Inferno</b>. These land for between 129,960 and 275,951 damage against "
    "players who have roughly 3,400 maximum health. They are not survivable and they "
    "are not meant to be. Ignivar's ordinary kit, the Searing Torrent and Forge "
    "Strike on the tanks, the Brand of the Pyre stacking burn, Falling Cinders, "
    "Revolving Inferno and Cleansing Backlash on the raid, is all healable. The fight "
    "is a clock, and the raid beat it with about 44 seconds to spare.", "body"))

story.append(Spacer(1, 2 * mm))
story.append(P("What was different on the kill", "h2"))
story.append(make_table(
    ["", "The 19 wipes (sample)", "The kill"],
    [
        [Paragraph("Time to kill", S["cellb"]), "Best reached 11.7% at 243s",
         Paragraph('<b>Boss dead at 199s</b>', S["cell"])],
        [Paragraph("Top damage dealer", S["cellb"]), "Fire mage or fury warrior",
         "Balance druid, 39,049 damage"],
        [Paragraph("Composition", S["cellb"]),
         "Melee-heavy",
         Paragraph("Balance druid and holy paladin present", S["cell"])],
        [Paragraph("Ending", S["cellb"]),
         Paragraph('<font color="%s">Chains of the Forge, then Last Inferno</font>'
                   % BAD.hexval(), S["cell"]),
         Paragraph('<font color="%s">Neither ability ever fired</font>'
                   % GOOD.hexval(), S["cell"])],
    ],
    [34 * mm, None, None],
))
story.append(Spacer(1, 4 * mm))

story.append(P(
    "The comparison points somewhere useful, and it also flags a drift worth "
    "noticing. The Ignivar kill group brought a balance druid and a holy paladin, and "
    "both were still there for the first Varkhul attempt. By attempt 12 they were "
    "gone, replaced by more warriors and a second holy priest, and the roster stayed "
    "that way through attempt 23: five warriors, two rogues, one mage and two "
    "priests, with no druid, paladin, shaman, hunter or warlock. The raid shed its "
    "ranged damage over the course of the night, which is the wrong direction for an "
    "add phase spread across a room. It is a contributing factor. It is not the "
    "cause. The cause is that nobody attacked the Cinder Artificers.", "body"))

# ============================ PAGE 6 ========================================
story.append(PageBreak())
story.append(P("What to change, in order", "h1"))
story.append(P(
    "Nothing below asks the raid to play better in the abstract. Every item is a "
    "target-priority or interrupt decision that can be made before the next pull.",
    "body"))
story.append(Spacer(1, 1 * mm))
story.append(bullets([
    "<b>Assign the Artificers before the pull.</b> When Varkhul seals at 50 percent, "
    "every damage dealer swaps to Cinder Artificers and nothing else. On normal, "
    "killing all three ends the problem and the phase releases shortly after.",
    "<b>Set an interrupt rotation on Cinder Recalibrate.</b> Six seconds is a long "
    "cast. Two rogues and three Storm Bolt warriors can cover it indefinitely. Every "
    "interrupt is 6,000 health the raid does not have to deal twice.",
    "<b>Stop tunnelling the boss during the seal.</b> Roughly 100,000 damage went "
    "into a target that could not be hurt and was healing anyway. That is the single "
    "largest pool of wasted effort on the night.",
    "<b>Leave the Sentinels and Wardens to the tanks.</b> Eleven died to raid damage "
    "that should have gone elsewhere. They are a threat problem, not a damage one.",
    "<b>Do not add healing.</b> The two priests already overhealed 75,501 against "
    "55,414 effective. The deaths at the end follow from the phase never ending.",
    "<b>Bring the ranged damage back.</b> The balance druid and holy paladin who were "
    "there for the Ignivar kill and the first Varkhul attempt were gone by attempt 12 "
    "and never returned. Ranged damage is worth more, not less, against a spread "
    "add phase.",
]))

story.append(Spacer(1, 5 * mm))
story.append(callout(
    "The one-line summary",
    "Heroic Ignivar's Forge is not beating this raid on damage, healing or survival. "
    "Varkhul seals at 50 percent and three Cinder Artificers heal him back to full "
    "with a six second cast that has never been interrupted and on targets that have "
    "never been killed. Kill the Artificers and the raid will see content it has not "
    "seen yet.", GOOD))

story.append(Spacer(1, 7 * mm))
story.append(P(
    "Method note. Every number is drawn from recorded fight data on the Parses "
    "service for realm Claudemoon, environment prod, game build 0.41.1, all on "
    "1 September 2026. Boss health curves come from sampled resource tracks. Boss "
    "health floors were checked on all 23 heroic Varkhul attempts. Ability "
    "breakdowns, cast timelines, aura uptimes and death recaps were read in full for "
    "heroic attempt 66500, heroic Ignivar kill 66110 and wipe 66066, and normal-mode "
    "Varkhul kill 67212. Interrupt counts, dispel counts and rosters are the "
    "per-participant totals the service records, inspected on heroic Varkhul pulls "
    "66146, 66313 and 66500, which are attempts 1, 12 and 23, and on Ignivar kill "
    "66110. All 40 participant rows across those four pulls show zero interrupts and "
    "zero dispels. The remaining 20 Varkhul pulls were checked for boss health only. "
    "This raid does not exist in the checked-out source tree, which is at build "
    "0.35.1, so mechanics here are inferred from combat logs rather than read from "
    "encounter scripts.",
    "small"))

Doc(OUTPUT).build(story)
print("wrote", OUTPUT, os.path.getsize(OUTPUT), "bytes")
