"""Name normalisation and the personal-name privacy filter (fictional names only)."""

from django.test import SimpleTestCase

from app.grants.normalize import looks_like_person, normalize_name


class NormalizeNameTests(SimpleTestCase):
    def test_federal_and_alberta_spellings_share_a_key(self):
        self.assertEqual(normalize_name("University of Calgary"), "UNIVERSITY OF CALGARY")
        self.assertEqual(normalize_name("UNIVERSITY OF CALGARY"), "UNIVERSITY OF CALGARY")

    def test_accents_punctuation_and_legal_forms(self):
        self.assertEqual(normalize_name("Société Example Ltée."), "SOCIETE EXAMPLE LTEE")
        self.assertEqual(normalize_name("Acme Widgets Limited"), normalize_name("ACME WIDGETS LTD."))
        self.assertEqual(normalize_name("Acme & Sons, Incorporated"), "ACME AND SONS INC")
        self.assertEqual(normalize_name("The Example Foundation"), "EXAMPLE FOUNDATION")

    def test_split_legal_forms_and_coops(self):
        self.assertEqual(normalize_name("Northern Biofuel L P"), "NORTHERN BIOFUEL LP")
        self.assertEqual(normalize_name("Prairie Co-op"), normalize_name("PRAIRIE CO OP"))

    def test_french_elision(self):
        self.assertEqual(
            normalize_name("L'Association d'Exemple"), "L ASSOCIATION D EXEMPLE"
        )

    def test_blank(self):
        self.assertEqual(normalize_name(""), "")
        self.assertEqual(normalize_name(None), "")


class LooksLikePersonTests(SimpleTestCase):
    def test_people_are_flagged(self):
        for name in [
            "DOE JANE",
            "DOE JANE MARIE",
            "ROE RICHARD A",
            "DOE JOHN AND MARY",  # couples: AND is not an organization marker
            "ST-PIERRE ANNE",  # ST is a surname particle
            "WOOD ALEX",  # surname that is also an organization word
            "PARK MINJI",
            "STANDING ON THE ROAD ALEX",  # Indigenous family name containing ON THE
            "FIRST RIDER SAM",
            "GARCIA LOPEZ MARIA DEL CARMEN",  # long personal names
            "BOARD ALEX",  # a surname, listed surname first
            "LODGE SAM RIVER",
        ]:
            with self.subTest(name=name):
                self.assertTrue(looks_like_person(name))

    def test_organizations_are_kept(self):
        for name in [
            "ACME WIDGETS LTD",
            "1234567 ALBERTA LTD",
            "EXAMPLE COMMUNITY ASSOCIATION",
            "UNIVERSITY OF EXAMPLE",
            "MD OF EXAMPLE NO 1",
            "EXAMPLE FIRST NATION",
            "EXAMPLE SCHOOL BOARD",
            "CALGARY EXAMPLE CO-OP",
            "EXAMPLECORP",  # single token
            "JANE DOE PROFESSIONAL CORP",  # a business entity, not an individual
            "EXAMPLE CHILDCARE SOCIETY",
            "ALPHA BETA GAMMA DELTA EPSILON ZETA ETA",  # 7+ tokens
            "EXAMPLE LAKE BAND",  # First Nations bands
            "MOHAWKS OF THE BAY OF EXAMPLE",
            "EXAMPLE WINNIPEG BALLET THE",  # federal inverted article
            "EXAMPLE VALLEY LAND AND WATER BOARD",  # trailing BOARD on a 3+ word name
            "EXAMPLE ANISHINABEK",
        ]:
            with self.subTest(name=name):
                self.assertFalse(looks_like_person(name))

    def test_blank_is_not_a_person(self):
        self.assertFalse(looks_like_person(""))
        self.assertFalse(looks_like_person(None))
