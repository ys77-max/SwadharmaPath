"""Regenerates the seed block at the end of supabase/migrations/001_init.sql.

    python3 supabase/seed/build_seed.py

Everything after the "-- BEGIN GENERATED SEED" marker is replaced.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from instruments import all_instruments  # noqa: E402
from library import CAREERS, OUTLOOK_SOURCE, SEED_SOURCE, STREAMS  # noqa: E402

MIGRATION = HERE.parent / "migrations" / "001_init.sql"
MARKER = "-- BEGIN GENERATED SEED (supabase/seed/build_seed.py)"


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    raise TypeError(v)


def js(v):
    return lit(json.dumps(v, ensure_ascii=False)) + "::jsonb"


def text_array(xs):
    return "array[" + ", ".join(lit(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"


def num_array(xs):
    return "array[" + ", ".join(repr(x) for x in xs) + "]::numeric[]"


def build():
    out = [MARKER, "", "-- Career library (20) with education pathways"]
    for c in CAREERS:
        out.append("with c as (\n  insert into public.careers (name, family, riasec_code, interest_weights, aptitude_min, workstyle_fit, values_fit,\n"
                   "    description, day_in_life, typical_entry_paths, india_salary_band, outlook, automation_exposure, adjacent_emerging, sources, last_reviewed)\n"
                   f"  values ({lit(c['name'])}, {lit(c['family'])}, {lit(c['riasec_code'])}, {num_array(c['interest_weights'])},\n"
                   f"    {js(c['aptitude_min'])}, {js(c['workstyle_fit'])}, {js(c['values_fit'])},\n"
                   f"    {lit(c['description'])},\n    {lit(c['day_in_life'])},\n"
                   f"    {js(c['typical_entry_paths'])}, {js(c['india_salary_band'])}, {lit(c['outlook'])}, {lit(c['automation_exposure'])},\n"
                   f"    {text_array(c['adjacent_emerging'])}, {js({'content': SEED_SOURCE, 'outlook': OUTLOOK_SOURCE})}, null)\n"
                   "  returning id)\n"
                   "insert into public.education_pathways (career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes)\nselect c.id, v.* from c, (values")
        rows = []
        for p in c["pathways"]:
            rows.append(f"  ({lit(p['level'])}, {lit(p['stream_required'])}, {js(p['exams'])}, {text_array(p['degrees'])}, "
                        f"{js(p['institutions'])}, {lit(p['duration'])}, {lit(p['alternative_routes'])}, {lit(p['notes'])})")
        out.append(",\n".join(rows) + "\n) as v(level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes);\n")

    out.append("-- CBSE stream options (8)")
    out.append("insert into public.stream_options (name, board, subjects, keeps_open_families, closes_families, notes) values")
    out.append(",\n".join(f"  ({lit(s['name'])}, {lit(s['board'])}, {text_array(s['subjects'])}, {text_array(s['keeps_open'])}, "
                          f"{text_array(s['closes'])}, {lit(s['notes'])})" for s in STREAMS) + ";\n")

    out.append("-- Instruments: one junior and one standard version each (placeholder items)")
    for i in all_instruments():
        out.append("insert into public.instruments (code, name, version, track_variant, items, scoring_spec, norms, time_limit_min, is_active) values\n"
                   f"  ({lit(i['code'])}, {lit(i['name'])}, {lit(i['version'])}, {lit(i['track_variant'])},\n"
                   f"   {js(i['items'])},\n   {js(i['scoring_spec'])},\n   {js(i['norms'])}, {lit(i['time_limit_min'])}, true);\n")
    return "\n".join(out)


def main():
    sql = MIGRATION.read_text()
    head = sql.split(MARKER)[0].rstrip() + "\n\n"
    MIGRATION.write_text(head + build())
    print(f"wrote seed block to {MIGRATION}")


if __name__ == "__main__":
    main()
