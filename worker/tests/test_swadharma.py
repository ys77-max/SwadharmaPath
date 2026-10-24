import json
from datetime import date, datetime, time, timezone

import pytest

import swadharma as S
from families import FAMILIES

BIRTHS = [
    (date(2010, 8, 15), time(6, 30), "Asia/Kolkata", 28.61, 77.21),
    (date(1995, 1, 3), time(23, 50), "Asia/Kolkata", 12.97, 77.59),
    (date(2008, 11, 28), time(14, 5), "Asia/Kolkata", 19.07, 72.88),
    (date(1988, 6, 21), time(3, 15), "Europe/London", 51.5, -0.12),
]


@pytest.fixture(scope="module", params=BIRTHS, ids=lambda b: b[0].isoformat())
def chart(request):
    d, t, tz, lat, lng = request.param
    return S.compute_chart(d, t, tz, lat, lng, "exact"), S.to_utc(d, t, tz)


def test_bav_tables_have_classical_totals():
    for planet, table in S.BAV_TABLE.items():
        assert sum(len(h) for h in table.values()) == S.BAV_TOTALS[planet]
    assert sum(S.BAV_TOTALS.values()) == 337


def test_sav_checksum_is_337(chart):
    c, _ = chart
    av = S.ashtakavarga(c)
    assert sum(av["sav"]) == 337
    for p in S.SEVEN:
        assert sum(av["bav"][p]) == S.BAV_TOTALS[p]


def test_divisional_rules():
    assert S.d9_sign(0) == 0          # Aries starts from Aries
    assert S.d9_sign(30) == 9         # Taurus starts from Capricorn
    assert S.d9_sign(60) == 6         # Gemini from Libra
    assert S.d9_sign(90) == 3         # Cancer from Cancer
    assert S.d9_sign(29.99) == 8      # last navamsa of Aries is Sagittarius
    assert S.d10_sign(0) == 0         # odd sign counts from itself
    assert S.d10_sign(29) == 9
    assert S.d10_sign(30) == 9        # even sign (Taurus) counts from the 9th: Capricorn
    assert S.d10_sign(59) == 6


def test_nakshatra_and_kp_sub_lord():
    n = S.nakshatra(0.0)
    assert n["star_lord"] == "Ketu" and n["sub_lord"] == "Ketu" and n["pada"] == 1
    # Ketu sub spans 7/120 of 13°20' = 0°46'40"; just past it the sub is Venus
    assert S.nakshatra(0.78)["sub_lord"] == "Venus"
    assert S.nakshatra(359.99)["star_lord"] == "Mercury"  # Revati
    assert S.nakshatra(359.99)["sub_lord"] == "Saturn"    # last sub of a Mercury star


def test_chart_shape(chart):
    c, _ = chart
    assert set(c["planets"]) == set(S.PLANETS)
    assert abs(((c["planets"]["Ketu"]["lon"] - c["planets"]["Rahu"]["lon"]) % 360) - 180) < 1e-9
    assert len(c["kp_cusps"]) == 12
    assert 23 < c["ayanamsa_deg"] < 25  # Lahiri for these dates
    for p in S.PLANETS:
        assert 1 <= c["planets"][p]["house"] <= 12
        assert 1 <= c["planets"][p]["kp_house"] <= 12


def test_dashas_cover_120_years(chart):
    c, utc = chart
    d = S.vimshottari(c, utc)
    assert len(d) == 9
    span = (date.fromisoformat(d[-1]["end"]) - date.fromisoformat(d[0]["start"])).days / S.YEAR_DAYS
    assert span == pytest.approx(120, abs=0.01)
    assert date.fromisoformat(d[0]["start"]) <= utc.date() < date.fromisoformat(d[0]["end"])
    for md in d:
        assert md["antar"][0]["lord"] == md["lord"]
        assert md["antar"][-1]["end"] == md["end"] or abs((date.fromisoformat(md["antar"][-1]["end"]) - date.fromisoformat(md["end"])).days) <= 1


def test_scores_fifteen_families_within_bounds(chart):
    c, utc = chart
    out = S.score_chart(c, date(2026, 10, 24), utc)
    assert set(out["families"]) == set(FAMILIES)
    assert out["confidence"] == "high"
    assert sum(out["component_weights"].values()) == pytest.approx(100)
    for f, v in out["families"].items():
        assert 0 <= v["points"] <= 100
        for k, x in v["components"].items():
            assert 0 <= x <= out["component_weights"][k] + 1e-9
    # never everything at zero: no family is ruled out
    assert all(v["points"] > 0 for v in out["families"].values())


def test_unknown_time_uses_moon_and_dignity_only():
    d, _, tz, lat, lng = BIRTHS[0]
    c = S.compute_chart(d, None, tz, lat, lng, "unknown")
    out = S.score_chart(c, date(2026, 10, 24), S.to_utc(d, None, tz))
    assert out["confidence"] == "low"
    assert set(out["component_weights"]) == {"moon_sign", "strength"}
    assert sum(out["component_weights"].values()) == pytest.approx(100)
    assert "kp_cusps" not in c and out["ashtakavarga"] is None
    assert all(i["basis"] in ("Moon sign", "Sun sign") for i in out["lens"]["items"])


def test_lens_text_never_strays_into_banned_topics(chart):
    c, _ = chart
    texts = [json.dumps(S.personality_lens(c, a)).lower() for a in ("candidate", "parent_of_junior")]
    texts.append(json.dumps(S.SIGN_LENS).lower())
    for t in texts:
        for term in S.BANNED_TERMS:
            assert term not in t, term
    assert "Your child may" in json.dumps(S.personality_lens(c, "parent_of_junior"))


def test_junior_windows_only_in_board_and_class11_slots(chart):
    c, utc = chart
    slots = S.junior_slots("Class 9", None, date(2026, 10, 24))
    assert slots[0][1] == date(2028, 1, 15)  # Class 10 boards in early 2028
    out = S.score_chart(c, date(2026, 10, 24), utc, track="early_explorer", class_label="Class 9")
    allowed = {s[0] for s in slots}
    for w in out["windows"]:
        assert w["purpose"] in allowed
        assert any(a <= date.fromisoformat(w["from"]) and date.fromisoformat(w["to"]) <= b for _, a, b in slots)


def test_agreement_matrix_verdicts():
    points = {f: 100 - i for i, f in enumerate(FAMILIES)}
    same = S.agreement_matrix(points, list(FAMILIES))
    assert [r["verdict"] for r in same[:5]] == ["Agree"] * 5
    flipped = S.agreement_matrix(points, list(reversed(FAMILIES)))
    assert flipped[0]["verdict"] == "Conflict" and flipped[-1]["verdict"] == "Conflict"
    assert len(same) == 15


def test_karakatwa_covers_planets_and_known_families():
    raw = json.loads(S.KARAKATWA_PATH.read_text())["planets"]
    assert set(raw) == set(S.PLANETS)
    for p, fams in raw.items():
        assert {k for k in fams if not k.startswith("_")} <= set(FAMILIES), p
    K = S.load_karakatwa()
    covered = {f for p in K for f, w in K[p].items() if w > 0}
    assert covered == set(FAMILIES)
