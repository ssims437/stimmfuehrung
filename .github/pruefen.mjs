/* Prüft dieses Blatt so, wie ein Mensch es prüfen würde: im echten Browser
   öffnen, den Prüfknopf drücken, das Ergebnis lesen. Kein Nachbau der Logik,
   keine Attrappe — dieselbe Datei, die auch veröffentlicht wird.

   Läuft in der CI (siehe workflows/pruefen.yml) und lokal:
       npm install playwright && npx playwright install chromium
       node .github/pruefen.mjs

   Rückgabe 0 = alles in Ordnung, 1 = mindestens eine Beanstandung. */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const WURZEL = process.cwd();
const NABE = "https://ssims437.github.io/";
const TYPEN = { ".html": "text/html; charset=utf-8", ".js": "text/javascript",
  ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".json": "application/json", ".csv": "text/csv", ".mid": "audio/midi", ".svg": "image/svg+xml" };

/* Der Prüflauf mancher Blätter rechnet in Häppchen weiter, damit die Seite
   nicht einfriert — die Zahl steht erst eine Sekunde später da. Deshalb wird
   auf eine stabile Ausgabe gewartet, nicht auf einen festen Zeitpunkt. */
const GEDULD_MS = 180000;

const beanstandungen = [];
const meldung = (blatt, text) => { beanstandungen.push(`${blatt}: ${text}`); console.log(`  ✗ ${text}`); };
const in_ordnung = (text) => console.log(`  ✓ ${text}`);

const server = createServer(async (anfrage, antwort) => {
  try {
    let pfad = decodeURIComponent((anfrage.url || "/").split("?")[0]);
    if (pfad.endsWith("/")) pfad += "index.html";
    const datei = join(WURZEL, normalize(pfad).replace(/^([/\\])+/, ""));
    if (!datei.startsWith(WURZEL)) { antwort.writeHead(403).end(); return; }
    const inhalt = await readFile(datei);
    antwort.writeHead(200, { "content-type": TYPEN[extname(datei)] || "application/octet-stream" });
    antwort.end(inhalt);
  } catch {
    antwort.writeHead(404).end("nicht gefunden");
  }
});

await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
const adresse = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const seiten = process.argv.slice(2);
const zuPruefen = seiten.length ? seiten : ["index.html"];

for (const seite of zuPruefen) {
  console.log(`\n=== ${seite}`);
  const kontext = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const tab = await kontext.newPage();

  const konsolenfehler = [];
  tab.on("console", (n) => { if (n.type() === "error") konsolenfehler.push(n.text()); });
  tab.on("pageerror", (f) => konsolenfehler.push("Ausnahme: " + f.message));

  await tab.goto(`${adresse}/${seite}`, { waitUntil: "load" });
  await tab.waitForTimeout(400);

  /* 1. Nichts darf beim Laden brechen. Ein fehlendes Favicon ist kein Fehler
        des Blattes, sondern des Servers ohne Favicon. */
  const echteFehler = konsolenfehler.filter((t) => !/favicon/i.test(t));
  if (echteFehler.length) meldung(seite, `Konsolenfehler: ${echteFehler.join(" | ").slice(0, 300)}`);
  else in_ordnung("kein Konsolenfehler beim Laden");

  /* 2. Der Verweis auf die Sammelseite muss dranbleiben — genau der Punkt, an
        dem die frühere Verweispflege stillschweigend gedriftet ist. Verlangt
        wird er nur vom Hauptblatt; Unterblätter (etwa bei plotterblaetter)
        tragen ihn nicht. */
  if (seite === "index.html") {
    const nabeDa = await tab.locator(`a[href="${NABE}"]`).count();
    if (nabeDa === 0) meldung(seite, `Verweis auf ${NABE} fehlt`);
    else in_ordnung("Verweis auf die Sammelseite vorhanden");
  }

  /* 3. Wenn es einen Prüfknopf gibt: drücken und das Ergebnis lesen. */
  const knopf = tab.locator("#b-pruefen");
  if (await knopf.count()) {
    const fussWahl = (await tab.locator("#pruef-fuss").count()) ? "#pruef-fuss" : null;
    const vorher = fussWahl ? (await tab.locator(fussWahl).innerText()).trim() : "";
    await knopf.click();

    let text = vorher, ruhig = 0;
    const frist = Date.now() + GEDULD_MS;
    while (Date.now() < frist) {
      await tab.waitForTimeout(500);
      const jetzt = fussWahl ? (await tab.locator(fussWahl).innerText()).trim() : "";
      if (jetzt !== vorher && jetzt === text) { if (++ruhig >= 2) break; } else { ruhig = 0; }
      text = jetzt;
    }

    if (!fussWahl) {
      in_ordnung("Prüfknopf vorhanden (ohne Ergebniszeile zum Auslesen)");
    } else if (text === vorher || !text) {
      meldung(seite, "Prüflauf hat nichts ausgegeben");
    } else {
      console.log(`  → ${text.replace(/\s+/g, " ").slice(0, 220)}`);
      /* Die Blätter melden Fehler in drei Formulierungen: „N Prüfung(en)
         fehlgeschlagen", „N FEHLER" und „N FALSCHE FÄLLE". Die beiden letzten
         müssen verankert geprüft werden — sonst schlägt der Erfolgssatz von
         zeitsprung („252 Prüfungen, kein einziger Fehler") fälschlich an. */
      const kurz = text.replace(/\s+/g, " ").trim();
      const gescheitert = /Prüfung\(en\)\s+fehlgeschlagen/i.test(kurz)
        || /^\d[\d\s.']*\s+(FEHLER|FALSCHE\s+FÄLLE)\.?$/i.test(kurz);
      if (gescheitert) meldung(seite, `Prüflauf meldet Fehler: ${kurz.slice(0, 200)}`);
      else in_ordnung("Prüflauf ohne Beanstandung");

      /* Zusätzlich markup-unabhängig: rote Zellen in der Prüftabelle. Die
         Blätter benutzen verschiedene Farbtoken für „falsch"; gemeinsam ist
         nur, dass sie rot sind. */
      const rot = await tab.evaluate(() => {
        const tabellen = ["#pruef", "#pruef-tabelle"].flatMap((s) => [...document.querySelectorAll(s)]);
        let n = 0;
        for (const t of tabellen) {
          for (const zelle of t.querySelectorAll("td")) {
            const f = getComputedStyle(zelle).color.match(/\d+/g);
            if (!f) continue;
            const [r, g, b] = f.map(Number);
            if (r > 110 && r > g * 1.5 && r > b * 1.5) n++;
          }
        }
        return n;
      });
      if (rot > 0) meldung(seite, `${rot} rot markierte Zelle(n) in der Prüftabelle`);
      else in_ordnung("keine rote Zelle in der Prüftabelle");
    }
  } else {
    in_ordnung("kein Prüfknopf vorgesehen — dieses Blatt prüft anders");
  }

  await kontext.close();
}

await browser.close();
server.close();

console.log("");
if (beanstandungen.length) {
  console.log(`FEHLGESCHLAGEN — ${beanstandungen.length} Beanstandung(en):`);
  for (const b of beanstandungen) console.log(`  - ${b}`);
  process.exit(1);
}
console.log("Alles in Ordnung.");
