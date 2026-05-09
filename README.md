# Vérnyomás App (Spec v3 alapján)

## Indítás

1. Másold a környezeti fájlt:
   ```bash
   cp .env.example .env
   ```
2. Indítsd a stack-et:
   ```bash
   docker compose up --build
   ```
3. Elérés:
   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000

## Mit tud most (MVP)
- Regisztráció + belépés (PIN hash)
- User/Admin szerepkör
- Mérés felvitel (sys/dia/pulse, napszak, kontextus, tünet szöveg, napi sorszám)
- Figyelmeztetés magas/veszélyes értéknél
- Grafikon referencia vonalakkal (140/90)
- Trend/átlag/min/max stat
- CSV export
- Admin: user lista + rendszer stat + report kérés rekord

## Fontos
Ez nem orvosi diagnosztikai rendszer, csak naplózó/összegző alkalmazás.
