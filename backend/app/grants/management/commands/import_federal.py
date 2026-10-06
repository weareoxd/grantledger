"""Import the federal Proactive Disclosure of Grants and Contributions CSV."""

from django.core.management.base import BaseCommand

from app.grants.importers.base import prune_orphans
from app.grants.importers.federal import import_federal


class Command(BaseCommand):
    help = (
        "Import grants.csv from open.canada.ca (Proactive Disclosure - Grants and "
        "Contributions). Streams the file; re-importing the same file name replaces "
        "its rows."
    )

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--limit", type=int, default=None, help="Stop after N data rows")
        parser.add_argument("--batch-size", type=int, default=5000)
        parser.add_argument(
            "--include-individuals", action="store_true",
            help="Store individuals' names instead of withholding them (private copies only)",
        )

    def handle(self, *args, **options):
        stats = import_federal(
            options["path"],
            include_individuals=options["include_individuals"],
            limit=options["limit"],
            batch_size=options["batch_size"],
        )
        self.stdout.write(str(stats))
        self.stdout.write(f"Pruned records with no awards: {prune_orphans()}")
