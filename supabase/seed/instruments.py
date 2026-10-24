"""Placeholder instrument content (original text, not from any licensed test).

Every instrument has items.sections[].items[] so the runner and next_item()
treat all of them the same way. Scoring keys (scale, key, factor, reverse,
value_name) live on the item or option and are stripped by next_item().

Replace the items with validated, licensed content and real norms through
/admin/instruments before launch.
"""
from itertools import combinations

RIASEC = ["R", "I", "A", "S", "E", "C"]
BANDS = ["13-15", "16-18", "19-22", "23+"]

LIKERT_STD = [{"value": v, "label": l} for v, l in
              zip(range(1, 6), ["Strongly dislike", "Dislike", "Not sure", "Like", "Strongly like"])]
LIKERT_JR = [{"value": v, "label": l} for v, l in
             zip(range(1, 6), ["Not for me", "Not really", "Maybe", "I like it", "Love it!"])]
AGREE = [{"value": v, "label": l} for v, l in
         zip(range(1, 6), ["Disagree strongly", "Disagree a little", "Neutral", "Agree a little", "Agree strongly"])]
AGREE_JR = [{"value": v, "label": l} for v, l in
            zip(range(1, 6), ["Not like me at all", "A little not like me", "In between", "A bit like me", "Very much like me"])]

INTEREST_STD = {
    "R": ["Repair a machine or gadget that has stopped working", "Build something with tools in a workshop",
          "Work outdoors on a construction or farm project", "Operate equipment or drive specialised vehicles"],
    "I": ["Work out why an experiment gave an unexpected result", "Read about new discoveries in science",
          "Solve a hard puzzle or maths problem", "Analyse data to find a hidden pattern"],
    "A": ["Design a poster, logo or app screen", "Write a story, poem or script",
          "Perform music, dance or drama", "Photograph or film something in an original way"],
    "S": ["Teach a friend something they find difficult", "Help someone through a personal problem",
          "Volunteer for a community cause", "Care for people who are unwell"],
    "E": ["Convince people to support an idea", "Start and run a small business",
          "Lead a team towards a target", "Negotiate a deal"],
    "C": ["Keep records organised and accurate", "Plan a budget and track spending",
          "Check a document carefully for errors", "Follow a clear process to get a task done"],
}
INTEREST_JR = {
    "R": ["Fix a bicycle or a broken toy", "Build a model with your hands", "Grow plants in a garden"],
    "I": ["Find out how a rocket flies", "Do a science experiment", "Solve a tricky riddle"],
    "A": ["Draw, paint or make a comic", "Make up a story or song", "Act in a school play"],
    "S": ["Help a classmate with homework", "Look after a younger child", "Raise money for a good cause"],
    "E": ["Be the captain of a team", "Sell things at a school fair", "Give a speech in assembly"],
    "C": ["Arrange your books and notes neatly", "Keep score in a match", "Make a timetable and stick to it"],
}

# Aptitude: (prompt, options, key). Original placeholder questions.
APT_STD = {
    "numerical": [
        ("A shirt costs ₹800 after a 20% discount. What was the price before the discount?", ["₹960", "₹1,000", "₹1,040", "₹640"], 1),
        ("A train covers 180 km in 2 hours 30 minutes. What is its average speed?", ["60 km/h", "72 km/h", "75 km/h", "90 km/h"], 1),
        ("If 3 pens and 2 pencils cost ₹50 and 1 pen costs ₹12, what does 1 pencil cost?", ["₹5", "₹6", "₹7", "₹8"], 2),
        ("What is 15% of 240 plus 25% of 120?", ["54", "60", "66", "72"], 2),
    ],
    "verbal": [
        ("Choose the word closest in meaning to METICULOUS.", ["Careless", "Precise", "Quick", "Loud"], 1),
        ("BOOK is to READ as FORK is to …", ["Kitchen", "Eat", "Metal", "Spoon"], 1),
        ("Choose the word opposite in meaning to SCARCE.", ["Rare", "Plentiful", "Small", "Hidden"], 1),
        ("Which sentence is correct?", ["Each of the students have a book.", "Each of the students has a book.", "Each of the student have a book.", "Each students has a book."], 1),
    ],
    "abstract": [
        ("What comes next: 2, 6, 12, 20, 30, …", ["38", "40", "42", "44"], 2),
        ("What comes next: A, C, F, J, O, …", ["S", "T", "U", "V"], 2),
        ("Which one does not belong: 121, 144, 169, 196, 210", ["144", "169", "196", "210"], 3),
        ("If ▲ = 3 and ■ = ▲ + ▲ and ● = ■ × ▲, what is ●?", ["9", "12", "18", "27"], 2),
    ],
    "spatial": [
        ("A cube painted on all faces is cut into 27 equal small cubes. How many small cubes have exactly two painted faces?", ["6", "8", "12", "18"], 2),
        ("You face north, turn 90° right, then 180°. Which way are you facing now?", ["North", "East", "South", "West"], 3),
        ("How many faces does a triangular prism have?", ["4", "5", "6", "8"], 1),
        ("A clock shows 3:00. What time does its mirror image show?", ["9:00", "3:00", "6:00", "12:00"], 0),
    ],
}
APT_JR = {
    "numerical": [
        ("A pencil costs ₹6. How much do 7 pencils cost?", ["₹36", "₹42", "₹48", "₹13"], 1),
        ("What is half of 3 quarters?", ["3/8", "1/2", "3/4", "1/4"], 0),
        ("Riya has ₹100 and spends ₹35. How much is left?", ["₹55", "₹65", "₹75", "₹45"], 1),
    ],
    "verbal": [
        ("HAPPY means nearly the same as …", ["Sad", "Glad", "Angry", "Tired"], 1),
        ("BIRD is to NEST as BEE is to …", ["Honey", "Hive", "Flower", "Wing"], 1),
        ("Which word is spelled correctly?", ["Recieve", "Receive", "Receeve", "Riceive"], 1),
    ],
    "abstract": [
        ("What comes next: 1, 4, 9, 16, …", ["20", "24", "25", "32"], 2),
        ("What comes next: Z, X, V, T, …", ["S", "R", "Q", "P"], 1),
        ("Which one does not belong: circle, square, triangle, cube", ["circle", "square", "triangle", "cube"], 3),
    ],
    "spatial": [
        ("How many corners does a cube have?", ["6", "8", "10", "12"], 1),
        ("If you turn a 'b' upside down (rotate 180°), what letter do you see?", ["d", "p", "q", "b"], 2),
        ("You face east and turn left. Which way are you facing?", ["North", "South", "West", "East"], 0),
    ],
}

# Work-style tetrads: one statement per factor (R results, A affiliative,
# P paced/steady, D detail). The candidate picks most-like and least-like.
WS_STD = [
    ("Driven to win", "Lively with people", "Calm and patient", "Careful and exact"),
    ("Direct", "Persuasive", "Loyal", "Systematic"),
    ("Takes charge", "Enthusiastic", "Easy-going", "Follows the rules"),
    ("Competitive", "Talkative", "Good listener", "Thorough"),
    ("Bold", "Optimistic", "Even-tempered", "Accurate"),
    ("Decisive", "Inspiring", "Dependable", "Analytical"),
    ("Independent", "Sociable", "Consistent", "Precise"),
    ("Forceful", "Charming", "Steady", "Cautious"),
    ("Daring", "Expressive", "Supportive", "Orderly"),
    ("Restless for results", "Warm", "Unhurried", "Detail-minded"),
    ("Firm", "Playful", "Cooperative", "Logical"),
    ("Ambitious", "Friendly", "Patient", "Diligent"),
]
WS_JR = [
    ("I like to win", "I love chatting with friends", "I stay calm", "I like things neat"),
    ("I say what I think", "I cheer people up", "I'm a loyal friend", "I check my work"),
    ("I like to be the leader", "I'm full of energy", "I go with the flow", "I follow instructions"),
    ("I'm brave", "I'm fun", "I'm patient", "I'm careful"),
    ("I decide fast", "I get people excited", "People can count on me", "I think things through"),
    ("I do things my way", "I make friends easily", "I like routines", "I like getting it exactly right"),
    ("I push hard", "I make people laugh", "I help others", "I keep things organised"),
    ("I like challenges", "I like parties", "I like quiet time", "I like rules that make sense"),
]

BIGFIVE = {  # (text, reverse)
    "O": [("I enjoy thinking about new ideas", False), ("I like art, music or literature", False), ("I prefer routines to new experiences", True),
          ("I am curious about many things", False), ("I find abstract ideas boring", True), ("I enjoy imagining possibilities", False)],
    "C": [("I keep my things organised", False), ("I finish what I start", False), ("I often leave tasks to the last minute", True),
          ("I plan ahead", False), ("I can be careless", True), ("I work steadily until a job is done", False)],
    "E": [("I am outgoing and sociable", False), ("I feel energised around people", False), ("I tend to be quiet in groups", True),
          ("I start conversations easily", False), ("I prefer to stay in the background", True), ("I am full of energy", False)],
    "A": [("I am considerate of others' feelings", False), ("I trust people easily", False), ("I can be cold or distant", True),
          ("I like to cooperate", False), ("I start arguments", True), ("I forgive easily", False)],
    "N": [("I worry a lot", False), ("I get stressed easily", False), ("I stay calm under pressure", True),
          ("My mood changes often", False), ("I rarely feel anxious", True), ("I get upset easily", False)],
}
SOCIAL_DESIRABILITY = ["I have never been annoyed with anyone", "I always keep every promise I make",
                       "I have never taken anything that was not mine"]

VALUES_STD = ["Achievement", "Security", "Creativity", "Helping others", "Independence",
              "Recognition", "Variety", "Work-life balance", "Learning", "Leadership"]
VALUES_JR = ["Being kind", "Being creative", "Winning", "Learning new things", "Making my family proud", "Having freedom"]

LEARNING = {
    "visual": ["I understand best from diagrams and charts", "I remember faces better than names", "I like colour-coding my notes"],
    "auditory": ["I learn well by listening to explanations", "I remember things I have discussed aloud", "I like podcasts or recorded lectures"],
    "reading": ["I like reading the textbook before class", "Writing notes helps me remember", "I prefer written instructions"],
    "kinesthetic": ["I learn best by doing", "I need to move around while studying", "I like hands-on experiments"],
}
LEARNING_JR = {
    "visual": ["Pictures help me learn", "I like drawing mind-maps", "I remember what I see"],
    "auditory": ["I learn when someone explains out loud", "I remember songs easily", "I like talking about what I learned"],
    "reading": ["I like reading on my own", "Writing things down helps me", "I like lists"],
    "kinesthetic": ["I learn by trying things", "I can't sit still for long", "I like building models"],
}
SUBJECTS = {"maths": "Maths", "science": "Science", "languages": "Languages (English, Hindi, others)",
            "social_science": "Social Science", "art": "Art and craft", "computers": "Computers", "sports": "Sports and PE"}


def likert_norms(scales, n_items):
    return {b: {s: {"mean": round(n_items * 3.0, 1), "sd": round(n_items * 0.8, 1)} for s in scales} for b in BANDS}


def interest(junior):
    src = INTEREST_JR if junior else INTEREST_STD
    items = []
    for i in range(len(src["R"])):  # interleave scales
        for s in RIASEC:
            items.append({"id": f"int_{s}{i+1}", "type": "likert5", "prompt": src[s][i], "scale": s,
                          "options": LIKERT_JR if junior else LIKERT_STD})
    n = len(src["R"])
    return dict(code="interest", name="Interests" if not junior else "What I like doing",
                items={"sections": [{"code": "main", "name": "Activities", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "riasec", "scales": RIASEC, "min": 1, "max": 5},
                norms=likert_norms(RIASEC, n), time_limit_min=None)


def aptitude(junior):
    src = APT_JR if junior else APT_STD
    secs = []
    names = {"numerical": "Numbers", "verbal": "Words", "abstract": "Patterns", "spatial": "Shapes and space"}
    for code, qs in src.items():
        secs.append({"code": code, "name": names[code], "time_limit_sec": 240 if junior else 300,
                     "items": [{"id": f"apt_{code[:3]}{i+1}", "type": "mcq", "prompt": p, "scale": code, "key": k,
                                "options": [{"value": j, "label": o} for j, o in enumerate(opts)]}
                               for i, (p, opts, k) in enumerate(qs)]})
    n = len(next(iter(src.values())))
    return dict(code="aptitude", name="Aptitude" if not junior else "Brain games",
                items={"sections": secs},
                scoring_spec={"method": "aptitude", "subtests": list(src),
                              "bands": [[0, 25, "Low"], [25, 75, "Average"], [75, 90, "High"], [90, 101, "Very High"]]},
                norms={b: {s: {"mean": round(n * 0.55, 2), "sd": round(n * 0.22, 2)} for s in src} for b in BANDS},
                time_limit_min=(4 if junior else 5) * len(src))


def workstyle(junior):
    src = WS_JR if junior else WS_STD
    items = [{"id": f"ws_{i+1}", "type": "forced_choice",
              "prompt": "Pick the one MOST like you and the one LEAST like you",
              "options": [{"value": v, "label": t, "factor": f} for v, t, f in zip("abcd", tet, "RAPD")]}
             for i, tet in enumerate(src)]
    return dict(code="workstyle", name="Work style" if not junior else "How I like to work",
                items={"sections": [{"code": "main", "name": "Most and least like me", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "workstyle", "factors": ["R", "A", "P", "D"],
                              "graphs": ["others", "self"] if junior else ["others", "stress", "self"], "range": 19},
                norms={}, time_limit_min=None)


def bigfive():
    items = []
    for i in range(6):
        for d in "OCEAN":
            t, rev = BIGFIVE[d][i]
            items.append({"id": f"bf_{d}{i+1}", "type": "likert5", "prompt": t, "scale": d, "reverse": rev, "options": AGREE})
    for i, t in enumerate(SOCIAL_DESIRABILITY):
        items.insert(8 + i * 9, {"id": f"bf_SD{i+1}", "type": "likert5", "prompt": t, "scale": "SD", "sd": True, "options": AGREE})
    norms = {b: {**{d: {"mean": 3.4, "sd": 0.7} for d in "OCEAN"}, "SD": {"mean": 2.6, "sd": 0.8}} for b in BANDS}
    return dict(code="bigfive", name="Personality (Big Five)", items={"sections": [{"code": "main", "name": "About me", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "bigfive", "domains": list("OCEAN"), "score": "mean", "note": "Load licensed BFI-2-S items and keys before launch."},
                norms=norms, time_limit_min=None)


def values(junior):
    vals = VALUES_JR if junior else VALUES_STD
    if junior:
        # 12 pairs over 6 values: every value appears 4 times (all pairs except a perfect matching)
        pairs = [(a, b) for a, b in combinations(range(6), 2) if not (b == a + 1 and a % 2 == 0)]
    else:
        pairs = list(combinations(range(len(vals)), 2))
    # spread pairs so the same value does not repeat back-to-back too often
    pairs = pairs[::2] + pairs[1::2]
    items = [{"id": f"{'sv' if junior else 'val'}_{i+1}", "type": "pair",
              "prompt": "Which matters more to you?" if not junior else "Which is more important to you?",
              "options": [{"value": "a", "label": vals[a], "value_name": vals[a]},
                          {"value": "b", "label": vals[b], "value_name": vals[b]}]}
             for i, (a, b) in enumerate(pairs)]
    return dict(code="school_values" if junior else "values", name="What matters to me" if junior else "Work values",
                items={"sections": [{"code": "main", "name": "Choose one", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "values", "values": vals, "top": 5}, norms={}, time_limit_min=None)


def learning(junior):
    src = LEARNING_JR if junior else LEARNING
    scales = list(src)
    items = [{"id": f"lrn_{s[:3]}{i+1}", "type": "likert5", "prompt": src[s][i], "scale": s, "options": AGREE_JR if junior else AGREE}
             for i in range(3) for s in scales]
    return dict(code="learning", name="How I learn", items={"sections": [{"code": "main", "name": "Learning", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "likert_scales", "scales": scales}, norms=likert_norms(scales, 3), time_limit_min=None)


def subject_enjoyment():
    items = [{"id": f"subj_{k}", "type": "likert5", "prompt": f"How much do you enjoy {v}?", "scale": k, "options": LIKERT_JR}
             for k, v in SUBJECTS.items()]
    return dict(code="subject_enjoyment", name="Subjects I enjoy", items={"sections": [{"code": "main", "name": "Subjects", "time_limit_sec": None, "items": items}]},
                scoring_spec={"method": "likert_scales", "scales": list(SUBJECTS), "per_item": True}, norms={}, time_limit_min=None)


def all_instruments():
    out = []
    for junior in (True, False):
        variant = "junior" if junior else "standard"
        for inst in (interest(junior), aptitude(junior), workstyle(junior), values(junior), learning(junior)):
            out.append({**inst, "track_variant": variant})
    out.append({**bigfive(), "track_variant": "standard"})
    out.append({**subject_enjoyment(), "track_variant": "junior"})
    for o in out:
        o["version"] = "0.1-placeholder"
    return out
