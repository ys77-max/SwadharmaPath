"""A small in-memory stand-in for the supabase-py query builder: just the calls the worker makes.
Embedded selects resolve through EMBEDS; column lists are ignored (whole rows come back)."""
from __future__ import annotations

import copy
import re
import uuid
from datetime import datetime, timezone

EMBEDS = {
    ("career_matches", "careers"): ("careers", "career_id"),
    ("stream_matches", "stream_options"): ("stream_options", "stream_option_id"),
    ("assessment_results", "instruments"): ("instruments", "instrument_id"),
    ("assessment_sessions", "candidates"): ("candidates", "candidate_id"),
    ("candidates", "users!candidates_user_id_fkey"): ("users", "user_id"),
    ("roadmaps", "candidates"): ("candidates", "candidate_id"),
}
UNIQUE = {"profile_summary": ["candidate_id"], "swadharma_charts": ["candidate_id"], "notifications": ["user_id", "kind", "entity_id"]}
DEFAULTS = {"career_matches": {"counsellor_action": None, "visible_to_candidate": False},
            "stream_matches": {"counsellor_action": None, "visible_to_candidate": False},
            "notifications": {"sent_at": None, "read_at": None}}


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self.embeds, self._order, self._limit, self._single, self._maybe, self._negate = [], None, None, False, False, False
        self.on_conflict, self.ignore_dupes = None, False

    # building
    def select(self, cols="*"):
        self.embeds = [m.group(1) for m in re.finditer(r"([\w!]+)\(", cols)]
        return self

    def _f(self, fn):
        if self._negate:
            self._negate = False
            self.filters.append(lambda r: not fn(r))
        else:
            self.filters.append(fn)
        return self

    def eq(self, c, v): return self._f(lambda r: r.get(c) == v)
    def gte(self, c, v): return self._f(lambda r: r.get(c) is not None and str(r.get(c)) >= str(v))
    def lt(self, c, v): return self._f(lambda r: r.get(c) is not None and str(r.get(c)) < str(v))
    def is_(self, c, v): return self._f(lambda r: r.get(c) is None if v == "null" else r.get(c) == v)

    @property
    def not_(self):
        self._negate = True
        return self

    def or_(self, expr):
        parts = []
        for p in expr.split(","):
            col, op, val = p.split(".", 2)
            parts.append((col, op, val))

        def fn(r):
            for col, op, val in parts:
                x = r.get(col)
                if op == "is" and val == "null" and x is None:
                    return True
                if op == "lt" and x is not None and str(x) < val:
                    return True
            return False
        return self._f(fn)

    def order(self, c, desc=False):
        self._order = (c, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def single(self):
        self._single = True
        return self

    def maybe_single(self):
        self._maybe = True
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, row):
        self.op, self.payload = "update", row
        return self

    def upsert(self, row, on_conflict=None, ignore_duplicates=False):
        self.op, self.payload, self.on_conflict, self.ignore_dupes = "upsert", row, on_conflict, ignore_duplicates
        return self

    def delete(self):
        self.op = "delete"
        return self

    # running
    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.table, []) if all(f(r) for f in self.filters)]

    def _embed(self, r):
        r = copy.deepcopy(r)
        for e in self.embeds:
            target, fk = EMBEDS[(self.table, e)]
            r[e] = copy.deepcopy(next((x for x in self.db.tables.get(target, []) if x["id"] == r.get(fk)), None))
        return r

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            new = {"id": str(uuid.uuid4()), **DEFAULTS.get(self.table, {}), **copy.deepcopy(self.payload)}
            new.setdefault("scored_at", datetime.now(timezone.utc).isoformat()) if self.table == "assessment_results" else None
            rows.append(new)
            self.db.log.append(("insert", self.table, new))
            return Result([new])
        if self.op == "update":
            hit = self._rows()
            for r in hit:
                r.update(copy.deepcopy(self.payload))
            self.db.log.append(("update", self.table, self.payload))
            return Result(hit)
        if self.op == "delete":
            hit = self._rows()
            self.db.tables[self.table] = [r for r in rows if r not in hit]
            return Result(hit)
        if self.op == "upsert":
            keys = (self.on_conflict.split(",") if self.on_conflict else UNIQUE.get(self.table, ["id"]))
            found = next((r for r in rows if all(r.get(k) == self.payload.get(k) for k in keys)), None)
            if found and not self.ignore_dupes:
                found.update(copy.deepcopy(self.payload))
            elif not found:
                rows.append({"id": str(uuid.uuid4()), **DEFAULTS.get(self.table, {}), **copy.deepcopy(self.payload)})
            self.db.log.append(("upsert", self.table, self.payload))
            return Result([found])
        out = [self._embed(r) for r in self._rows()]
        if self._order:
            c, desc = self._order
            out.sort(key=lambda r: (r.get(c) is None, r.get(c) or 0), reverse=desc)
        if self._limit:
            out = out[: self._limit]
        if self._single:
            assert len(out) == 1, f"{self.table}: expected one row, got {len(out)}"
            return Result(out[0])
        if self._maybe:
            return Result(out[0]) if out else None
        return Result(out)


class Bucket:
    def __init__(self, store):
        self.store = store

    def upload(self, path, data, opts=None):
        assert path not in self.store, "write-once"
        self.store[path] = data


class Storage:
    def __init__(self):
        self.files: dict[str, bytes] = {}

    def from_(self, bucket):
        return Bucket(self.files.setdefault(bucket, {}))


class FakeDB:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}
        self.log: list = []
        self.storage = Storage()

    def table(self, name):
        return Query(self, name)
