# Firebase-opslag van Thuisbord

## Nieuwe indeling (`FIRESTORE_LAYOUT = "v2"`, standaard)

```
artifacts/{appId}/public/data/
├─ thuisbord_households/{gezin-id}    1 document per gezin, bv. "jannis-bellens-1ywedju"
│                                     (alle instellingen als echte velden: rooms, shutters,
│                                      entityMap, hourlyPrices, bgColor, ...)
├─ thuisbord_accounts/{e-mail}        1 document per account: naam, rol, gezin
├─ thuisbord_meta/migration           markering dat de eenmalige overzetting klaar is
└─ thuisbord_settings/main_dashboard  OUDE document, blijft staan als back-up
```

Wat dit oplost t.o.v. vroeger (alles in één document als JSON-tekst):

- **Leesbaar**: in de Firebase-console zie je nu per gezin gewoon alle velden.
- **Geen limiet-probleem**: Firestore staat max. 1 MB per document toe. Vroeger zat alles van alle gezinnen in één document.
- **Gezinnen overschrijven elkaar niet meer**: er wordt alleen geschreven wat gewijzigd is. Vroeger werd bij elke opslag het hele document vervangen.
- **Minder writes**: een wijziging in één gezin = 1 write (belangrijk voor het gratis Spark-plan).
- **Schrijfbeveiliging**: de app schrijft nooit voordat de serverdata binnen is, zodat standaardwaarden nooit echte data overschrijven.

## Eerste keer opstarten

Bij het eerste opstarten leest de app het oude document en zet alles automatisch over
naar de nieuwe documenten. Je ziet de melding "Gegevens overgezet naar de nieuwe Firebase-indeling."
Het oude document wordt niet aangepast of verwijderd.

## Terug naar de oude manier

Zet in `js/config.js`:

```js
const FIRESTORE_LAYOUT = "legacy";
```

Let op: wijzigingen die je in de nieuwe indeling maakte, staan dan niet in het oude document.
Als de Firestore-regels de nieuwe collecties blokkeren, schakelt de app zelf tijdelijk
terug naar de oude opslag en toont een melding.

## Opruimen

Als alles een tijdje goed werkt, kun je in de Firebase-console het oude document
`thuisbord_settings/main_dashboard` verwijderen.

## Beveiliging: twee stappen

Er zijn twee regelbestanden. Je plakt er telkens één in Firebase-console → Firestore → Rules.

| Bestand | Wie heeft toegang |
|---|---|
| `firestore-stap1.rules` | de eigenaar en iedereen met een account in de ledenlijst; die zien wel nog alles |
| `firestore-stap2.rules` | **per gezin**, zie hieronder |

### Stap 2: wie mag wat

| Rol | Gezinnen | Accounts |
|---|---|---|
| Eigenaar (`jaiderjannis@gmail.com`) en rol `admin` | alles lezen, aanmaken, wijzigen, verwijderen | alles |
| `manager` | enkel het eigen gezin lezen en wijzigen | accounts van het eigen gezin lezen; leden toevoegen, wijzigen en verwijderen (nooit een `admin` maken) |
| `user` | enkel het eigen gezin lezen en wijzigen | enkel het eigen account lezen |
| Niet in de ledenlijst | niets | niets |

Het oude document `thuisbord_settings` en `thuisbord_meta` zijn alleen voor admins.
De app past zich daarop aan: eigenaar en admins laden alles ("volledige modus"), managers en gebruikers
laden alleen hun eigen gezin ("beperkte modus"). Dat zie je ook niet aan de app zelf, maar wel aan de
data die in de browser terechtkomt: een gewoon lid krijgt de Home Assistant-token van andere gezinnen nooit binnen.

### Volgorde (belangrijk, anders sluit je mensen buiten)

1. Upload de nieuwe versie van de app (alle bestanden uit de zip).
2. Open het dashboard één keer als eigenaar. Daarmee wordt de oude data overgezet.
3. Controleer in Firestore dat `thuisbord_accounts` een document heeft voor elk gezinslid, en dat bij elk account het veld `household` **exact** gelijk is aan de naam van het gezin.
4. Publiceer eerst `firestore-stap1.rules` en controleer dat alles werkt.
5. Publiceer daarna `firestore-stap2.rules`. Laat de andere gezinsleden hun pagina vernieuwen (Ctrl+Shift+R, of op de tablet de pagina herladen).
6. Test per rol: één keer als gewone gebruiker, één keer als manager.

Terugdraaien kan altijd door de vorige regels terug te plakken.

### Testen in de Rules Playground

| Wie | Actie | Pad | Verwacht |
|---|---|---|---|
| eigenaar | get | `.../thuisbord_households/elk-gezin` | toegestaan |
| lid van gezin A | get | het gezinsdocument van gezin A | toegestaan |
| lid van gezin A | get | het gezinsdocument van gezin B | geweigerd |
| lid van gezin A | list | `.../thuisbord_households` | geweigerd |
| `user` | update | eigen account met `role: admin` | geweigerd |
| `manager` | create | account met `role: admin` | geweigerd |
| niet in de lijst | get | gelijk welk gezinsdocument | geweigerd |

Het pad begint telkens met `/artifacts/thuisbord-default-app/public/data/`.

### Goed om te weten

- Een `user` kan binnen het eigen gezin nog alle velden wijzigen (ook instellingen). Dat per veld beperken kan, maar vraagt dat ik weet welke velden gewone gebruikers mogen aanpassen.
- Een manager kan alleen leden van het eigen gezin beheren. Als de Firestore-regels de ledenlijst-query van een manager toch weigeren, laadt de app alleen het eigen account en toont een melding.
- Een gezin hernoemen wordt niet ondersteund: de koppeling tussen account en gezin loopt via de gezinsnaam.
- Deze regels gaan uit van `FIRESTORE_LAYOUT = "v2"`. In "legacy"-modus werkt per-gezin-toegang niet.

## Stap 3: gewone gebruikers mogen enkel "live" velden wijzigen

Bestand: `firestore-stap3.rules` (= stap 2 + een lijst van velden die een gewone gebruiker (rol "user") mag schrijven).

- **Mag een gebruiker wel**: taken, agenda, apparaten, lampen/rolluiken/klimaat/robots (aan-uit en status), live energiewaarden, prijzen, dagcijfers (`history`).
- **Mag een gebruiker niet**: Home Assistant-URL en -token, entiteitskoppelingen (`entityMap`), prijsinstellingen, kamers, auto's, meldingsinstellingen, thema, accounts.
- Beheerders (manager/admin) blijven alles mogen binnen hun eigen gezin.
- De app stuurt voor een gebruiker enkel de gewijzigde toegestane velden (`update`), nooit het hele document. De lijst staat in `js/firestore-v2.js` (`V2_USER_WRITABLE_FIELDS`) en moet identiek zijn aan `userFields()` in de rules. Pas je de ene aan, pas dan ook de andere aan.

### Volgorde
1. Zet eerst de nieuwe app online (alle bestanden, ook `stats.js`, `overview.js`, `notifications.js`, `backup.js`).
2. Controleer dat inloggen als gewone gebruiker werkt met de stap 2-rules.
3. Publiceer pas daarna `firestore-stap3.rules`.
4. Een oudere app-versie op een ander scherm (nog niet ververst) kan als gebruiker foutmeldingen geven tot ze herladen is.

### Testen in de Rules Playground
- Update als gebruiker op het eigen gezin, veld `tasks` → **toegestaan**.
- Update als gebruiker op het eigen gezin, veld `statusText` of `haToken` → **geweigerd**.
- Zelfde updates als manager → **toegestaan**.

### Goed om te weten
- Een gebruiker kan zijn eigen gezinsdocument nog wel **lezen**, dus ook de HA-token. Dat kan Firestore niet per veld verbergen; wil je dat vermijden, gebruik dan een aparte token met beperkte rechten.
- Velden zoals `robots`, `shutters` en `roomLights` bevatten entiteit-id's die een gebruiker technisch kan aanpassen.
- Dagcijfers (`history`) beginnen vanaf de dag dat je deze versie live zet; er wordt niets achteraf aangevuld.

## Stap 4: rechten per rol (nieuw)

Bestand: `firestore-stap4.rules` = stap 3 + één extra regel voor het document `thuisbord_meta/permissions`.

- De Super Admin stelt in de app (Beheer → **Rechten**) in wat gezinsbeheerders en gezinsleden mogen bekijken, bedienen en beheren.
- Dat document mag iedereen met een account **lezen**, alleen de admin mag het **schrijven**.
- **Publiceer stap 4 in de plaats van stap 3** (het is stap 3 plus die ene regel). Volgorde: app uploaden, dan de rules publiceren.
- Zonder stap 4 werkt alles nog steeds met de standaardrechten, maar de admin kan de rechten dan niet opslaan (melding: "publiceer eerst firestore-stap4.rules").
- Testen in de Rules Playground: lees `thuisbord_meta/permissions` als gezinslid → toegestaan; schrijf het als gezinsbeheerder → geweigerd; schrijf het als admin → toegestaan.

### Hoe werken de rechten
- Rechten gelden voor alle gezinnen en per rol (Gezinsbeheerder, Gezinslid). De Super Admin mag altijd alles.
- **Bekijken en bedienen**: ruimtes, robots, auto's, overzicht, agenda en taken; apart recht om te bedienen of toe te voegen. Zet je "bekijken" uit, dan valt "bedienen" automatisch ook weg.
- **Beheer**: elk tabblad van het beheerpaneel apart, alleen voor gezinsbeheerders. Een gezinslid kan nooit beheerrechten krijgen.
- De app verbergt wat niet mag en blokkeert de bediening. Firestore beschermt daarnaast de gevoelige velden (zie stap 3). Een technisch onderlegde gezinsbeheerder kan in zijn eigen gezin nog steeds direct naar de database schrijven; de rechten zijn dus een gebruikersniveau-regeling, geen harde beveiliging per knop.

## Aanvulling: donkere modus, rechten per persoon, evcc en muziek

Geen nieuwe rules nodig: `firestore-stap4.rules` blijft het bestand om te publiceren (upload eerst de hele app).
- Rechten per persoon staan in hetzelfde document `thuisbord_meta/permissions` (alleen Super Admin schrijft).
- Weergave per gezinslid (licht/donker/kleur) staat op het accountdocument; gezinsbeheerders mogen dat bewerken.
- evcc- en muziekinstellingen zijn beheerderinstellingen (alleen manager/admin kan ze wijzigen).
Nieuwe bestanden: `css/dark.css`, `js/darkmode.js`, `js/evcc.js`, `js/music.js`.

## Aanvulling: weer, regenradar en autokaart
Geen nieuwe rules nodig. De weerlocatie (`appState.weather`) en de tracker per auto zijn beheerderinstellingen.
Nieuwe bestanden: `js/maps.js`, `js/weather.js`. Externe diensten: Open-Meteo (weer), RainViewer (regenradar, max. zoom 7, laatste 2 uur), Leaflet via cdnjs en OpenStreetMap-kaarttegels (CARTO is niet meer gratis zonder sleutel).

## Scènes, planner en doelen
De nieuwe velden `scenes`, `planner` en `budget` staan in de gezinsconfiguratie (appState) en worden door dezelfde generieke opslag bewaard als de rest. Er zijn **geen nieuwe Firestore-regels** nodig: enkel gezinsbeheerders schrijven de configuratie.
Rechten: `view_scenes`, `control_scenes`, `manage_scenes`, `view_planner` en `manage_advice` (Beheer → Rechten).
