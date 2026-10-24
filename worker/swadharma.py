"""Swadharma engine: Vedic / KP / Ashtakavarga career-family points.

Counsellor-only. Runs only when candidates.swadharma_opted_in and
birth_details.consent_at exist. Writes swadharma_charts and swadharma_scores,
and the counsellor-only `swadharma` key of career_matches / stream_matches
breakdowns (stripped by the candidate views). Never writes anywhere a
candidate or parent can read.

Swiss Ephemeris (Moshier, no data files needed), Lahiri sidereal, whole-sign
houses for Parashari work, Placidus cusps for KP.

Points per family (max 100):
  1. D10                 25
  2. KP 10th sub-lord    20
  3. Ashtakavarga        20
  4. Planetary strength  15
  5. Yogas               10
  6. Dasha timing        10
Unknown birth time: Moon-sign (Chandra lagna) and dignity components only,
rescaled to 100, confidence 'low'.

The output describes a traditional lens. It never rules a family out and
the text never covers health, marriage, longevity or wealth.
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import swisseph as swe

from families import FAMILIES, FAMILY_RIASEC

ENGINE_VERSION = "swadharma-0.1"
AYANAMSA = "lahiri"
FLAGS = swe.FLG_MOSEPH | swe.FLG_SIDEREAL | swe.FLG_SPEED
KARAKATWA_PATH = Path(__file__).with_name("karakatwa.json")

PLANETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn", "Rahu", "Ketu"]
SEVEN = PLANETS[:7]
SWE_ID = {"Sun": swe.SUN, "Moon": swe.MOON, "Mars": swe.MARS, "Mercury": swe.MERCURY,
          "Jupiter": swe.JUPITER, "Venus": swe.VENUS, "Saturn": swe.SATURN, "Rahu": swe.MEAN_NODE}
SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius",
         "Capricorn", "Aquarius", "Pisces"]
SIGN_LORD = ["Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"]
EXALT = {"Sun": 0, "Moon": 1, "Mars": 9, "Mercury": 5, "Jupiter": 3, "Venus": 11, "Saturn": 6, "Rahu": 1, "Ketu": 7}
OWN = {"Sun": {4}, "Moon": {3}, "Mars": {0, 7}, "Mercury": {2, 5}, "Jupiter": {8, 11}, "Venus": {1, 6},
       "Saturn": {9, 10}, "Rahu": {10}, "Ketu": {7}}
# Natural relationships (Parashara). Nodes borrow Saturn's (Rahu) and Mars's (Ketu).
FRIENDS = {"Sun": {"Moon", "Mars", "Jupiter"}, "Moon": {"Sun", "Mercury"}, "Mars": {"Sun", "Moon", "Jupiter"},
           "Mercury": {"Sun", "Venus"}, "Jupiter": {"Sun", "Moon", "Mars"}, "Venus": {"Mercury", "Saturn"},
           "Saturn": {"Mercury", "Venus"}}
ENEMIES = {"Sun": {"Venus", "Saturn"}, "Moon": set(), "Mars": {"Mercury"}, "Mercury": {"Moon"},
           "Jupiter": {"Mercury", "Venus"}, "Venus": {"Sun", "Moon"}, "Saturn": {"Sun", "Moon", "Mars"}}
NODE_PROXY = {"Rahu": "Saturn", "Ketu": "Mars"}
COMBUST_ORB = {"Moon": 12, "Mars": 17, "Mercury": 14, "Jupiter": 11, "Venus": 10, "Saturn": 15}
COMBUST_ORB_RETRO = {"Mercury": 12, "Venus": 8}
DIG_BALA_HOUSE = {"Sun": 10, "Mars": 10, "Jupiter": 1, "Mercury": 1, "Moon": 4, "Venus": 4, "Saturn": 7}
NAISARGIKA = {"Sun": 1.0, "Moon": 0.86, "Venus": 0.71, "Jupiter": 0.57, "Mercury": 0.43, "Mars": 0.29, "Saturn": 0.14}
SPECIAL_ASPECTS = {"Mars": (4, 8), "Jupiter": (5, 9), "Saturn": (3, 10), "Rahu": (5, 9), "Ketu": (5, 9)}

# Vimshottari: nakshatra lords in order from Ashwini, and their years (total 120)
DASHA_LORDS = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"]
DASHA_YEARS = {"Ketu": 7, "Venus": 20, "Sun": 6, "Moon": 10, "Mars": 7, "Rahu": 18, "Jupiter": 16, "Saturn": 19, "Mercury": 17}
NAK_SPAN = 360 / 27
YEAR_DAYS = 365.25

# Benefic points (Parashara). BAV[planet][contributor] = houses counted from the contributor.
BAV_TABLE: dict[str, dict[str, list[int]]] = {
    "Sun": {"Sun": [1, 2, 4, 7, 8, 9, 10, 11], "Moon": [3, 6, 10, 11], "Mars": [1, 2, 4, 7, 8, 9, 10, 11],
            "Mercury": [3, 5, 6, 9, 10, 11, 12], "Jupiter": [5, 6, 9, 11], "Venus": [6, 7, 12],
            "Saturn": [1, 2, 4, 7, 8, 9, 10, 11], "Lagna": [3, 4, 6, 10, 11, 12]},
    "Moon": {"Sun": [3, 6, 7, 8, 10, 11], "Moon": [1, 3, 6, 7, 10, 11], "Mars": [2, 3, 5, 6, 9, 10, 11],
             "Mercury": [1, 3, 4, 5, 7, 8, 10, 11], "Jupiter": [1, 4, 7, 8, 10, 11, 12], "Venus": [3, 4, 5, 7, 9, 10, 11],
             "Saturn": [3, 5, 6, 11], "Lagna": [3, 6, 10, 11]},
    "Mars": {"Sun": [3, 5, 6, 10, 11], "Moon": [3, 6, 11], "Mars": [1, 2, 4, 7, 8, 10, 11], "Mercury": [3, 5, 6, 11],
             "Jupiter": [6, 10, 11, 12], "Venus": [6, 8, 11, 12], "Saturn": [1, 4, 7, 8, 9, 10, 11], "Lagna": [1, 3, 6, 10, 11]},
    "Mercury": {"Sun": [5, 6, 9, 11, 12], "Moon": [2, 4, 6, 8, 10, 11], "Mars": [1, 2, 4, 7, 8, 9, 10, 11],
                "Mercury": [1, 3, 5, 6, 9, 10, 11, 12], "Jupiter": [6, 8, 11, 12], "Venus": [1, 2, 3, 4, 5, 8, 9, 11],
                "Saturn": [1, 2, 4, 7, 8, 9, 10, 11], "Lagna": [1, 2, 4, 6, 8, 10, 11]},
    "Jupiter": {"Sun": [1, 2, 3, 4, 7, 8, 9, 10, 11], "Moon": [2, 5, 7, 9, 11], "Mars": [1, 2, 4, 7, 8, 10, 11],
                "Mercury": [1, 2, 4, 5, 6, 9, 10, 11], "Jupiter": [1, 2, 3, 4, 7, 8, 10, 11], "Venus": [2, 5, 6, 9, 10, 11],
                "Saturn": [3, 5, 6, 12], "Lagna": [1, 2, 4, 5, 6, 7, 9, 10, 11]},
    "Venus": {"Sun": [8, 11, 12], "Moon": [1, 2, 3, 4, 5, 8, 9, 11, 12], "Mars": [3, 5, 6, 9, 11, 12],
              "Mercury": [3, 5, 6, 9, 11], "Jupiter": [5, 8, 9, 10, 11], "Venus": [1, 2, 3, 4, 5, 8, 9, 10, 11],
              "Saturn": [3, 4, 5, 8, 9, 10, 11], "Lagna": [1, 2, 3, 4, 5, 8, 9, 11]},
    "Saturn": {"Sun": [1, 2, 4, 7, 8, 10, 11], "Moon": [3, 6, 11], "Mars": [3, 5, 6, 10, 11, 12],
               "Mercury": [6, 8, 9, 10, 11, 12], "Jupiter": [5, 6, 11, 12], "Venus": [6, 11, 12],
               "Saturn": [3, 5, 6, 11], "Lagna": [1, 3, 4, 6, 10, 11]},
}
BAV_TOTALS = {"Sun": 48, "Moon": 49, "Mars": 39, "Mercury": 54, "Jupiter": 56, "Venus": 52, "Saturn": 39}

WEIGHTS = {"d10": 25, "kp": 20, "ashtakavarga": 20, "strength": 15, "yogas": 10, "dasha": 10}
UNKNOWN_TIME_WEIGHTS = {"moon_sign": 25, "strength": 15}
CAREER_HOUSES = {2, 6, 10, 11}
SERVICE_FAMILIES = ["Public Service & Defence", "Law & Governance", "Education & Counselling", "Medicine & Health"]
BUSINESS_FAMILIES = ["Business, Management & Entrepreneurship", "Sales, Marketing & Media", "Hospitality, Travel & Service"]


def load_karakatwa(path: Path = KARAKATWA_PATH) -> dict[str, dict[str, float]]:
    raw = json.loads(path.read_text())["planets"]
    return {p: {f: float(raw[p].get(f, 0)) for f in FAMILIES} for p in PLANETS}


# ---------------------------------------------------------------- chart

def sign_of(lon: float) -> int:
    return int(lon // 30) % 12


def d9_sign(lon: float) -> int:
    return math.floor(lon * 9 / 30) % 12


def d10_sign(lon: float) -> int:
    """Dashamsa: 3° parts; odd signs count from the sign itself, even signs from the 9th."""
    s = sign_of(lon)
    part = int((lon % 30) // 3)
    return (s + part) % 12 if s % 2 == 0 else (s + 8 + part) % 12


def nakshatra(lon: float) -> dict:
    """Nakshatra index, star-lord and KP sub-lord (Vimshottari proportions within the star)."""
    n = int(lon // NAK_SPAN) % 27
    star = DASHA_LORDS[n % 9]
    into = (lon % NAK_SPAN) / NAK_SPAN * 120  # position in "years" through the star
    i = DASHA_LORDS.index(star)
    acc = 0.0
    sub = star
    for k in range(9):
        lord = DASHA_LORDS[(i + k) % 9]
        acc += DASHA_YEARS[lord]
        if into < acc:
            sub = lord
            break
    return {"index": n, "pada": int((lon % NAK_SPAN) // (NAK_SPAN / 4)) + 1, "star_lord": star, "sub_lord": sub}


def whole_house(sign: int, lagna_sign: int) -> int:
    return (sign - lagna_sign) % 12 + 1


def dignity(planet: str, sign: int) -> tuple[str, float]:
    if EXALT[planet] == sign:
        return "exalted", 1.0
    if (EXALT[planet] + 6) % 12 == sign:
        return "debilitated", 0.15
    if sign in OWN[planet]:
        return "own", 0.85
    p = NODE_PROXY.get(planet, planet)
    lord = SIGN_LORD[sign]
    if lord in FRIENDS[p]:
        return "friend", 0.65
    if lord in ENEMIES[p]:
        return "enemy", 0.35
    return "neutral", 0.5


def to_utc(birth_date: date, birth_time: time | None, tz: str | None) -> datetime:
    local = datetime.combine(birth_date, birth_time or time(12, 0))
    return local.replace(tzinfo=ZoneInfo(tz or "Asia/Kolkata")).astimezone(timezone.utc)


def julian_day(dt_utc: datetime) -> float:
    h = dt_utc.hour + dt_utc.minute / 60 + dt_utc.second / 3600
    return swe.julday(dt_utc.year, dt_utc.month, dt_utc.day, h)


def compute_chart(birth_date: date, birth_time: time | None, tz: str | None, lat: float, lng: float,
                  time_certainty: str = "exact") -> dict:
    """Planet longitudes, D1/D9/D10 signs, KP cusps and star/sub lords. Pure, no database."""
    swe.set_sid_mode(swe.SIDM_LAHIRI)
    known = time_certainty != "unknown" and birth_time is not None
    dt = to_utc(birth_date, birth_time if known else None, tz)
    jd = julian_day(dt)
    planets: dict[str, dict] = {}
    for p in PLANETS[:8]:
        xx, _ = swe.calc_ut(jd, SWE_ID[p], FLAGS)
        planets[p] = {"lon": xx[0] % 360, "speed": xx[3]}
    planets["Ketu"] = {"lon": (planets["Rahu"]["lon"] + 180) % 360, "speed": planets["Rahu"]["speed"]}

    cusps = asc = None
    if known:
        c, a = swe.houses_ex(jd, lat, lng, b"P", swe.FLG_SIDEREAL)
        cusps = [x % 360 for x in c[:12]]
        asc = a[0] % 360
    lagna_sign = sign_of(asc) if known else sign_of(planets["Moon"]["lon"])  # Chandra lagna fallback

    sun = planets["Sun"]["lon"]
    for p, d in planets.items():
        lon = d["lon"]
        s = sign_of(lon)
        name, score = dignity(p, s)
        gap = abs((lon - sun + 180) % 360 - 180)
        retro = d["speed"] < 0 and p not in ("Rahu", "Ketu")
        orb = (COMBUST_ORB_RETRO if retro else COMBUST_ORB).get(p, COMBUST_ORB.get(p))
        d.update({
            "sign": s, "sign_name": SIGNS[s], "deg_in_sign": round(lon % 30, 4),
            "house": whole_house(s, lagna_sign),
            "d9": d9_sign(lon), "d10": d10_sign(lon),
            "dignity": name, "dignity_score": score,
            "retrograde": retro,
            "combust": bool(orb) and gap < orb,
            **nakshatra(lon),
        })
        if cusps:
            d["kp_house"] = kp_house(lon, cusps)
    chart = {
        "ayanamsa": AYANAMSA, "ayanamsa_deg": round(swe.get_ayanamsa_ut(jd), 4),
        "jd": jd, "utc": dt.isoformat(), "time_known": known, "time_certainty": time_certainty,
        "lagna": {"lon": asc, "sign": lagna_sign, "sign_name": SIGNS[lagna_sign], "basis": "ascendant" if known else "moon",
                  **({"d9": d9_sign(asc), "d10": d10_sign(asc), **nakshatra(asc)} if known else {})},
        "planets": planets,
    }
    if cusps:
        chart["kp_cusps"] = [{"house": i + 1, "lon": round(c, 4), "sign": sign_of(c), "sign_lord": SIGN_LORD[sign_of(c)], **nakshatra(c)}
                             for i, c in enumerate(cusps)]
    return chart


def kp_house(lon: float, cusps: list[float]) -> int:
    for i in range(12):
        start, end = cusps[i], cusps[(i + 1) % 12]
        if (lon - start) % 360 < (end - start) % 360:
            return i + 1
    return 12


def house_lord(chart: dict, house: int) -> str:
    return SIGN_LORD[(chart["lagna"]["sign"] + house - 1) % 12]


def occupants(chart: dict, house: int) -> list[str]:
    return [p for p, d in chart["planets"].items() if d["house"] == house]


def aspects(planet: str, from_sign: int, to_sign: int) -> bool:
    dist = (to_sign - from_sign) % 12 + 1
    return dist == 7 or dist in SPECIAL_ASPECTS.get(planet, ())


def associated(chart: dict, a: str, b: str) -> bool:
    """Conjunction, mutual aspect or sign exchange."""
    pa, pb = chart["planets"][a], chart["planets"][b]
    if pa["sign"] == pb["sign"]:
        return True
    if aspects(a, pa["sign"], pb["sign"]) and aspects(b, pb["sign"], pa["sign"]):
        return True
    return SIGN_LORD[pa["sign"]] == b and SIGN_LORD[pb["sign"]] == a


# ---------------------------------------------------------------- Ashtakavarga

def ashtakavarga(chart: dict) -> dict:
    """BAV per planet by sign (index 0 = Aries) and SAV. SAV always totals 337."""
    pos = {p: chart["planets"][p]["sign"] for p in SEVEN}
    pos["Lagna"] = chart["lagna"]["sign"]
    bav = {}
    for planet, table in BAV_TABLE.items():
        row = [0] * 12
        for contributor, houses in table.items():
            for h in houses:
                row[(pos[contributor] + h - 1) % 12] += 1
        bav[planet] = row
    sav = [sum(bav[p][s] for p in SEVEN) for s in range(12)]
    return {"bav": bav, "sav": sav}


# ---------------------------------------------------------------- KP

def kp_significations(chart: dict, planet: str) -> set[int]:
    """Houses a planet signifies in KP: occupied and owned by its star-lord, and by itself.
    Nodes also carry their sign lord's houses."""
    cusps = chart["kp_cusps"]

    def own(p: str) -> set[int]:
        return {c["house"] for c in cusps if c["sign_lord"] == p}

    def occ(p: str) -> set[int]:
        return {chart["planets"][p]["kp_house"]}

    star = chart["planets"][planet]["star_lord"]
    houses = occ(star) | own(star) | occ(planet) | own(planet)
    if planet in ("Rahu", "Ketu"):
        lord = SIGN_LORD[chart["planets"][planet]["sign"]]
        houses |= occ(lord) | own(lord)
    return houses


# ---------------------------------------------------------------- strength

def strength_proxy(chart: dict) -> dict[str, float]:
    """Shadbala proxy in [0, 1]: sthana (dignity), dig, naisargika and chesta/paksha.
    Directional strength needs houses, so it is left out when the time is unknown."""
    out = {}
    known = chart["time_known"]
    sun = chart["planets"]["Sun"]["lon"]
    for p in SEVEN:
        d = chart["planets"][p]
        sthana = d["dignity_score"]
        dist = abs(d["house"] - DIG_BALA_HOUSE[p]) % 12
        dig = 1 - min(dist, 12 - dist) / 6
        if p == "Moon":
            motion = abs((d["lon"] - sun + 180) % 360 - 180) / 180  # paksha: brightness
        elif p == "Sun":
            motion = 0.5
        else:
            motion = 1.0 if d["retrograde"] else 0.5
        parts = [(0.4, sthana), (0.15, NAISARGIKA[p]), (0.2, motion)] + ([(0.25, dig)] if known else [])
        out[p] = sum(w * x for w, x in parts) / sum(w for w, _ in parts)
    out["Rahu"] = out[SIGN_LORD[chart["planets"]["Rahu"]["sign"]]]
    out["Ketu"] = out[SIGN_LORD[chart["planets"]["Ketu"]["sign"]]]
    return out


def chara_karakas(chart: dict) -> tuple[str, str]:
    """Atmakaraka and Amatyakaraka (seven-karaka scheme)."""
    order = sorted(SEVEN, key=lambda p: -chart["planets"][p]["deg_in_sign"])
    return order[0], order[1]


def neecha_bhanga(chart: dict, planet: str) -> bool:
    d = chart["planets"][planet]
    if d["dignity"] != "debilitated":
        return False
    dispositor = SIGN_LORD[d["sign"]]
    exalt_lord = next((p for p in SEVEN if EXALT[p] == d["sign"]), None)
    moon_sign = chart["planets"]["Moon"]["sign"]
    for helper in filter(None, (dispositor, exalt_lord)):
        hs = chart["planets"][helper]["sign"]
        if whole_house(hs, chart["lagna"]["sign"]) in (1, 4, 7, 10) or whole_house(hs, moon_sign) in (1, 4, 7, 10):
            return True
    return False


# ---------------------------------------------------------------- yogas

def find_yogas(chart: dict) -> list[dict]:
    P = chart["planets"]
    out: list[dict] = []
    known = chart["time_known"]

    def add(name: str, planets: list[str], strength: float, note: str):
        out.append({"name": name, "planets": sorted(set(planets)), "strength": strength, "note": note})

    if P["Sun"]["sign"] == P["Mercury"]["sign"]:
        add("Budhaditya", ["Sun", "Mercury"], 0.5, "Sun and Mercury together: analysis and expression")
    if whole_house(P["Jupiter"]["sign"], P["Moon"]["sign"]) in (1, 4, 7, 10):
        add("Gaja-Kesari", ["Jupiter", "Moon"], 0.5, "Jupiter in a kendra from the Moon")
    for p in SEVEN:
        if neecha_bhanga(chart, p):
            add("Neecha-bhanga", [p], 0.4, f"{p}'s debility is cancelled")
    if not known:
        return out
    good = {1, 2, 4, 5, 7, 9, 10}
    if all(P[p]["house"] in good for p in ("Jupiter", "Venus", "Mercury")) and P["Jupiter"]["dignity"] in ("exalted", "own", "friend"):
        add("Saraswati", ["Jupiter", "Venus", "Mercury"], 0.6, "Jupiter, Venus and Mercury well placed")
    l9, l10 = house_lord(chart, 9), house_lord(chart, 10)
    if l9 != l10 and associated(chart, l9, l10):
        add("Dharma-Karmadhipati", [l9, l10], 0.7, "Lords of the 9th and 10th associate")
    for h, kind in ((1, "Raja"), (5, "Raja"), (9, "Raja"), (2, "Dhana"), (11, "Dhana")):
        lh = house_lord(chart, h)
        if lh != l10 and h != 9 and associated(chart, lh, l10):
            add(f"{kind} (10th lord)", [lh, l10], 0.5, f"10th lord associates with the {h}th lord")
    x = P[l10]["house"]
    if x != 10 and P[house_lord(chart, x)]["house"] == 10 and house_lord(chart, x) != l10:
        add("Parivartana (10th)", [l10, house_lord(chart, x)], 0.6, f"10th lord and {x}th lord exchange signs")
    return out


# ---------------------------------------------------------------- dashas

def vimshottari(chart: dict, birth_utc: datetime) -> list[dict]:
    moon = chart["planets"]["Moon"]["lon"]
    n = int(moon // NAK_SPAN) % 27
    first = DASHA_LORDS[n % 9]
    elapsed = (moon % NAK_SPAN) / NAK_SPAN
    start = birth_utc - timedelta(days=elapsed * DASHA_YEARS[first] * YEAR_DAYS)
    out = []
    i = DASHA_LORDS.index(first)
    for k in range(9):
        md = DASHA_LORDS[(i + k) % 9]
        md_end = start + timedelta(days=DASHA_YEARS[md] * YEAR_DAYS)
        antars = []
        a_start = start
        j = DASHA_LORDS.index(md)
        for m in range(9):
            ad = DASHA_LORDS[(j + m) % 9]
            a_end = a_start + timedelta(days=DASHA_YEARS[md] * DASHA_YEARS[ad] / 120 * YEAR_DAYS)
            antars.append({"lord": ad, "start": a_start.date().isoformat(), "end": a_end.date().isoformat()})
            a_start = a_end
        out.append({"lord": md, "start": start.date().isoformat(), "end": md_end.date().isoformat(), "antar": antars})
        start = md_end
    return out


def dasha_support(chart: dict, lord: str) -> set[int]:
    """Career-relevant houses (2/6/10/11) a dasha lord signifies: KP when cusps exist, else owns/occupies (whole sign)."""
    if chart.get("kp_cusps"):
        return kp_significations(chart, lord) & CAREER_HOUSES
    houses = {chart["planets"][lord]["house"]} | {h for h in range(1, 13) if house_lord(chart, h) == lord}
    return houses & CAREER_HOUSES


def periods_between(dashas: list[dict], start: date, end: date) -> list[dict]:
    out = []
    for md in dashas:
        for ad in md["antar"]:
            a, b = date.fromisoformat(ad["start"]), date.fromisoformat(ad["end"])
            lo, hi = max(a, start), min(b, end)
            if lo < hi:
                out.append({"maha": md["lord"], "antar": ad["lord"], "start": lo, "end": hi})
    return out


# ---------------------------------------------------------------- components

def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def _weighted(contribs: list[tuple[float, str, float]], K: dict) -> dict[str, float]:
    """contribs: (weight, planet, multiplier) → per-family weighted mean of karakatwa × multiplier."""
    total = sum(w for w, _, _ in contribs) or 1
    return {f: sum(w * K[p][f] * m for w, p, m in contribs) / total for f in FAMILIES}


def comp_d10(chart: dict, K: dict) -> tuple[dict[str, float], dict]:
    P = chart["planets"]
    lag = chart["lagna"]["d10"]
    lagna_lord = SIGN_LORD[lag]
    tenth_lord = SIGN_LORD[(lag + 9) % 12]

    def dig(p: str) -> float:
        return dignity(p, P[p]["d10"])[1]
    contribs = [(1.0, lagna_lord, dig(lagna_lord)), (1.0, tenth_lord, dig(tenth_lord))]
    in_lagna = [p for p in PLANETS if P[p]["d10"] == lag]
    in_tenth = [p for p in PLANETS if P[p]["d10"] == (lag + 9) % 12]
    contribs += [(0.8, p, dig(p)) for p in in_lagna + in_tenth]
    fam = _weighted(contribs, K)
    return {f: _clamp(v) for f, v in fam.items()}, {
        "d10_lagna": SIGNS[lag], "d10_lagna_lord": lagna_lord, "d10_tenth_lord": tenth_lord,
        "in_d10_lagna": in_lagna, "in_d10_tenth": in_tenth}


def comp_moon_sign(chart: dict, K: dict) -> tuple[dict[str, float], dict]:
    """Unknown-time substitute for D10: 10th from the Moon, its lord and occupants, by D1 dignity."""
    P = chart["planets"]
    tenth = (P["Moon"]["sign"] + 9) % 12
    lord = SIGN_LORD[tenth]
    occ = [p for p in PLANETS if P[p]["sign"] == tenth]
    contribs = [(1.0, lord, P[lord]["dignity_score"]), (0.8, "Moon", P["Moon"]["dignity_score"])] + [(0.8, p, P[p]["dignity_score"]) for p in occ]
    return {f: _clamp(v) for f, v in _weighted(contribs, K).items()}, {"tenth_from_moon": SIGNS[tenth], "lord": lord, "occupants": occ}


def comp_kp(chart: dict, K: dict) -> tuple[dict[str, float], dict]:
    cusp = chart["kp_cusps"][9]
    sub = cusp["sub_lord"]
    star = chart["planets"][sub]["star_lord"]
    sig = kp_significations(chart, sub)
    strength = len(sig & CAREER_HOUSES) / 4
    service, business = 6 in sig, 7 in sig
    fam = {}
    for f in FAMILIES:
        base = 0.5 * K[sub][f] + 0.5 * K[star][f]
        bias = (0.15 if service and f in SERVICE_FAMILIES else 0) + (0.15 if business and f in BUSINESS_FAMILIES else 0)
        fam[f] = _clamp((0.5 + 0.5 * strength) * base + bias)
    abroad = len(sig & {9, 12})
    home = len(sig & {4})
    lean = "abroad" if abroad > home else "home" if home > abroad else "either"
    return fam, {"sub_lord": sub, "star_lord": star, "signifies": sorted(sig), "career_strength": strength,
                 "service_bias": service, "business_bias": business, "study_location_lean": lean}


def _sav_factor(v: int) -> float:
    return 1.0 if v >= 28 else 0.6 if v >= 25 else 0.3


def comp_ashtakavarga(chart: dict, av: dict, K: dict) -> tuple[dict[str, float], dict]:
    lag = chart["lagna"]["sign"]
    houses = {h: av["sav"][(lag + h - 1) % 12] for h in (10, 2, 6, 11)}
    house_factor = sum(_sav_factor(v) for v in houses.values()) / 4
    tenth = (lag + 9) % 12
    bav10 = {p: av["bav"][p][tenth] / 8 for p in SEVEN}
    bav10["Rahu"] = bav10[SIGN_LORD[chart["planets"]["Rahu"]["sign"]]]
    bav10["Ketu"] = bav10[SIGN_LORD[chart["planets"]["Ketu"]["sign"]]]
    lord10 = house_lord(chart, 10)
    fam = {}
    for f in FAMILIES:
        weight = sum(K[p][f] for p in PLANETS) or 1
        karaka = sum(K[p][f] * bav10[p] for p in PLANETS) / weight
        fam[f] = _clamp(0.4 * house_factor + 0.4 * karaka + 0.2 * bav10[lord10] * (1 if K[lord10][f] > 0 else 0.5))
    return fam, {"sav_by_house": houses, "house_factor": round(house_factor, 3), "tenth_lord": lord10,
                 "tenth_lord_bav": av["bav"][lord10][tenth]}


def comp_strength(chart: dict, K: dict) -> tuple[dict[str, float], dict]:
    sb = strength_proxy(chart)
    ranked = sorted(SEVEN, key=lambda p: -sb[p])
    rank_score = {p: (7 - i) / 7 for i, p in enumerate(ranked)}
    adj = {}
    for p in SEVEN:
        d = chart["planets"][p]
        x = rank_score[p]
        if d["dignity"] in ("exalted", "own"):
            x += 0.15
        if (d["dignity"] == "debilitated" and not neecha_bhanga(chart, p)) or d["combust"]:
            x -= 0.15
        adj[p] = _clamp(x)
    for node in ("Rahu", "Ketu"):
        adj[node] = adj[SIGN_LORD[chart["planets"][node]["sign"]]]
    ak, amk = chara_karakas(chart)
    fam = {}
    for f in FAMILIES:
        weight = sum(K[p][f] for p in PLANETS) or 1
        fam[f] = _clamp(sum(K[p][f] * adj[p] for p in PLANETS) / weight + 0.1 * K[ak][f] + 0.1 * K[amk][f])
    return fam, {"shadbala_proxy_rank": ranked, "atmakaraka": ak, "amatyakaraka": amk,
                 "shadbala_note": "proxy (dignity, directional, natural and motional strength), not full Shadbala"}


def comp_yogas(yogas: list[dict], K: dict) -> tuple[dict[str, float], dict]:
    fam = {f: 0.0 for f in FAMILIES}
    for y in yogas:
        for f in FAMILIES:
            fam[f] += y["strength"] * sum(K[p][f] for p in y["planets"]) / len(y["planets"])
    return {f: _clamp(v) for f, v in fam.items()}, {"found": [y["name"] for y in yogas]}


def comp_dasha(chart: dict, dashas: list[dict], K: dict, as_of: date) -> tuple[dict[str, float], dict]:
    end = as_of + timedelta(days=int(10 * YEAR_DAYS))
    fam = {f: 0.0 for f in FAMILIES}
    support = {p: dasha_support(chart, p) for p in PLANETS}
    for per in periods_between(dashas, as_of, end):
        yrs = (per["end"] - per["start"]).days / YEAR_DAYS
        for f in FAMILIES:
            fam[f] += yrs / 10 * (0.5 * bool(support[per["maha"]]) * K[per["maha"]][f]
                                  + 0.5 * bool(support[per["antar"]]) * K[per["antar"]][f])
    return {f: _clamp(v * 1.5) for f, v in fam.items()}, {"supportive_lords": sorted(p for p, s in support.items() if s)}


# ---------------------------------------------------------------- windows

PURPOSE_HOUSES = {"exams": {4, 5, 9, 11, 6}, "job change": {6, 10, 11}, "launch": {7, 10, 11}}


def favourable_windows(chart: dict, dashas: list[dict], as_of: date, years: int = 10,
                       junior_slots: list[tuple[str, date, date]] | None = None) -> list[dict]:
    """Antardasha periods where both lords support career houses. For early_explorer the windows
    are clipped to board-exam years and Class 11 entry, with no career-specific labels."""
    known = bool(chart.get("kp_cusps"))

    def sig(p: str) -> set[int]:
        if known:
            return kp_significations(chart, p)
        return {chart["planets"][p]["house"]} | {h for h in range(1, 13) if house_lord(chart, h) == p}

    end = as_of + timedelta(days=int(years * YEAR_DAYS))
    out = []
    for per in periods_between(dashas, as_of, end):
        if not (sig(per["maha"]) & CAREER_HOUSES and sig(per["antar"]) & CAREER_HOUSES):
            continue
        if junior_slots is not None:
            for label, a, b in junior_slots:
                lo, hi = max(a, per["start"]), min(b, per["end"])
                if lo < hi:
                    out.append({"from": lo.isoformat(), "to": hi.isoformat(), "purpose": label,
                                "dasha": f"{per['maha']}-{per['antar']}"})
            continue
        purposes = [k for k, hs in PURPOSE_HOUSES.items() if sig(per["antar"]) & hs]
        if purposes:
            out.append({"from": per["start"].isoformat(), "to": per["end"].isoformat(), "purpose": ", ".join(purposes),
                        "dasha": f"{per['maha']}-{per['antar']}"})
    return out


def junior_slots(class_label: str | None, dob: date | None, as_of: date) -> list[tuple[str, date, date]]:
    """Board-exam seasons (Class 10 and 12) and Class 11 entry, from the current class or the date of birth."""
    academic_end = as_of.year + 1 if as_of.month >= 4 else as_of.year
    n = None
    if class_label:
        digits = "".join(ch for ch in class_label if ch.isdigit())
        n = int(digits) if digits else None
    if n is not None and 6 <= n <= 12:
        y10 = academic_end + (10 - n)
    elif dob:
        y10 = dob.year + 16
    else:
        y10 = academic_end + 1
    return [("Class 10 board exams", date(y10, 1, 15), date(y10, 3, 31)),
            ("Class 11 entry", date(y10, 4, 1), date(y10, 6, 30)),
            ("Class 12 board exams", date(y10 + 2, 1, 15), date(y10 + 2, 3, 31))]


# ---------------------------------------------------------------- personality lens

# Base-form phrases so they read after "You may" or "Your child may". Original text.
# Never about health, marriage, longevity or wealth; never a prohibition.
SIGN_LENS = {
    "Aries": ("take the lead and start new things quickly", "courage to begin and energy under pressure", "rush ahead before planning; a short pause before deciding helps"),
    "Taurus": ("prefer steady progress and practical results", "patience, reliability and a good eye for quality", "hold on to a plan after it has stopped working; reviewing it each term helps"),
    "Gemini": ("enjoy ideas, talk and learning several things at once", "curiosity, quick learning and clear explanation", "spread attention thin; finishing one thing before the next helps"),
    "Cancer": ("care deeply about the people around them and feel things strongly", "empathy, loyalty and a protective instinct", "take setbacks to heart; talking things through helps"),
    "Leo": ("like to create, perform and be recognised for good work", "warmth, confidence and generosity", "find it hard to step back from the spotlight; sharing credit helps"),
    "Virgo": ("notice detail and like to improve how things are done", "precision, analysis and a helpful nature", "aim for perfect before sharing work; a 'good enough' first draft helps"),
    "Libra": ("seek balance, fairness and harmony with others", "diplomacy, taste and teamwork", "delay choices to keep everyone happy; setting a decision date helps"),
    "Scorpio": ("go deep into whatever holds their interest", "focus, resilience and investigative skill", "keep worries private; trusting one mentor helps"),
    "Sagittarius": ("look for meaning, adventure and the bigger picture", "optimism, openness and a love of learning", "lose interest in routine steps; linking them to a goal helps"),
    "Capricorn": ("work steadily towards long-term goals", "discipline, responsibility and endurance", "be hard on themselves; celebrating small milestones helps"),
    "Aquarius": ("think independently and question the usual way", "originality, fairness and interest in systems", "seem detached when busy with ideas; checking in with people helps"),
    "Pisces": ("imagine, feel and respond to the mood around them", "creativity, compassion and intuition", "drift without structure; a simple weekly plan helps"),
}
LENS_BASIS = [("Lagna (rising sign)", "outlook and first approach"), ("Moon sign", "feelings and comfort zone"),
              ("Sun sign", "core drive"), ("Lagna lord", "where effort naturally goes")]


def personality_lens(chart: dict, audience: str = "candidate") -> dict:
    who = "Your child may" if audience == "parent_of_junior" else "You may"
    P = chart["planets"]
    lagna_lord = SIGN_LORD[chart["lagna"]["sign"]]
    rows = [
        ("Lagna (rising sign)", SIGNS[chart["lagna"]["sign"]]) if chart["time_known"] else None,
        ("Moon sign", P["Moon"]["sign_name"]),
        ("Sun sign", P["Sun"]["sign_name"]),
        ("Lagna lord", f"{lagna_lord} in {P[lagna_lord]['sign_name']}") if chart["time_known"] else None,
    ]
    items = []
    for row in filter(None, rows):
        basis, value = row
        sign = value.split(" in ")[-1]
        t, s, w = SIGN_LENS[sign]
        items.append({"basis": basis, "value": value, "tendencies": f"{who} {t}.",
                      "strengths": f"Strengths to build on: {s}.", "watch_outs": f"{who} {w}."})
    return {"audience": audience, "items": items,
            "note": "A traditional lens for reflection, read alongside the psychometric profile. It does not decide or rule out anything."}


BANNED_TERMS = ["health", "illness", "disease", "marriage", "spouse", "divorce", "death", "longevity", "lifespan",
                "wealth", "rich", "money", "must not", "never choose", "forbidden", "unlucky", "doomed"]


# ---------------------------------------------------------------- agreement

def agreement_matrix(points: dict[str, float], psych_rank: list[str]) -> list[dict]:
    """Per family: Agree (both top-5), Partial (top-5 on one side, top-8 on the other),
    Conflict (top-5 on one side, bottom-5 on the other), else '—'."""
    sw_rank = sorted(FAMILIES, key=lambda f: -points[f])
    out = []
    for f in FAMILIES:
        s = sw_rank.index(f) + 1
        p = psych_rank.index(f) + 1 if f in psych_rank else len(FAMILIES)
        if s <= 5 and p <= 5:
            v = "Agree"
        elif (s <= 5 and p <= 8) or (p <= 5 and s <= 8):
            v = "Partial"
        elif (s <= 5 and p >= 11) or (p <= 5 and s >= 11):
            v = "Conflict"
        else:
            v = "—"
        out.append({"family": f, "swadharma_rank": s, "psychometric_rank": p, "verdict": v})
    return out


def psychometric_family_rank(career_matches: list[dict], interest_vector: list[float] | None) -> list[str]:
    """Families by best career fit; families with no match follow, ordered by interest alignment."""
    from match import cosine
    best: dict[str, float] = {}
    for m in career_matches:
        f = m.get("family")
        if f:
            best[f] = max(best.get(f, 0), float(m.get("fit_score") or 0))
    by_interest = sorted(FAMILIES, key=lambda f: -cosine(interest_vector, FAMILY_RIASEC[f]))
    ranked = sorted(best, key=lambda f: -best[f])
    return ranked + [f for f in by_interest if f not in best]


# ---------------------------------------------------------------- engine

def score_chart(chart: dict, as_of: date, birth_utc: datetime, track: str = "student",
                class_label: str | None = None, dob: date | None = None, K: dict | None = None) -> dict:
    """Pure: chart → per-family points with components, windows, lens and confidence."""
    K = K or load_karakatwa()
    dashas = vimshottari(chart, birth_utc)
    comps: dict[str, dict[str, float]] = {}
    detail: dict[str, Any] = {}
    av = None
    if chart["time_known"]:
        av = ashtakavarga(chart)
        comps["d10"], detail["d10"] = comp_d10(chart, K)
        comps["kp"], detail["kp"] = comp_kp(chart, K)
        comps["ashtakavarga"], detail["ashtakavarga"] = comp_ashtakavarga(chart, av, K)
        comps["strength"], detail["strength"] = comp_strength(chart, K)
        comps["yogas"], detail["yogas"] = comp_yogas(find_yogas(chart), K)
        comps["dasha"], detail["dasha"] = comp_dasha(chart, dashas, K, as_of)
        weights = WEIGHTS
    else:
        comps["moon_sign"], detail["moon_sign"] = comp_moon_sign(chart, K)
        comps["strength"], detail["strength"] = comp_strength(chart, K)
        weights = UNKNOWN_TIME_WEIGHTS
    scale = 100 / sum(weights.values())
    families = {}
    for f in FAMILIES:
        parts = {k: round(weights[k] * comps[k][f] * scale, 1) for k in comps}
        families[f] = {"points": round(sum(parts.values()), 1), "components": parts}
    confidence = {"exact": "high", "approx_15m": "medium"}.get(chart["time_certainty"], "low")
    junior = track == "early_explorer"
    windows = favourable_windows(chart, dashas, as_of, junior_slots=junior_slots(class_label, dob, as_of) if junior else None)
    return {
        "families": families, "detail": detail, "confidence": confidence, "windows": windows, "dashas": dashas,
        "ashtakavarga": av, "yogas": detail.get("yogas", {}).get("found", []),
        "lens": personality_lens(chart, "parent_of_junior" if junior else "candidate"),
        "component_weights": {k: round(v * scale, 1) for k, v in weights.items()},
    }


def stream_rollup(points: dict[str, float], keeps_open: list[str]) -> float:
    return round(sum(points.get(f, 0) for f in keeps_open), 1)


def run(db, candidate_id: str, as_of: date | None = None) -> dict | None:
    """Computes and stores the Swadharma analysis. Returns None when consent is missing."""
    as_of = as_of or date.today()
    cand = db.table("candidates").select("track, dob, class_or_years_exp, swadharma_opted_in").eq("id", candidate_id).single().execute().data
    bd = db.table("birth_details").select("*").eq("candidate_id", candidate_id).maybe_single().execute()
    birth = bd.data if bd else None
    if not cand.get("swadharma_opted_in") or not birth or not birth.get("consent_at"):
        return None
    if birth.get("lat") is None or birth.get("lng") is None or not birth.get("birth_date"):
        return None
    bdate = date.fromisoformat(birth["birth_date"])
    btime = time.fromisoformat(birth["birth_time"]) if birth.get("birth_time") else None
    certainty = birth.get("time_certainty") or ("exact" if btime else "unknown")
    chart = compute_chart(bdate, btime, birth.get("tz"), birth["lat"], birth["lng"], certainty)
    birth_utc = to_utc(bdate, btime if chart["time_known"] else None, birth.get("tz"))
    dob = date.fromisoformat(cand["dob"]) if cand.get("dob") else bdate
    out = score_chart(chart, as_of, birth_utc, cand["track"], cand.get("class_or_years_exp"), dob)
    points = {f: v["points"] for f, v in out["families"].items()}

    matches = db.table("career_matches").select("id, breakdown, fit_score, careers(family)").eq("candidate_id", candidate_id).execute().data
    psych_matches = [{"family": (m.get("careers") or {}).get("family"), "fit_score": m["fit_score"]} for m in matches]
    summary = db.table("profile_summary").select("interest_vector").eq("candidate_id", candidate_id).maybe_single().execute()
    interest = ((summary.data if summary else None) or {}).get("interest_vector")
    agreement = agreement_matrix(points, psychometric_family_rank(psych_matches, interest))

    now = datetime.now(timezone.utc).isoformat()
    D = chart["planets"]
    db.table("swadharma_charts").upsert({
        "candidate_id": candidate_id, "ayanamsa": AYANAMSA,
        "d1": {"lagna": chart["lagna"], "planets": D, "time_known": chart["time_known"], "ayanamsa_deg": chart["ayanamsa_deg"]},
        "d9": {p: SIGNS[d["d9"]] for p, d in D.items()},
        "d10": {**{p: SIGNS[d["d10"]] for p, d in D.items()}, **({"Lagna": SIGNS[chart["lagna"]["d10"]]} if chart["time_known"] else {})},
        "kp_cusps": chart.get("kp_cusps"), "ashtakavarga": out["ashtakavarga"], "dashas": out["dashas"],
        "computed_at": now, "engine_version": ENGINE_VERSION,
        "insights": {"personality_lens": out["lens"], "agreement": agreement, "detail": out["detail"],
                     "yogas": out["yogas"], "confidence": out["confidence"], "component_weights": out["component_weights"]},
    }, on_conflict="candidate_id").execute()

    existing = {r["career_family"]: r["id"] for r in db.table("swadharma_scores").select("id, career_family").eq("candidate_id", candidate_id).execute().data}
    for f, v in out["families"].items():
        row = {"points": v["points"], "max_points": 100, "components": v["components"], "favourable_windows": out["windows"],
               "confidence": out["confidence"], "computed_at": now, "engine_version": ENGINE_VERSION}
        if f in existing:  # update in place so counsellor_notes survive
            db.table("swadharma_scores").update(row).eq("id", existing[f]).execute()
        else:
            db.table("swadharma_scores").insert({"candidate_id": candidate_id, "career_family": f, **row}).execute()

    for m in matches:
        fam = (m.get("careers") or {}).get("family")
        db.table("career_matches").update({"breakdown": {**(m["breakdown"] or {}), "swadharma": points.get(fam)}}).eq("id", m["id"]).execute()
    for m in db.table("stream_matches").select("id, breakdown, stream_options(keeps_open_families)").eq("candidate_id", candidate_id).execute().data:
        keeps = (m.get("stream_options") or {}).get("keeps_open_families") or []
        db.table("stream_matches").update({"breakdown": {**(m["breakdown"] or {}), "swadharma": stream_rollup(points, keeps)}}).eq("id", m["id"]).execute()
    return out
