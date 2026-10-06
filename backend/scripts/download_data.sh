#!/bin/bash
# Download the open-data sources used by GrantLedger into backend/data/.
set -u
cd "$(dirname "$0")/../data"
mkdir -p alberta
AB=https://open.alberta.ca/dataset/faef5592-9ea0-4b60-92db-79a8a9673fe5/resource
# 2014-15 to 2019-20 use the "(standardized)" resources: the original files for
# those years contain thousands of rows with unquoted commas that shift columns.
declare -a FILES=(
  "3a822e71-4dc9-41da-8147-cc693a4e2829 2014-15"
  "73f0fc9b-de26-49d1-a6d2-26a150e20c9d 2015-16"
  "8b6af39d-5815-4e5d-9a4f-29c7f4bf63a5 2016-17"
  "ee66f4db-2668-4faf-a208-1d426a6fb580 2017-18"
  "abf3ef21-8a22-418a-bf8f-7d93b9ec6da5 2018-19"
  "bd6f09bc-5db3-46ec-959c-e30a0b1d09f3 2019-20"
  "ef6f0f85-7f5e-449e-8a54-3d45e37f3dc4 2020-21"
  "bda2903e-8106-47be-824e-2b22636c8a05 2021-22"
  "a9a92ce7-c005-418d-a411-b663254c601a 2022-23"
  "0c7e93c1-1c28-460d-92eb-f6934e9ba4a8 2023-24"
  "f4197a5a-b3c3-4045-b2ce-7f77d700935f 2024-25"
  "1e95ba75-b4b1-44df-9426-988d60b6cff7 2025-26"
)
for entry in "${FILES[@]}"; do
  set -- $entry
  out="alberta/tbf-grants-disclosure-$2.csv"
  [ -s "$out" ] && { echo "skip $out"; continue; }
  curl -sS -L --retry 3 --max-time 600 -o "$out" "$AB/$1/download/tbf-grants-disclosure-$2.csv" && echo "ok $out $(wc -c < "$out")"
done
# Current fiscal year (live export: US-style dates, different header). Saved under
# the fiscal year it contains, so the official yearly file replaces it once published.
tmp=alberta/.current-export.csv
if curl -sS -L --retry 3 --max-time 600 -o "$tmp" \
     "https://grants.dataservices.alberta.ca/GrantsDataService.svc/file.exportcsv"; then
  fy=$(sed -n '2p' "$tmp" | grep -oE '[0-9]{4} - [0-9]{4}' | head -1 | sed -E 's/([0-9]{4}) - [0-9]{2}([0-9]{2})/\1-\2/')
  # The live export always holds the open fiscal year, which has no yearly file yet,
  # so refreshing it overwrites the previous export of the same year.
  if [ -n "$fy" ]; then
    mv -f "$tmp" "alberta/tbf-grants-disclosure-$fy.csv" && echo "ok current -> $fy"
  else
    rm -f "$tmp"; echo "current export skipped (fiscal year not found in the file)"
  fi
fi
# Federal consolidated file (~2.3 GB)
if [ ! -s federal/grants.csv ]; then
  mkdir -p federal
  curl -sS -L --retry 3 -C - -o federal/grants.csv \
    "https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013/resource/1d15a62f-5656-49ad-8c88-f40ce689d831/download/grants.csv" \
    && echo "ok federal $(wc -c < federal/grants.csv)"
fi
echo DONE
