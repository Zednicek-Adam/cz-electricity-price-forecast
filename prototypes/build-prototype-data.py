"""PROTOTYPE ONLY -- issue #12. Builds prototype-data.js from the epf-diploma thesis outputs.
Not production code; no error handling, no tests."""
import csv, json, math, os, sys
from collections import defaultdict

SRC = sys.argv[1]  # path to a clone of epf-diploma
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prototype-data.js")

def read_series(path, col):
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            out[row["date"]] = float(row[col])
    return out

price = read_series(os.path.join(SRC, "sources", "CZ.csv"), "el_price")
preds = {}
for name, frag in (("chronos", "Chronos-2_"), ("ar", "AR_")):
    d = os.path.join(SRC, "predictions")
    fn = next(f for f in os.listdir(d) if f.startswith(frag))
    preds[name] = read_series(os.path.join(d, fn), "pred_el_price")

stamps = sorted(price)
idx = {s: i for i, s in enumerate(stamps)}
window = [s for s in stamps if "2020-01-01" <= s[:10] <= "2024-12-31"]

days = {}
for s in window:
    day, hour = s[:10], int(s[11:13])
    d = days.setdefault(day, {"o": [None]*24, "c": [None]*24, "a": [None]*24, "n": [None]*24})
    d["o"][hour] = price[s]
    d["c"][hour] = preds["chronos"].get(s)
    d["a"][hour] = preds["ar"].get(s)
    d["n"][hour] = price[stamps[idx[s]-24]]          # day-lag naive

days = {k: v for k, v in days.items() if all(x is not None for row in v.values() for x in row)}
print("complete days:", len(days))

MODELS = ("c", "a", "n")

def metrics(rows):
    """rows: list of (obs, {model: pred}) -> mae/rmse/smape per model plus rmae"""
    out = {}
    for m in MODELS:
        errs = [abs(o - r[m]) for o, r in rows]
        sq = [(o - r[m])**2 for o, r in rows]
        sm = [200*abs(o - r[m])/(abs(o)+abs(r[m])) for o, r in rows if abs(o)+abs(r[m]) > 0]
        out[m] = {"mae": sum(errs)/len(errs), "rmse": math.sqrt(sum(sq)/len(sq)),
                  "smape": sum(sm)/len(sm), "n": len(rows)}
    for m in MODELS:
        out[m]["rmae"] = out[m]["mae"] / out["n"]["mae"]
    return out

def rows_for(daykeys):
    return [(days[d]["o"][h], {m: days[d][m][h] for m in MODELS})
            for d in daykeys for h in range(24)]

allday = sorted(days)
overall = metrics(rows_for(allday))
by_year = {y: metrics(rows_for([d for d in allday if d[:4] == y])) for y in ("2020","2021","2022","2023","2024")}
by_month = {}
for d in allday:
    by_month.setdefault(d[:7], []).append(d)
by_month = {k: metrics(rows_for(v)) for k, v in sorted(by_month.items())}

# Diebold-Mariano statistic per period ordinal, MAE loss, h=1. Positive => a beats b.
def dm(a, b):
    out = []
    for h in range(24):
        diffs = [abs(days[d]["o"][h]-days[d][b][h]) - abs(days[d]["o"][h]-days[d][a][h]) for d in allday]
        n = len(diffs); mu = sum(diffs)/n
        var = sum((x-mu)**2 for x in diffs)/(n-1)
        out.append(mu/math.sqrt(var/n))
    return out

dm_stats = {f"{a}_vs_{b}": dm(a, b) for a in MODELS for b in MODELS if a != b}

# per-day mae/rmse/smape, for the "which day" surfaces and the metric selector
def day_metrics(d):
    out={}
    for m in MODELS:
        errs=[abs(days[d]["o"][h]-days[d][m][h]) for h in range(24)]
        sq=[(days[d]["o"][h]-days[d][m][h])**2 for h in range(24)]
        sm=[200*abs(days[d]["o"][h]-days[d][m][h])/(abs(days[d]["o"][h])+abs(days[d][m][h]))
            for h in range(24) if abs(days[d]["o"][h])+abs(days[d][m][h])>0]
        out[m]={"mae":sum(errs)/24,"rmse":math.sqrt(sum(sq)/24),
                "smape":(sum(sm)/len(sm)) if sm else 0.0}
    for m in MODELS:                       # rMAE of a single day, naive as denominator
        out[m]["rmae"]=out[m]["mae"]/out["n"]["mae"] if out["n"]["mae"] > 0 else 0.0
    return out
day_mae = {d: day_metrics(d) for d in allday}

# running metrics: cumulative over every hour up to and including each day, so the
# line shows how the whole-period figure settles rather than how one day scored
def running():
    acc={m:{"abs":0.0,"sq":0.0,"smape":0.0,"nsm":0} for m in MODELS}
    n=0; out={m:{k:[] for k in ("mae","rmse","smape","rmae")} for m in MODELS}
    for d in allday:
        for h in range(24):
            o=days[d]["o"][h]
            for m in MODELS:
                e=o-days[d][m][h]
                acc[m]["abs"]+=abs(e); acc[m]["sq"]+=e*e
                if abs(o)+abs(days[d][m][h])>0:
                    acc[m]["smape"]+=200*abs(e)/(abs(o)+abs(days[d][m][h])); acc[m]["nsm"]+=1
        n+=24
        for m in MODELS:
            out[m]["mae"].append(acc[m]["abs"]/n)
            out[m]["rmse"].append(math.sqrt(acc[m]["sq"]/n))
            out[m]["smape"].append(acc[m]["smape"]/acc[m]["nsm"] if acc[m]["nsm"] else 0.0)
        for m in MODELS:
            out[m]["rmae"].append(out[m]["mae"][-1]/out["n"]["mae"][-1])
    return out
run = running()

r1 = lambda xs: [round(x, 1) for x in xs]
payload = {
    "window": [allday[0], allday[-1]],
    "days": {d: {k: r1(v) for k, v in days[d].items()} for d in allday},
    "overall": overall, "byYear": by_year, "byMonth": by_month,
    "dm": {k: [round(x, 3) for x in v] for k, v in dm_stats.items()},
    "running": {m: {k: [round(x, 4) for x in v] for k, v in run[m].items()} for m in MODELS},
    "dayMetrics": {d: {m: {k: round(x, 2) for k, x in v[m].items()} for m in MODELS}
                   for d, v in day_mae.items()},
    "labels": {"c": "Chronos-2", "a": "AR-168", "n": "Naive"},
}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// PROTOTYPE DATA -- generated by build-prototype-data.py from epf-diploma. Throwaway.\n")
    f.write("window.PROTO = " + json.dumps(payload) + ";\n")
print("overall:", {m: (round(overall[m]["mae"],2), round(overall[m]["rmae"],3)) for m in MODELS})
print("wrote", OUT, round(os.path.getsize(OUT)/1e6, 2), "MB")
