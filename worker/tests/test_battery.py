"""Integrity of the v0.2 assessment battery (supabase/seed/instruments_v2.py) and that the worker scores every instrument."""
import random
import sys

import pytest

from conftest import REPO
import scoring

sys.path.insert(0, str(REPO / "supabase/seed"))
import instruments_v2 as battery  # noqa: E402

INSTRUMENTS = battery.all_instruments()
IDS = [f"{i['track_variant']}-{i['code']}" for i in INSTRUMENTS]


def answer(item, rng):
    if item["type"] == "forced_choice":
        most, least = rng.sample([o["value"] for o in item["options"]], 2)
        return {"most": most, "least": least}
    return rng.choice([o["value"] for o in item["options"]])


def test_each_track_has_one_battery_of_the_expected_size():
    by_variant = {}
    for i in INSTRUMENTS:
        by_variant.setdefault(i["track_variant"], []).append(i["code"])
    assert by_variant == {
        "junior": ["interest", "subject_enjoyment", "aptitude", "bigfive", "workstyle", "school_values", "learning"],
        "standard": ["interest", "aptitude", "bigfive", "workstyle", "values", "learning"],
        "adult": ["interest", "aptitude", "bigfive", "workstyle", "values", "career_anchors", "adaptability"],
    }
    sizes = {v: sum(battery.item_count(i) for i in INSTRUMENTS if i["track_variant"] == v) for v in by_variant}
    assert sizes == {"junior": 167, "standard": 265, "adult": 277}


@pytest.mark.parametrize("inst", INSTRUMENTS, ids=IDS)
def test_items_are_well_formed(inst):
    items = [it for s in inst["items"]["sections"] for it in s["items"]]
    assert len({it["id"] for it in items}) == len(items), "item ids are unique"
    assert len({it["prompt"] + "|" + "|".join(str(o["label"]) for o in it["options"]) for it in items}) == len(items), "no repeated question"
    for it in items:
        labels = [o["label"] for o in it["options"]]
        assert len(set(labels)) == len(labels), it["prompt"]
        if it["type"] == "mcq":
            assert len(labels) == 4 and 0 <= it["key"] < 4, it["prompt"]


@pytest.mark.parametrize("variant", ["junior", "standard", "adult"])
def test_aptitude_sections_are_balanced_and_keys_spread(variant):
    apt = next(i for i in INSTRUMENTS if i["code"] == "aptitude" and i["track_variant"] == variant)
    secs = apt["items"]["sections"]
    assert [s["code"] for s in secs] == apt["scoring_spec"]["subtests"]
    assert {len(s["items"]) for s in secs} == {8}
    keys = [it["key"] for s in secs for it in s["items"]]
    assert all(keys.count(k) >= len(keys) // 8 for k in range(4)), "answer positions are not lopsided"


@pytest.mark.parametrize("inst", INSTRUMENTS, ids=IDS)
def test_worker_scores_every_instrument(inst):
    rng = random.Random(inst["code"] + inst["track_variant"])
    responses = {it["id"]: {"a": answer(it, rng), "rt": rng.randint(2500, 8000)}
                 for s in inst["items"]["sections"] for it in s["items"]}
    out = scoring.score_session({"items": inst["items"], "scoring_spec": inst["scoring_spec"], "norms": inst["norms"],
                                 "responses": responses, "ageBand": "16-18",
                                 "variant": "junior" if inst["track_variant"] == "junior" else "standard"})
    method = inst["scoring_spec"]["method"]
    if method == "aptitude":
        assert set(out["percentiles"]) == set(inst["scoring_spec"]["subtests"])
    if method == "likert_scales" and not inst["scoring_spec"].get("per_item"):
        assert set(out["raw"]) == set(inst["scoring_spec"]["scales"])
    if method == "bigfive":
        assert set(out["percentiles"]) == set("OCEAN")
    if method == "values":
        assert len(out["derived"]["top5"]) == 5
