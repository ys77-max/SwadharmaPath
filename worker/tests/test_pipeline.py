"""End-to-end worker run on an in-memory database: score → profile → match/streams → Swadharma → reports."""
import json
import sys

import pytest

from conftest import REPO
from fakedb import FakeDB

sys.path.insert(0, str(REPO / "supabase" / "seed"))
import instruments as seed_instruments  # noqa: E402
import library  # noqa: E402

import reports  # noqa: E402
import scheduler  # noqa: E402

STD, JR = "cand-std", "cand-jr"


def answer(item, i):
    if item["type"] == "forced_choice":
        opts = item["options"]
        return {"a": {"most": opts[i % 4]["value"], "least": opts[(i + 2) % 4]["value"]}, "rt": 4000}
    if item["type"] == "mcq":
        return {"a": item["key"] if i % 3 else (item["key"] + 1) % len(item["options"]), "rt": 9000}
    if item["type"] == "pair":
        return {"a": item["options"][i % 2]["value"], "rt": 3000}
    return {"a": [5, 4, 2, 3, 1][i % 5] if item.get("scale") in ("I", "A", "maths", "art") else [3, 2, 4][i % 3], "rt": 3500}


@pytest.fixture()
def db():
    db = FakeDB()
    t = db.tables
    t["users"] = [{"id": "u-std", "role": "candidate", "full_name": "Ravi Kumar"}, {"id": "u-jr", "role": "candidate", "full_name": "Isha Shah"},
                  {"id": "u-c", "role": "counsellor", "full_name": "Meera Iyer"}, {"id": "u-a", "role": "admin", "full_name": "Admin"}]
    t["candidates"] = [
        {"id": STD, "user_id": "u-std", "track": "student", "dob": "2008-11-28", "counsellor_id": "u-c", "constraints": {}, "board": "CBSE",
         "swadharma_opted_in": True, "class_or_years_exp": "Class 12", "status": "active"},
        {"id": JR, "user_id": "u-jr", "track": "early_explorer", "dob": "2011-08-15", "counsellor_id": "u-c", "constraints": {}, "board": "CBSE",
         "swadharma_opted_in": True, "class_or_years_exp": "Class 9", "status": "active"},
    ]
    t["careers"] = [{**{k: v for k, v in c.items() if k != "pathways"}, "id": f"car{i}"} for i, c in enumerate(library.CAREERS)]
    t["stream_options"] = [{"id": f"st{i}", "name": s["name"], "board": s["board"], "subjects": s["subjects"],
                            "keeps_open_families": s["keeps_open"], "closes_families": s["closes"], "notes": s["notes"]}
                           for i, s in enumerate(library.STREAMS)]
    t["instruments"] = [{**inst, "id": f"ins-{inst['code']}-{inst['track_variant']}"} for inst in seed_instruments.all_instruments()]
    t["assessment_sessions"] = []
    for cid, variant in ((STD, "standard"), (JR, "junior")):
        for inst in t["instruments"]:
            if inst["track_variant"] != variant:
                continue
            items = [it for s in inst["items"]["sections"] for it in s["items"]]
            t["assessment_sessions"].append({"id": f"s-{cid}-{inst['code']}", "candidate_id": cid, "instrument_id": inst["id"],
                                             "status": "completed", "completed_at": "2026-10-01T10:00:00+00:00",
                                             "responses": {it["id"]: answer(it, i) for i, it in enumerate(items)}})
    t["birth_details"] = [
        {"candidate_id": STD, "birth_date": "2008-11-28", "birth_time": "14:05:00", "time_certainty": "exact", "lat": 19.07, "lng": 72.88,
         "tz": "Asia/Kolkata", "consent_at": "2026-09-20T00:00:00+00:00"},
        {"candidate_id": JR, "birth_date": "2011-08-15", "birth_time": None, "time_certainty": "unknown", "lat": 28.6, "lng": 77.2,
         "tz": "Asia/Kolkata", "consent_at": "2026-09-20T00:00:00+00:00"},
    ]
    return db


def test_full_worker_pipeline(db):
    assert scheduler.job_score_pending(db) == 12
    assert scheduler.job_score_pending(db) == 0  # idempotent
    scheduler.job_refresh_candidates(db)
    t = db.tables

    cm = [m for m in t["career_matches"] if m["candidate_id"] == STD]
    assert len(cm) == 15 and all(not m["visible_to_candidate"] for m in cm)
    assert all(isinstance(m["breakdown"]["swadharma"], float) for m in cm)  # filled by the Swadharma run
    sm = [m for m in t["stream_matches"] if m["candidate_id"] == JR]
    assert 5 <= len(sm) <= 6 and any(m["breakdown"]["widest"] for m in sm)

    scores = {(s["candidate_id"], s["career_family"]): s for s in t["swadharma_scores"]}
    assert len(scores) == 30
    assert scores[(STD, "Law & Governance")]["confidence"] == "high"
    assert scores[(JR, "Law & Governance")]["confidence"] == "low"
    jr_windows = scores[(JR, "Law & Governance")]["favourable_windows"]
    assert all(w["purpose"] in ("Class 10 board exams", "Class 11 entry", "Class 12 board exams") for w in jr_windows)
    assert {c["candidate_id"] for c in t["swadharma_charts"]} == {STD, JR}

    # Swadharma writes only to its own tables plus the counsellor-only breakdown key
    sw_tables = {tbl for op, tbl, row in db.log if "swadharma" in json.dumps(row, default=str).lower()}
    assert sw_tables <= {"swadharma_charts", "swadharma_scores", "career_matches", "stream_matches", "notifications"}

    # counsellor notes survive a re-run; a re-run with nothing new changes nothing
    key = (STD, "Law & Governance")
    scores[key]["counsellor_notes"] = "keep me"
    import swadharma
    swadharma.run(db, STD)
    assert next(s for s in t["swadharma_scores"] if (s["candidate_id"], s["career_family"]) == key)["counsellor_notes"] == "keep me"
    assert len(t["swadharma_scores"]) == 30

    # counsellor curation survives a re-match
    pinned = cm[-1]
    pinned["counsellor_action"] = "pinned"
    import match
    match.run(db, STD)
    assert any(m["id"] == pinned["id"] and m["counsellor_action"] == "pinned" for m in t["career_matches"])

    # reports: one requested row per kind renders once, write-once path
    for kind, cid in (("candidate", STD), ("parent", STD), ("case_file", STD), ("swadharma", STD), ("candidate_junior", JR), ("stream_choice", JR)):
        t.setdefault("reports", []).append({"id": f"r-{kind}-0000", "candidate_id": cid, "kind": kind, "version": 1, "pdf_path": None,
                                            "created_at": "2026-10-02", "content": {"status": "requested"}})
    assert reports.render_pending(db) == 6
    assert reports.render_pending(db) == 0
    files = db.storage.files["reports"]
    assert len(files) == 6 and all(b[:4] == b"%PDF" for b in files.values())
    cand_snapshot = json.dumps(next(r for r in t["reports"] if r["kind"] == "candidate")["content"])
    assert '"swadharma"' not in cand_snapshot


def test_no_consent_no_swadharma(db):
    db.tables["birth_details"][0]["consent_at"] = None
    db.tables["candidates"][1]["swadharma_opted_in"] = False
    scheduler.job_score_pending(db)
    scheduler.job_refresh_candidates(db)
    assert not db.tables.get("swadharma_scores")
    assert not db.tables.get("swadharma_charts")


def test_nightly_jobs(db):
    from datetime import date
    db.tables["roadmaps"] = [{"id": "rm1", "candidate_id": STD, "published_at": "2025-01-01T00:00:00+00:00"}]
    db.tables["outcomes"] = [{"candidate_id": STD, "checkpoint": "6m"}]
    assert scheduler.job_outcome_reminders(db, date(2026, 2, 1)) == 1
    assert scheduler.job_outcome_reminders(db, date(2026, 2, 1)) == 1  # upsert ignores the repeat
    assert len([n for n in db.tables["notifications"] if n["kind"] == "outcome_12m"]) == 1
    db.tables["careers"][0]["last_reviewed"] = "2020-01-01"
    assert scheduler.job_outlook_refresh(db, date(2026, 10, 1)) >= 1
    assert scheduler.job_deliver(db) == len(db.tables["notifications"])
    assert scheduler.job_deliver(db) == 0
