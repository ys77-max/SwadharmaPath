"""PDF reports (WeasyPrint + Jinja2).

Six kinds: candidate, candidate_junior, parent, stream_choice, case_file, swadharma.
A counsellor inserts a reports row (pdf_path null, content {status: 'requested'});
this module snapshots the data into content, renders the PDF, uploads it to the
private `reports` bucket and sets pdf_path once (the reports trigger allows
exactly that). Downloads go through generate_signed_report_url (15 min).

Only case_file and swadharma reports carry Swadharma content. Every report
carries the disclaimer; the Swadharma report also opens with it on page 1.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

REPORTS_VERSION = "reports-0.1"
TEMPLATES = Path(__file__).with_name("templates")
BUCKET = "reports"
KINDS = ("candidate", "candidate_junior", "parent", "stream_choice", "case_file", "swadharma")
SWADHARMA_KINDS = {"case_file", "swadharma"}

DISCLAIMER = (
    "SwadharmaPath supports career decisions; it does not make them. Psychometric results describe tendencies at a "
    "point in time and are interpreted by a trained counsellor; they are not a measure of worth or a guarantee of "
    "success. The Swadharma (Vedic astrology) analysis is a traditional lens offered for reflection; it has no "
    "established scientific validity, is never used to rule out any career, and is shared only with your consent. "
    "Decisions remain yours and your family’s."
)
AGENCY = {"name": "SwadharmaPath", "tagline": "Career guidance with care"}

RIASEC_LABEL = {"R": "Realistic", "I": "Investigative", "A": "Artistic", "S": "Social", "E": "Enterprising", "C": "Conventional"}
RIASEC_JUNIOR = {"R": "Building & fixing", "I": "Exploring & solving", "A": "Creating & imagining",
                 "S": "Helping & teaching", "E": "Leading & persuading", "C": "Organising & checking"}
WORKSTYLE_LABEL = {"R": "Results", "A": "Affiliative", "P": "Paced", "D": "Detail"}
APTITUDE_LABEL = {"numerical": "Numerical", "verbal": "Verbal", "abstract": "Abstract", "spatial": "Spatial"}
COMPONENT_LABEL = {"d10": "D10", "kp": "KP 10th sub-lord", "ashtakavarga": "Ashtakavarga", "strength": "Planetary strength",
                   "yogas": "Yogas", "dasha": "Dasha timing", "moon_sign": "Moon sign"}

_env = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape(["html"]))
_env.filters["pct"] = lambda x: "—" if x is None else f"{round(float(x))}"
_env.filters["d"] = lambda s: "" if not s else date.fromisoformat(str(s)[:10]).strftime("%d %b %Y")


# ---------------------------------------------------------------- assembly (pure)

def _strip_swadharma(breakdown: dict | None) -> dict:
    return {k: v for k, v in (breakdown or {}).items() if k != "swadharma"}


def assemble(kind: str, data: dict[str, Any]) -> dict:
    """Builds the template context from raw rows. Candidate-facing kinds never see Swadharma
    or private session notes, whatever is passed in."""
    if kind not in KINDS:
        raise ValueError(f"unknown report kind {kind}")
    cand = data["candidate"]
    junior = cand.get("track") == "early_explorer"
    staff = kind == "case_file"
    results = data.get("results") or {}
    interest = (results.get("interest") or {}).get("derived") or {}
    aptitude = results.get("aptitude") or {}
    workstyle = (results.get("workstyle") or {}).get("derived") or {}
    values = ((results.get("values") or results.get("school_values")) or {}).get("derived") or {}
    labels = RIASEC_JUNIOR if junior or kind == "candidate_junior" else RIASEC_LABEL

    def visible(rows: list[dict]) -> list[dict]:
        return rows if staff else [r for r in rows if r.get("visible_to_candidate")]

    careers = [{**m, "breakdown": m.get("breakdown") if staff else _strip_swadharma(m.get("breakdown"))}
               for m in visible(data.get("career_matches") or []) if m.get("counsellor_action") != "hidden"]
    careers.sort(key=lambda m: (m.get("counsellor_action") != "pinned", m.get("rank") or 99))
    streams = [{**m, "breakdown": m.get("breakdown") if staff else _strip_swadharma(m.get("breakdown"))}
               for m in visible(data.get("stream_matches") or []) if m.get("counsellor_action") != "hidden"]
    streams.sort(key=lambda m: (m.get("counsellor_action") != "pinned", m.get("rank") or 99))
    sessions = [{k: v for k, v in s.items() if staff or k != "notes_private"} for s in data.get("sessions") or []]
    roadmap = data.get("roadmap")
    if roadmap and not staff and roadmap.get("status") == "draft":
        roadmap = None

    ctx: dict[str, Any] = {
        "kind": kind, "agency": AGENCY, "disclaimer": DISCLAIMER, "generated_on": data.get("today") or date.today().isoformat(),
        "version": data.get("version"), "candidate": cand, "junior": junior,
        "interest": [{"code": c, "label": labels.get(c, c), "pct": (results.get("interest") or {}).get("percentiles", {}).get(c)}
                     for c in (interest.get("order") or [])],
        "interest_code": interest.get("code"),
        "aptitude": [{"code": k, "label": APTITUDE_LABEL.get(k, k), "pct": v, "band": (aptitude.get("derived") or {}).get("bands", {}).get(k)}
                     for k, v in (aptitude.get("percentiles") or {}).items()],
        "workstyle": {"primary": workstyle.get("primary"), "secondary": workstyle.get("secondary"),
                      "primary_label": WORKSTYLE_LABEL.get(workstyle.get("primary") or "", ""),
                      "secondary_label": WORKSTYLE_LABEL.get(workstyle.get("secondary") or "", ""),
                      "table": workstyle.get("style_table")},
        "values_top5": values.get("top5") or [],
        "narrative": (data.get("profile") or {}).get("narrative") or {},
        "careers": careers[:10] if kind != "case_file" else careers,
        "streams": streams,
        "roadmap": roadmap, "roadmap_items": sorted(data.get("roadmap_items") or [], key=lambda i: i.get("due_date") or "9999"),
        "sessions": sessions,
        "counsellor": data.get("counsellor") or {},
    }
    if kind in SWADHARMA_KINDS:
        scores = sorted(data.get("swadharma_scores") or [], key=lambda s: -float(s.get("points") or 0))
        chart = data.get("swadharma_chart") or {}
        insights = chart.get("insights") or {}
        ctx["swadharma"] = {
            "families": [{"family": s["career_family"], "points": s.get("points"), "components": s.get("components") or {},
                          "confidence": s.get("confidence"), "notes": s.get("counsellor_notes") if staff else None} for s in scores],
            "windows": (scores[0].get("favourable_windows") if scores else None) or [],
            "confidence": scores[0].get("confidence") if scores else None,
            "lens": insights.get("personality_lens"),
            "agreement": insights.get("agreement") or [],
            "yogas": insights.get("yogas") or [],
            "component_labels": COMPONENT_LABEL,
            "lagna": ((chart.get("d1") or {}).get("lagna") or {}).get("sign_name"),
            "time_known": (chart.get("d1") or {}).get("time_known"),
        }
    return ctx


def render_html(kind: str, ctx: dict) -> str:
    return _env.get_template(f"{kind}.html").render(**ctx)


def render_pdf(html: str) -> bytes:
    from weasyprint import HTML  # imported lazily: needs system Pango
    return HTML(string=html, base_url=str(TEMPLATES)).write_pdf()


# ---------------------------------------------------------------- database

def _latest_results(db, candidate_id: str) -> dict[str, dict]:
    rows = db.table("assessment_results").select("raw, percentiles, derived, scored_at, instruments(code)") \
        .eq("candidate_id", candidate_id).order("scored_at", desc=True).execute().data
    latest: dict[str, dict] = {}
    for r in rows:
        latest.setdefault(r["instruments"]["code"], r)
    return latest


def load_data(db, report: dict) -> dict:
    cid = report["candidate_id"]
    cand = db.table("candidates").select("*, users!candidates_user_id_fkey(full_name)").eq("id", cid).single().execute().data
    cand["full_name"] = (cand.pop("users", None) or {}).get("full_name") or "Candidate"
    counsellor = None
    if cand.get("counsellor_id"):
        counsellor = db.table("users").select("full_name, email, phone").eq("id", cand["counsellor_id"]).single().execute().data
    roadmaps = db.table("roadmaps").select("*").eq("candidate_id", cid).order("start_date", desc=True).limit(1).execute().data
    roadmap = roadmaps[0] if roadmaps else None
    data = {
        "candidate": cand, "counsellor": counsellor, "version": report.get("version"),
        "results": _latest_results(db, cid),
        "profile": (db.table("profile_summary").select("*").eq("candidate_id", cid).maybe_single().execute() or _Empty()).data,
        "career_matches": db.table("career_matches").select("*, careers(name, family, outlook, description, typical_entry_paths)")
            .eq("candidate_id", cid).order("rank").execute().data,
        "stream_matches": db.table("stream_matches").select("*, stream_options(name, subjects, keeps_open_families, closes_families, notes)")
            .eq("candidate_id", cid).order("rank").execute().data,
        "sessions": db.table("sessions").select("*").eq("candidate_id", cid).order("scheduled_at").execute().data,
        "roadmap": roadmap,
        "roadmap_items": db.table("roadmap_items").select("*").eq("roadmap_id", roadmap["id"]).execute().data if roadmap else [],
    }
    if report["kind"] in SWADHARMA_KINDS:
        data["swadharma_scores"] = db.table("swadharma_scores").select("*").eq("candidate_id", cid).execute().data
        data["swadharma_chart"] = (db.table("swadharma_charts").select("d1, insights").eq("candidate_id", cid).maybe_single().execute() or _Empty()).data
    return data


class _Empty:
    data = None


def render_report(db, report: dict) -> str:
    ctx = assemble(report["kind"], load_data(db, report))
    pdf = render_pdf(render_html(report["kind"], ctx))
    path = f"{report['candidate_id']}/{report['kind']}-v{report['version']}-{report['id'][:8]}.pdf"
    db.storage.from_(BUCKET).upload(path, pdf, {"content-type": "application/pdf", "upsert": "false"})
    snapshot = json.loads(json.dumps(ctx, default=str))
    db.table("reports").update({
        "pdf_path": path,
        "content": {"status": "rendered", "rendered_at": datetime.now(timezone.utc).isoformat(),
                    "renderer": REPORTS_VERSION, "snapshot": snapshot},
    }).eq("id", report["id"]).is_("pdf_path", "null").execute()
    return path


def render_pending(db, limit: int = 20) -> int:
    rows = db.table("reports").select("id, candidate_id, kind, version").is_("pdf_path", "null").order("created_at").limit(limit).execute().data
    for r in rows:
        render_report(db, r)
    return len(rows)

