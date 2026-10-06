"""
Tests for the MCP OAuth 2.1 server (Google federation). The Google leg is mocked;
these cover the domain policy, token round-trips, dynamic client registration and
the full authorize -> Google callback -> code -> token -> verify flow.
"""

import asyncio
from unittest import mock

from django.test import SimpleTestCase, TransactionTestCase, override_settings
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull
from starlette.requests import Request

from app.account.models import User
from app.mcp_server.models import OAuthAuthorizationRequest, OAuthClient
from app.mcp_server.oauth import google_flow, routes, tokens
from app.mcp_server.oauth.provider import GrantLedgerOAuthProvider

ISSUER = "https://mcp.test.example"
CLIENT_REDIRECT = "https://claude.ai/api/mcp/auth_callback"


def _client():
    return OAuthClientInformationFull(
        client_id="client-123",
        redirect_uris=[CLIENT_REDIRECT],
        token_endpoint_auth_method="none",
        grant_types=["authorization_code", "refresh_token"],
        response_types=["code"],
    )


@override_settings(MCP_ALLOWED_EMAIL_DOMAINS=["example.org"])
class DomainPolicyTests(SimpleTestCase):
    def test_allowed_domain(self):
        self.assertTrue(google_flow.email_domain_allowed({"email": "a@example.org", "email_verified": True}))

    def test_wrong_domain_denied(self):
        self.assertFalse(google_flow.email_domain_allowed({"email": "a@gmail.com", "email_verified": True}))

    def test_unverified_denied(self):
        self.assertFalse(google_flow.email_domain_allowed({"email": "a@example.org", "email_verified": False}))

    @override_settings(MCP_ALLOWED_EMAIL_DOMAINS=[])
    def test_empty_allowlist_trusts_google_but_requires_verified(self):
        self.assertTrue(google_flow.email_domain_allowed({"email": "a@any.com", "email_verified": True}))
        self.assertFalse(google_flow.email_domain_allowed({"email": "a@any.com", "email_verified": False}))


@override_settings(MCP_PUBLIC_URL=ISSUER, MCP_ACCESS_TOKEN_TTL=3600, MCP_REFRESH_TOKEN_TTL_DAYS=30)
class TokenTests(SimpleTestCase):
    def test_access_token_roundtrip(self):
        tok, _, jti = tokens.mint_access_token(user_id=7, email="a@example.org", client_id="c", scopes=["read"])
        claims = tokens.decode(tok)
        self.assertEqual((claims["typ"], claims["sub"], claims["jti"], claims["scope"]), ("access", "7", jti, "read"))

    def test_tampered_token_rejected(self):
        import jwt

        tok, _, _ = tokens.mint_access_token(user_id=1, email="a@example.org", client_id="c", scopes=[])
        with self.assertRaises(jwt.PyJWTError):
            tokens.decode(tok + "tamper")


@override_settings(
    MCP_PUBLIC_URL=ISSUER,
    MCP_ALLOWED_EMAIL_DOMAINS=["example.org"],
    MCP_API_KEY="static-service-key",
    MCP_ACCESS_TOKEN_TTL=3600,
    MCP_REFRESH_TOKEN_TTL_DAYS=30,
)
class ProviderFlowTests(TransactionTestCase):
    def setUp(self):
        self.provider = GrantLedgerOAuthProvider()

    def _authorize(self, client, google_state):
        with mock.patch.object(
            google_flow, "build_authorization_url",
            return_value=("https://accounts.google.com/o/oauth2/auth?x=1", google_state),
        ):
            params = AuthorizationParams(
                state="mcp-state", scopes=[], code_challenge="challenge-xyz",
                redirect_uri=CLIENT_REDIRECT, redirect_uri_provided_explicitly=True,
                resource=f"{ISSUER}/mcp",
            )
            return asyncio.run(self.provider.authorize(client, params))

    def _callback(self, google_state, claims):
        scope = {"type": "http", "method": "GET",
                 "query_string": f"state={google_state}&code=google-code".encode(), "headers": []}
        with mock.patch.object(google_flow, "exchange_code", return_value=claims):
            return asyncio.run(routes.google_callback(Request(scope)))

    def test_static_service_key_accepted(self):
        token = asyncio.run(self.provider.load_access_token("static-service-key"))
        self.assertEqual(token.subject, "service-key")

    def test_bad_token_rejected(self):
        self.assertIsNone(asyncio.run(self.provider.load_access_token("not-a-jwt")))

    def test_register_and_get_client(self):
        asyncio.run(self.provider.register_client(_client()))
        self.assertTrue(OAuthClient.objects.filter(pk="client-123").exists())
        self.assertEqual(asyncio.run(self.provider.get_client("client-123")).client_id, "client-123")

    def test_full_login_flow(self):
        client = _client()
        asyncio.run(self.provider.register_client(client))
        url = self._authorize(client, "gstate-1")
        self.assertTrue(url.startswith("https://accounts.google.com"))

        resp = self._callback("gstate-1", {"email": "person@example.org", "email_verified": True,
                                           "given_name": "Pat", "family_name": "Lee"})
        location = resp.headers["location"]
        self.assertTrue(location.startswith(CLIENT_REDIRECT))
        self.assertIn("state=mcp-state", location)
        user = User.objects.get(email="person@example.org")
        self.assertFalse(user.is_staff)

        req = OAuthAuthorizationRequest.objects.get(google_state="gstate-1")
        auth_code = asyncio.run(self.provider.load_authorization_code(client, req.code))
        oauth_token = asyncio.run(self.provider.exchange_authorization_code(client, auth_code))
        access = asyncio.run(self.provider.load_access_token(oauth_token.access_token))
        self.assertEqual(access.subject, str(user.id))

        # The authorization code is single-use.
        self.assertIsNone(asyncio.run(self.provider.load_authorization_code(client, req.code)))

        # Refresh rotates: the old refresh token stops working.
        refresh = asyncio.run(self.provider.load_refresh_token(client, oauth_token.refresh_token))
        asyncio.run(self.provider.exchange_refresh_token(client, refresh, []))
        self.assertIsNone(asyncio.run(self.provider.load_refresh_token(client, oauth_token.refresh_token)))

    def test_wrong_domain_callback_denied(self):
        client = _client()
        asyncio.run(self.provider.register_client(client))
        self._authorize(client, "gstate-2")
        resp = self._callback("gstate-2", {"email": "outsider@gmail.com", "email_verified": True})
        self.assertIn("error=access_denied", resp.headers["location"])
        self.assertFalse(User.objects.filter(email="outsider@gmail.com").exists())
