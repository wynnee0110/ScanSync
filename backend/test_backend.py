"""
test_backend.py
---------------
Focused unit tests for Supabase JWT verification (HS256 + ES256 JWKS),
operator creation validation/error handling, and FastAPI /api/operators routes.
"""

import base64
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

import auth
import main
import operator_service
from config import Config


def _b64url_uint(value: int, length: int = 32) -> str:
    raw = value.to_bytes(length, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _generate_ec_keypair(kid: str = "test-kid-1"):
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    numbers = private_key.public_key().public_numbers()
    jwk_dict = {
        "kty": "EC",
        "crv": "P-256",
        "alg": "ES256",
        "use": "sig",
        "kid": kid,
        "x": _b64url_uint(numbers.x),
        "y": _b64url_uint(numbers.y),
    }
    return private_pem, jwk_dict


def _make_config(app_env: str = "production") -> Config:
    return Config(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role-test-key",
        supabase_jwt_secret="hs256-test-secret-1234567890",
        drive_root_folder_id="folder-id",
        drive_auth_mode="oauth_user",
        google_oauth_client_id="",
        google_oauth_client_secret="",
        google_oauth_refresh_token="",
        google_service_account_json="",
        google_drive_shared_drive_id="",
        app_env=app_env,
        log_level="info",
        allowed_origins=["*"],
    )


class JwtVerificationTests(unittest.TestCase):
    def setUp(self):
        auth._jwks_cache.clear()
        self.secret = "hs256-test-secret-1234567890"
        self.user_id = "0f7e45aa-e2c5-47f5-b5f1-b00d6d9c35e0"

    def test_hs256_valid_token(self):
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) + 300,
            },
            self.secret,
            algorithm="HS256",
        )
        res = auth.verify_supabase_token(token, self.secret)
        self.assertEqual(res["user_id"], self.user_id)

    def test_hs256_expired_token_raises_401(self):
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) - 60,
            },
            self.secret,
            algorithm="HS256",
        )
        with self.assertRaises(HTTPException) as ctx:
            auth.verify_supabase_token(token, self.secret)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_hs256_wrong_secret_raises_401(self):
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) + 300,
            },
            "different-secret",
            algorithm="HS256",
        )
        with self.assertRaises(HTTPException) as ctx:
            auth.verify_supabase_token(token, self.secret)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_es256_valid_token_via_jwks(self):
        private_pem, jwk_dict = _generate_ec_keypair("kid-valid")
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) + 300,
            },
            private_pem,
            algorithm="ES256",
            headers={"kid": "kid-valid"},
        )
        with patch.object(auth, "_fetch_jwks", return_value=[jwk_dict]) as mock_fetch:
            res = auth.verify_supabase_token(
                token,
                self.secret,
                supabase_url="https://example.supabase.co",
            )
        self.assertEqual(res["user_id"], self.user_id)
        mock_fetch.assert_called_once_with("https://example.supabase.co", force_refresh=False)

    def test_es256_expired_token_raises_401(self):
        private_pem, jwk_dict = _generate_ec_keypair("kid-exp")
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) - 30,
            },
            private_pem,
            algorithm="ES256",
            headers={"kid": "kid-exp"},
        )
        with patch.object(auth, "_fetch_jwks", return_value=[jwk_dict]):
            with self.assertRaises(HTTPException) as ctx:
                auth.verify_supabase_token(
                    token,
                    self.secret,
                    supabase_url="https://example.supabase.co",
                )
        self.assertEqual(ctx.exception.status_code, 401)

    def test_es256_wrong_key_raises_401(self):
        private_pem, _ = _generate_ec_keypair("kid-mismatch")
        _, other_jwk = _generate_ec_keypair("kid-mismatch")
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) + 300,
            },
            private_pem,
            algorithm="ES256",
            headers={"kid": "kid-mismatch"},
        )
        with patch.object(auth, "_fetch_jwks", return_value=[other_jwk]):
            with self.assertRaises(HTTPException) as ctx:
                auth.verify_supabase_token(
                    token,
                    self.secret,
                    supabase_url="https://example.supabase.co",
                )
        self.assertEqual(ctx.exception.status_code, 401)

    def test_es256_unknown_kid_triggers_jwks_refresh(self):
        private_pem, refreshed_jwk = _generate_ec_keypair("kid-rotated")
        _, stale_jwk = _generate_ec_keypair("kid-old")
        token = jwt.encode(
            {
                "sub": self.user_id,
                "aud": "authenticated",
                "role": "authenticated",
                "exp": int(time.time()) + 300,
            },
            private_pem,
            algorithm="ES256",
            headers={"kid": "kid-rotated"},
        )
        with patch.object(
            auth, "_fetch_jwks", side_effect=[[stale_jwk], [refreshed_jwk]]
        ) as mock_fetch:
            res = auth.verify_supabase_token(
                token,
                self.secret,
                supabase_url="https://example.supabase.co",
            )
        self.assertEqual(res["user_id"], self.user_id)
        self.assertEqual(mock_fetch.call_count, 2)
        self.assertEqual(mock_fetch.call_args_list[0].kwargs, {"force_refresh": False})
        self.assertEqual(mock_fetch.call_args_list[1].kwargs, {"force_refresh": True})


class OperatorServiceTests(unittest.TestCase):
    def setUp(self):
        self.config = _make_config()

    def test_short_password_rejected_before_db_writes(self):
        mock_client = MagicMock()
        with patch.object(operator_service, "_get_supabase_client", return_value=mock_client):
            with self.assertRaises(ValueError) as ctx:
                operator_service.create_or_update_operator(
                    self.config,
                    {
                        "name": "Test Operator",
                        "email": "test.op@example.com",
                        "role": "Volunteer",
                        "password": "123",
                    },
                )
        self.assertIn("6 characters", str(ctx.exception))
        mock_client.auth.admin.create_user.assert_not_called()
        mock_client.table.assert_not_called()

    def test_create_user_failure_without_existing_user_aborts_before_table_upserts(self):
        mock_client = MagicMock()
        mock_client.auth.admin.create_user.side_effect = RuntimeError("Auth create failed")
        mock_client.auth.admin.list_users.return_value = []

        with patch.object(operator_service, "_get_supabase_client", return_value=mock_client):
            with self.assertRaises(ValueError) as ctx:
                operator_service.create_or_update_operator(
                    self.config,
                    {
                        "name": "Test Operator",
                        "email": "test.op@example.com",
                        "role": "Organizer",
                        "password": "ValidPassword123",
                    },
                )
        self.assertIn("Supabase Auth", str(ctx.exception))
        mock_client.table.assert_not_called()


class OperatorRoutesTests(unittest.TestCase):
    def setUp(self):
        self.config = _make_config(app_env="production")
        main.app.dependency_overrides[main.get_config] = lambda: self.config
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()

    def test_post_operators_returns_400_on_short_password(self):
        main.app.dependency_overrides[main.get_current_user_id] = (
            lambda: "0f7e45aa-e2c5-47f5-b5f1-b00d6d9c35e0"
        )
        mock_client = MagicMock()
        with patch.object(operator_service, "_get_supabase_client", return_value=mock_client):
            res = self.client.post(
                "/api/operators",
                json={
                    "name": "Short Pass",
                    "email": "short@example.com",
                    "role": "Volunteer",
                    "password": "123",
                },
            )
        self.assertEqual(res.status_code, 400)
        self.assertIn("6 characters", res.json()["detail"])

    def test_post_operators_returns_403_when_unauthorized_actor(self):
        main.app.dependency_overrides[main.get_current_user_id] = (
            lambda: "46d78253-c007-4b45-b93e-0f2f21cbb123"
        )
        mock_client = MagicMock()
        mock_table = mock_client.table.return_value
        mock_table.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(
            data=[]
        )
        with patch.object(operator_service, "_get_supabase_client", return_value=mock_client):
            res = self.client.post(
                "/api/operators",
                json={
                    "name": "Valid Pass",
                    "email": "valid@example.com",
                    "role": "Organizer",
                    "password": "Password123",
                },
            )
        self.assertEqual(res.status_code, 403)
        self.assertIn("superadmin or organizer", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()

