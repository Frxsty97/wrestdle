#!/usr/bin/env python3
"""Turn tools/roster.txt into data/themes.json.

Each theme becomes one playable song. The game looks up the audio preview
from Apple's iTunes API at play time using the trackId, so links never go stale.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "roster.txt"
OUT = ROOT / "data" / "themes.json"
PROMOS = {"W": "WWE", "A": "AEW"}


def main() -> int:
    songs, seen_ids, errors = [], set(), []
    for n, raw in enumerate(SRC.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) != 4:
            errors.append(f"line {n}: expected 4 fields, got {len(parts)}")
            continue
        wrestler, era, aliases, themes = (p.strip() for p in parts)
        if era not in ("Classic", "Modern"):
            errors.append(f"line {n}: era must be Classic or Modern")
        alias_list = [a.strip() for a in aliases.split(",") if a.strip()]
        for theme in themes.split(";;"):
            bits = [b.strip() for b in theme.split("#")]
            if len(bits) != 3 or not bits[1].isdigit() or bits[2] not in PROMOS:
                errors.append(f"line {n}: bad theme '{theme.strip()}'")
                continue
            title, track_id, promo = bits[0], int(bits[1]), PROMOS[bits[2]]
            if track_id in seen_ids:
                errors.append(f"line {n}: duplicate trackId {track_id}")
                continue
            seen_ids.add(track_id)
            songs.append({
                "id": track_id,
                "wrestler": wrestler,
                "aliases": alias_list,
                "song": title,
                "promotion": promo,
                "era": era,
            })
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(songs, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    wrestlers = {s["wrestler"] for s in songs}
    by_promo = {p: sum(s["promotion"] == p for s in songs) for p in PROMOS.values()}
    print(f"Wrote {len(songs)} themes for {len(wrestlers)} wrestlers to {OUT.relative_to(ROOT)} {by_promo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
