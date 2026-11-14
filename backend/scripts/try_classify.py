"""Run the classify stage on reference videos with real Gemini calls and print the results.

  uv run python -m scripts.try_classify "Fall Response Backup.mp4" sittostand_primary.mp4
  uv run python -m scripts.try_classify --all            # all 16 reference videos, then a table
  uv run python -m scripts.try_classify --all --people   # also print each person found

Each file is ingested once; later runs reuse the stored video row and its Gemini upload.
The expected slug comes from catalog.REFERENCE_FILES and is never shown to the model.
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor

from app import catalog, config, db, gemini, jobs, media
from app.stages import classify

EXPECTED = {f: slug for slug, files in catalog.REFERENCE_FILES.items() for f in files.values() if f}


def reference_video(filename: str) -> dict:
    """The stored row for a reference file, ingesting it the first time."""
    row = db.fetch_one(
        "SELECT * FROM videos WHERE kind='reference' AND original_name=%s ORDER BY recorded_at DESC LIMIT 1",
        (filename,),
    )
    return row or jobs.ingest(str(config.REFERENCE_DIR / filename), "reference", filename)


def classify_file(filename: str) -> dict:
    try:
        video = reference_video(filename)
        result = classify.run(jobs.StageContext(job_id=None, video=video))
        return {"file": filename, "duration": video["duration_s"], "result": result}
    except Exception as exc:
        return {"file": filename, "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="*", help="file names in reference_vids/")
    parser.add_argument("--all", action="store_true", help="every reference video, shortest first")
    parser.add_argument("--people", action="store_true", help="print each person found")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    files = list(args.files)
    if args.all:
        files = sorted(EXPECTED, key=lambda f: media.probe(config.REFERENCE_DIR / f)["duration_s"])
    if not files:
        parser.error("name some files or pass --all")

    db.migrate()
    before = gemini.spent_usd()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(classify_file, files))

    correct = 0
    print(f"\n{'file':<36} {'dur':>4}  {'expected':<20} {'predicted':<20} {'conf':>4}  people")
    for r in rows:
        expected = EXPECTED.get(r["file"], "?")
        if "error" in r:
            print(f"{r['file']:<36} {'':>4}  {expected:<20} ERROR {r['error'][:200]}")
            continue
        c = r["result"]
        mark = "" if c.skill_slug == expected else "  <-- WRONG"
        correct += c.skill_slug == expected
        roles = ", ".join(f"{p.label}:{p.role}" for p in c.people)
        print(f"{r['file']:<36} {r['duration']:>4.0f}  {expected:<20} {c.skill_slug:<20} {c.confidence:>4.2f}  "
              f"{roles}{mark}")
        if args.people or len(rows) == 1:
            print(f"    alternatives={c.alternatives} order_matters={c.order_matters} category={c.category}")
            print(f"    summary: {c.summary}")
            for p in c.people:
                print(f"    {p.label} {p.role}: {p.description}")
    print(f"\n{correct}/{len(rows)} correct; this run cost ${gemini.spent_usd() - before:.4f}, "
          f"total recorded ${gemini.spent_usd():.4f} of ${config.GEMINI_BUDGET_USD:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
