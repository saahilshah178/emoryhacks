"""Print recorded Gemini spend for the configured database.

The budget (GEMINI_BUDGET_USD) applies to the API key now in GEMINI_API_KEY, so the table and
the total are for that key. Calls made with other keys, and calls logged before keys were
fingerprinted, are shown on one line underneath. --jobs adds the most expensive recent jobs.

  uv run python -m scripts.cost [--jobs 10]
"""
import argparse

from app import config, db, gemini

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", type=int, default=0, help="also list this many recent jobs with their spend")
    args = parser.parse_args()
    key = gemini.key_id()
    rows = db.fetch_all(
        """SELECT split_part(purpose, ':', 1) AS purpose, model, count(*) AS calls,
                  sum(input_tokens) AS input_tokens, sum(output_tokens + thought_tokens) AS output_tokens,
                  round(sum(cost_usd)::numeric, 4) AS usd, count(*) FILTER (WHERE error IS NOT NULL) AS errors
           FROM gemini_calls WHERE key_id = %s GROUP BY 1, 2 ORDER BY usd DESC""", (key,))
    total = sum(float(r["usd"]) for r in rows)
    for r in rows:
        print(f"{r['purpose']:<22} {r['model']:<22} calls={r['calls']:<4} in={r['input_tokens']:<9} "
              f"out={r['output_tokens']:<8} errors={r['errors']:<3} ${r['usd']}")
    print(f"TOTAL ${total:.4f} of ${config.GEMINI_BUDGET_USD:.2f} budget for key {key} ({config.DB_SOURCE})")
    other = gemini.spent_all_usd() - total
    if other > 0:
        print(f"Other keys and calls from before keys were recorded: ${other:.4f} (not counted against the budget)")
    if args.jobs:
        print()
        for j in db.fetch_all(
                """SELECT j.kind, j.status, v.duration_s, count(c.*) AS calls,
                          round(sum(c.cost_usd)::numeric, 4) AS usd, max(c.created_at) AS last
                   FROM gemini_calls c JOIN jobs j ON j.id = c.job_id JOIN videos v ON v.id = j.video_id
                   WHERE c.key_id = %s GROUP BY j.id, v.duration_s ORDER BY last DESC LIMIT %s""",
                (key, args.jobs)):
            print(f"{j['kind']:<9} {j['status']:<6} {j['duration_s']:7.1f} s  calls={j['calls']:<3} ${j['usd']}")
