import json

import pytest

import reports as R

DISCLAIMER = R.DISCLAIMER


def data(track="student"):
    return {
        "today": "2026-10-24", "version": 2,
        "candidate": {"id": "c1", "full_name": "Ananya Rao", "track": track, "class_or_years_exp": "Class 9", "city": "Pune", "status": "active"},
        "counsellor": {"full_name": "Meera Iyer", "email": "meera@example.org"},
        "results": {
            "interest": {"percentiles": {"I": 88, "A": 70, "S": 40}, "derived": {"order": ["I", "A", "S"], "code": "IAS"}},
            "aptitude": {"percentiles": {"numerical": 81, "verbal": 64}, "derived": {"bands": {"numerical": "High", "verbal": "Average"}}},
            "workstyle": {"derived": {"primary": "D", "secondary": "R", "style_table": {"strengths": "Careful and thorough.", "approach": "Plans first."}}},
            "values": {"derived": {"top5": ["Learning", "Creativity", "Security", "Independence", "Achievement"]}},
        },
        "profile": {"narrative": {"summary": "Curious and methodical.", "strengths": ["Analysis"], "watch_outs": ["Over-checking"]}},
        "career_matches": [
            {"id": "m1", "rank": 1, "fit_score": 82.4, "visible_to_candidate": True, "counsellor_action": None,
             "breakdown": {"interest": 30, "aptitude": 20, "workstyle": 12, "values": 6, "outlook": 7, "constraints": 5, "swadharma": 61.2,
                           "explanation": {"interest": "Close match.", "aptitude": "Meets needs."}},
             "careers": {"name": "Data Scientist", "family": "Mathematics, Finance & Analytics", "outlook": "growing"}},
            {"id": "m2", "rank": 2, "fit_score": 70, "visible_to_candidate": False, "counsellor_action": None,
             "breakdown": {"swadharma": 40}, "careers": {"name": "Hidden Unpublished Career", "family": "Law & Governance", "outlook": "stable"}},
        ],
        "stream_matches": [
            {"id": "s1", "rank": 1, "fit_score": 77, "visible_to_candidate": True, "counsellor_action": "pinned",
             "breakdown": {"keeps_open": ["Engineering & Technology", "Medicine & Health"], "closes": [], "widest": True, "swadharma": 99.9,
                           "sample_careers": {"Engineering & Technology": ["Software Engineer"]}},
             "stream_options": {"name": "Science - PCMB", "subjects": ["Physics", "Chemistry", "Maths", "Biology"]}},
        ],
        "sessions": [{"scheduled_at": "2026-09-01T10:00:00Z", "iccc_stage": "know_self", "notes_private": "PRIVATE-NOTE-XYZ",
                      "summary_for_candidate": "We discussed your interests."}],
        "roadmap": {"start_date": "2026-10-01", "end_date": "2027-09-30", "status": "published"},
        "roadmap_items": [{"due_date": "2027-01-10", "title": "JEE Main session 1", "kind": "exam", "owner": "candidate", "status": "todo"}],
        "swadharma_scores": [{"career_family": "Law & Governance", "points": 61.2, "components": {"d10": 12.5}, "confidence": "high",
                              "counsellor_notes": "COUNSELLOR-NOTE-ABC", "favourable_windows": [{"from": "2027-01-01", "to": "2027-06-01", "purpose": "exams", "dasha": "Ketu-Saturn"}]}],
        "swadharma_chart": {"d1": {"lagna": {"sign_name": "Pisces"}, "time_known": True},
                            "insights": {"personality_lens": {"items": [{"basis": "Moon sign", "value": "Leo", "tendencies": "You may like to create.", "strengths": "Warmth.", "watch_outs": "You may want the spotlight."}], "note": "A lens."},
                                         "agreement": [{"family": "Law & Governance", "swadharma_rank": 1, "psychometric_rank": 3, "verdict": "Agree"}]}},
    }


@pytest.mark.parametrize("kind", R.KINDS)
def test_every_report_has_the_verbatim_disclaimer(kind):
    track = "early_explorer" if kind in ("candidate_junior", "stream_choice") else "student"
    html = R.render_html(kind, R.assemble(kind, data(track)))
    assert DISCLAIMER.replace("’", "&#39;") in html or DISCLAIMER in html


@pytest.mark.parametrize("kind", ["candidate", "candidate_junior", "parent", "stream_choice"])
def test_candidate_facing_reports_carry_no_swadharma_or_private_notes(kind):
    track = "early_explorer" if kind in ("candidate_junior", "stream_choice") else "student"
    ctx = R.assemble(kind, data(track))
    blob = json.dumps(ctx)
    assert "swadharma" not in ctx
    assert '"swadharma":' not in blob
    assert "PRIVATE-NOTE-XYZ" not in blob and "COUNSELLOR-NOTE-ABC" not in blob
    assert "Hidden Unpublished Career" not in blob
    html = R.render_html(kind, ctx)
    assert "Swadharma (counsellor only)" not in html and "Ketu-Saturn" not in html


def test_case_file_has_everything():
    ctx = R.assemble("case_file", data())
    html = R.render_html("case_file", ctx)
    for s in ("PRIVATE-NOTE-XYZ", "COUNSELLOR-NOTE-ABC", "Hidden Unpublished Career", "Ketu-Saturn", "61"):
        assert s in html


def test_swadharma_report_puts_disclaimer_on_page_one_and_hides_notes():
    html = R.render_html("swadharma", R.assemble("swadharma", data()))
    first_break = html.index('class="page-break"')
    assert html.index('class="disclaimer-full"') < first_break
    assert "COUNSELLOR-NOTE-ABC" not in html and "Ketu-Saturn" not in html
    assert "Law &amp; Governance" in html


def test_junior_report_speaks_of_leanings_and_has_eight_pages():
    html = R.render_html("candidate_junior", R.assemble("candidate_junior", data("early_explorer")))
    assert "leaning" in html.lower()
    assert "Holland code" not in html
    assert html.count('class="page-break"') == 7
    assert "Exploring &amp; solving" in html


def test_pdf_renders():
    pytest.importorskip("weasyprint")
    try:
        pdf = R.render_pdf(R.render_html("parent", R.assemble("parent", data())))
    except OSError as e:  # Pango missing on the host
        pytest.skip(str(e))
    assert pdf[:4] == b"%PDF"
