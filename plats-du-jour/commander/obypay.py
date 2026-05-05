"""
Commander via l'API Obypay pour Le Bistrot Trèfle.
Outlet ID : i-eKnzdpaAY8-1

Endpoints Obypay (à valider) :
  POST /api/auth/login         → token JWT
  GET  /api/cashless/outlets/{id}?instance=null  → catalogue produits
  POST /api/cashless/carts     → créer panier  { outletId }
  POST /api/cashless/carts/{id}/items  → ajouter article  { productId, quantity }
  POST /api/cashless/carts/{id}/checkout  → valider  { paymentMethod: "later" }

Variables d'environnement :
  OBYPAY_EMAIL
  OBYPAY_PASSWORD
"""

import json
import os
import urllib.request
import urllib.error
from dotenv import load_dotenv

load_dotenv()

OUTLET_ID = "i-eKnzdpaAY8-1"
API_BASE = "https://order-api.obypay.com/api"
HEADERS_JSON = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0",
}


def _post(url: str, payload: dict, token: str | None = None) -> dict:
    headers = dict(HEADERS_JSON)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _get(url: str, token: str | None = None) -> dict:
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def login(email: str, password: str) -> str:
    """Authentification → JWT."""
    data = _post(f"{API_BASE}/auth/login", {"email": email, "password": password})
    token = data.get("token") or data.get("access_token") or data.get("accessToken")
    if not token:
        raise ValueError(f"Token introuvable dans la réponse auth : {data}")
    return token


def _extract_products(data, results: list):
    if isinstance(data, dict):
        if data.get("name") and data.get("price") is not None:
            results.append(data)
            return
        for v in data.values():
            _extract_products(v, results)
    elif isinstance(data, list):
        for item in data:
            _extract_products(item, results)


def find_product_id(dish_name: str) -> str | None:
    """Cherche l'ID Obypay du produit le plus proche du nom de plat."""
    data = _get(f"{API_BASE}/cashless/outlets/{OUTLET_ID}?instance=null")
    products = []
    _extract_products(data, products)

    dish_lower = dish_name.lower()
    for p in products:
        name = (p.get("name") or "").lower()
        desc = (p.get("description") or "").lower()
        if dish_lower in desc or desc in dish_lower or dish_lower in name:
            return str(p.get("id") or p.get("_id") or "")
    return None


def place_order(token: str, product_id: str, quantity: int = 1) -> dict:
    """Crée un panier, ajoute l'article, checkout 'payer plus tard'."""
    # Créer le panier
    cart = _post(
        f"{API_BASE}/cashless/carts",
        {"outletId": OUTLET_ID},
        token=token,
    )
    cart_id = cart.get("id") or cart.get("cartId") or cart.get("_id")
    if not cart_id:
        raise ValueError(f"ID panier introuvable : {cart}")

    # Ajouter l'article
    _post(
        f"{API_BASE}/cashless/carts/{cart_id}/items",
        {"productId": product_id, "quantity": quantity},
        token=token,
    )

    # Checkout
    order = _post(
        f"{API_BASE}/cashless/carts/{cart_id}/checkout",
        {"paymentMethod": "later"},
        token=token,
    )
    return order


def commander(dish_name: str, quantity: int = 1) -> dict:
    """Point d'entrée : commande le plat donné via Obypay."""
    email = os.environ.get("OBYPAY_EMAIL")
    password = os.environ.get("OBYPAY_PASSWORD")
    if not email or not password:
        raise ValueError("OBYPAY_EMAIL et OBYPAY_PASSWORD requis dans l'environnement")

    print(f"[obypay] Authentification ({email})...")
    token = login(email, password)

    print(f"[obypay] Recherche produit '{dish_name}'...")
    product_id = find_product_id(dish_name)
    if not product_id:
        raise ValueError(
            f"Produit '{dish_name}' introuvable dans le catalogue Obypay. "
            "Vérifiez le nom exact du plat."
        )

    print(f"[obypay] Commande {quantity}x '{dish_name}' (id={product_id})...")
    order = place_order(token, product_id, quantity)
    print(f"[obypay] Commande confirmée : {order}")
    return {"ok": True, "restaurant": "Le Bistrot Trèfle", "plat": dish_name, "order": order}


if __name__ == "__main__":
    import sys
    plat = sys.argv[1] if len(sys.argv) > 1 else "plat du jour"
    qty = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    print(commander(plat, qty))
