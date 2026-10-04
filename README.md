# QLab Web Remote

Yksinkertainen mobiilikaukosäädin QLabille ja Spotifylle. Pieni Node-palvelin pyörii samalla Macilla kuin QLab, ja puhelimen selaimella ohjataan sitä lähiverkon yli.

## Ominaisuudet

- **GO-napit** cueille (oletuksena 1 ja 2). Napeissa näkyy cuen nimi, tila (soi / tauko / valmis), jäljellä oleva aika, kokonaiskesto ja edistymispalkki.
- **Vahvistetut komennot:** nappi muuttuu vihreäksi vasta, kun QLab on kuitannut komennon, ja punaiseksi, jos QLab ei vastaa tai cuea ei löydy.
- **FADE** feidaa kaikki soivat cuet pois (oletuksena 2 s) ja pysäyttää ne. Tuplanapautus valittavissa (`FADE_CONFIRM=1`).
- **STOP** pysäyttää kaikki cuet heti. Vaatii tuplanapautuksen vahinkopainallusten välttämiseksi.
- **Spotify**: soiva kappale ja edistyminen, edellinen / toista-tauko / seuraava sekä äänenvoimakkuus.
- **Yhteyskatko näkyy:** jos puhelin ei saa yhteyttä palvelimeen tai palvelin QLabiin, näytön yläreunaan tulee punainen ilmoitus ja QLab-napit harmaantuvat.

## Vaatimukset

- macOS
- [Node.js](https://nodejs.org/) 18 tai uudempi (ei muita riippuvuuksia)
- QLab 5 (FADE käyttää QLab 5:n `/panicInTime`-komentoa)
- Spotify-työpöytäsovellus, jos haluat Spotify-ohjauksen

## Käyttöönotto

1. **QLab:** avaa Workspace Settings → Network ja varmista, että OSC-viestit ovat sallittuja. Jos workspacessa on passcode, poista se tai anna "No passcode" -yhteyksille tarvittavat oikeudet.
2. Käynnistä palvelin tuplaklikkaamalla Finderissa **`QLab Remote.command`**, tai terminaalissa repon kansiossa:
   ```bash
   npm start
   ```
3. Palvelin tulostaa QR-koodin ja osoitteen, esim. `http://Oman-MacBookin-nimi.local:8080`. Skannaa koodi tai avaa osoite puhelimella, joka on samassa wifissä kuin Mac. `.local`-osoite pysyy samana, vaikka verkko vaihtuu. Jos se ei aukea (esim. osa Android-puhelimista), käytä tulostettua IP-osoitetta.
4. macOS kysyy ensimmäisellä kerralla:
   - saako Node ottaa vastaan verkkoyhteyksiä → **Salli**
   - saako ohjelma ohjata Spotifyta → **Salli**

Vinkki: iPhonella sivun voi lisätä Koti-valikkoon (Jaa → Lisää Koti-valikkoon), jolloin se aukeaa kuin oma sovellus.

Pysäytä palvelin terminaalissa **Ctrl+C**:llä tai sulkemalla ikkuna. (Ctrl+Z jättää sen taustalle varaamaan porttia.)

Palvelin estää Macia menemästä lepotilaan niin kauan kuin se on käynnissä (`caffeinate`). Kannen sulkeminen nukuttaa Macin silti, ellei siihen ole kytketty ulkoista näyttöä.

## Tarkistuslista ennen tapahtumaa

- [ ] QLab auki, oikea workspace edessä, OSC sallittu
- [ ] Palvelin käynnissä ja puhelimen yläkulmassa vihreä "QLab yhdistetty"
- [ ] Puhelin ja Mac samassa verkossa. Tapahtumapaikan wifi estää usein laitteiden väliset yhteydet: varaudu omalla reitittimellä tai puhelimen hotspotilla.
- [ ] Puhelimen automaattinen näytön lukitus pois (iPhone: Asetukset → Näyttö ja kirkkaus → Automaattilukitus → Ei koskaan)
- [ ] Puhelin latauksessa tai akku täynnä
- [ ] Kokeile jokainen GO-nappi kerran

## Asetukset

Asetukset annetaan ympäristömuuttujina, esim. `CUES=1,2,3 FADE_SECONDS=3 npm start`.

| Muuttuja | Oletus | Kuvaus |
| --- | --- | --- |
| `CUES` | `1,2` | Pilkulla erotetut QLab-cuenumerot, joille tehdään GO-napit |
| `FADE_SECONDS` | `2` | FADE-napin feidin pituus sekunteina |
| `FADE_CONFIRM` | (pois) | `1` = FADE vaatii tuplanapautuksen kuten STOP |
| `PORT` | `8080` | Web-palvelimen portti |
| `QLAB_HOST` | `127.0.0.1` | QLab-koneen osoite |
| `QLAB_PORT` | `53000` | QLabin OSC-portti |

## Miten se toimii

- Palvelin pitää QLabiin yhden OSC-yhteyden TCP:n yli (portti 53000, SLIP-kehystys) ja pyytää yhteyden alussa `/alwaysReply 1`, jotta QLab kuittaa myös toimintokomennot.
- GO-, FADE- ja STOP-komennot (`/cue/{n}/start`, `/panicInTime`, `/stop`) odottavat QLabin vastausta enintään sekunnin ennen kuin puhelimelle vastataan.
- Cuejen tila kysytään (`/cue/{n}/valuesForKeys`) neljä kertaa sekunnissa. Jos vastauksia ei tule kahteen sekuntiin, sivu näyttää "QLab ei vastaa".
- Spotifyta ohjataan ja sen tila luetaan AppleScriptillä (`osascript`) kerran sekunnissa.
- Koodi on kolmessa tiedostossa: [`server.js`](server.js) (palvelin), [`index.html`](index.html) (sivu) ja [`qr.js`](qr.js) (QR-koodi terminaaliin).

## Tietoturva

Palvelimessa ei ole kirjautumista: kuka tahansa samassa verkossa oleva voi avata sivun ja laukaista cueja tai ohjata Spotifyta. Käytä sitä vain luotetussa verkossa, äläkä avaa porttia internetiin.
