"""Create FiscalYear rows covering the awards in the database (plus a default span)."""

from datetime import date

from django.core.management.base import BaseCommand
from django.db.models import Max, Min

from app.grants.models import Award, FiscalYear


class Command(BaseCommand):
    help = "Ensure FiscalYear rows exist for every year covered by the data."

    def add_arguments(self, parser):
        parser.add_argument("--from", dest="start", type=int, default=2014)
        parser.add_argument("--to", dest="end", type=int, default=date.today().year)

    def handle(self, *args, **options):
        start, end = options["start"], options["end"]
        bounds = Award.objects.aggregate(lo=Min("start_date"), hi=Max("start_date"))
        if bounds["lo"]:
            lo = bounds["lo"]
            start = min(start, lo.year - 1 if lo.month < 4 else lo.year)
        if bounds["hi"]:
            hi = bounds["hi"]
            end = max(end, hi.year - 1 if hi.month < 4 else hi.year)
        created = 0
        for year in range(start, end + 1):
            _, was_created = FiscalYear.objects.get_or_create(
                year=year,
                defaults={"start_date": date(year, 4, 1), "end_date": date(year + 1, 3, 31)},
            )
            created += int(was_created)
        self.stdout.write(f"Fiscal years {start}-{end} ensured ({created} created).")
