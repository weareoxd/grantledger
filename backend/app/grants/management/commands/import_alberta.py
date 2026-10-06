"""Import one or more Government of Alberta Grant Payments Disclosure CSVs."""

from django.core.management.base import BaseCommand

from app.grants.importers.base import prune_orphans
from app.grants.importers.alberta import import_alberta


class Command(BaseCommand):
    help = (
        "Import tbf-grants-disclosure-<fy>.csv files from open.alberta.ca. Each file "
        "name is a replaceable unit: re-importing it replaces its rows."
    )

    def add_arguments(self, parser):
        parser.add_argument("paths", nargs="+")
        parser.add_argument("--limit", type=int, default=None, help="Stop after N data rows per file")
        parser.add_argument("--batch-size", type=int, default=5000)
        parser.add_argument(
            "--include-individuals", action="store_true",
            help="Store names that look like individuals' instead of withholding them (private copies only)",
        )

    def handle(self, *args, **options):
        for path in options["paths"]:
            stats = import_alberta(
                path,
                include_individuals=options["include_individuals"],
                limit=options["limit"],
                batch_size=options["batch_size"],
            )
            self.stdout.write(f"{path}: {stats}")
        self.stdout.write(f"Pruned records with no awards: {prune_orphans()}")
