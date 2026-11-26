#!/usr/bin/env python3
"""Build a draft TSV of per-wrestler clue fields for Easy Mode.

Reads data/themes.json, applies the overrides below, writes tools/clues_draft.tsv
for a human to review and edit. The merge step (apply_clues.py) will read the
edited TSV and write the fields back into data/themes.json.

Columns: wrestler, gender, actType, defaultCompany, notes
- gender: male | female | trans | mixed
- actType: singles | group
- defaultCompany: short code — WWF, WWE, NXT, WCW, ECW, TNA, ROH, AEW
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
    # WWE Modern
    "The Shield", "The Usos", "The New Day", "Legacy", "The Judgment Day",
    "Damage CTRL", "The Bloodline", "Street Profits", "The Viking Raiders",
    "Hurt Business", "Imperium", "Alpha Academy", "Final Testament",
    "Diamond Mine", "Pretty Deadly", "The OC", "Legado del Fantasma", "The Legacy",
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

# --- Default company inference ---------------------------------------------
def default_company(promotion: str, era: str) -> str:
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
    company = default_company(promotion, era)
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
