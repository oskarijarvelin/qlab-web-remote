# QLab Web Remote

Yksinkertainen mobiilikaukosäädin QLabille ja Spotifylle. Pieni Node-palvelin pyörii samalla Macilla kuin QLab, ja puhelimen selaimella ohjataan sitä lähiverkon yli.

## Ominaisuudet

- **GO-napit** cueille (oletuksena 1 ja 2). Napeissa näkyy cuen nimi, tila (soi / tauko / valmis), jäljellä oleva aika, kokonaiskesto ja edistymispalkki.
- **FADE** feidaa kaikki soivat cuet pois (oletuksena 2 s) ja pysäyttää ne.
- **STOP** pysäyttää kaikki cuet heti. Vaatii tuplanapautuksen vahinkopainallusten välttämiseksi.
- **Spotify**: soiva kappale ja edistyminen, edellinen / toista-tauko / seuraava sekä äänenvoimakkuus.
- Yhteysvalo kertoo, onko palvelimella yhteys QLabiin.

## Vaatimukset

- macOS
- [Node.js](https://nodejs.org/) 18 tai uudempi (ei muita riippuvuuksia)
- QLab 5 (FADE käyttää QLab 5:n `/panicInTime`-komentoa)
- Spotify-työpöytäsovellus, jos haluat Spotify-ohjauksen

## Käyttöönotto

1. **QLab:** avaa Workspace Settings → Network ja varmista, että OSC-viestit ovat sallittuja. Jos workspacessa on passcode, poista se tai anna "No passcode" -yhteyksille tarvittavat oikeudet.
2. Käynnistä palvelin repon kansiossa:
   ```bash
   npm start
   ```
3. Palvelin tulostaa osoitteen, esim. `http://192.168.1.20:8080`. Avaa se puhelimella, joka on samassa wifissä kuin Mac.
4. macOS kysyy ensimmäisellä kerralla:
   - saako Node ottaa vastaan verkkoyhteyksiä → **Salli**
   - saako ohjelma ohjata Spotifyta → **Salli**

Vinkki: iPhonella sivun voi lisätä Koti-valikkoon (Jaa → Lisää Koti-valikkoon), jolloin se aukeaa kuin oma sovellus.

Pysäytä palvelin terminaalissa **Ctrl+C**:llä. (Ctrl+Z jättää sen taustalle varaamaan porttia.)

## Asetukset

Asetukset annetaan ympäristömuuttujina, esim. `CUES=1,2,3 FADE_SECONDS=3 npm start`.

| Muuttuja | Oletus | Kuvaus |
| --- | --- | --- |
| `CUES` | `1,2` | Pilkulla erotetut QLab-cuenumerot, joille tehdään GO-napit |
| `FADE_SECONDS` | `2` | FADE-napin feidin pituus sekunteina |
| `PORT` | `8080` | Web-palvelimen portti |
| `QLAB_HOST` | `127.0.0.1` | QLab-koneen osoite |
| `QLAB_PORT` | `53000` | QLabin OSC-portti |

## Miten se toimii

- GO-, FADE- ja STOP-komennot lähetetään QLabille OSC-viesteinä UDP:llä (`/cue/{n}/start`, `/panicInTime`, `/stop`).
- Cuejen tila kysytään QLabilta OSC:llä TCP:n yli (`/cue/{n}/valuesForKeys`) neljä kertaa sekunnissa.
- Spotifyta ohjataan ja sen tila luetaan AppleScriptillä (`osascript`) kerran sekunnissa.
- Kaikki on kahdessa tiedostossa: [`server.js`](server.js) ja [`index.html`](index.html).

## Tietoturva

Palvelimessa ei ole kirjautumista: kuka tahansa samassa verkossa oleva voi avata sivun ja laukaista cueja tai ohjata Spotifyta. Käytä sitä vain luotetussa verkossa, äläkä avaa porttia internetiin.
