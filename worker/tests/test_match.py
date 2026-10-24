import sys

import pytest

from conftest import REPO

sys.path.insert(0, str(REPO / "supabase" / "seed"))
import library  # noqa: E402

import match  # noqa: E402
import streams  # noqa: E402
from families import FAMILIES  # noqa: E402

CAREERS = [{**c, "id": f"c{i}"} for i, c in enumerate(library.CAREERS)]
STREAMS = [{**s, "id": f"s{i}", "keeps_open_families": s["keeps_open"], "closes_families": s["closes"]}
           for i, s in enumerate(library.STREAMS)]

INVESTIGATIVE = {
    "interest_vector": [0.4, 1.0, 0.3, 0.2, 0.2, 0.6],
    "aptitude_bands": {"numerical": "High", "verbal": "Average", "abstract": "Very High", "spatial": "Average"},
    "primary": "D", "secondary": "R",
    "values_top5": ["Learning", "Achievement", "Independence", "Security", "Creativity"],
    "constraints": {},
}


def test_library_families_are_the_fifteen():
    assert len(FAMILIES) == 15
    assert {c["family"] for c in CAREERS} <= set(FAMILIES)
    for s in STREAMS:
        assert set(s["keeps_open_families"]) | set(s["closes_families"]) <= set(FAMILIES)


def test_cosine_basics():
    assert match.cosine([1, 0], [1, 0]) == pytest.approx(1)
    assert match.cosine([1, 0], [0, 1]) == 0
    assert match.cosine(None, [1]) == 0
    assert match.cosine([0, 0], [1, 1]) == 0


def test_aptitude_fit():
    assert match.aptitude_fit({}, None) == 1
    assert match.aptitude_fit({"numerical": "Low"}, {"numerical": "High"}) == 0
    assert match.aptitude_fit({"numerical": "High", "verbal": "Low"}, {"numerical": "High", "verbal": "Average"}) == 0.5
    assert match.aptitude_fit({"numerical": "Very High"}, {"numerical": "Average"}) == 1


def test_workstyle_and_values_fit():
    assert match.workstyle_fit("D", "R", ["D", "R"]) == 1
    assert match.workstyle_fit("A", "P", ["D", "R"]) == 0
    assert match.workstyle_fit(None, None, ["D"]) == 0.5
    assert match.values_fit(["A", "B"], ["A", "B", "C", "D"]) == 0.5
    assert match.values_fit([], ["A"]) == 0


def test_score_is_sum_of_parts_and_within_100():
    for c in CAREERS:
        fit, b = match.score_career(INVESTIGATIVE, c, {f: 50 for f in FAMILIES})
        parts = sum(b[k] for k in ("interest", "aptitude", "workstyle", "values", "outlook", "constraints"))
        assert fit == pytest.approx(parts, abs=0.11)
        assert 0 <= fit <= 100
        assert b["swadharma"] == 50
        assert set(b["explanation"]) == {"interest", "aptitude", "workstyle", "values", "outlook", "constraints"}


def test_rank_top15_ordered_and_investigative_first():
    ranked = match.rank_careers(INVESTIGATIVE, CAREERS)
    assert len(ranked) == match.TOP_N
    assert [r["rank"] for r in ranked] == list(range(1, 16))
    assert all(a["fit_score"] >= b["fit_score"] for a, b in zip(ranked, ranked[1:]))
    top_families = {r["family"] for r in ranked[:3]}
    assert top_families & {"Engineering & Technology", "Pure Sciences & Research", "Mathematics, Finance & Analytics"}
    assert "swadharma" not in ranked[0]["breakdown"]  # only added when the counsellor has a chart


def test_excluded_family_loses_constraint_points():
    c = next(c for c in CAREERS if c["family"] == "Medicine & Health")
    _, ok = match.score_career(INVESTIGATIVE, c)
    _, no = match.score_career({**INVESTIGATIVE, "constraints": {"exclude_families": ["Medicine & Health"]}}, c)
    assert ok["constraints"] == 5 and no["constraints"] == 0


def test_streams_always_include_widest_and_never_one():
    profiles = [
        {"interest_vector": [0, 0, 1, 0.2, 0.1, 0], "aptitude_percentiles": {"spatial": 95, "abstract": 90}, "subjects": {"art": {"enjoyment": 5}}},
        {"interest_vector": [0.1, 0.2, 0.2, 1, 0.8, 0.3], "aptitude_percentiles": {"verbal": 90}, "subjects": {}},
        {},
    ]
    widest = max(len(s["keeps_open_families"]) for s in STREAMS)
    for p in profiles:
        top = streams.rank_streams(p, STREAMS, {"Engineering & Technology": ["Software Engineer"]}, {f: 10 for f in FAMILIES})
        assert 5 <= len(top) <= 6
        assert any(len(r["breakdown"]["keeps_open"]) == widest for r in top)
        assert [r["rank"] for r in top] == list(range(1, len(top) + 1))
        for r in top:
            assert r["breakdown"]["swadharma"] == 10 * len(r["breakdown"]["keeps_open"])
            assert set(r["breakdown"]["sample_careers"]) == set(r["breakdown"]["keeps_open"])


def test_streams_follow_subject_strength():
    arts = {"interest_vector": [0.1, 0.1, 1, 0.3, 0.2, 0], "aptitude_percentiles": {"spatial": 95, "abstract": 85, "numerical": 20},
            "subjects": {"art": {"enjoyment": 5, "marks_pct": 92}, "maths": {"enjoyment": 1, "marks_pct": 40}}}
    names = [r["name"] for r in streams.rank_streams(arts, STREAMS, {})]
    assert names.index("Arts, Design & Vocational") < names.index("Science - PCM") if "Science - PCM" in names else True
    assert streams.academics_fit({"maths": {"marks_pct": 100, "enjoyment": 5}}, "Science - PCM") == 1
    assert streams.academics_fit({}, "Humanities") == 0.5
