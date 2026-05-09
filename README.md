# PressureLog (Vérnyomás napló)

## Tiszta telepítés lépésről lépésre (Windows CMD)

> Ajánlott útvonal: `I:\vernyomas\PressureLog`

### 0) Előfeltételek
- Docker Desktop fut
- Git telepítve van

### 1) Projekt klónozása
```cmd
cd /d I:\vernyomas
git clone https://github.com/kovadam1/PressureLog.git
cd PressureLog
```

### 2) Környezeti fájl létrehozása
```cmd
copy .env.example .env
```

### 3) Konténerek build + indítás
```cmd
docker compose up -d --build
```

### 4) Ellenőrzés
```cmd
docker compose ps
curl http://localhost:4000/health
```
Várt válasz:
```json
{"ok":true}
```

### 5) Használat
- Frontend: http://localhost:5173
- Alternatíva: http://127.0.0.1:5173

---

## Tiszta törlés (full reset)

> Figyelem: ez törli a projekt mappát és a kapcsolódó konténer/volume adatokat is.

```cmd
cd /d I:\vernyomas
docker compose -f PressureLog\docker-compose.yml down -v --remove-orphans 2>nul
docker ps -a --filter "name=pressurelog" -q | for /f %i in ('more') do docker rm -f %i
docker volume ls --format "{{.Name}}" | findstr /i pressurelog | for /f %i in ('more') do docker volume rm %i
rmdir /s /q PressureLog
```

## Tiszta újratelepítés (ha valami nagyon elcsúszott)

```cmd
cd /d I:\vernyomas
docker compose -f PressureLog\docker-compose.yml down -v --remove-orphans
rmdir /s /q PressureLog
git clone https://github.com/kovadam1/PressureLog.git
cd PressureLog
copy .env.example .env
docker compose up -d --build
```

## Linux gyors telepítés (opcionális)

```bash
git clone git@github.com:kovadam1/PressureLog.git
cd PressureLog
./install.sh --reset
```

- `--reset`: tiszta indulás (régi volume/adat törlése)
- reset nélkül: `./install.sh` (adatok megmaradnak)

## Elérés
- Frontend: http://localhost:5173 *(vagy http://127.0.0.1:5173)*
- Backend health: http://localhost:4000/health

## Gyors hibaelhárítás (regisztráció/belépés sikertelen)
1. Ellenőrizd a backendet:
   ```bash
   curl http://localhost:4000/health
   ```
   Várt válasz: `{"ok":true}`

2. CORS ellenőrzés (`.env`):
   ```env
   CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
   ```

3. Backend újraépítés CORS módosítás után:
   ```bash
   docker compose up -d --build backend
   ```

4. Böngészőben hard refresh: `Ctrl+F5`

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
