"""Print the dataset statistics the experiment write-up quotes, so they can be regenerated."""

from django.core.management.base import BaseCommand
from django.db.models import Count, Max, Min, Q, Sum

from app.grants.models import Award, Ministry, Organization, Program, Recipient
from app.grants.normalize import NOT_DISCLOSED, WITHHELD_INDIVIDUAL


def _money(value):
    return f"${float(value or 0) / 1e9:,.2f}B"


class Command(BaseCommand):
    help = "Print per-organization dataset statistics as a Markdown table."

    def handle(self, *args, **options):
        rows = []
        for org in Organization.objects.order_by("name"):
            awards = Award.objects.filter(ministry__organization=org)
            current = awards.filter(is_current=True)
            totals = current.aggregate(
                n=Count("id"),
                total_v=Sum("value"),
                first=Min("start_date"),
                last=Max("start_date"),
                withheld_n=Count("id", filter=Q(recipient__name=WITHHELD_INDIVIDUAL)),
                withheld_v=Sum("value", filter=Q(recipient__name=WITHHELD_INDIVIDUAL)),
                undisclosed_n=Count("id", filter=Q(recipient__name=NOT_DISCLOSED)),
                undisclosed_v=Sum("value", filter=Q(recipient__name=NOT_DISCLOSED)),
                negative_n=Count("id", filter=Q(value__lt=0)),
            )
            recipients = (
                current.filter(recipient__is_placeholder=False).values("recipient_id").distinct().count()
            )
            share = (totals["withheld_n"] / totals["n"]) if totals["n"] else 0
            rows.append(
                [
                    org.name,
                    f"{awards.count():,}",
                    f"{totals['n']:,}",
                    _money(totals["total_v"]),
                    f"{totals['first']} to {totals['last']}",
                    f"{Ministry.objects.filter(organization=org).count():,}",
                    f"{Program.objects.filter(ministry__organization=org).count():,}",
                    f"{recipients:,}",
                    f"{totals['withheld_n']:,} ({share:.1%}), {_money(totals['withheld_v'])}",
                    f"{totals['undisclosed_n']:,}, {_money(totals['undisclosed_v'])}",
                    f"{totals['negative_n']:,}",
                ]
            )

        header = [
            "Organization", "Rows", "Current rows", "Current value", "Start dates", "Ministries",
            "Programs", "Named recipients", "Withheld individuals", "Not disclosed", "Negative rows",
        ]
        self.stdout.write("| " + " | ".join(header) + " |")
        self.stdout.write("|" + "---|" * len(header))
        for row in rows:
            self.stdout.write("| " + " | ".join(row) + " |")

        shared = (
            Award.objects.filter(is_current=True, recipient__is_placeholder=False)
            .values("recipient_id")
            .annotate(funders=Count("ministry__organization_id", distinct=True))
            .filter(funders__gte=2)
            .count()
        )
        self.stdout.write("")
        self.stdout.write(f"Recipients funded by both governments (exact normalised name, all years): {shared:,}")
        self.stdout.write(f"Recipients in total (named): {Recipient.objects.filter(is_placeholder=False).count():,}")
