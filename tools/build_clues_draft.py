#!/usr/bin/env python3
"""Build a draft TSV of per-wrestler clue fields for Easy Mode.

Reads data/themes.json, applies the overrides below, writes tools/clues_draft.tsv
for a human to review and edit. The merge step (apply_clues.py) will read the
edited TSV and write the fields back into data/themes.json.

Columns: wrestler, gender, actType, defaultCompany, notes
- gender: male | female | trans | mixed
- actType: singles | group
- defaultCompany: one or more short codes separated by '|' for wrestlers who
  worked for multiple promotions. Codes: WWF, WWE, NXT, WCW, ECW, TNA, ROH,
  NJPW, DDT, AEW, GCW, IMPACT, MLW.
  (defaultCompany is the common case; per-theme company overrides will be added
  in a second pass.)
- notes: freeform, usually a '?' when the guess is low-confidence
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEMES = os.path.join(ROOT, "data", "themes.json")
OUT = os.path.join(ROOT, "tools", "clues_draft.tsv")

# --- Known women (both promotions, both eras) -------------------------------
WOMEN = {
    # WWF/WWE Classic
    "Lita", "Trish Stratus", "Chyna", "Stephanie McMahon", "Torrie Wilson",
    "Victoria", "Mickie James", "Beth Phoenix", "Melina", "Michelle McCool",
    "Layla", "Eve Torres", "Alicia Fox", "AJ Lee", "Kaitlyn", "Natalya",
    "Nikki Bella", "Brie Bella", "Paige", "Sable", "Debra", "Terri Runnels",
    "Jacqueline", "Molly Holly", "Ivory", "Jazz", "Gail Kim", "Candice Michelle",
    "Maria Kanellis", "Maryse", "Kelly Kelly", "Rosa Mendes", "Tamina",
    # WWE Modern
    "Becky Lynch", "Charlotte Flair", "Sasha Banks", "Bayley", "Alexa Bliss",
    "Nia Jax", "Carmella", "Nikki Cross", "Asuka", "Bianca Belair",
    "Rhea Ripley", "Liv Morgan", "Shayna Baszler", "IYO SKY", "Dakota Kai",
    "Zelina Vega", "Lacey Evans", "Mandy Rose", "Sonya Deville", "Naomi",
    "Kairi Sane", "Candice LeRae", "Raquel Rodriguez", "Tiffany Stratton",
    "Chelsea Green", "Piper Niven", "Tegan Nox", "Shotzi", "Scarlett",
    "Nikkita Lyons", "Roxanne Perez", "Lola Vice", "Jacy Jayne", "Gigi Dolin",
    "Cora Jade", "Indi Hartwell", "Ivy Nile", "Thea Hail", "Kiana James",
    "Lyra Valkyria", "Dana Brooke", "Ember Moon", "Ronda Rousey",
    "Mercedes Mone", "Jade Cargill", "Stephanie Vaquer", "Blair Davenport",
    "Giulia", "Stephanie De Lander", "Fallon Henley", "Ashley",
    "Lacey Von Erich", "Taylor Wilde", "ODB", "Rosemary", "Su Yung",
    # AEW
    "Britt Baker", "Jamie Hayter", "Thunder Rosa", "Hikaru Shida", "Nyla Rose",
    "Serena Deeb", "Riho", "Big Swole", "Tay Conti", "Penelope Ford",
    "Diamante", "Red Velvet", "Kris Statlander", "Julia Hart", "Toni Storm",
    "Saraya", "Willow Nightingale", "Anna Jay", "Athena", "Skye Blue",
    "Ruby Soho", "Deonna Purrazzo", "Mina Shirakawa", "Hangman Page",  # SAFETY: remove, Hangman is male — see below
}
# Correct the accidental entry above
WOMEN.discard("Hangman Page")

# --- Known trans wrestlers --------------------------------------------------
TRANS = {
    "Nyla Rose",  # also in WOMEN — we'll prefer TRANS when both match
}

# --- Known groups/tag teams/stables -----------------------------------------
GROUPS = {
    # WWE Classic
    "D-Generation X", "New Age Outlaws", "The APA", "Nation of Domination",
    "The Ministry of Darkness", "The Hardy Boyz", "Dudley Boyz", "Legion of Doom",
    "Bushwhackers", "Hart Foundation", "Too Cool", "nWo", "Evolution",
    "Right to Censor", "Los Guerreros", "Cryme Tyme", "The Brothers of Destruction",
    "Edge and Christian", "Rated-RKO", "La Resistance", "FBI", "Mean Street Posse",
    "The Oddities", "The Corporation", "The Corporate Ministry", "The Radicalz",
    "Three Minute Warning", "The Mexicools", "Deuce 'n Domino", "World's Greatest Tag Team",
    "The Four Horsemen", "The Bella Twins", "The Spirit Squad", "Cade and Murdoch",
    "The Hardy Boyz", "Legion of Doom", "Rated-RKO", "The OC", "The Club",
    "Edge and Christian",
    # WWE Modern
    "The Shield", "The Usos", "The New Day", "Legacy", "The Judgment Day",
    "Damage CTRL", "The Bloodline", "Street Profits", "The Viking Raiders",
    "Hurt Business", "Imperium", "Alpha Academy", "Final Testament",
    "Diamond Mine", "Pretty Deadly", "Legado del Fantasma", "The Legacy",
    "The Bloodline",
    "Hit Row", "Maximum Male Models", "Retribution", "SAnitY", "Undisputed Era",
    "Gallows and Anderson", "The Shield", "Breezango", "The Ascension",
    "The Lucha Dragons", "The B-Team", "The Bar", "Heavy Machinery",
    "Mustafa Ali", "Mysterio Family",
    # AEW
    "The Young Bucks", "FTR", "Dark Order", "Lucha Bros", "Best Friends",
    "Jurassic Express", "Gunn Club", "Inner Circle", "Undisputed Kingdom",
    "Bang Bang Gang", "Death Triangle", "The Elite", "SCU",
    "Nightmare Family", "Hardy Family Office", "House of Black",
    "Villain Enterprises", "The Pinnacle", "American Top Team",
    "Blackpool Combat Club", "Mogul Affiliates", "Mogul Embassy",
    "The Acclaimed", "The Patriarchy", "The Firm", "Jericho Appreciation Society",
}

# --- Mixed-gender groups ----------------------------------------------------
MIXED_GROUPS = {
    "The Judgment Day",     # has Rhea Ripley
    "Damage CTRL",          # women's stable
    "Inner Circle",         # mostly male but had women briefly; mark mixed cautiously
    "Mogul Affiliates",     # has women
    "House of Black",       # has Julia Hart
    "The Pinnacle",         # mostly male
    "Nightmare Family",     # has women
    "Hardy Family Office",  # has women
    "Alpha Academy",        # had Maxxine
    "The Bloodline",        # all male — remove below
}
# All-male despite looking mixed:
MIXED_GROUPS.discard("The Bloodline")
MIXED_GROUPS.discard("Inner Circle")   # ambiguous; default to male, user can correct
MIXED_GROUPS.discard("The Pinnacle")

# --- All-women groups -------------------------------------------------------
WOMEN_GROUPS = {
    "Damage CTRL",
    "The Bella Twins",
}

# --- Dual-promotion overrides ----------------------------------------------
# Wrestlers who meaningfully worked in more than one company. Order codes from
# earliest to latest for readability. '|' = the TSV multi-value separator.
DUAL_COMPANY = {
    # Attitude-era to WWE renamings and jumps
    "Chris Jericho":        "WCW|WWF|WWE|AEW",
    "Edge":                 "WWF|WWE|AEW",
    "Christian":            "WWF|TNA|WWE|AEW",
    "Jeff Hardy":           "WWF|TNA|WWE|AEW",
    "Matt Hardy":           "WWF|TNA|WWE|AEW",
    "The Hardy Boyz":       "WWF|TNA|WWE|AEW",
    "Kurt Angle":           "WWF|TNA|WWE",
    "Jeff Jarrett":         "WWF|WCW|TNA|AEW",
    "Hulk Hogan":           "WWF|WCW|TNA|WWE",
    "Kevin Nash":           "WCW|WWF|TNA|WWE",
    "Scott Hall":           "WCW|WWF|TNA|WWE",
    "Diesel":               "WWF|WCW",
    "Razor Ramon":          "WWF|WCW",
    "nWo":                  "WCW|WWF|WWE",
    "Goldust":              "WWF|WCW|TNA|WWE",
    "Dustin Rhodes":        "WWF|WCW|TNA|WWE|AEW",
    "Rob Van Dam":          "ECW|WWE|TNA|AEW",
    "Mick Foley":           "WCW|ECW|WWF|WWE|TNA",
    "Mankind":              "WCW|ECW|WWF|WWE",
    "Big Show":             "WCW|WWF|WWE|AEW",
    "Booker T":             "WCW|WWE|TNA",
    "Rey Mysterio":         "ECW|WCW|WWE|AEW",
    "Eddie Guerrero":       "ECW|WCW|WWF|WWE",
    "Vader":                "WCW|WWF",
    "Ric Flair":            "WCW|WWF|TNA|WWE",
    "William Regal":        "WCW|WWF|WWE|AEW",
    "Arn Anderson":         "WCW|WWF|WWE|AEW",
    "Owen Hart":            "WWF",  # legacy use in AEW, but owner: WWF
    # ROH / NJPW / Indie veterans in AEW
    "Kenny Omega":          "DDT|NJPW|AEW",
    "The Young Bucks":      "ROH|NJPW|AEW",
    "FTR":                  "WWE|ROH|NJPW|AEW",
    "Adam Cole":            "ROH|NXT|AEW",
    "Kyle O'Reilly":        "ROH|NXT|AEW",
    "Christopher Daniels":  "ROH|TNA|AEW",
    "Claudio Castagnoli":   "ROH|WWE|AEW",
    "Konosuke Takeshita":   "DDT|AEW",
    "Jon Moxley":           "WWE|AEW",
    "CM Punk":              "ROH|WWE|AEW",
    "Bryan Danielson":      "ROH|WWE|AEW",
    "AJ Styles":            "TNA|ROH|NJPW|WWE",
    "Samoa Joe":            "ROH|TNA|NXT|WWE|AEW",
    "Jay Lethal":           "ROH|TNA|AEW",
    "Jake Hager":           "WWE|AEW",
    "Chris Jericho (AEW)":  None,  # already covered above
    "Sting":                "WCW|TNA|WWE|AEW",
    "Mercedes Mone":        "WWE|NJPW|AEW",
    "Saraya":               "WWE|AEW",
    "Toni Storm":           "WWE|AEW",
    "Deonna Purrazzo":      "ROH|IMPACT|AEW",
    "Mina Shirakawa":       "STARDOM|AEW",
    "Athena":               "WWE|ROH",
    "Thunder Rosa":         "ROH|NWA|AEW",
    "Hangman Page":         "ROH|AEW",
    "Darby Allin":          "AEW",
    "MJF":                  "AEW",
    "Jamie Hayter":         "STARDOM|AEW",
    "Brodie Lee":           "WWE|AEW",
    "Keith Lee":            "WWE|AEW",
    "Malakai Black":        "WWE|AEW",
    "Brian Cage":           "LUCHA|IMPACT|AEW",
    "Andrade El Idolo":     "CMLL|WWE|AEW",
    "Tommaso Ciampa":       "WWE",  # mostly WWE
    "Eddie Kingston":       "CZW|IMPACT|AEW",
    "Jon Silver":           "AEW",
    "Preston Vance":        "AEW",
    "Sammy Guevara":        "AEW",
    "Wardlow":              "AEW",
    "Ricky Starks":         "AEW|WWE",
    "The Elite":            "ROH|NJPW|AEW",
    "Dark Order":           "AEW",
    "Blackpool Combat Club":"AEW",
    "The Rock":             "WWF|WWE",
    "Triple H":             "WWF|WWE",
    "Shawn Michaels":       "WWF|WWE",
    "The Undertaker":       "WWF|WWE",
    "Kane":                 "WWF|WWE",
    "Stone Cold Steve Austin": "WCW|WWF|WWE",
    "D-Generation X":       "WWF|WWE",
    "Evolution":            "WWE",
    "Legion of Doom":       "WWF|WCW",
    "Bret Hart":            "WWF|WCW|WWE",
    "The British Bulldog":  "WWF|WCW",
    "British Bulldog":      "WWF|WCW",
    "John Cena":            "WWE",
    "Randy Orton":          "WWE",
    "Batista":              "WWE",
    "Shelton Benjamin":     "WWE|ROH|AEW",
    "Charlie Haas":         "WWE|ROH",
    "World's Greatest Tag Team": "WWE|ROH",
}


def default_company(wrestler: str, promotion: str, era: str) -> str:
    override = DUAL_COMPANY.get(wrestler)
    if override:
        return override
    # Attitude-era themes are WWF (pre-2002). We can't tell from era alone,
    # so fall back to WWF for Classic WWE as a decent default — user corrects
    # anyone whose music was only used post-2002.
    if promotion == "WWE":
        return "WWF" if era == "Classic" else "WWE"
    if promotion == "AEW":
        return "AEW"
    return promotion


def classify(wrestler: str, promotion: str, era: str):
    name = wrestler
    # gender
    if name in TRANS:
        gender = "trans"
    elif name in WOMEN:
        gender = "female"
    elif name in WOMEN_GROUPS:
        gender = "female"
    elif name in MIXED_GROUPS:
        gender = "mixed"
    else:
        gender = "male"
    # act type
    act_type = "group" if name in GROUPS else "singles"
    # company
    company = default_company(name, promotion, era)
    # confidence
    notes = ""
    if act_type == "singles" and gender == "male":
        # Default guess — flag entries where we might have missed a group/woman
        lowered = name.lower()
        hints = ["family", "boyz", "team", "brothers", "sisters", "club", "club ", "squad",
                 "the ", "nation", "order", "dynasty", "crew", "connection"]
        if any(h in lowered for h in hints) and name not in GROUPS:
            notes = "? maybe group"
    return gender, act_type, company, notes


def main():
    with open(THEMES, encoding="utf-8") as f:
        songs = json.load(f)
    seen = {}
    for s in songs:
        seen.setdefault(s["wrestler"], (s["promotion"], s["era"]))

    rows = []
    for name in sorted(seen):
        promotion, era = seen[name]
        g, a, c, n = classify(name, promotion, era)
        rows.append((name, g, a, c, n))

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("wrestler\tgender\tactType\tdefaultCompany\tnotes\n")
        for r in rows:
            f.write("\t".join(r) + "\n")

    counts = {}
    for _, g, a, _, _ in rows:
        counts[(g, a)] = counts.get((g, a), 0) + 1
    print(f"Wrote {len(rows)} rows -> {os.path.relpath(OUT, ROOT)}")
    for k, v in sorted(counts.items()):
        print(f"  {k[0]:<6} {k[1]:<7}: {v}")


if __name__ == "__main__":
    sys.exit(main())
