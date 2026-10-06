"""Code tables and source metadata shared by the importers and the MCP schema."""

AGREEMENT_TYPES = {
    "G": "Grant",
    "C": "Contribution",
    "O": "Other transfer payment",
}

RECIPIENT_TYPES = {
    "F": "For-profit organization",
    "N": "Not-for-profit organization or charity",
    "S": "Academia",
    "A": "Indigenous recipient",
    "G": "Government",
    "I": "International (non-government)",
    "P": "Individual or sole proprietorship",
    "O": "Other",
}

RECORD_KINDS = {
    "agreement": (
        "A funding agreement as disclosed by the Government of Canada. ``value`` is the "
        "total agreement value, restated on each amendment; only ``is_current`` rows "
        "carry the latest value."
    ),
    "payment": (
        "A cash grant payment as disclosed by the Government of Alberta. ``value`` is "
        "the amount paid on ``start_date``."
    ),
}

# Organization key -> metadata. Keys are what the importers use; names are what the
# LLM sees.
ORGANIZATIONS = {
    "federal": {
        "name": "Government of Canada",
        "record_kind": "agreement",
        "source": "Proactive Disclosure - Grants and Contributions (Treasury Board of Canada Secretariat)",
        "source_url": "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
        "licence": "Open Government Licence - Canada",
        "licence_url": "https://open.canada.ca/en/open-government-licence-canada",
        "attribution": "Contains information licensed under the Open Government Licence – Canada.",
    },
    "alberta": {
        "name": "Government of Alberta",
        "record_kind": "payment",
        "source": "Grant Payments Disclosure (Government of Alberta)",
        "source_url": "https://open.alberta.ca/dataset/grant-disclosure",
        "licence": "Open Government Licence - Alberta",
        "licence_url": "https://open.alberta.ca/licence",
        "attribution": "Contains information licensed under the Open Government Licence – Alberta.",
    },
}

ATTRIBUTION_LINES = [meta["attribution"] for meta in ORGANIZATIONS.values()]
