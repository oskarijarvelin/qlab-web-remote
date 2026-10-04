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
- **Valinnainen PIN** jaettuihin verkkoihin ja tuki QLabin **passcodelle**.
- **Napit valitaan puhelimella:** ⚙-napista aukeaa editori, jossa cuet lisätään suoraan QLabin cue-listasta ja niille annetaan teksti, väri ja Spotify-feidi. Muutokset tallentuvat `config.json`:iin ja päivittyvät kaikkiin avoimiin puhelimiin.
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
| `pin` | (ei) | Sivu kysyy tämän PIN-koodin kerran per laite |
| `qlabPasscode` | (ei) | QLab-workspacen OSC-passcode |
| `port` | `8080` | Web-palvelimen portti |
| `qlabHost` | `127.0.0.1` | QLab-koneen osoite |
| `qlabPort` | `53000` | QLabin OSC-portti |

Ympäristömuuttujat ohittavat tiedoston asetukset: `CUES=1,2,3`, `FADE_SECONDS`, `FADE_CONFIRM=1`, `PIN`, `QLAB_PASSCODE`, `PORT`, `QLAB_HOST`, `QLAB_PORT`.

## Miten se toimii

- Palvelin pitää QLabiin yhden OSC-yhteyden TCP:n yli (portti 53000, SLIP-kehystys) ja pyytää yhteyden alussa `/alwaysReply 1`, jotta QLab kuittaa myös toimintokomennot.
- Jos `qlabPasscode` on asetettu, palvelin lähettää ensin `/connect {passcode}`.
- Komennot (`/cue/{n}/start`, `/cue/{n}/togglePause`, `/cue/{n}/stop`, `/cue/{n}/panicInTime`, `/go`, `/playhead/next`, `/playhead/previous`, `/panicInTime`, `/stop`) odottavat QLabin vastausta enintään sekunnin ennen kuin puhelimelle vastataan.
- Cuejen ja playheadin tila kysytään (`/cue/{n}/valuesForKeys`, `/cue/playhead/valuesForKeys`) neljä kertaa sekunnissa ja välitetään sivulle Server-Sent Events -yhteydellä. Jos vastauksia ei tule kahteen sekuntiin, sivu näyttää "QLab ei vastaa".
- Spotifyta ohjataan ja sen tila luetaan AppleScriptillä (`osascript`) kerran sekunnissa. "Musiikki alas" laskee äänenvoimakkuuden nollaan, pysäyttää toiston ja palauttaa äänenvoimakkuuden ennalleen.
- Editorin cue-lista haetaan QLabilta komennolla `/cueLists`. Napeiksi voi valita vain cueja, joilla on numero, koska komennot osoitetaan numerolla.
- Koodi on neljässä tiedostossa: [`server.js`](server.js) (palvelin), [`index.html`](index.html) (sivu), [`qr.js`](qr.js) (QR-koodi terminaaliin) ja [`icon.js`](icon.js) (Koti-valikon kuvake PNG:nä).

## Tietoturva

Ilman `pin`-asetusta kuka tahansa samassa verkossa oleva voi avata sivun, laukaista cueja, ohjata Spotifyta ja muuttaa nappeja. Aseta PIN, jos verkko on jaettu.

PIN suojaa vahingoilta ja uteliailta, mutta yhteys on salaamaton (`http://`), joten se ei suojaa verkkoliikennettä kuuntelevalta. Käytä työkalua vain lähiverkossa, äläkä avaa porttia internetiin.
