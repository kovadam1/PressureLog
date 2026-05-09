# PressureLog (Vérnyomás napló)

## Gyors telepítés (Git-ből, szűz indulás)

```bash
git clone git@github.com:kovadam1/PressureLog.git
cd PressureLog
./install.sh --reset
```

- `--reset`: tiszta indulás (régi volume/adat törlése)
- reset nélkül: `./install.sh` (adatok megmaradnak)

## Kézi indítás

1. Környezeti fájl létrehozása:
   ```bash
   cp .env.example .env
   ```
2. Stack indítása:
   ```bash
   docker compose up -d --build
   ```

## Elérés
- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/health

## Funkciók (jelenlegi)
- Regisztráció + belépés (**jelszóval**)
- Admin és user szerepkör
- Vérnyomás/pulzus mérés rögzítés
- Tünetek + megjegyzés
- Statisztikák és trend grafikon
- PDF/CSV export
- Admin panel: felhasználók + rendszer stat + riportkérés

## Fontos
Ez nem orvosi diagnosztikai rendszer, csak naplózó/összegző alkalmazás.
