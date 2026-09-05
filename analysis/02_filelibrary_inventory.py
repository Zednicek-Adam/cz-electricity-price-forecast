"""Ticket #14, step 1: find out what the File Library actually holds.

Prints the TP_export folder listing, then for each of the three series the ticket
names, the extract filenames available. Nothing is measured here -- this only
pins down the names 03_publication_lag.py has to ask for.
"""
from tp_fms import list_folder, token

WANTED = ("EnergyPrices", "DayAheadTotalLoadForecast", "DayAheadAggregatedGeneration")

tok = token()
root = list_folder(tok)
print(f"=== /TP_export/  ({len(root)} entries)")
for name in sorted(root):
    print("   ", name)

for name in sorted(root):
    if not any(w.lower() in name.lower() for w in WANTED):
        continue
    files = list_folder(tok, name)
    print(f"\n=== /TP_export/{name}/  ({len(files)} files)")
    for f in sorted(files)[-18:]:
        print("   ", f)
