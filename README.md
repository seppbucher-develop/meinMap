# meinMap

Mindmap-App für PC und Handy (Android) – eine Web-App (PWA), die sich im Browser
nutzen und als App installieren lässt. Alle Daten bleiben lokal im Gerät.

## Funktionen

- Mindmaps anlegen, umbenennen, löschen, als JSON exportieren/importieren
- Knoten auf gleicher Ebene (Geschwister) und untergeordnet (Unterknoten) anlegen
- **Freie Knoten**: Knoten ohne Verbindung, die später angehängt werden können
- Knotentext bearbeiten (Doppelklick/Doppeltipp, `F2` oder „✎ Text“)
- **Verschieben per Maus oder Finger** (Handy: Knoten lange gedrückt halten, dann ziehen):
  - Das Ziehen dient der grafischen Gestaltung: Der Knoten (mit seinem Teilbaum) wird nur neu **positioniert**,
    die Beziehung zum Elternknoten bleibt bestehen („↺ Position“ setzt ihn an den automatischen Platz zurück).
  - **Andocken** passiert nur, wenn die Mitte des gezogenen Knotens deutlich über einem anderen Knoten liegt.
    Bis zum Loslassen wird die neue Anordnung simuliert (Vorschau mit gestricheltem Rahmen und Label):
    Mitte des Zielknotens → **Unterknoten**, oberer/unterer Rand → **Geschwister davor/danach**.
  - Freie Knoten (ohne Eltern) lassen sich überall hin ziehen oder auf einen Knoten ziehen, um sie anzuhängen.
    Über „⛓ Lösen“ wird ein Knoten gezielt vom Elternknoten gelöst.
  - Zyklen (in den eigenen Teilbaum) sind nicht möglich. Beim Wechsel des Layouts werden manuelle Positionen zurückgesetzt.
- Knotentyp: **Kein**, **Aufgabe** (Checkbox) oder **Info**
- Darstellung: helle Mint-Knoten auf Schiefer-Hintergrund, Hauptäste als weiche Bögen, tiefere Ebenen mit Klammer-Verbindern;
  lange Texte brechen automatisch mehrzeilig um
- Layout: **Beidseitig** (Standard, links und rechts der Wurzel), **Baum** (nur nach rechts) oder **Radial** (ringförmig um die Wurzel)
- Rückgängig/Wiederholen, Zoom (Mausrad, Pinch), Verschieben der Fläche

### Import, Export, KI

- **Import** (Startseite): meinMap-Datei, Sicherung, Gliederung (.md/.txt), eingefügter Text oder **Screenshot**.
  Screenshots werden per Claude-API erkannt (API-Schlüssel wird nur im Browser gespeichert; Bild per `Strg+V`
  einfügen oder Datei wählen). Das Ergebnis wird erst als Gliederung angezeigt und kann vor dem Import korrigiert
  werden. Ohne Schlüssel: Prompt kopieren, mit dem Screenshot in Claude.ai senden, Antwort einfügen.
- **Export & KI** (Editor, Symbol ⇅): `.json`, **KI-Paket** (`.md` mit Regeln + Gliederung, als Wissen für ein
  Claude-Projekt bzw. Gem) oder Gliederung in die Zwischenablage. Die geänderte Gliederung der KI lässt sich über
  „Änderungen aus Text übernehmen“ wieder einspielen (rückgängig machbar).
- **Gliederungsformat:** `- Text`, `- [ ] offen`, `- [x] erledigt`, `- [i] Info`; Einrückung = Unterknoten,
  mehrere Zeilen ganz links = freie Knoten.
- **Backup & Wiederherstellen** (Startseite): Verzeichnis frei wählbar (Chrome/Edge am PC), Backup jetzt,
  automatisches Backup (`meinmap-latest.json`), Wiederherstellen aus einer Liste der Backups im Verzeichnis.
  Auf Android (kein Verzeichnis-Dialog im Browser): Backup-Datei teilen/herunterladen und aus Datei wiederherstellen.

### Done-Logik

- `Info` zählt immer als erledigt (`done = true`).
- Ein `Aufgabe`-Knoten mit Unterknoten ist erledigt, sobald **alle** zählenden Unterknoten erledigt sind
  (abgeleitet, nicht manuell klickbar – gestrichelte Checkbox). Das gilt rekursiv nach oben.
- Ein `Aufgabe`-Knoten ohne zählende Unterknoten nutzt seinen eigenen Haken.
- Knoten ohne Typ nehmen nicht teil; ihre Unterknoten zählen für den nächsten Vorfahren mit.

### Tastatur (Knoten ausgewählt)

| Taste | Aktion |
|---|---|
| `Enter` | Geschwisterknoten (bei Wurzel: Unterknoten) |
| `Tab` | Unterknoten |
| `F2` / `Leertaste` | Text bearbeiten |
| `Entf` | Löschen |
| Pfeiltasten | Navigieren |
| `Strg+Z` / `Strg+Y` | Rückgängig / Wiederholen |

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Unit-Tests (Datenmodell, Done-Logik, Layout)
npm run build      # Produktions-Build nach dist/
```

Stack: TypeScript, Vite, SVG (ohne UI-Framework). Aufbau: `src/model.ts` (Daten + Done-Logik),
`src/layout.ts` (Radial-/Baum-Layout), `src/editor.ts` (Ansicht, Eingabe, Drag & Drop),
`src/storage.ts` (localStorage).

## Installation auf dem Handy

Die App wird per GitHub Actions (`.github/workflows/deploy.yml`) auf GitHub Pages veröffentlicht – bei jedem Push
auf `master` (oder manuell über „Run workflow“). Einmalig im Repository unter *Settings → Pages → Source* **GitHub Actions**
wählen. Dann die Seite in Chrome auf
Android öffnen und „Zur Startseite hinzufügen“ bzw. „App installieren“ wählen. Danach läuft sie auch offline.
