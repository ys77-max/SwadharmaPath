"""Career matching for the student and professional tracks.

fit = 35·cosine(interest, career.interest_weights) + 25·aptitude_fit + 15·workstyle_fit
      + 10·values_fit + outlook_score (growing 10, transforming 7, stable 6, declining 2)
      + 5·constraints_feasible

Top 15 go to career_matches with visible_to_candidate = false until the
counsellor publishes. breakdown.swadharma carries the family points for the
counsellor; v_candidate_matches strips it.
"""
from __future__ import annotations

import math
from typing import Any

from families import BAND_RANK

MATCH_VERSION = "match-0.1"
TOP_N = 15
OUTLOOK_SCORE = {"growing": 10, "transforming": 7, "stable": 6, "declining": 2}
WEIGHTS = {"interest": 35, "aptitude": 25, "workstyle": 15, "values": 10, "constraints": 5}


def cosine(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def aptitude_fit(bands: dict[str, str], required: dict[str, str] | None) -> float:
    """Fraction of required bands met, +0.1 per band level exceeded, capped at 1."""
    if not required:
        return 1.0
    met = 0
    bonus = 0.0
    for sub, need in required.items():
        have = BAND_RANK.get(bands.get(sub, "Low"), 0)
        want = BAND_RANK.get(need, 0)
        if have >= want:
            met += 1
            bonus += 0.1 * (have - want)
    return min(1.0, met / len(required) + bonus)


def workstyle_fit(primary: str | None, secondary: str | None, fit_list: list[str] | None) -> float:
    """1 − normalised distance between the candidate's primary/secondary and the career's list."""
    if not fit_list or not primary:
        return 0.5
    dp = 0.0 if primary == fit_list[0] else 0.25 if primary in fit_list else 0.5
    ds = 0.0 if secondary in fit_list else 0.25 if secondary is None else 0.5
    return 1.0 - (dp + ds)


def values_fit(top5: list[str], career_values: list[str] | None) -> float:
    if not career_values or not top5:
        return 0.0
    return len(set(top5) & set(career_values)) / min(5, len(career_values))


def constraints_feasible(constraints: dict[str, Any] | None, career: dict) -> float:
    """1 unless the family is excluded by the candidate's constraints."""
    excluded = (constraints or {}).get("exclude_families") or []
    return 0.0 if career.get("family") in excluded else 1.0


EXPLAIN = {
    "interest": [(0.85, "Your interests line up closely with people who enjoy this work."),
                 (0.7, "Your interests overlap well with this field."),
                 (0.0, "Only part of this work matches what you enjoy.")],
    "aptitude": [(0.99, "Your aptitude meets or exceeds what this path usually needs."),
                 (0.5, "You meet most of the aptitude this path asks for."),
                 (0.0, "One or more aptitude areas are below what this path usually needs; this can be built.")],
    "workstyle": [(0.75, "Your work style suits how this role is usually done."),
                  (0.4, "Your work style partly suits this role."),
                  (0.0, "This role often calls for a different working style than your natural one.")],
    "values": [(0.6, "It offers several of the things you value most."),
               (0.2, "It offers some of what you value."),
               (0.0, "It may not offer what you value most.")],
}


def explain(dim: str, x: float) -> str:
    return next(text for threshold, text in EXPLAIN[dim] if x >= threshold)


def score_career(profile: dict, career: dict, swadharma_points: dict[str, float] | None = None) -> tuple[float, dict]:
    i = cosine(profile.get("interest_vector"), career.get("interest_weights"))
    a = aptitude_fit(profile.get("aptitude_bands") or {}, career.get("aptitude_min"))
    w = workstyle_fit(profile.get("primary"), profile.get("secondary"), career.get("workstyle_fit"))
    v = values_fit(profile.get("values_top5") or [], career.get("values_fit"))
    o = OUTLOOK_SCORE.get(career.get("outlook") or "stable", 6)
    c = constraints_feasible(profile.get("constraints"), career)
    parts = {
        "interest": round(WEIGHTS["interest"] * i, 1),
        "aptitude": round(WEIGHTS["aptitude"] * a, 1),
        "workstyle": round(WEIGHTS["workstyle"] * w, 1),
        "values": round(WEIGHTS["values"] * v, 1),
        "outlook": o,
        "constraints": round(WEIGHTS["constraints"] * c, 1),
    }
    fit = round(sum(parts.values()), 1)
    breakdown: dict[str, Any] = {
        **parts,
        "explanation": {
            "interest": explain("interest", i), "aptitude": explain("aptitude", a),
            "workstyle": explain("workstyle", w), "values": explain("values", v),
            "outlook": f"Outlook to 2035: {career.get('outlook', 'stable')} (career library, last reviewed {career.get('last_reviewed') or 'pending'}).",
            "constraints": "Fits your stated constraints." if c else "Conflicts with a constraint you set; discuss with your counsellor.",
        },
    }
    if swadharma_points is not None:
        breakdown["swadharma"] = swadharma_points.get(career.get("family"))
    return fit, breakdown


def rank_careers(profile: dict, careers: list[dict], swadharma_points: dict[str, float] | None = None, top_n: int = TOP_N) -> list[dict]:
    scored = []
    for career in careers:
        fit, breakdown = score_career(profile, career, swadharma_points)
        scored.append({"career_id": career["id"], "family": career.get("family"), "fit_score": fit, "breakdown": breakdown})
    scored.sort(key=lambda r: -r["fit_score"])
    for n, r in enumerate(scored[:top_n], start=1):
        r["rank"] = n
    return scored[:top_n]


# ---------------------------------------------------------------- database

def load_profile(db, candidate_id: str) -> dict:
    """Assembles the matcher's view of a candidate from results and the candidate row."""
    cand = db.table("candidates").select("constraints").eq("id", candidate_id).single().execute().data
    summary = db.table("profile_summary").select("interest_vector").eq("candidate_id", candidate_id).maybe_single().execute()
    results = db.table("assessment_results").select("derived, instruments(code)").eq("candidate_id", candidate_id) \
        .order("scored_at", desc=True).execute().data
    latest: dict[str, dict] = {}
    for r in results:
        latest.setdefault(r["instruments"]["code"], r["derived"])
    ws = latest.get("workstyle") or {}
    vals = latest.get("values") or latest.get("school_values") or {}
    return {
        "interest_vector": ((summary.data if summary else None) or {}).get("interest_vector") or (latest.get("interest") or {}).get("vector"),
        "aptitude_bands": (latest.get("aptitude") or {}).get("bands") or {},
        "primary": ws.get("primary"), "secondary": ws.get("secondary"),
        "values_top5": vals.get("top5") or [],
        "constraints": cand.get("constraints") or {},
    }


def swadharma_family_points(db, candidate_id: str) -> dict[str, float]:
    rows = db.table("swadharma_scores").select("career_family, points").eq("candidate_id", candidate_id).execute().data
    return {r["career_family"]: float(r["points"]) for r in rows}


def run(db, candidate_id: str) -> list[dict]:
    """Recomputes matches. Counsellor-curated rows (pinned / hidden / added) and visibility are kept."""
    profile = load_profile(db, candidate_id)
    careers = db.table("careers").select("*").execute().data
    ranked = rank_careers(profile, careers, swadharma_family_points(db, candidate_id))
    existing = {r["career_id"]: r for r in db.table("career_matches").select("id, career_id, counsellor_action, visible_to_candidate")
                .eq("candidate_id", candidate_id).execute().data}
    keep = set()
    for r in ranked:
        row = {"fit_score": r["fit_score"], "breakdown": r["breakdown"], "rank": r["rank"], "match_version": MATCH_VERSION}
        if r["career_id"] in existing:
            db.table("career_matches").update(row).eq("id", existing[r["career_id"]]["id"]).execute()
        else:
            db.table("career_matches").insert({"candidate_id": candidate_id, "career_id": r["career_id"], **row}).execute()
        keep.add(r["career_id"])
    for cid, e in existing.items():
        if cid not in keep and not e["counsellor_action"] and not e["visible_to_candidate"]:
            db.table("career_matches").delete().eq("id", e["id"]).execute()
    return ranked
