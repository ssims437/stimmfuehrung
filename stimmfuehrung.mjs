#!/usr/bin/env node
/**
 * stimmfuehrung — Akkordsymbole zu einer MIDI-Datei, mit geführten Stimmen.
 *
 * Der Punkt ist nicht das Dateiformat, sondern die Lage der Töne: Akkorde in
 * Grundstellung aneinandergereiht springen bei jedem Wechsel, weil alle Stimmen
 * gleichzeitig umziehen. Klingt es gut, wandert jede Stimme so wenig wie möglich.
 * Genau das wird hier gerechnet — und am Ende in Halbtonschritten je Stimme
 * ausgewiesen, damit man den Unterschied nicht glauben muss.
 *
 * Keine Abhängigkeit, kein Paketmanager. Nur Node.
 */

import { writeFileSync, readFileSync } from "node:fs";

/* ===================== Akkordsymbole ===================== */

const GRUNDTOENE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

// Halbtonabstände über dem Grundton. Reihenfolge ist die Lesart, nicht die Lage.
const QUALITAETEN = {
  "":       [0, 4, 7],          "maj":    [0, 4, 7],
  "m":      [0, 3, 7],          "min":    [0, 3, 7],
  "dim":    [0, 3, 6],          "aug":    [0, 4, 8],
  "5":      [0, 7],
  "6":      [0, 4, 7, 9],       "m6":     [0, 3, 7, 9],
  "7":      [0, 4, 7, 10],      "maj7":   [0, 4, 7, 11],
  "m7":     [0, 3, 7, 10],      "mmaj7":  [0, 3, 7, 11],
  "m7b5":   [0, 3, 6, 10],      "dim7":   [0, 3, 6, 9],
  "7b5":    [0, 4, 6, 10],      "7#5":    [0, 4, 8, 10],
  "sus2":   [0, 2, 7],          "sus4":   [0, 5, 7],
  "7sus4":  [0, 5, 7, 10],
  "add9":   [0, 4, 7, 14],      "madd9":  [0, 3, 7, 14],
  "9":      [0, 4, 7, 10, 14],  "maj9":   [0, 4, 7, 11, 14],
  "m9":     [0, 3, 7, 10, 14],
  "11":     [0, 7, 10, 14, 17], "13":     [0, 4, 7, 10, 14, 21],
  "m11":    [0, 3, 7, 10, 14, 17]
};

/** "F#m7b5/A" → { grundton: 6, toene: [6,9,0,4], bass: 9, name: "F#m7b5/A" } */
export function akkordLesen(text) {
  const m = /^([A-Ha-h])([#b]?)([^/]*)(?:\/([A-Ha-h])([#b]?))?$/.exec(text.trim());
  if (!m) throw new Error(`Kein Akkordsymbol: "${text}"`);
  const [, buchstabe, vorzeichen, qualitaet, bassBuchstabe, bassVorzeichen] = m;

  const grundton = (GRUNDTOENE[buchstabe.toUpperCase()] +
    (vorzeichen === "#" ? 1 : vorzeichen === "b" ? -1 : 0) + 12) % 12;

  const q = QUALITAETEN[qualitaet];
  if (q === undefined) throw new Error(`Unbekannte Akkordart: "${qualitaet}" in "${text}"`);

  const toene = q.map((i) => (grundton + i) % 12);
  let bass = grundton;
  if (bassBuchstabe) {
    bass = (GRUNDTOENE[bassBuchstabe.toUpperCase()] +
      (bassVorzeichen === "#" ? 1 : bassVorzeichen === "b" ? -1 : 0) + 12) % 12;
  }
  return { name: text.trim(), grundton, toene, bass };
}

/* ===================== Stimmführung =====================
   Für jeden Ton des Akkords wird die Oktavlage gesucht, in der die Stimme dem
   vorherigen Klang am nächsten liegt. Bewertet wird die Summe der Halbtonwege
   plus zwei Strafterme: für Lagen außerhalb des Wohlfühlbereichs und für zu
   weite Spreizung. Ohne diese Terme wandert der Satz mit jedem Akkord ein Stück
   nach unten und endet im Gebrumm. */

const UNTEN = 55, OBEN = 84, MITTE = 67;   // Bereich der rechten Hand

function lagen(tonklasse) {
  const l = [];
  for (let m = UNTEN; m <= OBEN; m++) if (m % 12 === tonklasse) l.push(m);
  return l;
}

function kandidaten(tonklassen) {
  let ergebnis = [[]];
  for (const tk of tonklassen) {
    const naechste = [];
    for (const teil of ergebnis) {
      for (const note of lagen(tk)) {
        if (teil.some((n) => Math.abs(n - note) < 1)) continue;   // kein Unisono
        naechste.push(teil.concat(note));
      }
    }
    ergebnis = naechste;
  }
  return ergebnis.map((v) => v.slice().sort((a, b) => a - b));
}

/* Weg von einem Klang zum nächsten in Halbtönen.
   Jede alte Stimme wandert zum nächstgelegenen neuen Ton; jeder Zielton wird nur
   einmal vergeben, damit nicht alle Stimmen auf denselben Ton fallen. Haben die
   Akkorde unterschiedlich viele Töne — Vierklang nach Dreiklang —, sind irgendwann
   alle Ziele vergeben; die restlichen Stimmen dürfen sich dann einen schon
   belegten Ton teilen, statt die Rechnung unendlich werden zu lassen. */
function wegVon(vorher, voicing) {
  let weg = 0;
  const frei = voicing.slice();
  for (const alt of vorher) {
    const quelle = frei.length ? frei : voicing;
    let besterIndex = 0, bester = Infinity;
    for (let i = 0; i < quelle.length; i++) {
      const d = Math.abs(quelle[i] - alt);
      if (d < bester) { bester = d; besterIndex = i; }
    }
    weg += bester;
    if (frei.length) frei.splice(besterIndex, 1);
  }
  return weg;
}

function bewerte(voicing, vorher) {
  const spreizung = voicing[voicing.length - 1] - voicing[0];
  let strafe = Math.max(0, spreizung - 19) * 2.5;                  // mehr als eine Duodezime
  const schwerpunkt = voicing.reduce((s, n) => s + n, 0) / voicing.length;
  strafe += Math.abs(schwerpunkt - MITTE) * 0.6;                   // Lage halten

  /* Enge Reibungen unten klingen trüb: eine kleine Sekunde zwischen B3 und C4
     macht den Klang matschig, dieselbe Reibung eine Oktave höher ist ein Reiz.
     Deshalb wird sie nach unten hin zunehmend bestraft — die Regel, die den
     Unterschied zwischen richtig gerechnet und gut klingend ausmacht. */
  for (let i = 1; i < voicing.length; i++) {
    const abstand = voicing[i] - voicing[i - 1];
    if (abstand <= 2 && voicing[i - 1] < 64) {
      strafe += (64 - voicing[i - 1]) * (abstand === 1 ? 1.4 : 0.7);
    }
  }

  if (!vorher) return strafe;

  return strafe + wegVon(vorher, voicing);
}

export function satzBauen(akkorde) {
  const satz = [];
  let vorher = null;
  for (const a of akkorde) {
    const alle = kandidaten(a.toene);
    let bestes = null, bestwert = Infinity;
    for (const v of alle) {
      const w = bewerte(v, vorher);
      if (w < bestwert) { bestwert = w; bestes = v; }
    }
    satz.push({ akkord: a, noten: bestes });
    vorher = bestes;
  }
  return satz;
}

/** Grundstellung ohne Führung — nur zum Vergleich */
export function satzOhneFuehrung(akkorde) {
  return akkorde.map((a) => ({
    akkord: a,
    noten: a.toene.map((tk, i) => {
      let n = 60 + tk;
      while (i > 0 && n <= 60 + a.toene[i - 1]) n += 12;
      return n;
    })
  }));
}

/** Gesamtbewegung eines Satzes in Halbtönen */
export function bewegung(satz) {
  let summe = 0;
  for (let i = 1; i < satz.length; i++) {
    summe += wegVon(satz[i - 1].noten, satz[i].noten);
  }
  return summe;
}

/* ===================== MIDI schreiben =====================
   Format 1: eine Spur für Tempo, danach je eine für Klavier, Bass und Schlagzeug.
   Zeitangaben sind Delta-Ticks als Variable Length Quantity — die einzige
   Stelle, an der das Format eigenwillig ist. */

const vlq = (n) => {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return bytes;
};

const text = (s) => [...Buffer.from(s, "utf8")];

function spur(ereignisse) {
  // ereignisse: [{ tick, bytes }] — absolute Ticks, hier in Deltas gewandelt
  const sortiert = ereignisse.slice().sort((a, b) => a.tick - b.tick || a.rang - b.rang);
  const daten = [];
  let letzter = 0;
  for (const e of sortiert) {
    daten.push(...vlq(e.tick - letzter), ...e.bytes);
    letzter = e.tick;
  }
  daten.push(...vlq(0), 0xff, 0x2f, 0x00);              // Spurende
  const laenge = daten.length;
  return [
    ...text("MTrk"),
    (laenge >> 24) & 0xff, (laenge >> 16) & 0xff, (laenge >> 8) & 0xff, laenge & 0xff,
    ...daten
  ];
}

export function midiBauen(satz, { bpm = 92, ppq = 480, taktSchlaege = 4, schlagzeug = true } = {}) {
  const proAkkord = ppq * taktSchlaege;
  const mikrosekundenProSchlag = Math.round(60000000 / bpm);

  const tempoSpur = spur([
    { tick: 0, rang: 0, bytes: [0xff, 0x51, 0x03,
      (mikrosekundenProSchlag >> 16) & 0xff, (mikrosekundenProSchlag >> 8) & 0xff, mikrosekundenProSchlag & 0xff] },
    { tick: 0, rang: 1, bytes: [0xff, 0x58, 0x04, taktSchlaege, 2, 24, 8] },
    { tick: 0, rang: 2, bytes: [0xff, 0x03, ...vlq(5), ...text("Tempo")] }
  ]);

  const klavier = [{ tick: 0, rang: 0, bytes: [0xc0, 0] }];          // Programm 0: Flügel
  const bass    = [{ tick: 0, rang: 0, bytes: [0xc1, 32] }];         // Programm 32: Akustikbass
  const drums   = [];

  satz.forEach((s, i) => {
    const start = i * proAkkord;
    const ende = start + proAkkord - 10;                              // kurz vor dem nächsten lösen

    for (const note of s.noten) {
      klavier.push({ tick: start, rang: 1, bytes: [0x90, note, 74] });
      klavier.push({ tick: ende, rang: 0, bytes: [0x80, note, 0] });
    }

    // Bass: Grundton auf Eins, Quinte oder Terz auf Drei
    const bassNote = 36 + s.akkord.bass;
    const zweiter = 36 + ((s.akkord.toene[2] ?? s.akkord.toene[1] ?? s.akkord.bass));
    bass.push({ tick: start, rang: 1, bytes: [0x91, bassNote, 88] });
    bass.push({ tick: start + ppq * 2 - 10, rang: 0, bytes: [0x81, bassNote, 0] });
    bass.push({ tick: start + ppq * 2, rang: 1, bytes: [0x91, zweiter, 78] });
    bass.push({ tick: ende, rang: 0, bytes: [0x81, zweiter, 0] });

    if (schlagzeug) {
      for (let schlag = 0; schlag < taktSchlaege; schlag++) {
        const t = start + schlag * ppq;
        drums.push({ tick: t, rang: 1, bytes: [0x99, 42, schlag % 2 ? 62 : 80] });   // Hi-Hat
        drums.push({ tick: t + 20, rang: 0, bytes: [0x89, 42, 0] });
        const instrument = schlag % 2 === 0 ? 36 : 38;                                // Kick / Snare
        drums.push({ tick: t, rang: 1, bytes: [0x99, instrument, 92] });
        drums.push({ tick: t + 20, rang: 0, bytes: [0x89, instrument, 0] });
      }
    }
  });

  const spuren = [tempoSpur, spur(klavier), spur(bass)];
  if (schlagzeug) spuren.push(spur(drums));

  const kopf = [
    ...text("MThd"), 0, 0, 0, 6,
    0, 1,                                    // Format 1
    (spuren.length >> 8) & 0xff, spuren.length & 0xff,
    (ppq >> 8) & 0xff, ppq & 0xff
  ];
  return Buffer.from([...kopf, ...spuren.flat()]);
}

/* ===================== MIDI zurücklesen =====================
   Die Prüfung schreibt nicht nur, sie liest die eigene Datei wieder ein:
   Kopf, Spurlängen, und ob zu jedem angeschlagenen Ton ein Loslassen gehört.
   Ein hängender Ton ist der Fehler, den man im Editor sieht und im Code nicht. */

export function midiLesen(puffer, streng = false) {
  let p = 0;
  const lies32 = () => { const v = puffer.readUInt32BE(p); p += 4; return v; };
  const lies16 = () => { const v = puffer.readUInt16BE(p); p += 2; return v; };
  const kennung = puffer.toString("ascii", p, p + 4); p += 4;
  if (kennung !== "MThd") throw new Error("Kein MThd-Kopf");
  const kopfLaenge = lies32();
  if (kopfLaenge !== 6) throw new Error("Kopflänge ist nicht 6");
  const format = lies16(), spurZahl = lies16(), ppq = lies16();

  const spuren = [];
  for (let s = 0; s < spurZahl; s++) {
    const marke = puffer.toString("ascii", p, p + 4); p += 4;
    if (marke !== "MTrk") throw new Error(`Spur ${s}: kein MTrk`);
    const laenge = lies32();
    const ende = p + laenge;
    let tick = 0, status = 0;
    const ereignisse = [];
    while (p < ende) {
      let delta = 0, byte;
      do { byte = puffer[p++]; delta = (delta << 7) | (byte & 0x7f); } while (byte & 0x80);
      tick += delta;
      let b = puffer[p];
      if (b & 0x80) { status = b; p++; } // sonst laufender Status
      const typ = status & 0xf0;
      if (status === 0xff) {
        const metaTyp = puffer[p++];
        let len = 0;
        do { byte = puffer[p++]; len = (len << 7) | (byte & 0x7f); } while (byte & 0x80);
        const inhalt = puffer.subarray(p, p + len); p += len;
        ereignisse.push({ tick, art: "meta", metaTyp, inhalt });
      } else if (typ === 0x90 || typ === 0x80) {
        const note = puffer[p++], velo = puffer[p++];
        ereignisse.push({ tick, art: (typ === 0x90 && velo > 0) ? "an" : "aus", kanal: status & 0x0f, note });
      } else if (typ === 0xc0 || typ === 0xd0) {
        p += 1; ereignisse.push({ tick, art: "programm" });
      } else {
        p += 2; ereignisse.push({ tick, art: "sonstiges" });
      }
    }
    if (p !== ende) throw new Error(`Spur ${s}: angekündigte Länge ${laenge} passt nicht zum Inhalt`);
    spuren.push(ereignisse);
  }
  // Eine gültige Datei geht exakt auf: kein Byte übrig, keines zu wenig.
  if (streng && p !== puffer.length) {
    throw new Error(`Nach der letzten Spur bleiben ${puffer.length - p} Byte übrig`);
  }
  return { format, spurZahl, ppq, spuren, gelesen: p, laenge: puffer.length };
}

/* ===================== Ausgabe ===================== */

const NAMEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const notenName = (n) => NAMEN[n % 12] + (Math.floor(n / 12) - 1);

function satzZeigen(satz) {
  const breite = Math.max(...satz.map((s) => s.akkord.name.length), 7);
  console.log("\n  " + "Akkord".padEnd(breite) + "  Stimmen (tief → hoch)        Bewegung");
  console.log("  " + "-".repeat(breite + 42));
  satz.forEach((s, i) => {
    let bew = "—";
    if (i > 0) {
      const einzeln = bewegung([satz[i - 1], s]);
      bew = einzeln + " HT";
    }
    console.log("  " + s.akkord.name.padEnd(breite) + "  " +
      s.noten.map(notenName).join(" ").padEnd(28) + " " + bew);
  });
}

/* ===================== CLI ===================== */

const BEISPIELE = {
  "jazz":  "Cmaj7 A7 Dm7 G7 Cmaj7 A7 Dm7 G7",
  "pop":   "C G Am F C G F F",
  "moll":  "Am F C G Am F Dm E7",
  "bossa": "Amaj7 F#m7 Bm7 E7 Amaj7 F#m7 Bm7 E7",
  "blues": "C7 F7 C7 C7 F7 F7 C7 A7 Dm7 G7 C7 G7"
};

function hilfe() {
  console.log(`
stimmfuehrung — Akkordsymbole zu MIDI, mit geführten Stimmen

  node stimmfuehrung.mjs "Cmaj7 A7 Dm7 G7" [-o datei.mid] [--bpm 92] [--ohne-fuehrung] [--ohne-schlagzeug]
  node stimmfuehrung.mjs --beispiel jazz
  node stimmfuehrung.mjs --pruefen

Beispiele: ${Object.keys(BEISPIELE).join(", ")}

Akkorde: Grundton A–H, optional # oder b, dann die Art
  Dur          C   Cmaj   ·  Moll  Cm
  Septakkorde  C7  Cmaj7  Cm7  Cm7b5  Cdim7  Cmmaj7
  Vorhalte     Csus2  Csus4  C7sus4
  Erweitert    C6  Cm6  Cadd9  C9  Cmaj9  Cm9  C11  C13
  Bassnote     C/E  Am7/G
`);
}

function pruefen() {
  console.log("Prüfung\n" + "=".repeat(60));
  let fehler = 0;
  const meldung = (was, gut, text) => {
    console.log("  " + (gut ? "ok   " : "FEHL ") + was.padEnd(38) + text);
    if (!gut) fehler++;
  };

  // 1. Akkordsymbole
  const proben = [
    ["C", [0, 4, 7]], ["Am", [9, 0, 4]], ["F#m7b5", [6, 9, 0, 4]],
    ["Bb13", [10, 2, 5, 8, 0, 7]], ["G7sus4", [7, 0, 2, 5]], ["Cmaj7", [0, 4, 7, 11]],
    ["Ddim7", [2, 5, 8, 11]], ["Eadd9", [4, 8, 11, 6]]
  ];
  let falsch = 0;
  for (const [symbol, erwartet] of proben) {
    const a = akkordLesen(symbol);
    if (a.toene.join(",") !== erwartet.join(",")) { falsch++; console.log(`       ${symbol}: ${a.toene} statt ${erwartet}`); }
  }
  meldung("Akkordsymbole", falsch === 0, proben.length + " Symbole gelesen");

  // 2. Slash-Akkord setzt den Bass, nicht den Klang
  const slash = akkordLesen("C/E");
  meldung("Bassnote getrennt vom Klang", slash.bass === 4 && slash.grundton === 0,
    "C/E → Bass E, Grundton C");

  /* 3. Die Führung darf nie längere Wege erzeugen als die Grundstellung.
        Gleichstand ist erlaubt und kommt vor: bei reinen Quintfällen (Amaj7 F#m7
        Bm7 E7) liegt die Grundstellung bereits am Optimum. Und die Führung
        optimiert nicht nur den Weg, sondern hält auch die Lage — sie darf
        deshalb nicht auf Weg allein getrimmt werden. */
  let schlechter = 0, kuerzer = 0, summeG = 0, summeS = 0;
  for (const folge of Object.values(BEISPIELE)) {
    const akkorde = folge.split(/\s+/).map(akkordLesen);
    const gefuehrt = bewegung(satzBauen(akkorde));
    const stur = bewegung(satzOhneFuehrung(akkorde));
    summeG += gefuehrt; summeS += stur;
    if (gefuehrt > stur) schlechter++;
    if (gefuehrt < stur) kuerzer++;
  }
  meldung("Führung nie länger als Grundstellung", schlechter === 0,
    `${kuerzer} von ${Object.keys(BEISPIELE).length} kürzer, keine länger · ` +
    `insgesamt ${summeG} statt ${summeS} Halbtöne (${Math.round((1 - summeG / summeS) * 100)} % weniger)`);

  // 4. Lage bleibt im Rahmen
  let ausserhalb = 0;
  for (const folge of Object.values(BEISPIELE)) {
    for (const s of satzBauen(folge.split(/\s+/).map(akkordLesen))) {
      for (const n of s.noten) if (n < UNTEN || n > OBEN) ausserhalb++;
    }
  }
  meldung("Lage im Rahmen", ausserhalb === 0, `alle Töne zwischen ${notenName(UNTEN)} und ${notenName(OBEN)}`);

  // 5. Die geschriebene Datei zurücklesen
  /* 4b. Wechselnde Stimmenzahl — Vierklang nach Dreiklang und zurück.
         Hier lief die Paarung der Stimmen früher leer und es wurde gar kein
         Voicing gewählt; der Fehler zeigt sich erst bei gemischten Folgen. */
  const gemischt = "Cmaj7 C/E F G7sus4 G7 Am Dm7 G C".split(/\s+/).map(akkordLesen);
  const gemischterSatz = satzBauen(gemischt);
  const alleGesetzt = gemischterSatz.every((s) => Array.isArray(s.noten) && s.noten.length >= 2);
  meldung("Wechselnde Stimmenzahl", alleGesetzt,
    alleGesetzt ? `${gemischt.length} Akkorde von 3 bis 4 Tönen, alle gesetzt` : "ein Akkord blieb ohne Lage");

  const satz = satzBauen(BEISPIELE.jazz.split(/\s+/).map(akkordLesen));
  const puffer = midiBauen(satz);
  let gelesen, aufgegangen = true, meldungText = "";
  try { gelesen = midiLesen(puffer, true); }
  catch (e) { aufgegangen = false; meldungText = e.message; gelesen = midiLesen(puffer); }
  meldung("Datei geht byteweise auf", aufgegangen,
    aufgegangen ? `${gelesen.gelesen} von ${gelesen.laenge} Byte gelesen, kein Rest` : meldungText);
  meldung("MIDI-Kopf", gelesen.format === 1 && gelesen.ppq === 480 && gelesen.spurZahl === 4,
    `Format ${gelesen.format}, ${gelesen.spurZahl} Spuren, ${gelesen.ppq} Ticks je Viertel`);

  // 6. Kein hängender Ton
  let offen = 0, anGesamt = 0;
  for (const ereignisse of gelesen.spuren) {
    const zaehler = new Map();
    for (const e of ereignisse) {
      if (e.art === "an") { zaehler.set(e.note, (zaehler.get(e.note) || 0) + 1); anGesamt++; }
      if (e.art === "aus") zaehler.set(e.note, (zaehler.get(e.note) || 0) - 1);
    }
    for (const v of zaehler.values()) if (v !== 0) offen++;
  }
  meldung("Jeder Ton wird losgelassen", offen === 0, anGesamt + " Anschläge, keiner offen");

  // 7. Länge stimmt mit der Akkordzahl überein
  const letzterTick = Math.max(...gelesen.spuren.flat().map((e) => e.tick));
  const erwartet = satz.length * 480 * 4;
  meldung("Länge passt zur Akkordzahl", Math.abs(letzterTick - erwartet) <= 20,
    `${satz.length} Akkorde × 4 Schläge = ${erwartet} Ticks, gemessen ${letzterTick}`);

  console.log("=".repeat(60));
  console.log(fehler === 0 ? "  Alles bestanden." : `  ${fehler} Prüfung(en) fehlgeschlagen.`);
  return fehler;
}

function haupt(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--hilfe") || args.includes("-h")) { hilfe(); return 0; }
  if (args.includes("--pruefen")) return pruefen();

  const wert = (name, standard) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : standard;
  };

  let folge = args.filter((a) => !a.startsWith("-") &&
    args[args.indexOf(a) - 1] !== "-o" && args[args.indexOf(a) - 1] !== "--bpm" &&
    args[args.indexOf(a) - 1] !== "--beispiel").join(" ");

  const beispiel = wert("--beispiel", null);
  if (beispiel) {
    if (!BEISPIELE[beispiel]) { console.error(`Kein Beispiel "${beispiel}". Verfügbar: ${Object.keys(BEISPIELE).join(", ")}`); return 1; }
    folge = BEISPIELE[beispiel];
  }
  if (!folge.trim()) { hilfe(); return 1; }

  let akkorde;
  try { akkorde = folge.split(/\s+/).filter(Boolean).map(akkordLesen); }
  catch (e) { console.error("Fehler: " + e.message); return 1; }

  const gefuehrt = !args.includes("--ohne-fuehrung");
  const satz = gefuehrt ? satzBauen(akkorde) : satzOhneFuehrung(akkorde);
  const datei = wert("-o", "akkorde.mid");
  const bpm = parseInt(wert("--bpm", "92"), 10);

  console.log(`\n  ${akkorde.length} Akkorde · ${bpm} bpm · Stimmführung ${gefuehrt ? "an" : "aus"}`);
  satzZeigen(satz);

  const mit = bewegung(satzBauen(akkorde));
  const ohne = bewegung(satzOhneFuehrung(akkorde));
  console.log(`\n  Gesamtbewegung: ${mit} Halbtöne geführt · ${ohne} in Grundstellung` +
    (ohne > 0 ? ` · ${Math.round((1 - mit / ohne) * 100)} % weniger` : ""));

  const puffer = midiBauen(satz, { bpm, schlagzeug: !args.includes("--ohne-schlagzeug") });
  writeFileSync(datei, puffer);
  const geprueft = midiLesen(readFileSync(datei));
  console.log(`  Geschrieben: ${datei} (${puffer.length} Byte, ${geprueft.spurZahl} Spuren) — zurückgelesen und in Ordnung.\n`);
  return 0;
}

// Nur ausführen, wenn die Datei direkt gestartet wurde. Beim Einbinden als Modul
// fehlt process.argv[1] ganz (etwa unter `node -e`) — deshalb erst prüfen, dann lesen.
const gestartet = process.argv[1]?.replace(/\\/g, "/") ?? "";
if (gestartet.endsWith("stimmfuehrung.mjs")) {
  process.exit(haupt(process.argv));
}
