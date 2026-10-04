# QLab Web Remote

Yksinkertainen mobiilikaukosäädin QLabille ja Spotifylle. Pieni Node-palvelin pyörii samalla Macilla kuin QLab, ja puhelimen selaimella ohjataan sitä lähiverkon yli.

## Ominaisuudet

- **GO-napit** valituille cueille (oletuksena 1 ja 2), omilla nimillä ja väreillä. Koko kortti on GO-nappi. Kortissa näkyy cuen numero, nimi (oma teksti tai QLabin nimi ilman tiedostopäätettä) ja kesto. Soidessa kortilla on valkoinen reunus, jäljellä oleva aika ja edistymispalkki. Tauolla reunus ja aika ovat keltaisia.
- **Pitkä painallus** cue-nappiin avaa valikon: tauko / jatka, feidaa tai pysäytä juuri se cue.
- **Playhead-tila:** iso GO seuraavalle cuelle ja ⏮ ⏭ playheadin siirtoon, kun cueja ajetaan järjestyksessä.
- **"Musiikki alas + GO":** cuen voi asettaa feidaamaan Spotifyn pois samalla kun cue käynnistyy.
- **Vahvistetut komennot:** nappi muuttuu vihreäksi vasta, kun QLab on kuitannut komennon, ja punaiseksi, jos QLab ei vastaa tai cuea ei löydy.
- **FADE** feidaa kaikki soivat cuet pois (oletuksena 2 s) ja pysäyttää ne. Tuplanapautus valittavissa (`FADE_CONFIRM=1`).
- **STOP** pysäyttää kaikki cuet heti. Vaatii tuplanapautuksen vahinkopainallusten välttämiseksi.
- **Spotify**: soiva kappale ja edistyminen, edellinen / toista-tauko / seuraava sekä äänenvoimakkuus.
- **Yhteyskatko näkyy:** jos puhelin ei saa yhteyttä palvelimeen tai palvelin QLabiin, näytön yläreunaan tulee punainen ilmoitus ja QLab-napit harmaantuvat.
- **Macin äänenvoimakkuus:** liukusäädin ja mykistys Macin oletusäänilaitteelle.
- **Pää- ja varakoneet:** jokainen komento lähtee pääkoneeseen ja yhteen tai useampaan varakoneeseen yhtä aikaa. Sivu näyttää varakoneiden tilan, varoittaa jos koneet eivät ole samassa tilassa ja vaihtaa varakoneen näkymään, jos pääkone lakkaa vastaamasta. Palvelin voi pyöriä myös omalla koneellaan.
- **Useampi puhelin:** kaikki näkevät saman tilan, ja alareunan tilarivi kertoo kaikille viimeisimmän komennon, kuka sen lähetti ja milloin (esim. "GO 1 · Intro — Valomiehen Android · 12.37.30"). Toisen puhelimen komento välähtää sinisenä. Laitteelle voi antaa nimen ⚙-paneelissa. Ilman nimeä näytetään laitteen tyyppi ja IP-osoitteen loppu, esim. "iPhone (.42)".
- **Valinnainen PIN** jaettuihin verkkoihin ja tuki QLabin **passcodelle**.
- **Napit valitaan puhelimella:** ⚙-paneelissa on editori, jossa cuet lisätään suoraan QLabin cue-listasta ja niille annetaan teksti, väri ja Spotify-feidi. Muutokset tallentuvat `config.json`:iin ja päivittyvät kaikkiin avoimiin puhelimiin.
- **Tabletti ja vaakanäkymä:** leveällä näytöllä cuet ovat vasemmalla ruudukossa ja FADE, STOP ja Spotify oikealla.
- **Koti-valikon kuvake:** sivun voi lisätä puhelimen Koti-valikkoon omana sovelluksenaan.

## Vaatimukset

- macOS
- [Node.js](https://nodejs.org/) 18 tai uudempi (ei muita riippuvuuksia)
- QLab 5 (FADE käyttää QLab 5:n `/panicInTime`-komentoa)
- Spotify-työpöytäsovellus, jos haluat Spotify-ohjauksen

## Käyttöönotto

1. **QLab:** avaa Workspace Settings → Network ja varmista, että OSC-viestit ovat sallittuja. Jos workspacessa on passcode, laita se asetukseen `qlabPasscode` (ks. [Asetukset](#asetukset)).
2. Kopioi `config.example.json` nimelle `config.json` ja muokkaa cuet tapahtumaan sopiviksi. Ilman tiedostoa käytetään oletuksia (cuet 1 ja 2).
3. Käynnistä palvelin tuplaklikkaamalla Finderissa **`QLab Remote.command`**, tai terminaalissa repon kansiossa:
   ```bash
   npm start
   ```
4. Palvelin tulostaa QR-koodin ja osoitteen, esim. `http://Oman-MacBookin-nimi.local:8080`. Skannaa koodi tai avaa osoite puhelimella, joka on samassa wifissä kuin Mac. `.local`-osoite pysyy samana, vaikka verkko vaihtuu. Jos se ei aukea (esim. osa Android-puhelimista), käytä tulostettua IP-osoitetta.
5. macOS kysyy ensimmäisellä kerralla:
   - saako Node ottaa vastaan verkkoyhteyksiä → **Salli**
   - saako ohjelma ohjata Spotifyta → **Salli**

**Koti-valikkoon:** iPhonella Safari → Jaa → Lisää Koti-valikkoon. Sivu aukeaa omana sovelluksenaan koko näytölle ilman selaimen palkkeja. Jos PIN on käytössä, se kysytään sovelluksessa kerran uudelleen, koska iOS pitää kotivalikon sovelluksen evästeet erillään Safarista. Androidin Chromessa (valikko → Lisää aloitusnäyttöön) kuvake toimii, mutta sivu aukeaa selaimessa, koska koko näytön tila vaatii Chromessa HTTPS-yhteyden.

Pysäytä palvelin terminaalissa **Ctrl+C**:llä tai sulkemalla ikkuna. (Ctrl+Z jättää sen taustalle varaamaan porttia.)

Palvelin estää Macia menemästä lepotilaan niin kauan kuin se on käynnissä (`caffeinate`). Kannen sulkeminen nukuttaa Macin silti, ellei siihen ole kytketty ulkoista näyttöä.

## Tarkistuslista ennen tapahtumaa

- [ ] QLab auki, oikea workspace edessä, OSC sallittu
- [ ] Palvelin käynnissä ja puhelimen yläkulmassa vihreä "QLab yhdistetty"
- [ ] Puhelin ja Mac samassa verkossa. Tapahtumapaikan wifi estää usein laitteiden väliset yhteydet: varaudu omalla reitittimellä tai puhelimen hotspotilla.
- [ ] Puhelimen automaattinen näytön lukitus pois (iPhone: Asetukset → Näyttö ja kirkkaus → Automaattilukitus → Ei koskaan)
- [ ] Puhelin latauksessa tai akku täynnä
- [ ] Kokeile jokainen GO-nappi kerran
- [ ] Jos "musiikki alas" on käytössä: Spotifyn äänenvoimakkuus palautuu feidin jälkeen

## Asetukset

Napit on helpointa valita puhelimella ⚙-napista (ks. [Ominaisuudet](#ominaisuudet)). Editori kirjoittaa saman `config.json`-tiedoston, jota voi muokata myös käsin. Editori ei ole käytössä, jos cuet annetaan `CUES`-ympäristömuuttujalla.

Asetukset luetaan tiedostosta `config.json` repon kansiossa (malli: [`config.example.json`](config.example.json)). Tiedosto ei mene versionhallintaan, joten jokaisella koneella ja tapahtumalla voi olla omansa. Eri tapahtumien asetustiedostoja voi pitää erikseen ja valita käynnistyksessä: `CONFIG=keikat/gaala.json npm start`.

```json
{
  "fadeSeconds": 2,
  "playhead": true,
  "cues": [
    { "number": "1", "label": "Intro", "color": "green", "spotifyFadeOut": true },
    { "number": "2", "label": "Palkinnot", "color": "blue" }
  ]
}
```

| Asetus | Oletus | Kuvaus |
| --- | --- | --- |
| `cues` | cuet 1 ja 2 | Lista GO-napeista. `number` = QLabin cuenumero (pakollinen, ei välilyöntejä). `label` = napin teksti. `color` = `green`, `blue`, `purple`, `orange`, `red`, `teal`, `gray` tai `#rrggbb`. `spotifyFadeOut: true` = Spotify feidataan pois, kun cue käynnistyy. |
| `playhead` | `false` | `true` = näytä playhead-osio (seuraava cue, GO, ⏮ ⏭). Toimii myös ilman `cues`-listaa. |
| `fadeSeconds` | `2` | FADE-napin ja cuekohtaisen feidin pituus sekunteina |
| `fadeConfirm` | `false` | `true` = FADE vaatii tuplanapautuksen kuten STOP |
| `spotify` | `true` | `false` = piilota Spotify-osio |
| `spotifyFadeSeconds` | `2` | Spotify-feidin pituus "musiikki alas" -cueissa |
| `macVolume` | `true` | `false` = piilota Macin äänenvoimakkuuden säädin |
| `backup` | (ei) | Varakone, esim. `{ "host": "192.168.1.21" }`, tai lista varakoneista. Valinnaiset `name` (näkyy sivulla), `port` (oletus 53000), `workspace` ja `passcode` (oletuksena samat kuin pääkoneella). |
| `pin` | (ei) | Sivu kysyy tämän PIN-koodin kerran per laite |
| `qlabWorkspace` | (ei) | Ohjattavan workspacen nimi (esim. `Gaala` tai `Gaala.qlab5`) tai tunnus. Ilman tätä komennot menevät kaikkiin avoimiin workspaceihin. |
| `qlabPasscode` | (ei) | QLab-workspacen OSC-passcode |
| `port` | `8080` | Web-palvelimen portti |
| `qlabHost` | `127.0.0.1` | QLab-koneen osoite |
| `qlabPort` | `53000` | QLabin OSC-portti |

Ympäristömuuttujat ohittavat tiedoston asetukset: `CUES=1,2,3`, `FADE_SECONDS`, `FADE_CONFIRM=1`, `PIN`, `QLAB_WORKSPACE`, `QLAB_PASSCODE`, `QLAB_BACKUP_HOST` (useampi pilkulla eroteltuna), `PORT`, `QLAB_HOST`, `QLAB_PORT`.

### Useampi workspace tai QLab

- **Monta workspacea auki samassa QLabissa:** ilman `qlabWorkspace`-asetusta QLab 5 välittää komennot kaikkiin avoimiin workspaceihin. Esimerkiksi GO cue 1 käynnistää cuen 1 jokaisessa workspacessa, jossa sellainen on. Sivu varoittaa tästä keltaisella ilmoituksella. Valitse ohjattava workspace asetuksella `qlabWorkspace`, jolloin muut workspacet eivät saa komentoja. Jos valittu workspace ei ole auki, sivu näyttää punaisen ilmoituksen eikä lähetä komentoja.
- **QLab muilla koneilla:** palvelin ohjaa osoitteessa `qlabHost` olevaa QLabia (oletuksena tämä Mac) ja `backup`-asetuksella lisäksi varakoneita. Muut koneet verkossa eivät vaikuta siihen.

### Pää- ja varakoneet

Varakoneille ei tarvita omaa palvelinta: riittää, että niillä on sama workspace auki ja OSC sallittu (Workspace Settings → Network). Lisää palvelimen `config.json`:iin varakoneiden osoitteet:

```json
{ "qlabWorkspace": "Gaala", "backup": { "host": "192.168.1.21" } }
```

tai useampi varakone listana:

```json
{ "backup": [ { "host": "192.168.1.21" }, { "host": "192.168.1.22", "name": "varakone B" } ] }
```

- **Komennot** (GO, FADE, STOP, playhead ja cuekohtaiset) lähtevät kaikkiin koneisiin yhtä aikaa. Komento onnistuu, jos ainakin yksi kone kuittaa sen. Muiden koneiden epäonnistuminen näkyy tilarivillä ⚠-varoituksena.
- **Tila** näytetään pääkoneelta. Yläkulman merkki kertoo varakoneiden tilan: **VARA ✓** (kunnossa), **VARA ≠** (ei samassa tilassa) tai **VARA ✕** (ei yhteyttä). Useammalla varakoneella merkki näyttää vastaavien koneiden määrän, esim. **VARA 1/2 ✕**.
- **Synkronointivahti:** jos jokin cue soi vain osalla koneista tai playhead on eri kohdassa yli 1,5 sekuntia, sivu varoittaa ja kertoo eron.
- **Jos pääkone lakkaa vastaamasta,** sivu näyttää ensimmäisen vastaavan varakoneen tilan oranssilla ilmoituksella. Komennot menevät edelleen kaikkiin, joten pääkone jatkaa samasta kohdasta, jos se palaa.
- **Spotify ja Macin äänenvoimakkuus** ohjaavat vain sitä Macia, jolla palvelin pyörii.

### Palvelin omalla koneellaan

Jos palvelinta ajava kone kaatuu, etäohjain lakkaa toimimasta. Palvelimen voi siksi ajaa erillisellä koneella, jolloin se ohjaa kaikkia QLabeja verkon yli:

```json
{
  "qlabHost": "192.168.1.20",
  "backup": [ { "host": "192.168.1.21" } ],
  "qlabWorkspace": "Gaala",
  "spotify": false,
  "macVolume": false
}
```

- Spotify ja Macin äänenvoimakkuus kannattaa ottaa pois, koska ne ohjaisivat palvelinkonetta.
- Anna QLab-koneille kiinteät IP-osoitteet (tai käytä `.local`-nimiä) ja mieluiten kaapeliyhteys. macOS:n palomuuri voi kysyä QLabin verkkoyhteyksistä ensimmäisellä kerralla.
- Palvelinkoneen ei tarvitse olla Mac, sillä QLab-ohjaus on tavallista Node.js:ää. Muilla käyttöjärjestelmillä käynnistä komennolla `node server.js`, koska `npm start` (`caffeinate`) ja `QLab Remote.command` ovat macOS-kohtaisia. Tätä ei ole testattu.

## Miten se toimii

- Palvelin pitää QLabiin yhden OSC-yhteyden TCP:n yli (portti 53000, SLIP-kehystys) ja pyytää yhteyden alussa `/alwaysReply 1`, jotta QLab kuittaa myös toimintokomennot.
- Palvelin tarkistaa avoimet workspacet (`/workspaces`) kahden sekunnin välein. Kun `qlabWorkspace` on asetettu, kaikki workspace-komennot osoitetaan muodossa `/workspace/{tunnus}/…`.
- Jos `qlabPasscode` on asetettu, palvelin lähettää ensin `/connect {passcode}` (valittuun workspaceen, kun se on löytynyt).
- Komennot (`/cue/{n}/start`, `/cue/{n}/togglePause`, `/cue/{n}/stop`, `/cue/{n}/panicInTime`, `/go`, `/playhead/next`, `/playhead/previous`, `/panicInTime`, `/stop`) odottavat QLabin vastausta enintään sekunnin ennen kuin puhelimelle vastataan.
- Cuejen ja playheadin tila kysytään (`/cue/{n}/valuesForKeys`, `/cue/playhead/valuesForKeys`) neljä kertaa sekunnissa ja välitetään sivulle Server-Sent Events -yhteydellä. Jos vastauksia ei tule kahteen sekuntiin, sivu näyttää "QLab ei vastaa".
- Spotifyta ohjataan ja sen tila luetaan AppleScriptillä (`osascript`) kerran sekunnissa.
- Macin äänenvoimakkuus luetaan ja asetetaan AppleScriptillä (`get volume settings`, `set volume output volume`). Säädin koskee macOS:n oletusäänilaitetta. Jos QLab soittaa äänikorttiin, jossa ei ole ohjelmallista äänenvoimakkuutta, säädin on harmaana eikä vaikuta QLabiin. "Musiikki alas" laskee äänenvoimakkuuden nollaan, pysäyttää toiston ja palauttaa äänenvoimakkuuden ennalleen.
- Editorin cue-lista haetaan QLabilta komennolla `/cueLists`. Napeiksi voi valita vain cueja, joilla on numero, koska komennot osoitetaan numerolla.
- Koodi on neljässä tiedostossa: [`server.js`](server.js) (palvelin), [`index.html`](index.html) (sivu), [`qr.js`](qr.js) (QR-koodi terminaaliin) ja [`icon.js`](icon.js) (Koti-valikon kuvake PNG:nä).

## Tietoturva

Ilman `pin`-asetusta kuka tahansa samassa verkossa oleva voi avata sivun, laukaista cueja, ohjata Spotifyta ja muuttaa nappeja. Aseta PIN, jos verkko on jaettu.

PIN suojaa vahingoilta ja uteliailta, mutta yhteys on salaamaton (`http://`), joten se ei suojaa verkkoliikennettä kuuntelevalta. Käytä työkalua vain lähiverkossa, äläkä avaa porttia internetiin.
