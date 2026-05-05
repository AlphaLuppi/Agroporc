"""
Commander au Truck Muche — pas de plateforme de commande en ligne.

Deux méthodes :
  1. Twilio (TWILIO_* configuré) : appel téléphonique automatique avec TTS
  2. Fallback manuel : retourne le message + numéro pour que l'utilisateur appelle

Variables d'environnement :
  TRUCK_MUCHE_PHONE       → numéro FR au format +33XXXXXXXXX
  TWILIO_ACCOUNT_SID      → (optionnel) SID du compte Twilio
  TWILIO_AUTH_TOKEN       → (optionnel) token Twilio
  TWILIO_FROM_NUMBER      → (optionnel) numéro Twilio (ex: +33757XXXXXX)

Tarifs Twilio (référence 2025) :
  Appel sortant France : ~0,013 €/min
  Location numéro FR : ~1 €/mois
  Alternative moins chère : Plivo (~0,008 €/min)
"""

import base64
import json
import os
import urllib.parse
import urllib.request
from dotenv import load_dotenv

load_dotenv()

TRUCK_MUCHE_PHONE = os.environ.get("TRUCK_MUCHE_PHONE", "")


def generate_order_message(items: list[dict]) -> str:
    """Génère le message TTS de commande."""
    lines = []
    for item in items:
        qty = item.get("quantity", 1)
        plat = item.get("plat", "")
        if qty > 1:
            lines.append(f"{qty} fois {plat}")
        else:
            lines.append(plat)
    order_str = ", ".join(lines)
    return (
        f"Bonjour, je voudrais passer une commande pour récupérer à midi. "
        f"Je voudrais : {order_str}. "
        f"Merci beaucoup."
    )


def call_twilio(message: str, to_number: str) -> dict:
    """Passe un appel TTS via Twilio."""
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_FROM_NUMBER")

    if not all([account_sid, auth_token, from_number]):
        raise ValueError(
            "Twilio non configuré. Requis : "
            "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER"
        )

    # TwiML : dit le message deux fois puis raccroche
    twiml = (
        f'<Response>'
        f'<Say language="fr-FR" voice="alice">{message}</Say>'
        f'<Pause length="2"/>'
        f'<Say language="fr-FR" voice="alice">Je répète. {message}</Say>'
        f'<Hangup/>'
        f'</Response>'
    )

    payload = urllib.parse.urlencode({
        "To": to_number,
        "From": from_number,
        "Twiml": twiml,
    }).encode()

    req = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Calls.json",
        data=payload,
        method="POST",
    )
    creds = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    req.add_header("Authorization", f"Basic {creds}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def commander(items: list[dict], use_twilio: bool = False) -> dict:
    """
    Contacte le Truck Muche pour passer commande.

    Si use_twilio=True et Twilio configuré → appel automatique.
    Sinon → retourne message + numéro pour appel manuel.
    """
    phone = TRUCK_MUCHE_PHONE
    message = generate_order_message(items)

    if use_twilio or os.environ.get("TWILIO_ACCOUNT_SID"):
        if not phone:
            print("[truck_muche] TRUCK_MUCHE_PHONE non configuré — appel impossible")
            return {
                "ok": False,
                "method": "twilio",
                "error": "TRUCK_MUCHE_PHONE non défini dans l'environnement",
            }
        try:
            print(f"[truck_muche] Appel Twilio vers {phone}...")
            result = call_twilio(message, phone)
            print(f"[truck_muche] Appel lancé : SID={result.get('sid')}")
            return {
                "ok": True,
                "method": "twilio",
                "call_sid": result.get("sid"),
                "phone": phone,
                "message": message,
            }
        except Exception as e:
            return {"ok": False, "method": "twilio", "error": str(e)}

    # Fallback manuel
    print(f"[truck_muche] Mode manuel — appelez le {phone or '(numéro non configuré)'}")
    print(f"[truck_muche] Message : {message}")
    return {
        "ok": True,
        "method": "manual",
        "phone": phone,
        "tts_text": message,
        "message": f"Appelez le {phone or '???'} et dites : {message}",
    }


if __name__ == "__main__":
    import sys
    plat = sys.argv[1] if len(sys.argv) > 1 else "plat du jour"
    qty = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    items = [{"plat": plat, "quantity": qty}]
    use_twilio = "--twilio" in sys.argv
    print(commander(items, use_twilio=use_twilio))
