from django.contrib.auth.base_user import BaseUserManager


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("An email address is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self._create_user(email, password, **extra_fields)

    def update_or_create_from_access_token(self, **claims):
        """
        Provision or refresh a user from Google id_token claims.

        Only identity fields are taken from the claims; staff/superuser flags are
        never derived from a login. Returns (user, created).
        """
        email = self.normalize_email(claims.get("email") or "")
        if not email:
            raise ValueError("Google claims did not include an email")
        defaults = {
            "first_name": (claims.get("given_name") or "")[:30],
            "last_name": (claims.get("family_name") or "")[:30],
        }
        user, created = self.update_or_create(email=email, defaults=defaults)
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        return user, created
