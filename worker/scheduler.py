"""Worker entry point: APScheduler jobs.

Polling (every minute):
  * score_pending       completed sessions without a result (Edge Function fallback)
  * refresh_candidates  profile vectors → career matches / stream recommendations,
                        and Swadharma for consented candidates whose chart is missing or stale
  * render_reports      requested reports without a PDF
  * deliver             notifications not yet sent (log by default; plug in email/SMS here)
  * library_refresh     queued library refresh runs → proposals for the admin to review
  * library_rematch     after a refresh is applied, recompute every active candidate's matches
Nightly (02:15 IST, after the pg_cron missed-items job):
  * report SLA check    counsellor + admins told when a report is overdue (7 days after assessments)
  * outcome reminders   6 / 12 / 24 months after the roadmap was published
Quarterly (1 Jan / Apr / Jul / Oct, 09:00 IST):
  * outlook refresh     queues an AI library refresh (needs ANTHROPIC_API_KEY); without a key, or
                        while another refresh is open, admins are reminded to review stale careers
Archived candidates (candidates.archived_at set) are skipped by every job.

Run: python scheduler.py           (blocking scheduler)
     python scheduler.py --once    (polling and nightly jobs once, then exit; handy for a smoke test.
                                    The quarterly job is left out so a smoke test never starts a paid AI refresh)
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone

from apscheduler.schedulers.blocking import BlockingScheduler

import library_refresh
import match
import reports
import scoring
import streams
import swadharma

log = logging.getLogger("swadharmapath.worker")
IST = "Asia/Kolkata"
CHECKPOINTS = {"6m": 182, "12m": 365, "24m": 730}
OUTLOOK_REVIEW_DAYS = 90


# ---------------------------------------------------------------- pure helpers

def due_checkpoints(published: date, today: date, recorded: set[str]) -> list[str]:
    """Outcome checkpoints that have come due and are not yet recorded."""
    return [k for k, days in CHECKPOINTS.items() if today >= published + timedelta(days=days) and k not in recorded]


def needs_refresh(latest_result_at: str | None, profile_updated_at: str | None) -> bool:
    return bool(latest_result_at) and (not profile_updated_at or latest_result_at > profile_updated_at)


def swadharma_stale(chart_computed_at: str | None, consent_at: str | None) -> bool:
    return bool(consent_at) and (not chart_computed_at or consent_at > chart_computed_at)


def _notify(db, user_id: str | None, kind: str, title: str, body: str, entity: str, entity_id: str, candidate_id: str | None = None):
    """One notification per (user, kind, entity); the unique index makes repeats a no-op."""
    if not user_id:
        return
    db.table("notifications").upsert({"user_id": user_id, "candidate_id": candidate_id, "kind": kind, "title": title,
                                      "body": body, "entity": entity, "entity_id": entity_id},
                                     on_conflict="user_id,kind,entity_id", ignore_duplicates=True).execute()


def _admins(db) -> list[str]:
    return [u["id"] for u in db.table("users").select("id").eq("role", "admin").execute().data]


# ---------------------------------------------------------------- jobs

def job_score_pending(db) -> int:
    return scoring.score_pending(db)


def job_refresh_candidates(db) -> int:
    done = 0
    for c in db.table("candidates").select("id, track, swadharma_opted_in").is_("archived_at", "null").execute().data:
        latest = db.table("assessment_results").select("scored_at").eq("candidate_id", c["id"]) \
            .order("scored_at", desc=True).limit(1).execute().data
        prof = db.table("profile_summary").select("updated_at").eq("candidate_id", c["id"]).maybe_single().execute()
        if needs_refresh(latest[0]["scored_at"] if latest else None, ((prof.data if prof else None) or {}).get("updated_at")):
            scoring.build_profile(db, c["id"])
            (streams.run if c["track"] == "early_explorer" else match.run)(db, c["id"])
            done += 1
        if c["swadharma_opted_in"]:
            bd = db.table("birth_details").select("consent_at").eq("candidate_id", c["id"]).maybe_single().execute()
            ch = db.table("swadharma_charts").select("computed_at").eq("candidate_id", c["id"]).maybe_single().execute()
            if swadharma_stale(((ch.data if ch else None) or {}).get("computed_at"), ((bd.data if bd else None) or {}).get("consent_at")):
                swadharma.run(db, c["id"])
                done += 1
    return done


def job_render_reports(db) -> int:
    return reports.render_pending(db)


def job_deliver(db) -> int:
    rows = db.table("notifications").select("id, user_id, kind, title").is_("sent_at", "null").limit(200).execute().data
    for n in rows:
        log.info("notify %s %s: %s", n["user_id"], n["kind"], n["title"])
        db.table("notifications").update({"sent_at": datetime.now(timezone.utc).isoformat()}).eq("id", n["id"]).execute()
    return len(rows)


def job_report_sla(db) -> int:
    now = datetime.now(timezone.utc).isoformat()
    late = db.table("v_caseload").select("candidate_id, full_name, counsellor_id, report_due_at, reported_at") \
        .lt("report_due_at", now).is_("reported_at", "null").execute().data
    admins = _admins(db)
    for r in late:
        title = f"Report overdue: {r['full_name'] or 'candidate'}"
        body = f"The report was due on {r['report_due_at'][:10]} (7 days after assessments)."
        for uid in [r["counsellor_id"], *admins]:
            _notify(db, uid, "report_sla", title, body, "candidates", r["candidate_id"], r["candidate_id"])
    return len(late)


def job_outcome_reminders(db, today: date | None = None) -> int:
    today = today or date.today()
    sent = 0
    names = {u["id"]: u["full_name"] for u in db.table("users").select("id, full_name").execute().data}
    for rm in db.table("roadmaps").select("id, candidate_id, published_at, candidates(counsellor_id, user_id, archived_at)") \
            .not_.is_("published_at", "null").execute().data:
        if (rm.get("candidates") or {}).get("archived_at"):
            continue
        recorded = {o["checkpoint"] for o in db.table("outcomes").select("checkpoint").eq("candidate_id", rm["candidate_id"]).execute().data}
        cand = rm.get("candidates") or {}
        name = names.get(cand.get("user_id")) or "candidate"
        for cp in due_checkpoints(date.fromisoformat(rm["published_at"][:10]), today, recorded):
            _notify(db, cand.get("counsellor_id"), f"outcome_{cp}", f"{cp} outcome check-in: {name}",
                    f"Record the {cp} outcome (status, career, satisfaction).", "roadmaps", rm["id"], rm["candidate_id"])
            sent += 1
    return sent


def _open_refresh(db) -> dict | None:
    rows = db.table("library_refresh_runs").select("id, status").in_("status", ["queued", "running", "review"]).execute().data
    return rows[0] if rows else None


def job_outlook_refresh(db, today: date | None = None) -> int:
    """Quarterly: queue an AI refresh of the whole library. Falls back to a reminder about
    careers not reviewed in 90 days when there is no API key or a refresh is already open."""
    today = today or date.today()
    if os.environ.get("ANTHROPIC_API_KEY") and not _open_refresh(db):
        run = db.table("library_refresh_runs").insert({"scope": "all", "source": "scheduled", "status": "queued"}).execute().data[0]
        log.info("queued scheduled library refresh %s", run["id"])
        return 1
    cutoff = (today - timedelta(days=OUTLOOK_REVIEW_DAYS)).isoformat()
    stale = db.table("careers").select("id, name").or_(f"last_reviewed.is.null,last_reviewed.lt.{cutoff}").execute().data
    if not stale:
        return 0
    body = f"{len(stale)} careers have not been reviewed since {cutoff}: " + ", ".join(c["name"] for c in stale[:10]) + ("…" if len(stale) > 10 else "")
    body += " Open Careers & streams and click Refresh now, or download the CSV, edit it and upload it."
    for uid in _admins(db):
        # entity_id is the first stale career so each quarter's reminder is distinct per batch
        _notify(db, uid, f"outlook_refresh_{today.year}q{(today.month - 1) // 3 + 1}", "Quarterly outlook refresh", body, "careers", stale[0]["id"])
    return len(stale)


def job_library_refresh(db, client_factory=None) -> int:
    """Queued refresh runs → proposals. Admins are told when a run is ready or failed."""
    runs = db.table("library_refresh_runs").select("*").eq("status", "queued").order("created_at").limit(1).execute().data
    for run in runs:
        try:
            summary = library_refresh.process_run(db, run, client_factory or library_refresh.anthropic_client)
            title, body = "Library refresh ready to review", (
                f"{summary['proposals']} suggested change(s) across {summary['checked']} item(s). Approve or reject them, then apply.")
        except Exception as e:  # recorded on the run by process_run
            title, body = "Library refresh failed", str(e)[:300]
        for uid in _admins(db):
            _notify(db, uid, "library_refresh", title, body, "library_refresh_runs", run["id"])
    return len(runs)


def job_library_rematch(db) -> int:
    """After an applied refresh, recompute matches for every active candidate with a profile.
    match.run / streams.run keep pinned, hidden, added and published rows."""
    runs = db.table("library_refresh_runs").select("id").eq("status", "applied").is_("rematched_at", "null").execute().data
    if not runs:
        return 0
    done = 0
    profiled = {p["candidate_id"] for p in db.table("profile_summary").select("candidate_id").execute().data}
    for c in db.table("candidates").select("id, track").is_("archived_at", "null").execute().data:
        if c["id"] in profiled:
            (streams.run if c["track"] == "early_explorer" else match.run)(db, c["id"])
            done += 1
    for r in runs:
        db.table("library_refresh_runs").update({"rematched_at": datetime.now(timezone.utc).isoformat()}).eq("id", r["id"]).execute()
    return done


POLLING = [job_score_pending, job_refresh_candidates, job_render_reports, job_deliver, job_library_refresh, job_library_rematch]
NIGHTLY = [job_report_sla, job_outcome_reminders]


def _safe(job, db):
    try:
        n = job(db)
        if n:
            log.info("%s: %s", job.__name__, n)
    except Exception:  # one bad row must not stop the scheduler
        log.exception("%s failed", job.__name__)


def main(argv: list[str]) -> None:
    from db import client
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db = client()
    if "--once" in argv:
        for job in POLLING + NIGHTLY:
            _safe(job, db)
        return
    sched = BlockingScheduler(timezone=IST)
    for job in POLLING:
        sched.add_job(_safe, "interval", minutes=1, args=[job, db], id=job.__name__, max_instances=1, coalesce=True)
    for job in NIGHTLY:
        sched.add_job(_safe, "cron", hour=2, minute=15, args=[job, db], id=job.__name__)
    sched.add_job(_safe, "cron", month="1,4,7,10", day=1, hour=9, args=[job_outlook_refresh, db], id="job_outlook_refresh")
    log.info("SwadharmaPath worker started")
    sched.start()


if __name__ == "__main__":
    main(sys.argv[1:])
