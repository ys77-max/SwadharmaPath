"""Library refresh: CSV parsing, validation, diffing, the AI loop (with a fake client) and the jobs."""
import csv
import io
import json
import sys
from datetime import date
from types import SimpleNamespace as NS

import pytest

from conftest import REPO
from fakedb import FakeDB

sys.path.insert(0, str(REPO / "supabase" / "seed"))
import library  # noqa: E402

import library_refresh as L  # noqa: E402
import scheduler  # noqa: E402


def careers():
    return [{**c, "id": f"car{i}", "pathways": L.pathways_for(c.get("pathways") or [])} for i, c in enumerate(library.CAREERS)]


def streams():
    return [{"id": f"st{i}", "name": s["name"], "board": s["board"], "subjects": s["subjects"],
             "keeps_open_families": s["keeps_open"], "closes_families": s["closes"], "notes": s["notes"]}
            for i, s in enumerate(library.STREAMS)]


def export(entity, rows):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(L.csv_columns(entity))
    for r in rows:
        w.writerow([r["id"], *[L.to_cell(k, r.get(f)) for f, k in L.FIELDS[entity].items()]])
    return out.getvalue()


@pytest.fixture()
def db():
    db = FakeDB()
    db.tables["users"] = [{"id": "u-a", "role": "admin", "full_name": "Admin"}]
    db.tables["careers"] = [{k: v for k, v in c.items() if k != "pathways"} for c in careers()]
    db.tables["education_pathways"] = [{**p, "id": f"p{i}-{j}", "career_id": f"car{i}"}
                                       for i, c in enumerate(library.CAREERS) for j, p in enumerate(c.get("pathways") or [])]
    db.tables["stream_options"] = streams()
    return db


# ---------------------------------------------------------------- pure

def test_seed_library_is_valid():
    for entity, rows in (("career", careers()), ("stream", streams())):
        for r in rows:
            for f, kind in L.FIELDS[entity].items():
                L.validate(kind, r.get(f))


def test_unchanged_export_round_trips_to_no_proposals():
    for entity, rows in (("career", careers()), ("stream", streams())):
        proposals, errors = L.parse_csv(entity, export(entity, rows), rows)
        assert proposals == [] and errors == [], (entity, proposals[:1], errors[:3])


def test_csv_edits_new_rows_and_errors():
    rows = streams()
    text = export("stream", rows).splitlines()
    reader = list(csv.reader(text))
    reader[1][6] = "Edited note"                                    # change notes on the first stream
    reader.append(["", "Vocational - IT", "CBSE", "English; IT; Maths", "Engineering & Technology", "", ""])
    reader.append(["", "Bad stream", "CBSE", "English", "Rocket Science", "", ""])
    reader.append(["nope", "Ghost", "CBSE", "English", "", "", ""])
    reader.append(["", "", "", "", "", "", ""])                     # blank row ignored
    out = io.StringIO()
    csv.writer(out).writerows(reader)
    proposals, errors = L.parse_csv("stream", out.getvalue(), rows)
    assert [(p["entity_id"], list(p["changes"])) for p in proposals] == [
        ("st0", ["notes"]), (None, ["name", "board", "subjects", "keeps_open_families"])]
    assert proposals[0]["changes"]["notes"] == {"old": rows[0]["notes"], "new": "Edited note"}
    assert any("Rocket Science" in e for e in errors)
    assert any("id nope is not in the library" in e for e in errors)


def test_csv_matches_by_name_and_needs_header():
    rows = streams()
    proposals, _ = L.parse_csv("stream", f"name,notes\n{rows[1]['name'].upper()},Changed\n", rows)
    assert proposals[0]["entity_id"] == "st1"
    with pytest.raises(L.RefreshError, match="header row"):
        L.parse_csv("stream", "foo,bar\n1,2\n", rows)


def test_new_career_needs_required_fields():
    proposals, errors = L.parse_csv("career", "name,family\nDrone Pilot,Engineering & Technology\n", careers())
    assert proposals == [] and "needs riasec_code, outlook" in errors[0]


def test_validate_rejects_bad_values():
    for kind, value in (("outlook", "booming"), ("weights", [1, 2]), ("riasec", "XYZ"), ("family", "Space"),
                        ("bands", {"numerical": "Superb"}), ("pathways", [{"level": "phd"}]), ("workstyle", ["Q"])):
        with pytest.raises(ValueError):
            L.validate(kind, value)
    assert L.validate("riasec", "irc") == "IRC"


def test_diff_ignores_none_and_equal_values():
    cur = {"outlook": "stable", "notes": "x", "subjects": ["A", "B"]}
    assert L.diff("stream", cur, {"notes": None, "subjects": ["A", "B"]}) == {}
    assert L.diff("career", cur, {"outlook": "growing"}) == {"outlook": {"old": "stable", "new": "growing"}}


# ---------------------------------------------------------------- AI loop with a fake client

class FakeClient:
    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.beta = NS(messages=NS(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        return self.script.pop(0) if self.script else self.default

    default = None


def tool_reply(changes, sources=None):
    block = NS(type="tool_use", name="submit_proposal",
               input={"changes": [{"field": f, "new_value_json": json.dumps(v)} for f, v in changes.items()],
                      "rationale": "Checked the 2026 notice.", "sources": sources or [{"url": "https://nta.ac.in", "title": "NTA"}]})
    return NS(stop_reason="tool_use", content=[block])


def test_draft_resumes_pause_turn_and_validates():
    row = careers()[0]
    new = "declining" if row["outlook"] != "declining" else "growing"
    paused = NS(stop_reason="pause_turn", content=[NS(type="server_tool_use", name="web_search")])
    client = FakeClient([paused, tool_reply({"outlook": new, "automation_exposure": "extreme"})])
    proposals, errors, checked = L.ai_proposals("career", [row], client)
    assert checked == 1 and len(client.calls) == 2
    assert client.calls[1]["messages"][-1]["role"] == "assistant"  # paused turn sent back
    assert client.calls[0]["model"] == L.MODEL and client.calls[0]["fallbacks"] == "default"
    assert proposals[0]["changes"] == {"outlook": {"old": row["outlook"], "new": new}}
    assert "automation_exposure" in errors[0]


def test_refusal_is_reported_not_fatal():
    client = FakeClient([NS(stop_reason="refusal", content=[])])
    proposals, errors, checked = L.ai_proposals("stream", streams()[:1], client)
    assert proposals == [] and checked == 1 and "declined" in errors[0]


# ---------------------------------------------------------------- jobs

def test_csv_run_goes_to_review(db):
    rows = streams()
    db.tables["library_refresh_runs"] = [{"id": "r1", "scope": "streams", "source": "csv", "status": "queued",
                                          "created_at": "2026-10-01", "csv_text": f"id,name,notes\nst0,{rows[0]['name']},New note\n"}]
    assert scheduler.job_library_refresh(db) == 1
    run = db.tables["library_refresh_runs"][0]
    assert run["status"] == "review" and run["summary"]["proposals"] == 1
    assert db.tables["library_refresh_proposals"][0]["run_id"] == "r1"
    assert db.tables["notifications"][0]["title"] == "Library refresh ready to review"


def test_ai_run_without_key_fails_clearly(db, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    db.tables["library_refresh_runs"] = [{"id": "r2", "scope": "all", "source": "ai", "status": "queued", "created_at": "2026-10-01"}]
    scheduler.job_library_refresh(db)
    run = db.tables["library_refresh_runs"][0]
    assert run["status"] == "failed" and "ANTHROPIC_API_KEY" in run["error"]
    assert db.tables["notifications"][0]["title"] == "Library refresh failed"


def test_ai_run_with_fake_client(db):
    db.tables["library_refresh_runs"] = [{"id": "r3", "scope": "streams", "source": "ai", "status": "queued", "created_at": "2026-10-01"}]
    client = FakeClient([tool_reply({"notes": "JEE Main is held twice a year."})])
    client.default = tool_reply({})
    scheduler.job_library_refresh(db, client_factory=lambda: client)
    run = db.tables["library_refresh_runs"][0]
    assert run["status"] == "review" and run["summary"] == {"checked": len(library.STREAMS), "proposals": 1, "errors": []}


def test_quarterly_queues_ai_run_or_reminds(db, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert scheduler.job_outlook_refresh(db, date(2026, 10, 1)) == len(library.CAREERS)  # nothing reviewed yet: reminder
    assert "Refresh now" in db.tables["notifications"][0]["body"]
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    assert scheduler.job_outlook_refresh(db, date(2026, 10, 1)) == 1
    assert db.tables["library_refresh_runs"][0]["source"] == "scheduled"
    scheduler.job_outlook_refresh(db, date(2026, 10, 1))  # a run is open: no second run
    assert len(db.tables["library_refresh_runs"]) == 1


def test_rematch_after_apply_skips_archived(db, monkeypatch):
    calls = []
    monkeypatch.setattr(scheduler.match, "run", lambda db, cid: calls.append(("match", cid)))
    monkeypatch.setattr(scheduler.streams, "run", lambda db, cid: calls.append(("streams", cid)))
    db.tables["candidates"] = [{"id": "a", "track": "student"}, {"id": "b", "track": "early_explorer"},
                               {"id": "c", "track": "student", "archived_at": "2026-01-01"}, {"id": "d", "track": "student"}]
    db.tables["profile_summary"] = [{"candidate_id": x} for x in ("a", "b", "c")]
    db.tables["library_refresh_runs"] = [{"id": "r4", "status": "applied", "rematched_at": None}]
    assert scheduler.job_library_rematch(db) == 2
    assert calls == [("match", "a"), ("streams", "b")]
    assert db.tables["library_refresh_runs"][0]["rematched_at"]
    assert scheduler.job_library_rematch(db) == 0
