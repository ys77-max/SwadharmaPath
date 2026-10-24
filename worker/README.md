# SwadharmaPath worker

Python 3.12 package that does all scoring, matching, Swadharma and PDF work. The web app only reads results.

| Module | Does |
|---|---|
| `scoring.py` | Scores completed assessment sessions (mirror of the `score_instrument` Edge Function; both are tested against `supabase/functions/_shared/scoring_fixtures.json`) and builds `profile_summary` vectors. |
| `match.py` | Career fit = 35 interest + 25 aptitude + 15 work style + 10 values + outlook (10/7/6/2) + 5 constraints. Top 15 into `career_matches`, hidden until the counsellor publishes. Keeps pinned / hidden / added rows. |
| `streams.py` | Class 8–10 stream fit = 35 interest + 30 aptitude + 20 academics & enjoyment + 10 breadth + 5 board. Top 5, plus the widest stream always. |
| `swadharma.py` | Lahiri sidereal chart (Swiss Ephemeris, Moshier), D9/D10, KP cusps and sub-lords, Ashtakavarga, Shadbala proxy, yogas, Vimshottari. Six components (25/20/20/15/10/10) per family; unknown time → Moon sign + dignity only, confidence low. Personality lens, agreement matrix, favourable windows. Runs only with opt-in and consent. |
| `karakatwa.json` | Planet → career-family weights. Editable by the agency astrologer; read at run time. |
| `reports.py` + `templates/` | Six WeasyPrint reports. Disclaimer on every page; the Swadharma report opens with it. Uploads to the private `reports` bucket and sets `pdf_path` once. |
| `scheduler.py` | APScheduler: minute polling (score, refresh, render, deliver notifications), nightly SLA and outcome reminders, quarterly outlook refresh. |
| `db.py` | Service-role Supabase client. |

## Run locally

```bash
cd worker
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt        # WeasyPrint also needs Pango (apt install libpango-1.0-0 libpangoft2-1.0-0)
pytest                                     # 88 tests, no network or database needed
cp .env.example .env                       # fill in the service-role key
set -a; . ./.env; set +a
python scheduler.py --once                 # every job once
python scheduler.py                        # long-running scheduler
```

## Deploy (Railway)

The `Dockerfile` and `railway.json` build a single long-running service. Set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` as service variables. One instance only: jobs are idempotent, but two
schedulers would duplicate work.

## Rules the code keeps

- Swadharma output goes only to `swadharma_charts`, `swadharma_scores` and the `swadharma` key of
  match breakdowns, which the candidate views strip. `tests/test_pipeline.py` checks this.
- Re-runs keep counsellor notes, pins, hides, additions and published flags.
- Lens text never covers health, marriage, longevity or wealth and never prohibits (`BANNED_TERMS` test).
- Candidate, parent and stream reports never contain Swadharma data or private session notes.
