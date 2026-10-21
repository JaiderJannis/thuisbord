# Thuisbord pushserver (stap voor stap)

Doel: meldingen op je telefoon, **ook als de app dicht is** (wasmachine klaar, deurbel, …).

Hoe het werkt, in 4 regels:
1. Deze kleine server draait bij jou thuis (Proxmox) en luistert via de WebSocket van Home Assistant.
2. Gebeurt er iets uit `rules.json`, dan stuurt de server een Web Push naar Google/Apple.
3. Google/Apple leveren die af op je telefoon, ook met gesloten app.
4. Je telefoon hoeft alleen **één keer** de server te bereiken om zich aan te melden (via Tailscale). Daarna komt de push van buitenaf binnen, zonder Tailscale.

---

## Stap 1 · Een kleine container op Proxmox
1. Proxmox → **Create CT** (LXC). Template Debian 12, 512 MB RAM, 2 GB schijf, netwerk via DHCP. Vink **Start after created** aan.
2. Open de console van de container en voer uit:
```bash
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v      # moet v20 tonen
```

## Stap 2 · De server plaatsen
Kopieer de map `push-server` uit je repository naar de container, bv. naar `/opt/thuisbord-push`:
```bash
git clone https://github.com/JaiderJannis/thuisbord.git /tmp/tb
cp -r /tmp/tb/push-server /opt/thuisbord-push
cd /opt/thuisbord-push
npm install --omit=dev
```

## Stap 3 · Sleutels en instellingen
```bash
npm run keys                 # toont VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY
cp .env.example .env
nano .env
```
Vul in `.env` in:
- `VAPID_PUBLIC_KEY` en `VAPID_PRIVATE_KEY`: de twee regels van hierboven.
- `SHARED_KEY`: een lang wachtwoord, bv. met `openssl rand -hex 24`.
- `ALLOWED_ORIGIN`: het adres van je Thuisbord (zonder slash), bv. `https://jaiderjannis.github.io`.
- `HA_URL`: intern adres van Home Assistant, bv. `http://192.168.1.50:8123`.
- `HA_TOKEN`: in Home Assistant → klik op je profiel (linksonder) → tabblad **Beveiliging** → onderaan **Langdurige toegangstokens** → *Token aanmaken*. Kopieer het meteen, je ziet het maar één keer.

Test even: `node server.js`. Je ziet "Push-server draait…" en "Verbonden met Home Assistant". Stop met Ctrl+C.

## Stap 4 · Automatisch laten starten
```bash
cat > /etc/systemd/system/thuisbord-push.service <<'UNIT'
[Unit]
Description=Thuisbord pushserver
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/thuisbord-push
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
User=nobody
Group=nogroup

[Install]
WantedBy=multi-user.target
UNIT
chown -R nobody:nogroup /opt/thuisbord-push
systemctl daemon-reload
systemctl enable --now thuisbord-push
systemctl status thuisbord-push      # moet "active (running)" tonen
```
Logboek bekijken: `journalctl -u thuisbord-push -f`

## Stap 5 · HTTPS via Tailscale
Je Thuisbord staat op GitHub Pages (https), dus de server moet ook **https** hebben. Tailscale regelt dat gratis.
1. In het Tailscale-beheer (login.tailscale.com) → **DNS** → zet **MagicDNS** en **HTTPS Certificates** aan.
2. In de container:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale serve --bg --https=443 http://127.0.0.1:8787
tailscale serve status
```
(LXC en Tailscale: lukt `tailscale up` niet met een fout over `/dev/net/tun`, voeg dan in Proxmox op de host aan `/etc/pve/lxc/<id>.conf` toe: `lxc.cgroup2.devices.allow: c 10:200 rwm` en `lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file`, en herstart de container.)

Je krijgt een adres zoals `https://thuisbord-push.jouw-tailnet.ts.net`. Controleer in de browser van een toestel **met Tailscale aan**: `https://…ts.net/health` moet `{"ok":true,…}` tonen.

Zet Tailscale ook op je telefoon(s) (app + inloggen met hetzelfde account). Dit is enkel nodig bij het aanzetten van meldingen.

## Stap 6 · Koppelen in Thuisbord
1. Open Thuisbord als beheerder → menu → **Meldingen** → klap **Pushserver** open.
2. Vul het `https://…ts.net` adres en je `SHARED_KEY` in → **Opslaan**.
3. Doe op **elke telefoon**: Tailscale aan, open Thuisbord, zet **Meldingen op dit apparaat** aan en sta meldingen toe.
   - **iPhone**: eerst Safari → Deel → *Zet op beginscherm*, en open de app vanaf het beginscherm (vereist iOS 16.4 of nieuwer).
   - **Android**: Chrome volstaat.
4. Druk op **Testmelding**. Sluit de app volledig en probeer nog eens: de melding moet toch binnenkomen.

## Stap 6b · Regenvoorspelling van KNMI op je kaart (optioneel)
1. Vraag een gratis **Web Map Service (WMS)**-sleutel aan op het [KNMI Developer Portal](https://developer.dataplatform.knmi.nl/).
2. Zet in de container in `/opt/thuisbord-push/.env` een nieuwe regel: `KNMI_KEY=jouw-sleutel` (deel de sleutel nooit).
3. Werk de server bij en herstart: `systemctl restart thuisbord-push`.
4. Open Thuisbord → **Weer** → bij de regenradar staat nu **🔮 Voorspelling**. Tik erop voor het beeld van nu tot +2 uur.
De server bewaart de beelden 5 minuten, want KNMI staat 1000 verzoeken per uur toe. Het toestel moet de pushserver kunnen bereiken (Tailscale aan).

## Stap 7a · De regels automatisch laten maken (aanbevolen)
Open Thuisbord als beheerder → menu → **Pushserver** → tik op **📤 Meldingsregels maken en naar de server sturen**. Thuisbord maakt dan regels uit je instellingen (wasmachine/droger klaar, autoportier open, auto-batterij laag, robotstoring, stofbak vol, water leeg, internetlimiet) en stuurt ze naar de server. Je hoeft niets in de console te typen. Doe dit opnieuw na elke wijziging aan je apparaten. Let op: de server moet eerst de nieuwste versie hebben (`cd /tmp/tb && git pull`, dan `cp /tmp/tb/push-server/server.js /opt/thuisbord-push/ && systemctl restart thuisbord-push`).

De knop zet ook toestellen zonder statussensor (via het stroomverbruik), bandendruk, robot klaar en de afvalophaling (de avond ervoor om 18:00 en 's ochtends om 7:00) klaar. Als Home Assistant langer dan 5 minuten weg is, meldt de server dat zelf. Airco en muziek kunnen niet via de server (live weergave, geen gebeurtenis).

## Stap 7b · Zelf bepalen wanneer er een melding komt
Pas `/opt/thuisbord-push/rules.json` aan (wordt binnen 5 seconden automatisch ingelezen):
```json
{ "naam": "Wasmachine klaar", "entity": "sensor.samsung_washer_machine_state",
  "van": "run", "naar": "stop", "titel": "Thuisbord", "tekst": "🧺 De wasmachine is klaar", "tag": "wasmachine" }
```
- `entity`: de entiteit uit Home Assistant (zie Wasserij → ⚙️ Instellen → "Wat ziet Home Assistant?").
- `naar` / `van`: nieuwe en oude status (beide optioneel, ook een lijst mag), `nietNaar`: lijst met statussen die niet mogen. `boven` / `onder`: een getal; de melding komt zodra de waarde die drempel overschrijdt.
- `tekst` mag `{naam}`, `{nieuw}` en `{oud}` bevatten. Dezelfde `tag` binnen 30 seconden geeft maar één melding.

Wil je een melding vanuit een Home Assistant-automatisering? Voeg toe aan `configuration.yaml`:
```yaml
rest_command:
  thuisbord_push:
    url: "http://<ip-van-de-container>:8787/notify"
    method: POST
    headers: { X-Key: "JE_SHARED_KEY", Content-Type: "application/json" }
    payload: '{"title":"Thuisbord","body":"{{ bericht }}"}'
```
(De server luistert standaard enkel lokaal. Wil je dit rechtstreeks vanuit HA aanroepen, zet dan `HOST=0.0.0.0` in `.env`, of gebruik gewoon het Tailscale-adres.) Aanroepen: `action: rest_command.thuisbord_push` met `data: { bericht: "Deurbel!" }`.

## Veiligheid
- Alle schrijf-acties vragen de `SHARED_KEY`. Iedereen met toegang tot jullie huishouden kan die in de app zien: deel hem dus enkel met huisgenoten die je vertrouwt.
- Zet `ALLOWED_ORIGIN` op je echte Thuisbord-adres.
- De server is alleen bereikbaar via je Tailscale-netwerk, niet via het open internet.
- De Home Assistant-token blijft in `.env` op de server, nooit in de app. Maak het bestand alleen leesbaar voor de server: `chmod 600 .env`.

## Problemen
| Probleem | Oplossing |
|---|---|
| "Pushserver niet bereikbaar" | Tailscale aan op de telefoon? `/health` openen in de browser. |
| "sleutel klopt niet" | `SHARED_KEY` in de app en `.env` zijn niet identiek. |
| Geen melding op iPhone | App vanaf het beginscherm geopend? iOS ≥ 16.4? Meldingen toegestaan in iOS-instellingen? |
| Geen "Verbonden met Home Assistant" | `HA_URL` en `HA_TOKEN` controleren, bereikbaarheid met `curl $HA_URL/api/`. |
| Melding blijft uit | `journalctl -u thuisbord-push -f` bekijken, controleer de `entity` en de statuswaarden. |
