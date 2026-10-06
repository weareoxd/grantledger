"""
Run the experiment's question bank against the live MCP server over Streamable HTTP.

Each question lists the tool calls a model would make to answer it. The runner makes
those calls through a real MCP client session and records the call count, wall time and
the raw results to results/question-bank-results.json, which the write-up reads from.

    docker compose exec django python scripts/run_question_bank.py
"""

import asyncio
import json
import os
import time
from pathlib import Path

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ.get("MCP_URL", "http://mcp:8082/mcp")
OUT = Path(os.environ.get("QB_OUT", "results/question-bank-results.json"))

FED = {"field": "organization", "op": "eq", "value": "Government of Canada"}
AB = {"field": "organization", "op": "eq", "value": "Government of Alberta"}


def fy(year):
    return {"field": "fiscal_year", "op": "eq", "value": year}


QUESTIONS = [
    # --- Program analyst -------------------------------------------------------------
    {
        "id": "A1",
        "persona": "Program analyst",
        "question": "Which organizations received funding from both governments in FY2024, and how much from each?",
        "portal": "No",
        "portal_why": "Two portals, two exports, then matching recipient names by hand in Excel.",
        "calls": [("shared_recipients", {"fiscal_year_from": 2024, "fiscal_year_to": 2024, "limit": 15})],
    },
    {
        "id": "A2",
        "persona": "Program analyst",
        "question": "From FY2020 to FY2025, how much did each government put into the University of Calgary, by year?",
        "portal": "Partial",
        "portal_why": "Two keyword searches; the federal portal filters by calendar year and lists every amendment.",
        "calls": [
            ("list_recipients", {"search": "University of Calgary", "limit": 10}),
            ("recipient_funding", {"recipient_name": "University of Calgary", "fiscal_year_from": 2020, "fiscal_year_to": 2025}),
        ],
    },
    {
        "id": "A3",
        "persona": "Program analyst",
        "question": "Which Alberta programs grew the most between FY2022 and FY2025?",
        "portal": "No",
        "portal_why": "The Alberta table pages through payments ten at a time and never totals them.",
        "calls": [
            ("query", {"model": "award", "filters": [AB, {"field": "fiscal_year", "op": "in", "value": [2022, 2025]},
                                                     {"field": "recipient_is_placeholder", "op": "eq", "value": False}],
                       "group_by": ["program", "fiscal_year"],
                       "aggregations": [{"func": "sum", "field": "value", "alias": "paid"}],
                       "order_by": ["-paid"], "limit": 400}),
        ],
    },
    {
        "id": "A4",
        "persona": "Program analyst",
        "question": "What share of Alberta Health's FY2024 grant payments went to named recipients versus undisclosed aggregates?",
        "portal": "No",
        "portal_why": "No totals; undisclosed rows are listed under program names among thousands of payments.",
        "calls": [
            ("list_ministries", {"organization_id": None, "search": "Health", "limit": 20}),
            ("ministry_funding", {"ministry_id": "$Health", "fiscal_year_from": 2024, "fiscal_year_to": 2024, "top_recipients": 5}),
        ],
    },
    # --- Journalist / researcher ---------------------------------------------------------
    {
        "id": "B1",
        "persona": "Journalist",
        "question": "Which federal departments committed the most to Alberta-based recipients in FY2024?",
        "portal": "No",
        "portal_why": "The federal portal has no recipient-province filter and no totals.",
        "calls": [("award_totals", {"group_by": "ministry", "filters": [FED, fy(2024), {"field": "recipient_province", "op": "eq", "value": "AB"}], "limit": 10})],
    },
    {
        "id": "B2",
        "persona": "Journalist",
        "question": "Which Calgary organizations received the most federal agreement value across FY2023 and FY2024?",
        "portal": "Partial",
        "portal_why": "A keyword search for Calgary finds rows but cannot group or total them.",
        "calls": [("award_totals", {"group_by": "recipient", "filters": [FED, {"field": "fiscal_year", "op": "between", "value": [2023, 2024]},
                                                                           {"field": "recipient_city", "op": "contains", "value": "Calgary"}], "limit": 10})],
    },
    {
        "id": "B3",
        "persona": "Journalist",
        "question": "Show the amendment history of the largest federal agreement with an Alberta recipient since FY2020.",
        "portal": "Partial",
        "portal_why": "Sort by value works, but there is no province filter to narrow to Alberta.",
        "calls": [
            ("list_awards", {"filters": [FED, {"field": "recipient_province", "op": "eq", "value": "AB"},
                                         {"field": "fiscal_year", "op": "gte", "value": 2020},
                                         {"field": "recipient_is_placeholder", "op": "eq", "value": False}],
                             "sort": ["-value"], "fields": ["id", "reference", "recipient", "ministry", "program", "value", "start_date", "amendment_number"], "limit": 1}),
            ("get_award", {"id": "$largest"}),
        ],
    },
    {
        "id": "B4",
        "persona": "Journalist",
        "question": "How did Alberta's lottery-funded grant payments change around the Lottery Fund's dissolution in December 2019?",
        "portal": "Partial",
        "portal_why": "The lottery column can be filtered, but nothing is totalled by year.",
        "calls": [("award_totals", {"group_by": "fiscal_year", "filters": [AB, {"field": "lottery_fund", "op": "eq", "value": True}], "limit": 20})],
    },
    # --- Sector researcher ---------------------------------------------------------------
    {
        "id": "C1",
        "persona": "Sector researcher",
        "question": "Which First Nations received funding from both governments across FY2023 and FY2024?",
        "portal": "No",
        "portal_why": "Cross-government matching is not possible in either portal.",
        "calls": [("shared_recipients", {"fiscal_year_from": 2023, "fiscal_year_to": 2024, "search": "FIRST NATION", "limit": 15})],
    },
    {
        "id": "C2",
        "persona": "Sector researcher",
        "question": "How have Alberta's child care grant payments changed year over year since FY2019?",
        "portal": "No",
        "portal_why": "Program filter works, but there are no yearly totals.",
        "calls": [("award_totals", {"group_by": "fiscal_year", "filters": [AB, {"field": "program", "op": "contains", "value": "CHILD CARE"},
                                                                              {"field": "fiscal_year", "op": "gte", "value": 2019}], "limit": 20})],
    },
    {
        "id": "C3",
        "persona": "Sector researcher",
        "question": "For federal agreements with Alberta not-for-profits, how does the split between grants and contributions change by year?",
        "portal": "Partial",
        "portal_why": "Agreement type is a facet; recipient type and province are not.",
        "calls": [("query", {"model": "award", "filters": [FED, {"field": "recipient_province", "op": "eq", "value": "AB"},
                                                           {"field": "recipient_type", "op": "eq", "value": "N"},
                                                           {"field": "fiscal_year", "op": "between", "value": [2019, 2025]}],
                             "group_by": ["fiscal_year", "agreement_type"],
                             "aggregations": [{"func": "sum", "field": "value", "alias": "committed"}, {"func": "count", "field": "id", "alias": "agreements"}],
                             "order_by": ["fiscal_year", "agreement_type"], "limit": 50})],
    },
    {
        "id": "C4",
        "persona": "Sector researcher",
        "question": "Which recipients got Community Facility Enhancement Program payments of $250,000 or more in FY2024?",
        "portal": "Yes",
        "portal_why": "Program and amount column filters can produce this list, ten rows per page.",
        "calls": [
            ("list_programs", {"organization_id": None, "search": "CFEP", "limit": 20}),
            ("list_awards", {"filters": [AB, fy(2024), {"field": "program", "op": "contains", "value": "CFEP"},
                                         {"field": "value", "op": "gte", "value": 250000}],
                             "sort": ["-value"], "fields": ["recipient", "program", "value", "start_date"], "limit": 25}),
        ],
    },
]


def _resolve(args, context):
    """Fill "$name" placeholders from earlier results (e.g. an id found by a lookup call)."""
    resolved = {}
    for key, value in args.items():
        if isinstance(value, str) and value.startswith("$"):
            value = context[value[1:]]
        if value is not None:
            resolved[key] = value
    return resolved


def _remember(question_id, tool, data, context):
    if question_id == "A4" and tool == "list_ministries":
        context["Health"] = next(
            m["id"] for m in data["data"] if m["name"] == "Health" and m["organization"] == "Government of Alberta"
        )
    if question_id == "B3" and tool == "list_awards" and data["data"]:
        context["largest"] = data["data"][0]["id"]


async def main():
    headers = {"Authorization": f"Bearer {os.environ['MCP_API_KEY']}"}
    results = []
    async with streamablehttp_client(URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            for q in QUESTIONS:
                context, calls, started = {}, [], time.monotonic()
                for tool, args in q["calls"]:
                    try:
                        args = _resolve(args, context)
                    except KeyError as missing:
                        calls.append({"tool": tool, "skipped": f"no earlier result for {missing}"})
                        break
                    t0 = time.monotonic()
                    res = await session.call_tool(tool, args)
                    elapsed = round(time.monotonic() - t0, 3)
                    text = "".join(getattr(c, "text", "") for c in res.content)
                    data = json.loads(text) if not res.isError else {"error": text}
                    if not res.isError:
                        _remember(q["id"], tool, data, context)
                    calls.append({"tool": tool, "args": args, "seconds": elapsed, "error": res.isError, "result": data})
                total = round(time.monotonic() - started, 3)
                print(f"{q['id']}: {len(calls)} call(s), {total:.2f}s{' ERROR' if any(c.get('error') for c in calls) else ''}{' SKIPPED' if any('skipped' in c for c in calls) else ''}")
                results.append({**{k: v for k, v in q.items() if k != "calls"}, "seconds": total, "calls": calls})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False, default=str))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
