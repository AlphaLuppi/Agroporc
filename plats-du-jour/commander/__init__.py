"""
Module commander — passe des commandes directement depuis le terminal.

Usage :
    python -m commander obypay "Blanquette de veau" 1
    python -m commander foxorders "Plat du jour" 1
    python -m commander truck-muche "Poulet basquaise" 1

Variables d'environnement requises (dans plats-du-jour/.env) :
    OBYPAY_EMAIL / OBYPAY_PASSWORD
    FOXORDERS_EMAIL / FOXORDERS_PASSWORD
    TRUCK_MUCHE_PHONE (numéro FR au format +33...)
    TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER  (optionnel)
"""

import asyncio
import sys


def main():
    if len(sys.argv) < 3:
        print("Usage: python -m commander <obypay|foxorders|truck-muche> <plat> [quantite]")
        sys.exit(1)

    restaurant = sys.argv[1].lower()
    plat = sys.argv[2]
    quantity = int(sys.argv[3]) if len(sys.argv) > 3 else 1

    if restaurant == "obypay":
        from commander.obypay import commander as cmd_obypay
        result = cmd_obypay(plat, quantity)
        print(result)
    elif restaurant == "foxorders":
        from commander.foxorders import commander as cmd_fox
        result = asyncio.run(cmd_fox(plat, quantity))
        print(result)
    elif restaurant in ("truck-muche", "truck_muche"):
        from commander.truck_muche import commander as cmd_truck
        items = [{"plat": plat, "quantity": quantity}]
        result = cmd_truck(items)
        print(result)
    else:
        print(f"Restaurant inconnu : {restaurant}")
        sys.exit(1)


if __name__ == "__main__":
    main()
