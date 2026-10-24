"""Psychometric scoring.

score_session() mirrors supabase/functions/_shared/scoring.ts exactly (the Edge
Function gives instant results; this is the batch / fallback path). Both are
checked against supabase/functions/_shared/scoring_fixtures.json.

build_profile() turns the latest results into profile_summary vectors, which
the matchers read.
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

SCORING_VERSION = "scoring-0.1"
FACTORS = ["R", "A", "P", "D"]
RIASEC = ["R", "I", "A", "S", "E", "C"]
APTITUDE_ORDER = ["numerical", "verbal", "abstract", "spatial"]
STYLE_TEMPLATES = json.loads((Path(__file__).parent / "data" / "workstyle_templates.json").read_text())


# ---------------------------------------------------------------- numeric helpers (JS-compatible)

def js_round(x: float) -> int:
    """Math.round semantics: halves round towards +infinity."""
    return math.floor(x + 0.5)


def round2(x: float) -> float:
    return js_round(x * 100) / 100


def _erf(x: float) -> float:
    # Same Abramowitz-Stegun approximation as the TypeScript scorer.
    s = 1 if x > 0 else -1 if x < 0 else 0
    a = abs(x)
    t = 1 / (1 + 0.3275911 * a)
    y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-a * a)
    return s * y


def percentile(x: float, mean: float, sd: float) -> int:
    if not sd:
        return 50
    p = 0.5 * (1 + _erf((x - mean) / (sd * math.sqrt(2))))
    return max(1, min(99, js_round(p * 100)))


def age_band(dob: str | date | None, on: date | None = None) -> str:
    if not dob:
        return "16-18"
    b = date.fromisoformat(dob) if isinstance(dob, str) else dob
    on = on or datetime.now(timezone.utc).date()
    age = on.year - b.year - ((on.month, on.day) < (b.month, b.day))
    if age <= 15:
        return "13-15"
    if age <= 18:
        return "16-18"
    if age <= 22:
        return "19-22"
    return "23+"


def aptitude_band(p: float) -> str:
    if p < 25:
        return "Low"
    if p < 75:
        return "Average"
    if p < 90:
        return "High"
    return "Very High"


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def _items(sections: list[dict]) -> list[dict]:
    return [i for s in sections for i in s["items"]]


def _norm_pct(norms: dict | None, band: str, scale: str, x: float) -> int | None:
    n = ((norms or {}).get(band) or {}).get(scale)
    return percentile(x, n["mean"], n["sd"]) if n else None


def _answer(responses: dict, item_id: str) -> Any:
    r = responses.get(item_id)
    return r.get("a") if isinstance(r, dict) else None


# ---------------------------------------------------------------- validity

def validity(items: list[dict], responses: dict) -> dict[str, bool]:
    rts = sorted(r["rt"] for i in items if isinstance(r := responses.get(i["id"]), dict) and isinstance(r.get("rt"), (int, float)) and not isinstance(r.get("rt"), bool))
    median = None
    if rts:
        n = len(rts)
        median = rts[(n - 1) // 2] if n % 2 else (rts[n // 2 - 1] + rts[n // 2]) / 2
    run = longest = 0
    prev = None
    for i in items:
        if i["type"] != "likert5":
            continue
        r = responses.get(i["id"])
        k = json.dumps(r["a"], separators=(",", ":")) if isinstance(r, dict) and "a" in r else None
        run = run + 1 if (k is not None and k == prev) else (0 if k is None else 1)
        prev = k
        longest = max(longest, run)
    answered = sum(1 for i in items if i["id"] in responses)
    return {
        "fast_responses": median is not None and median < 1500,
        "straight_lining": longest >= 10,
        "incomplete": len(items) > 0 and answered / len(items) < 0.8,
    }


# ---------------------------------------------------------------- methods

def _riasec(inp: dict) -> dict:
    scales = inp["scoring_spec"].get("scales") or RIASEC
    items = _items(inp["items"]["sections"])
    raw = {s: 0 for s in scales}
    n = {s: 0 for s in scales}
    for i in items:
        a = _answer(inp["responses"], i["id"])
        if isinstance(a, (int, float)) and not isinstance(a, bool) and i.get("scale") in raw:
            raw[i["scale"]] += a
            n[i["scale"]] += 1
    pct = {}
    for s in scales:
        p = _norm_pct(inp["norms"], inp["ageBand"], s, raw[s])
        if p is not None:
            pct[s] = p
    vector = [round2((raw[s] - n[s]) / (n[s] * 4)) if n[s] else 0 for s in scales]
    order = sorted(scales, key=lambda s: (-pct.get(s, 0), -raw[s], scales.index(s)))
    return {"raw": raw, "percentiles": pct, "derived": {"code": "".join(order[:3]), "vector": vector, "order": order},
            "validity_flags": validity(items, inp["responses"])}


def _aptitude(inp: dict) -> dict:
    raw, pct, bands = {}, {}, {}
    for sec in inp["items"]["sections"]:
        raw[sec["code"]] = sum(1 for i in sec["items"] if _answer(inp["responses"], i["id"]) == i.get("key") and i["id"] in inp["responses"])
        p = _norm_pct(inp["norms"], inp["ageBand"], sec["code"], raw[sec["code"]])
        if p is not None:
            pct[sec["code"]] = p
            bands[sec["code"]] = aptitude_band(p)
    items = _items(inp["items"]["sections"])
    v = validity(items, inp["responses"])
    return {"raw": raw, "percentiles": pct, "derived": {"bands": bands, "attempted": sum(1 for i in items if inp["responses"].get(i["id"]))},
            "validity_flags": {"fast_responses": v["fast_responses"]}}


def _clamp19(x: float) -> int:
    return max(-19, min(19, js_round(x)))


def primary_of(g: list[int]) -> str | None:
    above = sorted([(f, v) for f, v in zip(FACTORS, g) if v > 0], key=lambda t: -t[1])
    return above[0][0] if above else None


def style_table(primary: str | None) -> dict | None:
    if not primary:
        return None
    t = STYLE_TEMPLATES["styles"][primary]
    return {"style": primary, "label": t["label"], "summary": t["summary"],
            "rows": [{"area": a, **t[a]} for a in STYLE_TEMPLATES["areas"]],
            "template_version": STYLE_TEMPLATES["version"]}


def _workstyle(inp: dict) -> dict:
    items = _items(inp["items"]["sections"])
    most = {f: 0 for f in FACTORS}
    least = {f: 0 for f in FACTORS}
    n = 0
    for i in items:
        a = _answer(inp["responses"], i["id"])
        if not isinstance(a, dict) or not a.get("most") or not a.get("least") or a["most"] == a["least"]:
            continue
        fm = next((o.get("factor") for o in i["options"] if str(o["value"]) == a["most"]), None)
        fl = next((o.get("factor") for o in i["options"] if str(o["value"]) == a["least"]), None)
        if not fm or not fl:
            continue
        most[fm] += 1
        least[fl] += 1
        n += 1
    q = n / 4
    others = [_clamp19((most[f] - q) / (3 * q) * 19) if n else 0 for f in FACTORS]
    stress = [_clamp19((q - least[f]) / (3 * q) * 19) if n else 0 for f in FACTORS]
    self_ = [_clamp19((most[f] - least[f]) / n * 19) if n else 0 for f in FACTORS]
    junior = inp["variant"] == "junior"
    graphs = {"others": others, "self": self_} if junior else {"others": others, "stress": stress, "self": self_}
    R, A, P, D = self_
    span = max(self_) - min(self_)
    patterns: dict[str, Any] = {
        "span": "wide" if span >= 20 else "crunched" if span <= 8 else "normal",
        "reversal": primary_of(others) is not None and primary_of(self_) is not None and primary_of(others) != primary_of(self_),
        "undershift": all(v <= 2 for v in self_),
        "overshift": sum(1 for v in self_ if v > 0) >= 3,
        "mercurial": A - max(R, P, D) >= 8,
        "flick_up": P < 0 and D < 0 and D > P,
        "flick_down": P < 0 and D < 0 and D < P,
    }
    if not junior:
        s = []
        d_personal, d_perf = stress[2] - self_[2], others[2] - self_[2]
        a_personal, a_perf = stress[1] - self_[1], others[1] - self_[1]
        if abs(d_personal) >= 3:
            s.append("personal")
        if abs(d_perf) >= 3:
            s.append("performance")
        if (abs(d_personal) >= 3 and abs(a_personal) >= 3 and _sign(a_personal) == _sign(d_personal)) or \
           (abs(d_perf) >= 3 and abs(a_perf) >= 3 and _sign(a_perf) == _sign(d_perf)):
            s.append("relationship")
        patterns["stress"] = s
    ranked = sorted([(f, v) for f, v in zip(FACTORS, self_) if v > 0], key=lambda t: -t[1])
    primary = ranked[0][0] if ranked else None
    divergence = any(abs(o - s) >= 12 for o, s in zip(others, self_))
    return {
        "raw": {"most": most, "least": least, "n": n},
        "percentiles": {},
        "derived": {"graphs": graphs, "primary": primary, "secondary": ranked[1][0] if len(ranked) > 1 else None,
                    "patterns": patterns, "style_table": style_table(primary)},
        "validity_flags": {**validity(items, inp["responses"]), "divergence": divergence},
    }


def _bigfive(inp: dict) -> dict:
    domains = inp["scoring_spec"].get("domains") or list("OCEAN")
    items = _items(inp["items"]["sections"])
    sums: dict[str, list[float]] = {}
    for i in items:
        a = _answer(inp["responses"], i["id"])
        if not isinstance(a, (int, float)) or isinstance(a, bool) or not i.get("scale"):
            continue
        sums.setdefault(i["scale"], []).append(6 - a if i.get("reverse") else a)
    raw, pct = {}, {}
    for d in [*domains, "SD"]:
        xs = sums.get(d)
        if not xs:
            continue
        raw[d] = round2(sum(xs) / len(xs))
        p = _norm_pct(inp["norms"], inp["ageBand"], d, raw[d])
        if p is not None:
            pct[d] = p
    sd_pct = pct.pop("SD", None)
    return {"raw": raw, "percentiles": pct, "derived": {"social_desirability_pct": sd_pct},
            "validity_flags": {**validity([i for i in items if not i.get("sd")], inp["responses"]),
                               "social_desirability": sd_pct is not None and sd_pct > 80}}


def _values(inp: dict) -> dict:
    names = inp["scoring_spec"].get("values") or []
    top = inp["scoring_spec"].get("top") or 5
    items = _items(inp["items"]["sections"])
    wins = {v: 0 for v in names}
    seen = {v: 0 for v in names}
    for i in items:
        a = _answer(inp["responses"], i["id"])
        for o in i["options"]:
            if o.get("value_name"):
                seen[o["value_name"]] = seen.get(o["value_name"], 0) + 1
        chosen = next((o.get("value_name") for o in i["options"] if o["value"] == a and i["id"] in inp["responses"]), None)
        if chosen:
            wins[chosen] = wins.get(chosen, 0) + 1
    ranking = sorted(names, key=lambda v: (-wins[v], names.index(v)))
    vector = [round2(wins[v] / seen[v]) if seen[v] else 0 for v in names]
    return {"raw": {"wins": wins}, "percentiles": {}, "derived": {"ranking": ranking, "top5": ranking[:top], "vector": vector},
            "validity_flags": {"fast_responses": validity(items, inp["responses"])["fast_responses"]}}


def _likert_scales(inp: dict) -> dict:
    scales = inp["scoring_spec"].get("scales") or []
    items = _items(inp["items"]["sections"])
    by: dict[str, list[float]] = {}
    for i in items:
        a = _answer(inp["responses"], i["id"])
        if isinstance(a, (int, float)) and not isinstance(a, bool) and i.get("scale"):
            by.setdefault(i["scale"], []).append(a)
    raw, pct = {}, {}
    for s in scales:
        xs = by.get(s)
        if not xs:
            continue
        total = sum(xs)
        raw[s] = total if inp["scoring_spec"].get("per_item") else round2(total / len(xs))
        p = _norm_pct(inp["norms"], inp["ageBand"], s, total)
        if p is not None:
            pct[s] = p
    order = sorted([s for s in scales if s in raw], key=lambda s: -raw[s])
    return {"raw": raw, "percentiles": pct, "derived": {"order": order, "top": order[0] if order else None},
            "validity_flags": validity(items, inp["responses"])}


METHODS = {"riasec": _riasec, "aptitude": _aptitude, "workstyle": _workstyle, "bigfive": _bigfive,
           "values": _values, "likert_scales": _likert_scales}


def score_session(inp: dict) -> dict:
    method = inp["scoring_spec"]["method"]
    if method not in METHODS:
        raise ValueError(f"unknown scoring method {method}")
    return METHODS[method](inp)


# ---------------------------------------------------------------- database jobs

def score_pending(db) -> int:
    """Scores completed sessions that have no result yet (e.g. the Edge Function call failed)."""
    sessions = db.table("assessment_sessions").select("id, candidate_id, instrument_id, responses, completed_at, candidates(dob)") \
        .eq("status", "completed").execute().data
    done = 0
    for s in sessions:
        existing = db.table("assessment_results").select("id").eq("candidate_id", s["candidate_id"]) \
            .eq("instrument_id", s["instrument_id"]).gte("scored_at", s["completed_at"]).limit(1).execute().data
        if existing:
            continue
        inst = db.table("instruments").select("items, scoring_spec, norms, track_variant").eq("id", s["instrument_id"]).single().execute().data
        responses = {k: v for k, v in (s["responses"] or {}).items() if k != "_meta"}
        out = score_session({"items": inst["items"], "scoring_spec": inst["scoring_spec"], "norms": inst["norms"],
                             "responses": responses, "ageBand": age_band((s.get("candidates") or {}).get("dob")),
                             "variant": inst["track_variant"]})
        db.table("assessment_results").insert({"candidate_id": s["candidate_id"], "instrument_id": s["instrument_id"],
                                               **out, "scoring_version": SCORING_VERSION}).execute()
        done += 1
    return done


def profile_vectors(results_by_code: dict[str, dict]) -> dict[str, list[float] | None]:
    """Latest result per instrument code → the four profile_summary vectors."""
    interest = results_by_code.get("interest")
    aptitude = results_by_code.get("aptitude")
    workstyle = results_by_code.get("workstyle")
    values = results_by_code.get("values") or results_by_code.get("school_values")
    return {
        "interest_vector": interest["derived"]["vector"] if interest else None,
        "aptitude_vector": [aptitude["percentiles"].get(k, 0) for k in APTITUDE_ORDER] if aptitude else None,
        "workstyle_vector": workstyle["derived"]["graphs"]["self"] if workstyle else None,
        "values_vector": values["derived"]["vector"] if values else None,
    }


def build_profile(db, candidate_id: str) -> dict:
    """Upserts profile_summary vectors from the latest result per instrument. Never touches approval or narrative."""
    rows = db.table("assessment_results").select("instrument_id, percentiles, derived, scored_at, instruments(code)") \
        .eq("candidate_id", candidate_id).order("scored_at", desc=True).execute().data
    latest: dict[str, dict] = {}
    for r in rows:
        latest.setdefault(r["instruments"]["code"], r)
    vectors = profile_vectors(latest)
    db.table("profile_summary").upsert({"candidate_id": candidate_id, **vectors, "updated_at": datetime.now(timezone.utc).isoformat()},
                                       on_conflict="candidate_id").execute()
    return vectors
