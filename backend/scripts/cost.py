"""Print recorded Gemini spend for the configured database."""
from app import config, db

if __name__ == "__main__":
    rows = db.fetch_all(
        """SELECT split_part(purpose, ':', 1) AS purpose, model, count(*) AS calls,
                  sum(input_tokens) AS input_tokens, sum(output_tokens + thought_tokens) AS output_tokens,
                  round(sum(cost_usd)::numeric, 4) AS usd, count(*) FILTER (WHERE error IS NOT NULL) AS errors
           FROM gemini_calls GROUP BY 1, 2 ORDER BY usd DESC"""
    )
    total = sum(float(r["usd"]) for r in rows)
    for r in rows:
        print(f"{r['purpose']:<22} {r['model']:<22} calls={r['calls']:<4} in={r['input_tokens']:<9} "
              f"out={r['output_tokens']:<8} errors={r['errors']:<3} ${r['usd']}")
    print(f"TOTAL ${total:.4f} of ${config.GEMINI_BUDGET_USD:.2f} budget ({config.DB_SOURCE})")
