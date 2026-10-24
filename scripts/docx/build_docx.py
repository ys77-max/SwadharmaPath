#!/usr/bin/env python3
"""Builds the Word (.docx) versions of the Markdown docs in /docs.

    python3 scripts/docx/build_docx.py            # writes docs/word/*.docx

The Markdown files stay the source of truth. This script:
  1. renders every ```mermaid block to a PNG (render_mermaid.cjs, headless Chromium),
  2. converts each doc with pandoc using a branded reference document,
  3. post-processes the .docx: cover page, header/footer with page numbers, styled tables.

Needs: pandoc, node + playwright (Chromium) + mermaid, python-docx.
See docs/sops/technical-sops.md (SOP-T9).
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import struct
import subprocess
import sys
import tempfile

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DOCS = ROOT / "docs"
OUT = DOCS / "word"
REPO_URL = "https://github.com/ys77-max/SwadharmaPath/blob/main/"

TEAL = "0F5E5E"
TEAL_LIGHT = "E6F2F1"
SAND = "C9A26B"
SAND_LIGHT = "FBF7F1"
INK = "1F2D33"
GRID = "D5DCDC"

# (source, output name, cover subtitle, audience)
DOCS_TO_BUILD = [
    ("brd/BRD.md", "SwadharmaPath-BRD", "Business Requirements Document", "Owner, counsellors, developers"),
    ("design/HLD.md", "SwadharmaPath-HLD", "High-Level Design", "Developers, technical owner"),
    ("design/LLD.md", "SwadharmaPath-LLD", "Low-Level Design", "Developers"),
    ("user-guides/candidate.md", "SwadharmaPath-Guide-Candidate", "User guide: Candidate", "Students and professionals"),
    ("user-guides/parent.md", "SwadharmaPath-Guide-Parent", "User guide: Parent and guardian", "Parents and guardians"),
    ("user-guides/counsellor.md", "SwadharmaPath-Guide-Counsellor", "User guide: Counsellor", "Counsellors"),
    ("user-guides/admin.md", "SwadharmaPath-Guide-Admin", "User guide: Admin", "Admins"),
    ("sops/operations-sops.md", "SwadharmaPath-SOPs-Operations", "Operations SOPs", "Counsellors, admins"),
    ("sops/technical-sops.md", "SwadharmaPath-SOPs-Technical", "Technical SOPs", "Developers"),
    ("troubleshooting/troubleshooting.md", "SwadharmaPath-Troubleshooting", "Self-help troubleshooting", "Everyone"),
]

MERMAID_RE = re.compile(r"```mermaid\n(.*?)```", re.S)
LINK_RE = re.compile(r"\]\((?!https?://|#|mailto:)([^)\s]+?\.md)(#[^)]*)?\)")
MAX_W_IN, MAX_H_IN = 6.2, 8.4


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def image_md(png):
    w, h = png_size(png)
    w_in, h_in = w / 2 / 96, h / 2 / 96  # rendered at deviceScaleFactor 2
    scale = min(1.0, MAX_W_IN / w_in, MAX_H_IN / h_in)
    return f"![]({png}){{width={w_in * scale:.2f}in}}"


def render_diagrams(sources, img_dir):
    jobs, seen = [], set()
    for text in sources:
        for code in MERMAID_RE.findall(text):
            key = hashlib.sha1(code.encode()).hexdigest()[:12]
            out = img_dir / f"{key}.png"
            if key not in seen and not out.exists():
                jobs.append({"code": code, "out": str(out)})
            seen.add(key)
    if jobs:
        jobs_file = img_dir / "jobs.json"
        jobs_file.write_text(json.dumps(jobs))
        subprocess.run(["node", str(HERE / "render_mermaid.cjs"), str(jobs_file)], check=True, cwd=HERE)


def prepare_markdown(src_path, text, img_dir):
    # The cover page carries the title and the document-control table, so drop both.
    text = re.sub(r"\A# .*\n+(\|.*\|\n)*", "", text, count=1)

    def diagram(m):
        key = hashlib.sha1(m.group(1).encode()).hexdigest()[:12]
        return image_md(img_dir / f"{key}.png")

    text = MERMAID_RE.sub(diagram, text)

    # Links to other docs point at GitHub so they work from a Word file.
    def link(m):
        target = (src_path.parent / m.group(1)).resolve().relative_to(ROOT)
        return f"]({REPO_URL}{target.as_posix()}{m.group(2) or ''})"

    text = LINK_RE.sub(link, text)
    # Contents go after the introduction, just before the first section.
    first = re.search(r"^## ", text, re.M)
    cut = first.start() if first else 0
    return text[:cut] + contents_block(text) + text[cut:]


def slug(title):
    """pandoc's gfm heading identifier."""
    t = re.sub(r"[^\w\- ]", "", title.lower().strip())
    return t.replace(" ", "-")


def contents_block(text):
    """A clickable contents list (works in Word, Google Docs and LibreOffice without updating fields)."""
    lines, in_code = [], False
    for line in text.splitlines():
        if line.startswith("```"):
            in_code = not in_code
        m = None if in_code else re.match(r"^(##|###) (.+)$", line)
        if m:
            title = m.group(2).strip()
            indent = "" if m.group(1) == "##" else "    "
            label = re.sub(r"[`*]", "", title)
            lines.append(f"{indent}- [{label}](#{slug(title)})")
    if not lines:
        return ""
    return "**Contents**\n\n" + "\n".join(lines) + "\n\n"


# --------------------------------------------------------------------------- styling helpers

# Schema order of the children we add, so Word never sees out-of-order XML.
PPR_AFTER_PBDR = ("w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct",
                  "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd", "w:snapToGrid",
                  "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
                  "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId",
                  "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange")
PPR_AFTER_SHD = PPR_AFTER_PBDR[1:]
TCPR_AFTER_SHD = ("w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark",
                  "w:headers", "w:cellIns", "w:cellDel", "w:cellMerge", "w:tcPrChange")
TBLPR_AFTER_BORDERS = ("w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption", "w:tblDescription",
                       "w:tblPrChange")
TBLPR_AFTER_CELLMAR = ("w:tblLook", "w:tblCaption", "w:tblDescription", "w:tblPrChange")
TBLPR_AFTER_LAYOUT = ("w:tblCellMar",) + TBLPR_AFTER_CELLMAR
TBLPR_AFTER_W = ("w:jc", "w:tblCellSpacing", "w:tblInd", "w:tblBorders") + TBLPR_AFTER_BORDERS


def replace_child(parent, el, successors):
    for old in parent.findall(el.tag):
        parent.remove(old)
    parent.insert_element_before(el, *successors)


def shade(el, fill):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    if el.tag == qn("w:tc"):
        replace_child(el.get_or_add_tcPr(), shd, TCPR_AFTER_SHD)
    else:
        replace_child(el.get_or_add_pPr(), shd, PPR_AFTER_SHD)


def borders(el, tag, sides, color, size=4, space=0):
    pr = el.get_or_add_pPr() if tag == "w:pBdr" else el
    bdr = OxmlElement(tag)
    for side in sides:
        b = OxmlElement(f"w:{side}")
        b.set(qn("w:val"), "single")
        b.set(qn("w:sz"), str(size))
        b.set(qn("w:space"), str(space))
        b.set(qn("w:color"), color)
        bdr.append(b)
    replace_child(pr, bdr, PPR_AFTER_PBDR if tag == "w:pBdr" else TBLPR_AFTER_BORDERS)


def set_font(style, size=None, color=None, bold=None, name="Calibri"):
    style.font.name = name
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = OxmlElement("w:rFonts")
        rpr.append(fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        fonts.set(qn(attr), name)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme", "w:eastAsiaTheme"):
        fonts.attrib.pop(qn(attr), None)
    if size:
        style.font.size = Pt(size)
    if color:
        style.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        style.font.bold = bold


def make_reference_doc(path):
    """Pandoc's default reference.docx restyled with the SwadharmaPath palette."""
    subprocess.run(["pandoc", "-o", str(path), "--print-default-data-file", "reference.docx"], check=True)
    doc = Document(path)
    # python-docx maps "Heading 1" to the lower-case built-in name, which pandoc's
    # reference doc does not use, so look styles up by their exact name.
    st = {s.name: s for s in doc.styles}
    for name in ("Normal", "Body Text", "First Paragraph", "Compact"):
        if name in st:
            set_font(st[name], 10.5, INK)
            st[name].paragraph_format.space_after = Pt(6)
            st[name].paragraph_format.line_spacing = 1.15
    heads = {"Heading 1": (18, TEAL), "Heading 2": (14, TEAL), "Heading 3": (12, "8A6A3F"), "Heading 4": (11, INK)}
    for name, (size, color) in heads.items():
        s = st[name]
        set_font(s, size, color, True)
        s.font.italic = False
        s.paragraph_format.space_before = Pt(16 if name == "Heading 1" else 12)
        s.paragraph_format.space_after = Pt(6)
        s.paragraph_format.keep_with_next = True
    borders(st["Heading 1"].element, "w:pBdr", ["bottom"], SAND, size=8, space=4)
    set_font(st["Title"], 28, TEAL, True)
    bt = st["Block Text"]
    set_font(bt, 10.5, INK)
    bt.font.italic = False
    shade(bt.element, SAND_LIGHT)
    borders(bt.element, "w:pBdr", ["left"], SAND, size=24, space=8)
    bt.paragraph_format.left_indent = Cm(0.4)
    bt.paragraph_format.right_indent = Cm(0.2)
    if "Verbatim Char" in st:
        set_font(st["Verbatim Char"], 9, "0B4A4A", name="Consolas")
    if "Source Code" in st:
        set_font(st["Source Code"], 9, INK, name="Consolas")
        shade(st["Source Code"].element, "F3F5F5")
    if "Hyperlink" in st:
        st["Hyperlink"].font.color.rgb = RGBColor.from_string("1C7C7A")
    if "TOC Heading" in st:
        set_font(st["TOC Heading"], 18, TEAL, True)
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.2)
    sec.top_margin, sec.bottom_margin = Cm(2.2), Cm(2.0)
    sec.header_distance, sec.footer_distance, sec.gutter = Cm(1.0), Cm(1.0), Cm(0)
    doc.save(path)


TEXT_WIDTH_DXA = 9354  # A4 minus 2.2 cm margins


def fit_columns(table):
    """Full-width table, columns sized by content length (DXA widths on grid and cells)."""
    ncols = len(table.columns)
    lengths, longest = [0] * ncols, [0] * ncols
    for row in table.rows:
        for j, cell in enumerate(row.cells[:ncols]):
            words = cell.text.split()
            longest[j] = max([longest[j]] + [len(w) for w in words])
            lengths[j] += min(len(cell.text), 150)  # total content per column
    total = sum(lengths) or 1
    widths = [max(longest[j] * 110 + 300, int(TEXT_WIDTH_DXA * lengths[j] / total)) for j in range(ncols)]
    scale = TEXT_WIDTH_DXA / sum(widths)
    widths = [int(w * scale) for w in widths]
    widths[-1] += TEXT_WIDTH_DXA - sum(widths)
    tbl = table._tbl
    tbl_pr = tbl.tblPr
    for old in tbl_pr.findall(qn("w:tblW")) + tbl_pr.findall(qn("w:tblLayout")):
        tbl_pr.remove(old)
    tw = OxmlElement("w:tblW")
    tw.set(qn("w:w"), str(TEXT_WIDTH_DXA))
    tw.set(qn("w:type"), "dxa")
    replace_child(tbl_pr, tw, TBLPR_AFTER_W)
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    replace_child(tbl_pr, layout, TBLPR_AFTER_LAYOUT)
    grid = tbl.tblGrid
    for gc in list(grid):
        grid.remove(gc)
    for w in widths:
        gc = OxmlElement("w:gridCol")
        gc.set(qn("w:w"), str(w))
        grid.append(gc)
    for row in table.rows:
        for j, cell in enumerate(row.cells[:ncols]):
            tc_pr = cell._tc.get_or_add_tcPr()
            for old in tc_pr.findall(qn("w:tcW")):
                tc_pr.remove(old)
            tcw = OxmlElement("w:tcW")
            tcw.set(qn("w:w"), str(widths[j]))
            tcw.set(qn("w:type"), "dxa")
            tc_pr.insert(0, tcw)


def style_tables(doc):
    for table in doc.tables:
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        fit_columns(table)
        tbl_pr = table._tbl.tblPr
        borders(tbl_pr, "w:tblBorders", ["top", "left", "bottom", "right", "insideH", "insideV"], GRID)
        mar = OxmlElement("w:tblCellMar")
        for side, w in (("top", 50), ("left", 90), ("bottom", 50), ("right", 90)):
            m = OxmlElement(f"w:{side}")
            m.set(qn("w:w"), str(w))
            m.set(qn("w:type"), "dxa")
            mar.append(m)
        replace_child(tbl_pr, mar, TBLPR_AFTER_CELLMAR)
        for i, row in enumerate(table.rows):
            for cell in row.cells:
                tc = cell._tc
                if i == 0:
                    shade(tc, TEAL)
                elif i % 2 == 0:
                    shade(tc, SAND_LIGHT)
                for p in cell.paragraphs:
                    p.paragraph_format.space_after = Pt(2)
                    p.paragraph_format.space_before = Pt(2)
                    for r in p.runs:
                        code = r.style is not None and r.style.name == "Verbatim Char"
                        r.font.size = Pt(8.5 if code else 9.5)
                        if i == 0:
                            r.font.bold = True
                            r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            if i == 0:
                tr_pr = row._tr.get_or_add_trPr()
                hdr = OxmlElement("w:tblHeader")
                tr_pr.append(hdr)


def add_field(paragraph, instr):
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, instr), ("separate", None), (None, "1"), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        elif text == instr:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = instr
        else:
            el = OxmlElement("w:t")
            el.text = text
        run._r.append(el)
    return run


def header_footer(doc, subtitle):
    for sec in doc.sections:
        sec.different_first_page_header_footer = True
        hp = sec.header.paragraphs[0]
        hp.text = ""
        r = hp.add_run("SwadharmaPath  ·  " + subtitle)
        r.font.size, r.font.color.rgb = Pt(8.5), RGBColor.from_string(TEAL)
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        borders(hp._p, "w:pBdr", ["bottom"], SAND, size=4, space=2)
        fp = sec.footer.paragraphs[0]
        fp.text = ""
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = fp.add_run("Page ")
        r.font.size = Pt(8.5)
        add_field(fp, "PAGE").font.size = Pt(8.5)
        r = fp.add_run(" of ")
        r.font.size = Pt(8.5)
        add_field(fp, "NUMPAGES").font.size = Pt(8.5)


def meta_from_markdown(text):
    meta = {}
    head = "\n".join(text.splitlines()[:15])
    for m in re.finditer(r"^\|\s*(Version|Last updated|Status)\s*\|\s*(.+?)\s*\|\s*$", head, re.M):
        meta[m.group(1)] = m.group(2)
    if "Last updated" not in meta:
        m = re.search(r"Last updated (\d{4}-\d{2}-\d{2})", text)
        if m:
            meta["Last updated"] = m.group(1)
    return meta


def cover_page(doc, subtitle, audience, meta):
    body = doc.element.body
    first = body[0]
    new = []

    def para(text="", size=11, color=INK, bold=False, space_after=6, align=WD_ALIGN_PARAGRAPH.LEFT):
        p = doc.add_paragraph()
        p.alignment = align
        p.paragraph_format.space_after = Pt(space_after)
        if text:
            r = p.add_run(text)
            r.font.size, r.font.bold = Pt(size), bold
            r.font.color.rgb = RGBColor.from_string(color)
        new.append(p._p)
        return p

    for _ in range(5):
        para()
    band = doc.add_table(rows=1, cols=1)
    cell = band.rows[0].cells[0]
    shade(cell._tc, TEAL)
    cp = cell.paragraphs[0]
    cp.paragraph_format.space_before, cp.paragraph_format.space_after = Pt(18), Pt(2)
    cp.paragraph_format.left_indent = Cm(0.6)
    r = cp.add_run("SwadharmaPath")
    r.font.size, r.font.bold, r.font.color.rgb = Pt(32), True, RGBColor(0xFF, 0xFF, 0xFF)
    cp2 = cell.add_paragraph()
    cp2.paragraph_format.left_indent = Cm(0.6)
    cp2.paragraph_format.space_after = Pt(18)
    r = cp2.add_run(subtitle)
    r.font.size, r.font.color.rgb = Pt(18), RGBColor.from_string("F6EBDD")
    new.append(band._tbl)
    para()
    para("Career counselling platform: from enquiry to a tracked career roadmap", 12, TEAL, space_after=24)
    rows = [("Audience", audience)] + [(k, meta[k]) for k in ("Version", "Status", "Last updated") if k in meta]
    rows.append(("Source", "docs/ in the SwadharmaPath repository (Markdown is the master copy)"))
    for k, v in rows:
        p = para(space_after=3)
        r = p.add_run(f"{k}:  ")
        r.font.bold, r.font.size, r.font.color.rgb = True, Pt(10.5), RGBColor.from_string(TEAL)
        r = p.add_run(v)
        r.font.size = Pt(10.5)
    p = para(space_after=0)
    p.add_run().add_break(WD_BREAK.PAGE)
    for el in new:
        first.addprevious(el)


def build(src_rel, name, subtitle, audience, ref_doc, img_dir):
    src = DOCS / src_rel
    text = src.read_text()
    md = prepare_markdown(src, text, img_dir)
    out = OUT / f"{name}.docx"
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as tmp:
        tmp.write(md)
    subprocess.run([
        "pandoc", tmp.name, "-f", "gfm+attributes+implicit_figures", "-t", "docx",
        "--reference-doc", str(ref_doc), "--shift-heading-level-by=-1",
        "-o", str(out),
    ], check=True, cwd=src.parent)
    os.unlink(tmp.name)
    doc = Document(out)
    first_heading = next((p for p in doc.paragraphs if p.style.name == "Heading 1"), None)
    if first_heading is not None:
        first_heading.paragraph_format.page_break_before = True  # contents on its own page
    style_tables(doc)
    cover_page(doc, subtitle, audience, meta_from_markdown(text))
    header_footer(doc, subtitle)
    doc.core_properties.title = f"SwadharmaPath — {subtitle}"
    doc.core_properties.author = "SwadharmaPath"
    doc.save(out)
    print(f"built {out.relative_to(ROOT)}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cache = pathlib.Path(os.environ.get("DOCX_BUILD_CACHE", tempfile.gettempdir())) / "swadharmapath-docx"
    img_dir = cache / "img"
    img_dir.mkdir(parents=True, exist_ok=True)
    ref_doc = cache / "reference.docx"
    make_reference_doc(ref_doc)
    render_diagrams([(DOCS / s).read_text() for s, *_ in DOCS_TO_BUILD], img_dir)
    only = set(sys.argv[1:])
    for src, name, subtitle, audience in DOCS_TO_BUILD:
        if not only or name in only or src in only:
            build(src, name, subtitle, audience, ref_doc, img_dir)


if __name__ == "__main__":
    main()
