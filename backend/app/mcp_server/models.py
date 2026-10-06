"""
Persistence for the MCP OAuth 2.1 Authorization Server.

Only the OAuth handshake needs server-side state (registered clients, in-flight
authorization requests, revoked token ids); it must survive worker restarts and be
shared across uvicorn workers, so it lives in Postgres. Issued access and refresh
tokens are stateless signed JWTs (oauth/tokens.py) and are not stored.
"""

import uuid

from django.db import models


class OAuthClient(models.Model):
    """A client registered via Dynamic Client Registration (e.g. claude.ai, ChatGPT)."""

    client_id = models.CharField(max_length=255, primary_key=True)
    data = models.JSONField()  # full OAuthClientInformationFull payload
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.client_id


class OAuthAuthorizationRequest(models.Model):
    """
    One authorization request, spanning the Google federation round-trip.

    Created when the client hits /authorize (holding its PKCE challenge and our
    Google code_verifier), completed by the Google callback, which binds the
    authenticated user and issues the one-time authorization ``code``.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client_id = models.CharField(max_length=255)
    redirect_uri = models.TextField()
    redirect_uri_provided_explicitly = models.BooleanField(default=True)
    code_challenge = models.TextField(blank=True, null=True)
    scopes = models.JSONField(default=list)
    resource = models.TextField(blank=True, null=True)
    mcp_state = models.TextField(blank=True, null=True)

    google_state = models.CharField(max_length=255, db_index=True)
    google_code_verifier = models.TextField()

    user_id = models.IntegerField(blank=True, null=True)
    code = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    used = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"authz-request {self.id} ({self.client_id})"


class OAuthRevokedToken(models.Model):
    """Denylist of revoked or rotated token ids (jti) until their natural expiry."""

    jti = models.CharField(max_length=255, primary_key=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return self.jti
