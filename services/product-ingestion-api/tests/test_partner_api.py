"""Partner API tests against an in-memory fake of the Supabase REST API.

Run from the service folder: python -m unittest discover -s tests
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for name, value in {
    "SUPABASE_URL": "https://db.example", "SUPABASE_SERVICE_ROLE_KEY": "service",
    "INGESTION_HMAC_SECRET": "secret", "WHATSAPP_LISTINGS_SELLER_ID": "w", "TELEGRAM_LISTINGS_SELLER_ID": "t",
    "PUBLIC_SITE_URL": "https://buysell.example",
}.items():
    os.environ.setdefault(name, value)

from fastapi.testclient import TestClient  # noqa: E402

import partner_api  # noqa: E402
from main import app  # noqa: E402

FEED_KEY = "bsk_live_" + "a" * 64
FULL_KEY = "bsk_live_" + "b" * 64
REVOKED_KEY = "bsk_live_" + "c" * 64
PARTNER = "11111111-1111-1111-1111-111111111111"
PRODUCT = "22222222-2222-2222-2222-222222222222"


def digest(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class FakeSupabase:
    def __init__(self) -> None:
        partner = {"partner_name": "Shop A", "commission_rate": 10, "status": "active",
                   "allowed_origins": ["https://shop.example.com/"]}
        self.keys = {
            digest(FEED_KEY): {"id": "k1", "partner_id": PARTNER, "scopes": ["feed"], "status": "active", "partners": partner},
            digest(FULL_KEY): {"id": "k2", "partner_id": PARTNER, "scopes": ["feed", "orders"], "status": "active", "partners": partner},
            digest(REVOKED_KEY): {"id": "k3", "partner_id": PARTNER, "scopes": ["feed", "orders"], "status": "revoked", "partners": partner},
        }
        self.rpc_calls: list[dict] = []
        self.rpc_result: tuple[int, dict] = (200, {"created": True, "changed": True, "order": {"partner_order_id": "A-1"}})
        self.product_queries = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        q = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        if path == "/rest/v1/partner_api_keys" and request.method == "GET":
            row = self.keys.get(q["key_hash"].removeprefix("eq."))
            return httpx.Response(200, json=[row] if row else [])
        if path == "/rest/v1/partner_api_keys" and request.method == "PATCH":
            return httpx.Response(204)
        if path == "/rest/v1/partners":
            return httpx.Response(200, json=[{"allowed_origins": ["https://shop.example.com"]}])
        if path == "/rest/v1/products":
            self.product_queries += 1
            assert q["status"] == "eq.active" and q["stock_quantity"] == "gt.0"
            return httpx.Response(200, json=[{"id": PRODUCT, "name": "Smart Watch", "price": 25000, "stock_quantity": 15,
                                              "image_url": None, "images": ["https://img/1.jpg"], "seller_id": "seller_88",
                                              "category": "electronics"}])
        if path == "/rest/v1/profiles":
            return httpx.Response(200, json=[{"id": "admin-1"}])
        if path == "/rest/v1/advertisements":
            assert q["advertiser_id"] == "in.(admin-1)"
            return httpx.Response(200, json=[{"id": "ad_101", "title": "Mega Sale", "media_url": "https://img/ad.jpg",
                                              "media_type": "image", "cta_link": "javascript:alert(1)"}])
        if path == "/rest/v1/rpc/record_partner_order":
            self.rpc_calls.append(json.loads(request.content))
            status, body = self.rpc_result
            return httpx.Response(status, json=body)
        if path == "/rest/v1/partner_orders":
            return httpx.Response(200, json=[{"id": "o1"}] if q["partner_order_id"] == "eq.A-1" else [])
        if path == "/rest/v1/rpc/partner_order_summary":
            return httpx.Response(200, json={"partner_order_id": "A-1", "payment_status": "paid"})
        if path == "/rest/v1/partner_ledger_balances":
            return httpx.Response(200, json=[{"partner_name": "Shop A", "commission_rate": 10, "unsettled_orders": 2,
                                              "unsettled_sales": "75000", "unsettled_commission": "7500",
                                              "amount_due": "67500.00", "total_settled": 0, "orders_needing_review": 1}])
        return httpx.Response(404, json={"message": f"unexpected {request.method} {path}"})


ORDER = {"partner_order_id": "A-1", "payment_status": "paid", "payment_reference": "PSK-1", "total_amount": 25000,
         "items": [{"product_id": PRODUCT, "quantity": 1, "unit_price": 25000}]}


class PartnerApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fake = FakeSupabase()
        self.client = TestClient(app)
        self.client.__enter__()
        app.state.partner = partner_api.PartnerGateway("https://db.example", "service", "https://buysell.example",
                                                       transport=httpx.MockTransport(self.fake.handle))

    def tearDown(self) -> None:
        self.client.__exit__(None, None, None)

    def test_feed_matches_spec_shape(self) -> None:
        response = self.client.get("/api/v1/partner/feed", headers={"X-BUYSELL-API-KEY": FEED_KEY})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["success"])
        product = body["data"]["products"][0]
        self.assertEqual({k: product[k] for k in ("id", "title", "price", "stock", "image_url", "seller_id")},
                         {"id": PRODUCT, "title": "Smart Watch", "price": 25000, "stock": 15,
                          "image_url": "https://img/1.jpg", "seller_id": "seller_88"})
        ad = body["data"]["ads"][0]
        self.assertEqual((ad["id"], ad["title"], ad["image_url"]), ("ad_101", "Mega Sale", "https://img/ad.jpg"))
        self.assertEqual(ad["link"], "https://buysell.example", "unsafe ad links fall back to the site")

    def test_feed_is_cached(self) -> None:
        for _ in range(3):
            self.client.get("/api/v1/partner/feed", headers={"X-BUYSELL-API-KEY": FEED_KEY})
        self.assertEqual(self.fake.product_queries, 1)

    def test_missing_malformed_and_revoked_keys_are_rejected(self) -> None:
        for headers in ({}, {"X-BUYSELL-API-KEY": "not-a-key"}, {"X-BUYSELL-API-KEY": REVOKED_KEY},
                        {"X-BUYSELL-API-KEY": "bsk_live_" + "d" * 64}):
            response = self.client.get("/api/v1/partner/feed", headers=headers)
            self.assertEqual(response.status_code, 401, headers)
            self.assertEqual(response.json()["success"], False)

    def test_feed_only_key_cannot_record_orders(self) -> None:
        response = self.client.post("/api/v1/partner/orders", headers={"X-BUYSELL-API-KEY": FEED_KEY}, json=ORDER)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "insufficient_scope")

    def test_cors_only_for_registered_origins_on_feed(self) -> None:
        allowed = self.client.options("/api/v1/partner/feed", headers={"Origin": "https://shop.example.com"})
        self.assertEqual(allowed.headers.get("access-control-allow-origin"), "https://shop.example.com")
        self.assertIn("X-BUYSELL-API-KEY", allowed.headers.get("access-control-allow-headers", ""))
        other = self.client.options("/api/v1/partner/feed", headers={"Origin": "https://evil.example"})
        self.assertIsNone(other.headers.get("access-control-allow-origin"))
        get = self.client.get("/api/v1/partner/feed", headers={"X-BUYSELL-API-KEY": FEED_KEY, "Origin": "https://shop.example.com"})
        self.assertEqual(get.headers.get("access-control-allow-origin"), "https://shop.example.com")

    def test_orders_refuse_browser_requests(self) -> None:
        response = self.client.post("/api/v1/partner/orders", json=ORDER,
                                    headers={"X-BUYSELL-API-KEY": FULL_KEY, "Origin": "https://shop.example.com"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "server_only")

    def test_order_is_validated_and_forwarded(self) -> None:
        response = self.client.post("/api/v1/partner/orders", headers={"X-BUYSELL-API-KEY": FULL_KEY}, json=ORDER)
        self.assertEqual(response.status_code, 201)
        sent = self.fake.rpc_calls[0]
        self.assertEqual(sent["p_partner_id"], PARTNER, "partner comes from the key, never the payload")
        self.assertEqual(sent["p_order"]["items"][0]["product_id"], PRODUCT)

    def test_invalid_orders_are_rejected_before_the_database(self) -> None:
        bad_orders = [
            {**ORDER, "payment_status": "maybe"},
            {**ORDER, "items": []},
            {**ORDER, "items": [{"product_id": PRODUCT, "quantity": 0, "unit_price": 1}]},
            {**ORDER, "items": [ORDER["items"][0], ORDER["items"][0]]},
            {**ORDER, "partner_order_id": "has spaces"},
            {**ORDER, "currency": "USD"},
            {**ORDER, "partner_id": "someone-else"},
        ]
        for order in bad_orders:
            response = self.client.post("/api/v1/partner/orders", headers={"X-BUYSELL-API-KEY": FULL_KEY}, json=order)
            self.assertEqual(response.status_code, 422, order)
            self.assertEqual(response.json()["error"]["code"], "invalid_payload")
        self.assertEqual(self.fake.rpc_calls, [])

    def test_database_errors_map_to_clear_statuses(self) -> None:
        for message, status in (("order_items_changed", 409), ("invalid_status_transition", 409),
                                ("unknown_product", 422), ("partner_inactive", 403)):
            self.fake.rpc_result = (400, {"code": "P0001", "message": message, "details": None})
            response = self.client.post("/api/v1/partner/orders", headers={"X-BUYSELL-API-KEY": FULL_KEY}, json=ORDER)
            self.assertEqual(response.status_code, status, message)
            self.assertEqual(response.json()["error"]["code"], message)

    def test_repeat_report_returns_200(self) -> None:
        self.fake.rpc_result = (200, {"created": False, "changed": False, "order": {"partner_order_id": "A-1"}})
        response = self.client.post("/api/v1/partner/orders", headers={"X-BUYSELL-API-KEY": FULL_KEY}, json=ORDER)
        self.assertEqual(response.status_code, 200)

    def test_order_lookup_and_ledger(self) -> None:
        found = self.client.get("/api/v1/partner/orders/A-1", headers={"X-BUYSELL-API-KEY": FULL_KEY})
        self.assertEqual(found.json()["data"]["order"]["payment_status"], "paid")
        missing = self.client.get("/api/v1/partner/orders/NOPE", headers={"X-BUYSELL-API-KEY": FULL_KEY})
        self.assertEqual(missing.status_code, 404)
        ledger = self.client.get("/api/v1/partner/ledger", headers={"X-BUYSELL-API-KEY": FULL_KEY}).json()["data"]
        self.assertEqual((ledger["amount_due"], ledger["unsettled_orders"]), (67500, 2))

    def test_rate_limit(self) -> None:
        original = partner_api.RATE_LIMITS["feed"]
        partner_api.RATE_LIMITS["feed"] = (2, 60.0)
        try:
            codes = [self.client.get("/api/v1/partner/feed", headers={"X-BUYSELL-API-KEY": FEED_KEY}).status_code for _ in range(3)]
            self.assertEqual(codes, [200, 200, 429])
        finally:
            partner_api.RATE_LIMITS["feed"] = original


if __name__ == "__main__":
    unittest.main()
