from datetime import date

import scheduler as S


def test_due_checkpoints():
    pub = date(2025, 1, 1)
    assert S.due_checkpoints(pub, date(2025, 6, 1), set()) == []
    assert S.due_checkpoints(pub, date(2025, 7, 3), set()) == ["6m"]
    assert S.due_checkpoints(pub, date(2026, 1, 2), {"6m"}) == ["12m"]
    assert S.due_checkpoints(pub, date(2027, 1, 2), set()) == ["6m", "12m", "24m"]


def test_refresh_and_staleness():
    assert S.needs_refresh("2026-10-02T00:00:00Z", None)
    assert S.needs_refresh("2026-10-02T00:00:00Z", "2026-10-01T00:00:00Z")
    assert not S.needs_refresh("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")
    assert not S.needs_refresh(None, None)
    assert S.swadharma_stale(None, "2026-10-01")
    assert not S.swadharma_stale(None, None)  # no consent, never computed
    assert not S.swadharma_stale("2026-10-02", "2026-10-01")


def test_public_logs_hide_names(monkeypatch, caplog):
    import logging
    from fakedb import FakeDB
    db = FakeDB()
    db.tables["notifications"] = [{"id": "n1", "user_id": "u1", "kind": "report_sla", "title": "Report overdue: Ravi Kumar", "sent_at": None}]
    monkeypatch.setattr(S, "PUBLIC_LOGS", True)
    with caplog.at_level(logging.INFO, logger="swadharmapath.worker"):
        assert S.job_deliver(db) == 1
    assert "Ravi" not in caplog.text and "u1" not in caplog.text and "report_sla" in caplog.text


def test_run_groups():
    assert S.GROUPS["quarterly"] == [S.job_outlook_refresh]
    assert S.job_library_refresh in S.GROUPS["polling"] and S.job_report_sla in S.GROUPS["nightly"]
