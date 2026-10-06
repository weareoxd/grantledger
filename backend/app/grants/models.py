"""
Unified data model over two grant disclosures.

organization -> ministry -> program -> award, plus recipients. The federal source
discloses *agreements* (with amendments); Alberta discloses *payments*. Both land in
``Award`` with ``record_kind`` saying which, because the questions people ask
("who got money from whom, when, for what") are the same shape.
"""

from django.db import models

from app.grants import constants


class Organization(models.Model):
    name = models.CharField(max_length=255, unique=True)
    # Importer key ("federal", "alberta"); see constants.ORGANIZATIONS.
    key = models.CharField(max_length=32, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Ministry(models.Model):
    organization = models.ForeignKey(
        Organization, related_name="ministries", on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)

    class Meta:
        verbose_name_plural = "ministries"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="ministry_org_name_uniq")
        ]

    def __str__(self):
        return self.name


class Program(models.Model):
    ministry = models.ForeignKey(Ministry, related_name="programs", on_delete=models.CASCADE)
    name = models.CharField(max_length=500)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["ministry", "name"], name="program_ministry_name_uniq")
        ]

    def __str__(self):
        return self.name


class Recipient(models.Model):
    """
    A funding recipient. ``name`` is the canonical, normalised (upper-cased) form
    used for matching across sources; ``display_name`` is the first raw spelling seen.
    """

    name = models.CharField(max_length=500, unique=True)
    display_name = models.CharField(max_length=500)
    # True for the aggregate stand-ins ("INDIVIDUAL RECIPIENT (NAME WITHHELD)",
    # "RECIPIENT NOT DISCLOSED"). Exclude them from "top recipient" rankings.
    is_placeholder = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class RecipientAlias(models.Model):
    """A normalised raw name variant resolved to its canonical recipient."""

    name = models.CharField(max_length=500, unique=True)
    recipient = models.ForeignKey(Recipient, related_name="aliases", on_delete=models.CASCADE)

    class Meta:
        verbose_name_plural = "recipient aliases"

    def __str__(self):
        return f"{self.name} -> {self.recipient_id}"


class Award(models.Model):
    AGREEMENT = "agreement"
    PAYMENT = "payment"
    RECORD_KIND_CHOICES = [(k, k) for k in constants.RECORD_KINDS]
    AGREEMENT_TYPE_CHOICES = list(constants.AGREEMENT_TYPES.items())
    RECIPIENT_TYPE_CHOICES = list(constants.RECIPIENT_TYPES.items())

    ministry = models.ForeignKey(Ministry, related_name="awards", on_delete=models.CASCADE)
    program = models.ForeignKey(
        Program, related_name="awards", on_delete=models.SET_NULL, null=True, blank=True
    )
    recipient = models.ForeignKey(Recipient, related_name="awards", on_delete=models.CASCADE)

    record_kind = models.CharField(max_length=16, choices=RECORD_KIND_CHOICES)
    reference = models.CharField(max_length=255)
    amendment_number = models.IntegerField(default=0)
    amendment_date = models.DateField(null=True, blank=True)
    # For agreements: True on the latest amendment of each reference. Always True
    # for payments. Totals should only ever sum current rows.
    is_current = models.BooleanField(default=True)

    agreement_type = models.CharField(
        max_length=1, choices=AGREEMENT_TYPE_CHOICES, null=True, blank=True
    )
    recipient_type = models.CharField(
        max_length=1, choices=RECIPIENT_TYPE_CHOICES, null=True, blank=True
    )
    recipient_province = models.CharField(max_length=64, null=True, blank=True)
    recipient_city = models.CharField(max_length=255, null=True, blank=True)

    value = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    start_date = models.DateField()
    # True when the source gave no date and start_date is the first day of the
    # disclosed fiscal year (Alberta's undisclosed aggregate rows).
    start_date_estimated = models.BooleanField(default=False)
    end_date = models.DateField(null=True, blank=True)

    title = models.CharField(max_length=1000, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    naics = models.CharField(max_length=16, null=True, blank=True)

    # Alberta-only attributes
    business_unit = models.CharField(max_length=255, null=True, blank=True)
    lottery_fund = models.BooleanField(null=True, blank=True)

    source_file = models.CharField(max_length=255, null=True, blank=True)
    import_date = models.DateField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["start_date"], name="award_start_idx"),
            models.Index(fields=["value"], name="award_value_idx"),
            models.Index(fields=["ministry", "reference"], name="award_min_ref_idx"),
            models.Index(fields=["recipient", "start_date"], name="award_recip_start_idx"),
            models.Index(fields=["is_current"], name="award_current_idx"),
            models.Index(fields=["source_file"], name="award_source_idx"),
            models.Index(fields=["program", "start_date"], name="award_prog_start_idx"),
        ]

    def __str__(self):
        return f"{self.reference} ({self.record_kind})"

    @property
    def fiscal_year(self):
        """April-March fiscal year derived from start_date (month < 4 -> previous year)."""
        if self.start_date.month < 4:
            return self.start_date.year - 1
        return self.start_date.year


class FiscalYear(models.Model):
    year = models.IntegerField(unique=True, help_text="Fiscal year start, e.g. 2024 = Apr 2024 - Mar 2025")
    start_date = models.DateField()
    end_date = models.DateField()

    class Meta:
        ordering = ["-year"]

    def __str__(self):
        return f"FY{self.year}"
