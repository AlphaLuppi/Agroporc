/**
 * Route de commande unifiée — dispatche vers Obypay, Foxorders ou Truck Muche.
 * Requiert le cookie pdj-admin=1 (authentification admin).
 *
 * POST /api/commander
 * Body: { restaurant: string, items: { plat: string, prix: string, quantity: number }[] }
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type OrderItem = { plat: string; prix: string; quantity: number };

export async function POST(request: NextRequest) {
  const adminCookie = request.cookies.get("pdj-admin");
  if (adminCookie?.value !== "1") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { restaurant, items }: { restaurant: string; items: OrderItem[] } =
    await request.json();

  if (!restaurant || !items?.length) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  if (restaurant === "Le Bistrot Trèfle") {
    return commanderObypay(items);
  }
  if (restaurant === "La Pause Gourmande") {
    return commanderFoxorders(items);
  }
  if (restaurant === "Le Truck Muche") {
    return commanderTruckMuche(items);
  }

  return NextResponse.json({ error: "Restaurant non supporté" }, { status: 400 });
}

// ── Obypay (Bistrot Trèfle) ────────────────────────────────────────────────

async function commanderObypay(items: OrderItem[]) {
  const email = process.env.OBYPAY_EMAIL;
  const password = process.env.OBYPAY_PASSWORD;

  if (!email || !password) {
    return NextResponse.json(
      {
        ok: false,
        method: "obypay",
        error:
          "Variables d'environnement manquantes : OBYPAY_EMAIL, OBYPAY_PASSWORD",
      },
      { status: 503 }
    );
  }

  const OUTLET_ID = "i-eKnzdpaAY8-1";
  const API = "https://order-api.obypay.com/api";

  try {
    // 1. Authentification
    const loginRes = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!loginRes.ok) {
      const txt = await loginRes.text();
      return NextResponse.json(
        { ok: false, error: `Auth Obypay échouée (${loginRes.status}): ${txt}` },
        { status: 502 }
      );
    }
    const { token, access_token } = await loginRes.json();
    const jwt = token || access_token;

    // 2. Récupérer les IDs produits depuis le menu
    const menuRes = await fetch(
      `${API}/cashless/outlets/${OUTLET_ID}?instance=null`
    );
    const menuData = await menuRes.json();
    const products = extractProducts(menuData);

    // 3. Créer le panier
    const cartRes = await fetch(`${API}/cashless/carts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ outletId: OUTLET_ID }),
    });
    if (!cartRes.ok) {
      return NextResponse.json(
        { ok: false, error: `Création panier échouée (${cartRes.status})` },
        { status: 502 }
      );
    }
    const cart = await cartRes.json();
    const cartId = cart.id || cart.cartId;

    // 4. Ajouter les articles
    for (const item of items) {
      const product = products.find(
        (p) =>
          item.plat.toLowerCase().includes(p.description?.toLowerCase() || "") ||
          p.description?.toLowerCase().includes(item.plat.toLowerCase()) ||
          item.plat.toLowerCase().includes(p.name?.toLowerCase() || "")
      );
      if (!product?.id) continue;

      await fetch(`${API}/cashless/carts/${cartId}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ productId: product.id, quantity: item.quantity }),
      });
    }

    // 5. Checkout "payer plus tard"
    const orderRes = await fetch(`${API}/cashless/carts/${cartId}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ paymentMethod: "later" }),
    });
    const order = await orderRes.json();

    return NextResponse.json({
      ok: true,
      method: "obypay",
      order_id: order.id || order.orderId,
      message: "Commande passée ! Paiement à la livraison/retrait.",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

function extractProducts(data: unknown): { id?: string; name?: string; description?: string }[] {
  const results: { id?: string; name?: string; description?: string }[] = [];
  function recurse(obj: unknown) {
    if (Array.isArray(obj)) { obj.forEach(recurse); return; }
    if (typeof obj !== "object" || !obj) return;
    const o = obj as Record<string, unknown>;
    if (o.name && o.price !== undefined) {
      results.push({ id: o.id as string, name: o.name as string, description: o.description as string });
      return;
    }
    Object.values(o).forEach(recurse);
  }
  recurse(data);
  return results;
}

// ── Foxorders (Pause Gourmande) ────────────────────────────────────────────

async function commanderFoxorders(items: OrderItem[]) {
  // Foxorders nécessite Playwright — non compatible Vercel.
  // En local/serveur : lancer plats-du-jour/commander/foxorders.py
  // Pour Vercel : retourner un deep link direct vers le site
  const link = "https://lapausegourmandeagroparc.foxorders.com";
  return NextResponse.json({
    ok: false,
    method: "foxorders_redirect",
    message:
      "La commande automatique Foxorders nécessite un backend serveur (Playwright). " +
      "Utilisez le script Python plats-du-jour/commander/foxorders.py ou commandez directement.",
    redirect_url: link,
    items,
  });
}

// ── Truck Muche ────────────────────────────────────────────────────────────

async function commanderTruckMuche(items: OrderItem[]) {
  const phone = process.env.TRUCK_MUCHE_PHONE || "";
  const lines = items.map(
    (i) => `${i.quantity > 1 ? i.quantity + " fois " : ""}${i.plat}`
  );
  const ttsText = `Bonjour, je voudrais commander : ${lines.join(", ")}. Merci.`;

  // Si Twilio est configuré, passer l'appel automatiquement
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (accountSid && authToken && fromNumber && phone) {
    try {
      const twiml = `<Response><Say language="fr-FR" voice="alice">${ttsText}</Say><Pause length="3"/><Say language="fr-FR" voice="alice">Je répète. ${ttsText}</Say><Hangup/></Response>`;
      const body = new URLSearchParams({
        To: phone,
        From: fromNumber,
        Twiml: twiml,
      });
      const callRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        }
      );
      const call = await callRes.json();
      return NextResponse.json({
        ok: true,
        method: "twilio",
        call_sid: call.sid,
        message: `Appel en cours vers ${phone}`,
        tts_text: ttsText,
        phone,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: `Twilio: ${msg}` }, { status: 502 });
    }
  }

  // Fallback : TTS navigateur + lien tel:
  return NextResponse.json({
    ok: true,
    method: "tts_browser",
    tts_text: ttsText,
    phone,
    message: phone
      ? `Appelez le ${phone} et lisez votre commande.`
      : "Numéro du Truck Muche non configuré (TRUCK_MUCHE_PHONE).",
  });
}
