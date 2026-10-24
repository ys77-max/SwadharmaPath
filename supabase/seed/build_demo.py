"""Demo cases for trying the app end to end: SQL that creates sign-in accounts, candidates
at each stage, completed assessments and a first counselling session.

    python3 supabase/seed/build_demo.py --password '<demo password>' > demo.sql   # load
    python3 supabase/seed/build_demo.py --remove > remove_demo.sql               # remove
    python3 supabase/seed/build_demo.py --template > supabase/seed/demo_cases.sql  # committed copy

demo_cases.sql is the same SQL with the placeholder __DEMO_PASSWORD__ instead of a password,
for loading without Python: replace the placeholder, then run it.

Run the output in the Supabase SQL editor (it runs as postgres). Every demo account uses an
@example.com address and the name starts with "Demo" or "Test", so the cases are easy to spot
and remove. The password is never written to the repo: pass it on the command line.

Loading is idempotent (fixed ids, "on conflict do nothing"). Completed sessions are inserted
in progress and then marked completed, so the database trigger calls the scoring Edge Function
straight away; the worker's next polling run builds profiles and matches.
See docs/sops/technical-sops.md SOP-T9.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import uuid
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from instruments import all_instruments  # noqa: E402

NS = uuid.UUID("5b0c2a8e-1d7f-4a8e-9b51-2f6f6c0d5e11")
DOMAIN = "example.com"
PLACEHOLDER = "__DEMO_PASSWORD__"
JUNIOR = ["interest", "aptitude", "workstyle", "school_values", "learning", "subject_enjoyment"]
STANDARD = ["interest", "aptitude", "workstyle", "values", "learning", "bigfive"]


def uid(key: str) -> str:
    return str(uuid.uuid5(NS, key))


def lit(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


COUNSELLOR = {"key": "counsellor", "email": f"demo.counsellor@{DOMAIN}", "name": "Demo Counsellor (Meera)"}

# riasec: liking 1-5 per letter; apt: chance of a right answer per section; ws: most -> least like me;
# values: most -> least important; learn: 1-5 per style; big5: 1-5 per trait; subj: enjoyment, marks
PERSONAS = [
    dict(key="class9", email=f"demo.class9@{DOMAIN}", name="Demo Aarav Sharma (Class 9)", track="early_explorer", board="CBSE",
         dob="2011-08-14", gender="male", city="Pune", school="Demo Public School, Pune", cls="Class 9", stream=None,
         academics={"class_8_percent": 88}, constraints={}, complete=True,
         riasec=dict(R=4, I=5, A=2, S=2, E=3, C=3), apt=dict(numerical=0.9, verbal=0.6, abstract=0.85, spatial=0.75),
         ws="RDPA", values=["Learning new things", "Winning", "Having freedom", "Making my family proud", "Being creative", "Being kind"],
         learn=dict(visual=4, auditory=2, reading=3, kinesthetic=5),
         subj=dict(maths=(5, 92), science=(5, 90), computers=(4, 85), languages=(2, 70), social_science=(2, 68), art=(2, 65), sports=(4, None)),
         note="Loves robotics club and maths olympiad; parents hope for engineering."),
    dict(key="class10", email=f"demo.class10@{DOMAIN}", name="Demo Ananya Iyer (Class 10)", track="early_explorer", board="ICSE",
         dob="2010-03-02", gender="female", city="Chennai", school="Demo Convent School, Chennai", cls="Class 10", stream=None,
         academics={"class_9_percent": 84}, constraints={}, complete=True,
         riasec=dict(R=2, I=3, A=5, S=4, E=3, C=2), apt=dict(numerical=0.5, verbal=0.9, abstract=0.7, spatial=0.8),
         ws="APRD", values=["Being creative", "Being kind", "Having freedom", "Learning new things", "Making my family proud", "Winning"],
         learn=dict(visual=5, auditory=4, reading=3, kinesthetic=3),
         subj=dict(maths=(2, 66), science=(3, 74), computers=(3, 80), languages=(5, 93), social_science=(4, 86), art=(5, 95), sports=(2, None)),
         note="Draws comics and runs the school magazine; unsure whether Science is expected of her."),
    dict(key="class11", email=f"demo.class11@{DOMAIN}", name="Demo Rohan Mehta (Class 11 Science)", track="student", board="CBSE",
         dob="2009-05-20", gender="male", city="Delhi", school="Demo Senior Secondary School, Delhi", cls="Class 11", stream="Science - PCM with Computer Science",
         academics={"class_10_percent": 91, "class_11_midterm_percent": 78}, constraints={"budget": "Up to 4 lakh a year", "location": "Prefers North India"}, complete=True,
         riasec=dict(R=4, I=5, A=3, S=2, E=3, C=4), apt=dict(numerical=0.85, verbal=0.6, abstract=0.9, spatial=0.7),
         ws="DRPA", values=["Learning", "Achievement", "Independence", "Security", "Creativity", "Work-life balance", "Variety", "Recognition", "Leadership", "Helping others"],
         learn=dict(visual=4, auditory=3, reading=4, kinesthetic=3), big5=dict(O=4, C=4, E=2, A=3, N=3),
         note="Preparing for JEE; also curious about data science and wondering about B.Sc vs B.Tech."),
    dict(key="class12", email=f"demo.class12@{DOMAIN}", name="Demo Kavya Reddy (Class 12 Commerce)", track="student", board="Telangana State Board",
         dob="2008-11-11", gender="female", city="Hyderabad", school="Demo Junior College, Hyderabad", cls="Class 12", stream="Commerce with Mathematics (CEC/MEC)",
         academics={"class_10_gpa": 9.5, "class_11_percent": 89}, constraints={"location": "Hyderabad or Bengaluru"}, complete=True,
         riasec=dict(R=1, I=3, A=2, S=3, E=5, C=5), apt=dict(numerical=0.9, verbal=0.8, abstract=0.6, spatial=0.4),
         ws="RDAP", values=["Achievement", "Security", "Leadership", "Recognition", "Independence", "Learning", "Variety", "Work-life balance", "Helping others", "Creativity"],
         learn=dict(visual=3, auditory=4, reading=5, kinesthetic=2), big5=dict(O=3, C=5, E=4, A=3, N=2),
         note="Deciding between CA, B.Com (Hons) with CFA, and an IPM / BBA route."),
    dict(key="early", email=f"demo.earlycareer@{DOMAIN}", name="Demo Neha Kulkarni (2 yrs, Accounts)", track="professional", board=None,
         dob="2001-06-25", gender="female", city="Bengaluru", school="Demo Retail Pvt Ltd (Accounts Executive)", cls="2 years", stream="Finance and accounts",
         academics={"degree": "B.Com, 2022", "degree_percent": 76}, constraints={"budget": "Self-funded, up to 3 lakh", "study_mode": "Part-time or online"}, complete=True,
         riasec=dict(R=1, I=4, A=3, S=3, E=4, C=4), apt=dict(numerical=0.8, verbal=0.75, abstract=0.75, spatial=0.5),
         ws="RADP", values=["Learning", "Achievement", "Independence", "Variety", "Recognition", "Creativity", "Security", "Work-life balance", "Leadership", "Helping others"],
         learn=dict(visual=4, auditory=3, reading=4, kinesthetic=3), big5=dict(O=5, C=4, E=3, A=3, N=3),
         note="Bored with month-end closing; drawn to analytics or product roles. Wants to switch within a year."),
    dict(key="mid", email=f"demo.midcareer@{DOMAIN}", name="Demo Vikram Singh (12 yrs, Mechanical)", track="professional", board=None,
         dob="1988-01-09", gender="male", city="Gurugram", school="Demo Auto Components Ltd (Production Manager)", cls="12 years", stream="Manufacturing operations",
         academics={"degree": "B.Tech Mechanical, 2010"}, constraints={"location": "NCR only (family)", "pay_cut": "At most 15%"}, complete=True,
         riasec=dict(R=4, I=3, A=2, S=4, E=5, C=3), apt=dict(numerical=0.8, verbal=0.7, abstract=0.6, spatial=0.85),
         ws="RPAD", values=["Leadership", "Helping others", "Work-life balance", "Security", "Achievement", "Recognition", "Learning", "Independence", "Variety", "Creativity"],
         learn=dict(visual=4, auditory=4, reading=2, kinesthetic=5), big5=dict(O=3, C=4, E=4, A=4, N=2),
         note="Plateaued in plant operations; considering supply-chain leadership, EV manufacturing, or training and teaching."),
    # Fresh accounts with nothing taken yet, for trying the candidate screens yourself.
    dict(key="test_junior", email=f"test.junior@{DOMAIN}", name="Test Junior Candidate", track="early_explorer", board="CBSE",
         dob="2012-02-01", gender=None, city="Mumbai", school="Test School", cls="Class 8", stream=None,
         academics={}, constraints={}, complete=False),
    dict(key="test_senior", email=f"test.senior@{DOMAIN}", name="Test Senior Candidate", track="professional", board=None,
         dob="1996-09-15", gender=None, city="Mumbai", school="Test Company", cls="5 years", stream="Any",
         academics={}, constraints={}, complete=False),
]

# instrument code -> scoring-relevant item data, by variant
INSTRUMENTS = {(i["code"], i["track_variant"]): i for i in all_instruments()}


def _clip(x: float) -> int:
    return max(1, min(5, round(x)))


def responses(p: dict, code: str, variant: str, rng: random.Random) -> dict:
    inst = INSTRUMENTS[(code, variant)]
    out = {}
    for item in (i for s in inst["items"]["sections"] for i in s["items"]):
        rt = rng.randint(2600, 9000)
        t = item["type"]
        if code == "interest":
            a = _clip(p["riasec"][item["scale"]] + rng.choice([-1, 0, 0, 0, 1]))
        elif code == "aptitude":
            right = rng.random() < p["apt"].get(item["scale"], 0.5)
            wrong = [o["value"] for o in item["options"] if o["value"] != item["key"]]
            a = item["key"] if right else rng.choice(wrong)
        elif t == "forced_choice":
            # people are not perfectly consistent: rank with noise so the second style shows too
            ranked = sorted(item["options"], key=lambda o: p["ws"].index(o["factor"]) + rng.random() * 2.6)
            a = {"most": ranked[0]["value"], "least": ranked[-1]["value"]}
        elif t == "pair":
            ranked = sorted(item["options"], key=lambda o: p["values"].index(o["value_name"]) + rng.random() * 1.5)
            a = ranked[0]["value"]
        elif code == "learning":
            a = _clip(p["learn"][item["scale"]] + rng.choice([-1, 0, 0, 1]))
        elif code == "bigfive":
            base = p["big5"].get(item["scale"], 3)
            v = _clip(base + rng.choice([-1, 0, 0, 1]))
            a = 6 - v if item.get("reverse") else v
        elif code == "subject_enjoyment":
            a = p["subj"].get(item["scale"], (3, None))[0]
        else:
            a = 3
        out[item["id"]] = {"a": a, "rt": rt}
    return out


def account_sql(key: str, email: str, name: str, role: str) -> str:
    """auth.users + identity; the on_auth_user_created trigger adds public.users as candidate/parent."""
    i = uid(key)
    meta = {"full_name": name, "role": "candidate" if role == "counsellor" else role}
    return f"""insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '{i}', 'authenticated', 'authenticated', {lit(email)},
  extensions.crypt(:'pw', extensions.gen_salt('bf')), now(), '{{"provider": "email", "providers": ["email"]}}'::jsonb,
  {lit(meta)}, now(), now(), '', '', '', '')
on conflict (id) do nothing;
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select '{i}', '{i}', jsonb_build_object('sub', '{i}', 'email', {lit(email)}, 'email_verified', true), 'email', now(), now(), now()
where not exists (select 1 from auth.identities where user_id = '{i}' and provider = 'email');
"""


def build(password: str) -> str:
    pw = password.replace("'", "''")
    sql = ["-- SwadharmaPath demo cases. GENERATED by supabase/seed/build_demo.py; remove with --remove.",
           "begin;", ""]
    sql.append(account_sql(COUNSELLOR["key"], COUNSELLOR["email"], COUNSELLOR["name"], "counsellor"))
    sql.append(f"update public.users set role = 'counsellor' where id = '{uid(COUNSELLOR['key'])}' and role <> 'counsellor';\n")
    counsellor = uid(COUNSELLOR["key"])
    for p in PERSONAS:
        rng = random.Random(p["key"])
        user, cand = uid(p["key"]), uid(p["key"] + ":candidate")
        sql.append(f"-- {p['name']}")
        sql.append(account_sql(p["key"], p["email"], p["name"], "candidate"))
        today = date.today()
        minor = date.fromisoformat(p["dob"]) > today.replace(year=today.year - 18)
        sql.append(f"""insert into public.candidates (id, user_id, track, board, dob, gender, city, school_or_employer, class_or_years_exp,
  stream_or_function, academics, constraints, counsellor_id, status, disclaimer_accepted_at, guardian_consent_at)
values ('{cand}', '{user}', {lit(p['track'])}, {lit(p['board'])}, {lit(p['dob'])}, {lit(p['gender'])}, {lit(p['city'])}, {lit(p['school'])},
  {lit(p['cls'])}, {lit(p['stream'])}, {lit(p['academics'])}, {lit(p['constraints'])}, '{counsellor}',
  {lit('active' if p['complete'] else 'onboarding')}, now(), {'now()' if minor else 'null'})
on conflict (id) do nothing;
""")
        if not p["complete"]:
            continue
        variant = "junior" if p["track"] == "early_explorer" else "standard"
        if variant == "junior":
            rows = ", ".join(f"('{cand}', {lit(s)}, {e}, {lit(m)})" for s, (e, m) in p["subj"].items() if s not in ("computers", "sports") or m)
            sql.append(f"insert into public.subject_enjoyment (candidate_id, subject, enjoyment, marks_pct) values {rows}\non conflict do nothing;\n")
        for code in (JUNIOR if variant == "junior" else STANDARD):
            sid = uid(f"{p['key']}:{code}")
            resp = responses(p, code, variant, rng)
            sql.append(f"""insert into public.assessment_sessions (id, candidate_id, instrument_id, started_at, responses, status)
select '{sid}', '{cand}', i.id, now() - interval '3 days', {lit(resp)}, 'in_progress'
from public.instruments i where i.code = {lit(code)} and i.track_variant = {lit(variant)} and i.is_active
order by i.version desc limit 1
on conflict (id) do nothing;
update public.assessment_sessions set status = 'completed', completed_at = now() - interval '2 days'
where id = '{sid}' and status = 'in_progress';
""")
        sql.append(f"""insert into public.sessions (id, candidate_id, counsellor_id, scheduled_at, duration_min, mode, iccc_stage, notes_private,
  summary_for_candidate, action_items, attended)
values ('{uid(p['key'] + ':s1')}', '{cand}', '{counsellor}', now() - interval '1 day', 60, 'video', 'know_self', {lit(p['note'])},
  'We talked about what you enjoy and what your activities show. Next time we look at options together.', '[]'::jsonb, true),
  ('{uid(p['key'] + ':s2')}', '{cand}', '{counsellor}', now() + interval '6 days', 60, 'video', 'know_world', null, null, '[]'::jsonb, null)
on conflict (id) do nothing;
""")
    sql += ["commit;", ""]
    return "\n".join(sql).replace(":'pw'", f"'{pw}'")


def build_remove() -> str:
    ids = [uid(p["key"]) for p in PERSONAS] + [uid(COUNSELLOR["key"])]
    cands = [uid(p["key"] + ":candidate") for p in PERSONAS]
    q = lambda xs: ", ".join(f"'{x}'" for x in xs)  # noqa: E731
    return f"""-- Removes the demo cases created by supabase/seed/build_demo.py.
-- 1) Every demo login is disabled and every demo case archived (always succeeds).
-- 2) Cases and accounts are then deleted where the append-only rules allow it: a case with a
--    report, or an account named in the audit log, stays archived and disabled instead.
begin;
update auth.users set banned_until = 'infinity' where id in ({q(ids)});
update public.candidates set archived_at = coalesce(archived_at, now()) where id in ({q(cands)});
do $$
declare r record;
begin
  for r in select id from public.candidates where id in ({q(cands)}) loop
    begin
      delete from public.candidates where id = r.id;
    exception when others then raise notice 'kept archived case % (%)', r.id, sqlerrm;
    end;
  end loop;
  for r in select id from auth.users where id in ({q(ids)}) loop
    begin
      delete from public.notifications where user_id = r.id;
      delete from auth.users where id = r.id;
    exception when others then raise notice 'kept disabled account % (%)', r.id, sqlerrm;
    end;
  end loop;
end $$;
commit;
"""


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--password", help="password for every demo account (at least 8 characters)")
    ap.add_argument("--remove", action="store_true", help="print the removal SQL instead")
    ap.add_argument("--template", action="store_true", help="print the load SQL with the __DEMO_PASSWORD__ placeholder")
    args = ap.parse_args(argv)
    if args.remove:
        print(build_remove())
        return
    if args.template:
        print(build(PLACEHOLDER))
        return
    if not args.password or len(args.password) < 8:
        ap.error("--password with at least 8 characters is required")
    print(build(args.password))


if __name__ == "__main__":
    main(sys.argv[1:])
