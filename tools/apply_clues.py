#!/usr/bin/env python3
"""Merge tools/clues_draft.tsv into data/themes.json.

Each theme entry gets three new fields: `gender`, `actType`, `company`
(a list of company codes). Existing fields are preserved.
"""

import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TSV = os.path.join(ROOT, "tools", "clues_draft.tsv")
THEMES = os.path.join(ROOT, "data", "themes.json")


def main():
    clues = {}
    with open(TSV, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            name = row["wrestler"].strip()
            clues[name] = {
                "gender": row["gender"].strip(),
                "actType": row["actType"].strip(),
                "company": [c.strip() for c in row["defaultCompany"].split("|") if c.strip()],
            }

    with open(THEMES, encoding="utf-8") as f:
        songs = json.load(f)

    missing = []
    for s in songs:
        c = clues.get(s["wrestler"])
        if not c:
            missing.append(s["wrestler"])
            continue
        s["gender"] = c["gender"]
        s["actType"] = c["actType"]
        s["company"] = c["company"]

    with open(THEMES, "w", encoding="utf-8") as f:
        json.dump(songs, f, indent=1, ensure_ascii=False)
        f.write("\n")

    print(f"Updated {len(songs)} themes in {os.path.relpath(THEMES, ROOT)}")
    if missing:
        unique = sorted(set(missing))
        print(f"Missing clue rows for {len(unique)} wrestlers:")
        for n in unique:
            print(f"  {n}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
