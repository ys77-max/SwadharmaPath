import json

import pytest

from conftest import REPO
import scoring

FIXTURES = json.loads((REPO / "supabase/functions/_shared/scoring_fixtures.json").read_text())


@pytest.mark.parametrize("case", FIXTURES, ids=[c["name"] for c in FIXTURES])
def test_matches_typescript_scorer(case):
    assert case["expected"] is not None, "regenerate fixtures with UPDATE_FIXTURES=1 npx vitest run supabase/functions"
    assert scoring.score_session(case["input"]) == case["expected"]


def test_workstyle_templates_are_identical_copies():
    a = json.loads((REPO / "supabase/functions/_shared/workstyle_templates.json").read_text())
    b = json.loads((REPO / "worker/data/workstyle_templates.json").read_text())
    assert a == b


def test_js_rounding():
    assert scoring.js_round(2.5) == 3
    assert scoring.js_round(-2.5) == -2


def test_profile_vectors():
    v = scoring.profile_vectors({
        "interest": {"derived": {"vector": [0.1] * 6}},
        "aptitude": {"percentiles": {"numerical": 91, "verbal": 50}},
    })
    assert v["interest_vector"] == [0.1] * 6
    assert v["aptitude_vector"] == [91, 50, 0, 0]
    assert v["workstyle_vector"] is None
