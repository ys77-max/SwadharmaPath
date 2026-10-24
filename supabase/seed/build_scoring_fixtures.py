"""Builds supabase/functions/_shared/scoring_fixtures.json (inputs only).

Expected outputs are filled by the TypeScript scorer:
    UPDATE_FIXTURES=1 npx vitest run supabase/functions
and worker/tests/test_scoring.py checks the Python scorer gives the same result.
"""
import json
import pathlib
import random
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from instruments import all_instruments  # noqa: E402

OUT = HERE.parent / "functions" / "_shared" / "scoring_fixtures.json"


def answer(item, rng, mode):
    t = item["type"]
    if t == "likert5":
        return 4 if mode == "straight" else rng.randint(1, 5)
    if t == "mcq":
        return item["key"] if rng.random() < 0.7 else rng.randint(0, 3)
    if t == "pair":
        return rng.choice(["a", "b"])
    if t == "forced_choice":
        m, l = rng.sample(["a", "b", "c", "d"], 2)
        return {"most": m, "least": l}
    raise ValueError(t)


def main():
    cases = []
    for inst in all_instruments():
        for mode in ("normal", "fast", "straight"):
            if mode == "straight" and inst["code"] not in ("interest", "bigfive"):
                continue
            rng = random.Random(f"{inst['code']}-{inst['track_variant']}-{mode}")
            responses = {}
            for sec in inst["items"]["sections"]:
                for item in sec["items"]:
                    rt = rng.randint(400, 1200) if mode == "fast" else rng.randint(1800, 9000)
                    responses[item["id"]] = {"a": answer(item, rng, mode), "rt": rt}
            cases.append({
                "name": f"{inst['code']}/{inst['track_variant']}/{mode}",
                "input": {"items": inst["items"], "scoring_spec": inst["scoring_spec"], "norms": inst["norms"],
                          "responses": responses, "ageBand": "16-18", "variant": inst["track_variant"]},
                "expected": None,
            })
    OUT.write_text(json.dumps(cases, ensure_ascii=False, indent=1))
    print(f"wrote {len(cases)} cases to {OUT}")


if __name__ == "__main__":
    main()
