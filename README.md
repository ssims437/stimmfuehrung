# Stimmführung

Akkordsymbole hinein, eine MIDI-Datei heraus — mit **geführten Stimmen**.
Kein Paketmanager, keine Bibliothek, nur Node. Das MIDI-Format ist von Hand geschrieben.

```bash
node stimmfuehrung.mjs "Cmaj7 A7 Dm7 G7" -o akkorde.mid
node stimmfuehrung.mjs --beispiel jazz
node stimmfuehrung.mjs --pruefen
```

---

## Worum es geht

Akkorde in Grundstellung aneinanderzureihen ist die naheliegende Lösung und klingt nach
Anfänger: Bei jedem Wechsel ziehen alle Stimmen gleichzeitig um. Gut klingt es, wenn jede
Stimme **so wenig wie möglich wandert** — gemeinsame Töne bleiben liegen, der Rest rückt
einen Halbton weiter.

Dieselbe Folge, einmal stur und einmal geführt:

```
Cmaj7  A7     Dm7    G7           Grundstellung          geführt
                                  C4 E4 G4 B4            C4 E4 G4 B4
                                  A4 C#5 E5 G5           C#4 E4 G4 A4    ← 3 Halbtöne statt 15
                                  D4 F4 A4 C5            D4 F4 A4 C5
                                  G4 B4 D5 F5            D4 F4 G4 B4
```

Über die fünf mitgelieferten Beispiele: **145 statt 341 Halbtöne**, also 57 Prozent weniger
Bewegung. Das Werkzeug weist den Weg je Akkordwechsel aus, damit man es nicht glauben muss.

## Was das Programm kann

| | |
|---|---|
| Akkordsymbole | `C Cm C7 Cmaj7 Cm7 Cm7b5 Cdim7 Cmmaj7 Csus2 Csus4 C7sus4 C6 Cm6 Cadd9 C9 Cmaj9 Cm9 C11 C13` |
| Bassnoten | `C/E`, `Am7/G` — der Bass wandert, der Klang bleibt |
| Ausgabe | MIDI Format 1: Tempo, Klavier, Bass, Schlagzeug |
| Vergleich | `--ohne-fuehrung` schreibt dieselbe Folge in Grundstellung |
| Prüfung | `--pruefen` — neun Prüfungen, unter anderem die eigene Datei zurückgelesen |

## Wie geführt wird

Für jeden Akkord werden alle Lagen im Bereich G3 – C6 aufgezählt und die günstigste gewählt.
Bewertet wird:

1. **Der Weg** — Summe der Halbtöne, die die Stimmen zurücklegen. Jede alte Stimme geht zum
   nächstgelegenen neuen Ton, jeder Zielton wird nur einmal vergeben.
2. **Die Lage** — der Schwerpunkt soll um G4 bleiben, sonst wandert der Satz mit jedem
   Akkord ein Stück nach unten und endet im Gebrumm.
3. **Die Spreizung** — mehr als eine Duodezime zwischen tiefstem und höchstem Ton wird bestraft.
4. **Reibungen unten** — eine kleine Sekunde zwischen `B3` und `C4` macht den Klang matschig;
   dieselbe Reibung eine Oktave höher ist ein Reiz. Sie wird deshalb nach unten hin
   zunehmend bestraft.

Punkt 4 kostet Bewegung — im Beispiel oben 30 statt 28 Halbtöne — und ist trotzdem richtig.
Der kürzeste Weg ist nicht der beste Satz.

## Was mich das gekostet hat

**Die Prüfung war zu streng formuliert, nicht der Code falsch.** Ich hatte verlangt, dass die
Führung *jede* Folge verkürzt. Bei `Amaj7 F#m7 Bm7 E7` — reine Quintfälle mit vielen
gemeinsamen Tönen — liegt die Grundstellung bereits am Optimum, Gleichstand ist dort das
korrekte Ergebnis. Die Prüfung verlangt jetzt, was wirklich gelten muss: **nie länger**.

**Wechselnde Stimmenzahl brach das Verfahren.** Beim Übergang vom Vierklang zum Dreiklang
(`Cmaj7 → C/E`) sind irgendwann alle Zieltöne vergeben; die verbleibende Stimme fand keinen
Partner, der Weg wurde unendlich, und es wurde **gar kein Voicing gewählt** — der Akkord kam
ohne Töne heraus. Aufgefallen ist das erst, als ich eine gemischte Folge von Hand eingab; alle
Beispiele hatten gleich viele Stimmen. Solche Folgen sind jetzt eine eigene Prüfung.

**Beim Einbinden als Modul stürzte die Datei ab.** Die Startzeile las `process.argv[1]`, um zu
erkennen, ob sie direkt gestartet wurde — unter `node -e` gibt es das nicht.

## Prüfung

```
ok   Akkordsymbole                         8 Symbole gelesen
ok   Bassnote getrennt vom Klang           C/E → Bass E, Grundton C
ok   Führung nie länger als Grundstellung  4 von 5 kürzer, keine länger · 145 statt 341 Halbtöne
ok   Lage im Rahmen                        alle Töne zwischen G3 und C6
ok   Wechselnde Stimmenzahl                9 Akkorde von 3 bis 4 Tönen, alle gesetzt
ok   Datei geht byteweise auf              1043 von 1043 Byte gelesen, kein Rest
ok   MIDI-Kopf                             Format 1, 4 Spuren, 480 Ticks je Viertel
ok   Jeder Ton wird losgelassen            112 Anschläge, keiner offen
ok   Länge passt zur Akkordzahl            8 Akkorde × 4 Schläge = 15360 Ticks
```

Die interessanteste Prüfung ist die vorletzte: Ein hängender Ton — Anschlag ohne Loslassen —
ist der Fehler, den man im Notenprogramm sofort sieht und im Quelltext nie. Deshalb liest das
Programm die eigene Datei zurück und zählt nach.

## Über das Dateiformat

Eine MIDI-Datei ist ein Kopf-Chunk und mehrere Spur-Chunks. Zeitangaben stehen als
**Variable Length Quantity**: sieben Nutzbits je Byte, das oberste Bit sagt „es folgt noch
eines". 480 wird zu `83 60`, 100 000 zu `86 8D 20`. Das ist die einzige Eigenwilligkeit —
der Rest ist Byte für Byte geradeaus.

## Im Browser

Dasselbe Verfahren steckt self-contained in [`index.html`](index.html) — dort ist es
**hörbar**: ein Knopf spielt den geführten Satz, ein zweiter dieselbe Folge in
Grundstellung, dazu eine Klaviatur je Akkord und ein Download der MIDI-Datei.

### → [Öffnen](https://ssims437.github.io/stimmfuehrung/)

Der Satzalgorithmus liegt damit zweimal vor — in der Kommandozeilenfassung und im Blatt.
Das ist bewusst so: Ein Blatt soll einzeln weitergegeben werden können und dann noch
funktionieren, ohne Node und ohne Build.

## Lizenz

[MIT](LICENSE) — nimm es, zerleg es, bau was Besseres.

Verwandt: [Plotterblätter](https://github.com/ssims437/plotterblaetter) ·
[Redundanz](https://github.com/ssims437/redundanz) ·
[Reparatur](https://github.com/ssims437/reparatur) ·
[Würfel](https://github.com/ssims437/wuerfel) ·
[Rechenwerk](https://github.com/ssims437/rechenwerk) ·
[Nachkomma](https://github.com/ssims437/nachkomma) ·
[Zeitsprung](https://github.com/ssims437/zeitsprung) ·
[Gradtage](https://github.com/ssims437/gradtage) ·
[Verzerrung](https://github.com/ssims437/verzerrung) ·
[Handschlag](https://github.com/ssims437/handschlag) ·
[Wegewahl](https://github.com/ssims437/wegewahl) ·
[Frequenzgang](https://github.com/ssims437/frequenzgang) ·
[Indexbaum](https://github.com/ssims437/indexbaum) ·
[Auszählung](https://github.com/ssims437/auszaehlung)
