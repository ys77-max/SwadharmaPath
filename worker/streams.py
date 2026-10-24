"""Stream recommendation for the early_explorer track (Class 8-10).

stream_fit = 35·interest alignment + 30·aptitude fit + 20·academics & subject enjoyment
             + 10·breadth + 5·board availability

The widest "keep options open" combination is always included. Output is
streams with keeps-open / closes lists and sample careers per open family;
never a single career.
"""
from __future__ import annotations

from typing import Any

from families import FAMILY_RIASEC
from match import cosine

STREAM_VERSION = "streams-0.1"
APTITUDE_PAIRS = [
    ("PCMB", ["numerical", "abstract", "verbal"]),
    ("PCM", ["numerical", "abstract"]),
    ("PCB", ["verbal", "abstract"]),
    ("Commerce", ["numerical", "verbal"]),
    ("Humanities", ["verbal", "abstract"]),
    ("Design", ["spatial", "abstract"]),
    ("Vocational", ["spatial", "abstract"]),
]
STREAM_SUBJECTS = [
    ("PCMB", ["maths", "science"]),
    ("PCM", ["maths", "science"]),
    ("PCB", ["science", "languages"]),
    ("Commerce with Mathematics", ["maths", "social_science"]),
    ("Commerce", ["social_science", "languages"]),
    ("Humanities with Mathematics", ["social_science", "languages", "maths"]),
    ("Humanities", ["social_science", "languages"]),
    ("Design", ["art"]),
]


def _lookup(table: list[tuple[str, list[str]]], name: str) -> list[str]:
    return next((v for key, v in table if key.lower() in name.lower()), [])


def interest_alignment(interest: list[float] | None, keeps_open: list[str]) -> float:
    fams = [FAMILY_RIASEC[f] for f in keeps_open if f in FAMILY_RIASEC]
    if not fams or not interest:
        return 0.0
    mix = [sum(col) / len(fams) for col in zip(*fams)]
    return cosine(interest, mix)


def aptitude_fit(percentiles: dict[str, float], stream_name: str) -> float:
    subs = _lookup(APTITUDE_PAIRS, stream_name)
    vals = [percentiles[s] for s in subs if s in percentiles]
    return sum(vals) / len(vals) / 100 if vals else 0.5


def academics_fit(subjects: dict[str, dict[str, Any]], stream_name: str) -> float:
    """Mean over the stream's key subjects of 0.5·marks% + 0.5·enjoyment (1-5 scaled)."""
    keys = _lookup(STREAM_SUBJECTS, stream_name)
    scores = []
    for k in keys:
        s = subjects.get(k)
        if not s:
            continue
        parts = []
        if s.get("marks_pct") is not None:
            parts.append(float(s["marks_pct"]) / 100)
        if s.get("enjoyment") is not None:
            parts.append((float(s["enjoyment"]) - 1) / 4)
        if parts:
            scores.append(sum(parts) / len(parts))
    return sum(scores) / len(scores) if scores else 0.5


def rank_streams(profile: dict, streams: list[dict], careers_by_family: dict[str, list[str]],
                 swadharma_points: dict[str, float] | None = None) -> list[dict]:
    max_open = max((len(s["keeps_open_families"]) for s in streams), default=1) or 1
    out = []
    for s in streams:
        i = interest_alignment(profile.get("interest_vector"), s["keeps_open_families"])
        a = aptitude_fit(profile.get("aptitude_percentiles") or {}, s["name"])
        ac = academics_fit(profile.get("subjects") or {}, s["name"])
        br = len(s["keeps_open_families"]) / max_open
        bo = 1.0 if not profile.get("board") or s.get("board") == profile.get("board") else 0.0
        parts = {"interest": round(35 * i, 1), "aptitude": round(30 * a, 1), "academics": round(20 * ac, 1),
                 "breadth": round(10 * br, 1), "board": round(5 * bo, 1)}
        breakdown: dict[str, Any] = {
            **parts,
            "keeps_open": s["keeps_open_families"],
            "closes": s["closes_families"],
            "sample_careers": {f: careers_by_family.get(f, [])[:3] for f in s["keeps_open_families"]},
            "widest": len(s["keeps_open_families"]) == max_open,
        }
        if swadharma_points is not None:
            # counsellor-only roll-up: sum of family points over the families this stream keeps open
            breakdown["swadharma"] = round(sum(swadharma_points.get(f, 0) for f in s["keeps_open_families"]), 1)
        out.append({"stream_option_id": s["id"], "name": s["name"], "fit_score": round(sum(parts.values()), 1), "breakdown": breakdown})
    out.sort(key=lambda r: -r["fit_score"])
    top = out[:5]
    if not any(r["breakdown"]["widest"] for r in top):
        top.append(next(r for r in out if r["breakdown"]["widest"]))
    for n, r in enumerate(top, start=1):
        r["rank"] = n
    return top


def run(db, candidate_id: str) -> list[dict]:
    cand = db.table("candidates").select("board").eq("id", candidate_id).single().execute().data
    results = db.table("assessment_results").select("raw, percentiles, derived, instruments(code)").eq("candidate_id", candidate_id) \
        .order("scored_at", desc=True).execute().data
    latest: dict[str, dict] = {}
    for r in results:
        latest.setdefault(r["instruments"]["code"], r)
    subjects = {r["subject"]: dict(r) for r in db.table("subject_enjoyment").select("*").eq("candidate_id", candidate_id).execute().data}
    # the "Subjects I enjoy" instrument fills enjoyment where the counsellor has not entered it
    for subject, mean in (((latest.get("subject_enjoyment") or {}).get("raw")) or {}).items():
        row = subjects.setdefault(subject, {"subject": subject})
        if row.get("enjoyment") is None:
            row["enjoyment"] = mean
    profile = {
        "interest_vector": ((latest.get("interest") or {}).get("derived") or {}).get("vector"),
        "aptitude_percentiles": (latest.get("aptitude") or {}).get("percentiles") or {},
        "subjects": subjects,
        "board": cand.get("board"),
    }
    streams = db.table("stream_options").select("*").execute().data
    careers = db.table("careers").select("name, family").order("name").execute().data
    by_family: dict[str, list[str]] = {}
    for c in careers:
        by_family.setdefault(c["family"], []).append(c["name"])
    sw = {r["career_family"]: float(r["points"]) for r in db.table("swadharma_scores").select("career_family, points").eq("candidate_id", candidate_id).execute().data}
    ranked = rank_streams(profile, streams, by_family, sw)
    existing = {r["stream_option_id"]: r for r in db.table("stream_matches").select("id, stream_option_id, counsellor_action, visible_to_candidate")
                .eq("candidate_id", candidate_id).execute().data}
    keep = set()
    for r in ranked:
        row = {"fit_score": r["fit_score"], "breakdown": r["breakdown"], "rank": r["rank"]}
        if r["stream_option_id"] in existing:
            db.table("stream_matches").update(row).eq("id", existing[r["stream_option_id"]]["id"]).execute()
        else:
            db.table("stream_matches").insert({"candidate_id": candidate_id, "stream_option_id": r["stream_option_id"], **row}).execute()
        keep.add(r["stream_option_id"])
    for sid, e in existing.items():
        if sid not in keep and not e["counsellor_action"] and not e["visible_to_candidate"]:
            db.table("stream_matches").delete().eq("id", e["id"]).execute()
    return ranked
