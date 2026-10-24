"""Library refresh: turns a queued library_refresh_runs row into proposals the admin reviews.

Two sources:
  * ai / scheduled  one Claude call per career or stream, with web search, asking what has
                    changed (outlook, exams, salary bands, institutions, ...). Only fields that
                    differ from the library become a proposal.
  * csv             the admin's edited export (src/lib/libraryCsv.ts writes the same columns).
                    Rows match by id, then by name; a row with neither is a new item.

Nothing here writes to careers or stream_options. The admin approves proposals in the app and
apply_library_refresh() (SQL) writes them; job_library_rematch then recomputes matches.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from families import BAND_RANK, FAMILIES

log = logging.getLogger("swadharmapath.library")
MODEL = "claude-opus-5-5"
OUTLOOKS = ("growing", "stable", "transforming", "declining")
EXPOSURES = ("low", "medium", "high")
LEVELS = ("class11_12", "ug", "pg", "diploma", "certification", "global")
BANDS = tuple(BAND_RANK)
WORKSTYLES = ("R", "A", "P", "D")
MAX_ROW_ERRORS = 50

# field -> kind. Kinds drive CSV parsing, validation and diffing.
CAREER_FIELDS: dict[str, str] = {
    "name": "text", "family": "family", "riasec_code": "riasec", "interest_weights": "weights",
    "outlook": "outlook", "automation_exposure": "exposure", "description": "text", "day_in_life": "text",
    "typical_entry_paths": "list", "adjacent_emerging": "list", "workstyle_fit": "workstyle", "values_fit": "list",
    "india_salary_band": "object", "aptitude_min": "bands", "pathways": "pathways",
}
STREAM_FIELDS: dict[str, str] = {
    "name": "text", "board": "text", "subjects": "list", "keeps_open_families": "families",
    "closes_families": "families", "notes": "text",
}
FIELDS = {"career": CAREER_FIELDS, "stream": STREAM_FIELDS}
REQUIRED_NEW = {"career": ("name", "family", "riasec_code", "outlook"), "stream": ("name", "subjects")}
PATHWAY_KEYS = ("level", "stream_required", "exams", "degrees", "institutions", "duration", "alternative_routes", "notes")


class RefreshError(Exception):
    """A run-level failure the admin can act on (shown on the run)."""


# ---------------------------------------------------------------- values (pure)

def _split(s: str) -> list[str]:
    return [x.strip() for x in s.split(";") if x.strip()]


def from_cell(kind: str, cell: str) -> Any:
    """CSV cell -> value. Lists are semicolon separated; objects and pathways are JSON."""
    cell = (cell or "").strip()
    if cell == "":
        return None
    if kind in ("list", "families", "workstyle"):
        return _split(cell)
    if kind == "weights":
        return [float(x) for x in _split(cell)]
    if kind in ("object", "bands", "pathways"):
        return json.loads(cell)
    return cell


def to_cell(kind: str, value: Any) -> str:
    if value is None:
        return ""
    if kind in ("list", "families", "workstyle", "weights"):
        return "; ".join(str(x) for x in value)
    if kind in ("object", "bands", "pathways"):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def validate(kind: str, value: Any) -> Any:
    """Returns the cleaned value or raises ValueError with a message an admin can read."""
    if value is None:
        return None
    if kind == "text":
        if not isinstance(value, str):
            raise ValueError("must be text")
        return value.strip() or None
    if kind == "family":
        if value not in FAMILIES:
            raise ValueError(f"'{value}' is not one of the 15 career families")
        return value
    if kind == "riasec":
        v = str(value).upper().strip()
        if not (1 <= len(v) <= 3 and set(v) <= set("RIASEC") and len(set(v)) == len(v)):
            raise ValueError("must be 1-3 distinct letters from RIASEC, e.g. IRC")
        return v
    if kind == "weights":
        if not (isinstance(value, list) and len(value) == 6 and all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in value)):
            raise ValueError("must be 6 numbers between 0 and 1 (R; I; A; S; E; C)")
        return [round(float(x), 3) for x in value]
    if kind == "outlook":
        if value not in OUTLOOKS:
            raise ValueError(f"must be one of {', '.join(OUTLOOKS)}")
        return value
    if kind == "exposure":
        if value not in EXPOSURES:
            raise ValueError(f"must be one of {', '.join(EXPOSURES)}")
        return value
    if kind in ("list", "families", "workstyle"):
        if not (isinstance(value, list) and all(isinstance(x, str) for x in value)):
            raise ValueError("must be a list of text")
        value = [x.strip() for x in value if x.strip()]
        bad = [x for x in value if (kind == "families" and x not in FAMILIES) or (kind == "workstyle" and x not in WORKSTYLES)]
        if bad:
            raise ValueError(f"unknown value(s): {', '.join(bad)}")
        return value
    if kind == "object":
        if not isinstance(value, dict):
            raise ValueError("must be a JSON object")
        return value
    if kind == "bands":
        if not (isinstance(value, dict) and all(k in ("numerical", "verbal", "abstract", "spatial") and v in BANDS for k, v in value.items())):
            raise ValueError("must map numerical/verbal/abstract/spatial to a band such as Average")
        return value
    if kind == "pathways":
        if not (isinstance(value, list) and all(isinstance(p, dict) for p in value)):
            raise ValueError("must be a JSON list of pathways")
        out = []
        for p in value:
            if p.get("level") not in LEVELS:
                raise ValueError(f"pathway level must be one of {', '.join(LEVELS)}")
            out.append({k: p.get(k) for k in PATHWAY_KEYS})
        return out
    raise ValueError(f"unknown field kind {kind}")


def _comparable(kind: str, v: Any) -> Any:
    if kind == "pathways" and v is not None:
        return sorted(json.dumps({k: p.get(k) or None for k in PATHWAY_KEYS}, sort_keys=True) for p in v)
    if kind == "weights" and v is not None:
        return [round(float(x), 3) for x in v]
    if isinstance(v, (dict, list)):
        return json.dumps(v, sort_keys=True)
    return v if v not in ("", [], {}) else None


def diff(entity: str, current: dict | None, proposed: dict[str, Any]) -> dict[str, dict]:
    """{field: {old, new}} for fields in `proposed` that differ from `current`. None in
    `proposed` means "no opinion", never "clear the field"."""
    fields = FIELDS[entity]
    current = current or {}
    out = {}
    for f, new in proposed.items():
        if f not in fields or new is None:
            continue
        old = current.get(f)
        if _comparable(fields[f], old) != _comparable(fields[f], new):
            out[f] = {"old": old, "new": new}
    return out


def pathways_for(pathway_rows: list[dict]) -> list[dict]:
    return [{k: p.get(k) for k in PATHWAY_KEYS} for p in sorted(pathway_rows, key=lambda p: LEVELS.index(p["level"]) if p.get("level") in LEVELS else 99)]


# ---------------------------------------------------------------- CSV (pure)

def csv_columns(entity: str) -> list[str]:
    return ["id", *FIELDS[entity]]


def parse_csv(entity: str, text: str, library: list[dict]) -> tuple[list[dict], list[str]]:
    """Returns (proposals, errors). `library` is the current rows (careers carry `pathways`)."""
    by_id = {str(r["id"]): r for r in library}
    by_name = {r["name"].strip().lower(): r for r in library if r.get("name")}
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames or "name" not in [h.strip() for h in reader.fieldnames]:
        raise RefreshError(f"the CSV needs a header row with at least 'name'; expected columns: {', '.join(csv_columns(entity))}")
    unknown = [h for h in reader.fieldnames if h and h.strip() not in csv_columns(entity)]
    errors: list[str] = [f"ignored unknown column '{h}'" for h in unknown]
    proposals, seen = [], set()
    fields = FIELDS[entity]
    for n, raw in enumerate(reader, start=2):
        row = {(k or "").strip(): (v or "") for k, v in raw.items() if k}
        if not any(v.strip() for v in row.values()):
            continue
        rid, name = row.get("id", "").strip(), row.get("name", "").strip()
        current = by_id.get(rid) if rid else by_name.get(name.lower())
        if rid and current is None:
            errors.append(f"row {n}: id {rid} is not in the library; clear the id to add it as new")
            continue
        key = str(current["id"]) if current else f"new:{name.lower()}"
        if key in seen:
            errors.append(f"row {n}: '{name}' appears more than once; only the first row is used")
            continue
        seen.add(key)
        values, bad = {}, []
        for f, kind in fields.items():
            if f not in row:
                continue
            try:
                values[f] = validate(kind, from_cell(kind, row[f]))
            except (ValueError, json.JSONDecodeError) as e:
                bad.append(f"{f} {e}")
        if bad:
            errors.append(f"row {n} ({name or 'no name'}): " + "; ".join(bad))
            continue
        if current is None:
            missing = [f for f in REQUIRED_NEW[entity] if not values.get(f)]
            if missing:
                errors.append(f"row {n} ({name or 'no name'}): a new {entity} needs {', '.join(missing)}")
                continue
        changes = diff(entity, current, values)
        if changes:
            proposals.append({"entity": entity, "entity_id": current["id"] if current else None,
                              "entity_name": (current or {}).get("name") or name, "changes": changes,
                              "sources": [{"title": "Admin CSV upload"}], "rationale": None})
    return proposals, errors[:MAX_ROW_ERRORS]


# ---------------------------------------------------------------- Claude (AI drafts)

_ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["changes", "rationale", "sources"],
    "properties": {
        "changes": {
            "type": "array",
            "description": "Only fields whose current value is wrong or out of date. Empty if nothing needs to change.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["field", "new_value_json"],
                "properties": {
                    "field": {"type": "string"},
                    "new_value_json": {"type": "string", "description": "The complete new value for the field, as JSON."},
                },
            },
        },
        "rationale": {"type": "string", "description": "Two or three sentences a counsellor can check: what changed and why."},
        "sources": {
            "type": "array",
            "items": {"type": "object", "additionalProperties": False, "required": ["url", "title"],
                      "properties": {"url": {"type": "string"}, "title": {"type": "string"}}},
        },
    },
}

SYSTEM = (
    "You maintain the careers and streams library of SwadharmaPath, an Indian career-guidance practice. "
    "Counsellors use it with students from Class 8 to working professionals. Your job is to check one library "
    "entry against current, authoritative Indian sources (official exam bodies such as NTA, UPSC and state boards, "
    "regulators such as NMC, BCI, AICTE and UGC, government labour data, and reputable industry reports) and "
    "propose corrections.\n\n"
    "Rules:\n"
    "- Propose a change only when a source you found supports it. Keep a field as it is when you are unsure.\n"
    "- Keep the house style: plain English a 15-year-old and a parent can follow, no hype, no guarantees.\n"
    "- Exam entries keep the note 'Check the official notification every cycle; dates move.'\n"
    "- Salary bands stay indicative ranges in lakh per annum with a note; do not invent precision.\n"
    "- For pathways, send the complete list (it replaces the old one), using levels "
    f"{', '.join(LEVELS)}.\n"
    "- Allowed values: outlook {" + ", ".join(OUTLOOKS) + "}; automation_exposure {" + ", ".join(EXPOSURES) + "}; "
    "families " + json.dumps(FAMILIES) + "; workstyle letters R, A, P, D; aptitude bands " + json.dumps(list(BANDS)) + ".\n"
    "- When you are done, call submit_proposal exactly once. Cite the pages you relied on in sources."
)


def _prompt(entity: str, row: dict) -> str:
    shown = {k: v for k, v in row.items() if k in FIELDS[entity]}
    label = "career" if entity == "career" else "Class 11-12 stream"
    return (f"Review this {label} entry. Today is {datetime.now(timezone.utc).date().isoformat()}.\n"
            f"Editable fields: {', '.join(FIELDS[entity])}.\n\n"
            f"```json\n{json.dumps(shown, ensure_ascii=False, indent=1)}\n```\n\n"
            "Search for what has changed in the last year, then call submit_proposal.")


def _tools(entity: str) -> list[dict]:
    schema = json.loads(json.dumps(_ITEM_SCHEMA))
    schema["properties"]["changes"]["items"]["properties"]["field"]["enum"] = list(FIELDS[entity])
    return [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": 4, "user_location": {"type": "approximate", "country": "IN"}},
        {"name": "submit_proposal", "description": "Submit the reviewed changes for this library entry (empty changes if it is current).",
         "strict": True, "input_schema": schema},
    ]


def draft_with_claude(client, entity: str, row: dict, max_turns: int = 6) -> dict | None:
    """One library entry -> {"changes": {field: value}, "rationale", "sources"} or None if Claude
    declined. Raises RefreshError if no proposal came back."""
    messages: list[dict] = [{"role": "user", "content": _prompt(entity, row)}]
    for _ in range(max_turns):
        resp = client.beta.messages.create(
            model=MODEL, max_tokens=16000, system=SYSTEM, tools=_tools(entity), messages=messages,
            thinking={"type": "adaptive"}, output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            return None
        call = next((b for b in resp.content if b.type == "tool_use" and b.name == "submit_proposal"), None)
        if call is not None:
            data = call.input
            values: dict[str, Any] = {}
            for c in data.get("changes") or []:
                try:
                    values[c["field"]] = json.loads(c["new_value_json"])
                except (KeyError, json.JSONDecodeError):
                    log.warning("ignored unparseable value for %s.%s", row.get("name"), c.get("field"))
            return {"changes": values, "rationale": data.get("rationale"), "sources": data.get("sources") or []}
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason == "pause_turn":
            continue  # server-side search hit its iteration cap; re-send to resume
        if resp.stop_reason == "max_tokens":
            raise RefreshError(f"the review of '{row.get('name')}' ran out of output tokens")
        messages.append({"role": "user", "content": "Please call submit_proposal now with what you found."})
    raise RefreshError(f"no proposal came back for '{row.get('name')}'")


def ai_proposals(entity: str, rows: list[dict], client) -> tuple[list[dict], list[str], int]:
    proposals, errors, checked = [], [], 0
    fields = FIELDS[entity]
    for row in rows:
        try:
            draft = draft_with_claude(client, entity, row)
        except RefreshError as e:
            errors.append(str(e))
            continue
        checked += 1
        if draft is None:
            errors.append(f"'{row['name']}' was skipped: the model declined to review it")
            continue
        clean = {}
        for f, v in draft["changes"].items():
            try:
                clean[f] = validate(fields[f], v)
            except (ValueError, KeyError) as e:
                errors.append(f"'{row['name']}' {f}: suggested value dropped ({e})")
        changes = diff(entity, row, clean)
        if changes:
            proposals.append({"entity": entity, "entity_id": row["id"], "entity_name": row["name"], "changes": changes,
                              "sources": draft["sources"], "rationale": draft["rationale"]})
    return proposals, errors[:MAX_ROW_ERRORS], checked


def anthropic_client():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RefreshError("ANTHROPIC_API_KEY is not set on the worker; add it on Railway or use CSV upload instead")
    import anthropic
    return anthropic.Anthropic()


# ---------------------------------------------------------------- database

def load_library(db, entity: str) -> list[dict]:
    if entity == "stream":
        return db.table("stream_options").select("*").order("name").execute().data
    careers = db.table("careers").select("*").order("name").execute().data
    pathways = db.table("education_pathways").select("*").execute().data
    for c in careers:
        c["pathways"] = pathways_for([p for p in pathways if p.get("career_id") == c["id"]])
    return careers


def _entities(scope: str) -> list[str]:
    return {"careers": ["career"], "streams": ["stream"], "all": ["career", "stream"]}[scope]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def process_run(db, run: dict, client_factory=anthropic_client) -> dict:
    """queued -> running -> review (or failed). Returns the summary."""
    db.table("library_refresh_runs").update({"status": "running", "started_at": _now()}).eq("id", run["id"]).execute()
    try:
        proposals: list[dict] = []
        errors: list[str] = []
        checked = 0
        if run["source"] == "csv":
            entity = _entities(run["scope"])[0]
            library = load_library(db, entity)
            proposals, errors = parse_csv(entity, run.get("csv_text") or "", library)
            checked = len(library)
        else:
            client = client_factory()
            for entity in _entities(run["scope"]):
                p, e, n = ai_proposals(entity, load_library(db, entity), client)
                proposals += p
                errors += e
                checked += n
            if checked == 0:
                raise RefreshError("no library entry could be reviewed: " + ("; ".join(errors[:3]) or "unknown error"))
        for p in proposals:
            db.table("library_refresh_proposals").insert({**p, "run_id": run["id"]}).execute()
        summary = {"checked": checked, "proposals": len(proposals), "errors": errors[:MAX_ROW_ERRORS]}
        current = db.table("library_refresh_runs").select("status").eq("id", run["id"]).single().execute().data
        if current["status"] == "cancelled":  # admin cancelled while we worked
            return summary
        db.table("library_refresh_runs").update({"status": "review", "finished_at": _now(), "summary": summary}) \
            .eq("id", run["id"]).execute()
        return summary
    except Exception as e:
        msg = str(e) if isinstance(e, RefreshError) else f"unexpected error: {type(e).__name__}: {e}"
        db.table("library_refresh_runs").update({"status": "failed", "finished_at": _now(), "error": msg[:1000]}) \
            .eq("id", run["id"]).execute()
        if not isinstance(e, RefreshError):
            log.exception("library refresh %s failed", run["id"])
        raise
