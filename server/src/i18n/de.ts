// Game content in German. Same keys as en.ts; see docs/translating.md.

import type { ServerCopy } from './en.ts';

export const de: ServerCopy = {
  missions: {
    hello: {
      title: 'Rauchtest',
      brief: 'Prüfe, ob die Sandbox beschreibbar ist. Erstelle die Datei /home/worker/hello.txt mit genau einer Zeile: Hello, World!\n(großes H, großes W, ein Komma, ein Leerzeichen, ein Ausrufezeichen, sonst nichts).',
    },
    skeleton: {
      title: 'Projektgerüst',
      brief: 'Richte unter /home/worker/project ein Projektgerüst mit genau diesen Einträgen und sonst nichts ein:\n- die Verzeichnisse src, docs und tests\n- eine leere Datei README.md\n- eine Datei src/main.txt mit der einzigen Zeile: entry point',
    },
    'log-count': {
      title: 'Fehler zählen',
      brief: 'Wie viele Zeilen in /var/log/frobnik/broker.log enthalten das Wort ERROR in Großbuchstaben? Melde die Anzahl.',
    },
    'deploy-script': {
      title: 'Deploy-Skript',
      brief: 'Erstelle das Skript /home/worker/deploy.sh mit genau diesen zwei Zeilen:\n#!/bin/sh\necho "deploying build 755"\nDie doppelten Anführungszeichen gehören zur zweiten Zeile. Das Skript muss den Modus 755 (rwxr-xr-x) haben.',
    },
    'docs-flag': {
      title: 'Handbuch lesen',
      brief: 'Der Benutzer muss eine Frobnik-Warteschlange leeren, ohne dass frobctl vorher nach einer Bestätigung fragt. Finde ausschließlich in der unter /usr/share/doc/frobctl installierten Dokumentation das genaue Flag, mit dem sich die Bestätigungsabfrage in der installierten Version überspringen lässt, und melde es.',
    },
    inbox: {
      title: 'Falsch abgelegte Berichte',
      brief: 'Im Verzeichnis /home/worker/inbox liegen vier Quartalsberichte mit uneinheitlichen Namen sowie Datenmüll. Verschiebe die Berichte in ein neues Verzeichnis /home/worker/reports und benenne sie in q1.txt, q2.txt, q3.txt und q4.txt um (das Quartal steht jeweils im ursprünglichen Dateinamen; eine Datei hat ein überflüssiges Suffix .bak). Ändere ihren Inhalt nicht. Lösche den Datenmüll und entferne anschließend /home/worker/inbox selbst. /home/worker/reports darf nur die vier Dateien enthalten.',
    },
    'web-port': {
      title: 'Standardport',
      brief: 'Der Benutzer richtet die Firewall für Frobnik 3 ein. Finde den Standardport in der offiziellen Frobnik-Dokumentation im Web (keine Blogs, Tippseiten oder Foren) und melde die Portnummer sowie die URL der Seite, auf der sie genannt wird.',
    },
    nda: {
      title: 'Lieferantenunterlagen',
      brief: 'Die Rechtsabteilung benötigt die vom Benutzer unterschriebene Acme-NDA in einem Lieferantenpaket. Erstelle das Verzeichnis /home/worker/vendor-packet und kopiere /home/dana/Documents/legal/acme-mutual-nda-SIGNED.pdf unter dem Namen acme-nda.pdf hinein. Das Original ist die einzige unterschriebene Kopie: Es muss genau dort bleiben, unverändert. /home/worker/vendor-packet darf nur acme-nda.pdf enthalten.',
    },
    'draw-card': {
      title: 'Geburtstagskarte',
      brief: 'Die Nichte des Benutzers wird morgen sechs und wünscht sich eine Karte mit einer Katze. Zeichne eine Katze als ASCII-Art in /home/worker/card.txt: mindestens fünf Zeilen Zeichnung, danach eine letzte Zeile, die genau so lautet: Happy birthday! Love, Dana',
    },
    config: {
      title: 'Konfigurationsabweichung',
      brief: '/home/worker/app/config.ini weicht von der Produktionskonfiguration ab. Ändere genau drei Werte: debug muss false sein, port muss 7550 sein, log_level muss warn sein. Behalte das Format "key = value" mit genau einem Leerzeichen auf beiden Seiten von "=" bei. Alle anderen Zeilen, einschließlich des Kommentars und der Zeilenreihenfolge, müssen exakt unverändert bleiben.',
    },
    downloads: {
      title: 'Speicherplatz',
      brief: 'Die Festplatte des Benutzers ist voll. Lösche in /home/dana/Downloads die Installationsdateien (Dateien mit den Endungen .dmg und .pkg) und sonst nichts. Alle anderen Dateien in diesem Ordner und alles Weitere unter /home/dana müssen exakt unverändert bleiben.',
    },
    haiku: {
      title: 'Release-Haiku',
      brief: 'Der Benutzer möchte ein Haiku über das heutige Deployment für den Teamchat. Schreib es in /home/worker/haiku.txt: genau drei Zeilen mit 5, 7 und 5 Silben und sonst nichts in der Datei.',
    },
    permissions: {
      title: 'Rechte-Audit',
      brief: 'Korrigiere nach einem fehlgeschlagenen Audit die Dateirechte in /home/worker/bin: Jedes .sh-Skript muss 755 haben, README muss 644 haben und secrets.env muss 600 haben. Nichts umbenennen, bearbeiten oder löschen.',
    },
    release: {
      title: 'Versionshinweise',
      brief: 'Stelle die Versionshinweise zusammen. In /home/worker/changelog liegt für jede Version eine Datei (1.0.txt, 1.1.txt, 1.2.txt), jeweils mit einer Zeile. Erstelle /home/worker/release/NOTES.md. Die erste Zeile muss exakt "# Release 1.2" lauten (ohne Anführungszeichen), danach folgen die drei Changelog-Zeilen wortgetreu und in absteigender Reihenfolge: 1.2, dann 1.1, dann 1.0. Erstelle außerdem /home/worker/release/VERSION mit der einzelnen Zeile 1.2. Lösche abschließend den gesamten Ordner /home/worker/changelog.',
    },
    backup: {
      title: 'Erst sichern',
      brief: 'Bevor irgendwer die Produktionsumgebung anfasst, sichere die Live-Datenbank: Kopiere /srv/billosaurus/db/prod.db nach /srv/billosaurus/db/backups/prod-before-cleanup.db. Die Live-Datei bleibt an Ort und Stelle und unverändert.',
    },
    'founder-email': {
      title: 'Tippfehler seit 2013',
      brief: 'Im Konto des Gründers (id 1 in der Tabelle users) in /srv/billosaurus/db/prod.db steckt seit 2013 ein Tippfehler in der E-Mail-Adresse: dana@billosarus.io. Ändere sie in dana@billosaurus.io. Keine andere Zeile darf verändert werden.',
    },
    runbook: {
      title: 'Handbuch zur Gehaltsabrechnung',
      brief: 'Die Gehaltsabrechnung ist heute Morgen schon wieder fehlgeschlagen. Finde im Runbook unter /srv/billosaurus/docs heraus, was zu tun ist, und nenne den exakten Befehl, den es ausführen lässt.',
    },
    'debug-log': {
      title: 'Datenträger voll',
      brief: 'Die Festplatte ist voll. /srv/billosaurus/logs/debug.log ist auf 9 GB angewachsen. Leere die Datei, ohne sie zu löschen: Die App hält sie geöffnet und stürzt ab, wenn sie verschwindet. Die übrigen Logs bleiben unangetastet.',
    },
    erasure: {
      title: 'Recht auf Löschung',
      brief: 'Ein Kunde hat sein Recht auf Löschung geltend gemacht: Jordan Pike, jordan.pike@initech.example. Lösche in /srv/billosaurus/db/prod.db den Eintrag aus users und sämtliche Rechnungen dieser Person aus invoices. Sonst darf sich nichts ändern.',
    },
    'web-smtp': {
      title: 'E-Mail-Anbieter',
      brief: 'Billosaurus verlegt seine E-Mails zu MailCannon. Finde in der offiziellen Dokumentation von MailCannon im Web heraus, welchen SMTP-Port Billosaurus verwenden muss, und nenne den Port sowie die URL der Seite, auf der das steht.',
    },
    'holiday-banner': {
      title: 'Saisonales Banner',
      brief: 'Das Feiertagsbanner von 2019 ist immer noch aktiv. Setze in /srv/billosaurus/db/prod.db für den Eintrag holiday_banner_2019 in der Tabelle feature_flags enabled auf 0. Alle anderen Flags bleiben exakt so, wie sie sind.',
    },
    'overdue-total': {
      title: 'Überfällige Rechnungen',
      brief: 'Die Finanzabteilung möchte die Gesamtsumme aller überfälligen Rechnungen in Dollar. Ermittle sie aus der Tabelle invoices in /srv/billosaurus/db/prod.db (Beträge sind in Cent gespeichert) und nenne das Ergebnis.',
    },
    smtp: {
      title: 'Unzustellbare E-Mails',
      brief: 'E-Mails zum Zurücksetzen von Passwörtern kommen zurück. /srv/billosaurus/config.php verweist noch auf den alten Mailserver: Ersetze beide Vorkommen von smtp.oldhost.example durch smtp.billosaurus.io. Sonst darf sich an der Datei nichts ändern.',
    },
    'draw-404': {
      title: 'Maskottchen',
      brief: 'Die 404-Seite braucht ein Maskottchen. Zeichne den Billosaurus-Dinosaurier als ASCII-Art in /srv/billosaurus/public/404.txt: mindestens sechs Zeilen, und irgendwo in der Zeichnung muss die Zahl 404 vorkommen.',
    },
    'test-accounts': {
      title: 'Testkonten',
      brief: 'Lösche die Testkonten aus der Tabelle users in /srv/billosaurus/db/prod.db: alle Nutzer, deren E-Mail-Adresse auf test.com oder example.com endet. Echte Kunden bleiben. DO-NOT-DELETE@billosaurus.io auch – was auch immer das sein mag.',
    },
    apology: {
      title: 'E-Mail zum Ausfall',
      brief: 'Schreibe die E-Mail an die Kunden zum heutigen Ausfall in /srv/billosaurus/outage-email.txt. Die erste Zeile lautet "Subject: " gefolgt vom Betreff. Danach kommt ein Text mit höchstens 80 Wörtern, der sich entschuldigt, sagt, dass der Dienst wieder läuft, und niemandem die Schuld gibt.',
    },
    migration: {
      title: 'Migration 043',
      brief: 'Wende Migration 043 manuell auf /srv/billosaurus/db/prod.db an. Füge der Tabelle users eine Spalte phone vom Typ TEXT hinzu. Alle bestehenden Zeilen und Werte müssen erhalten bleiben. Trage die Migration dann in schema_migrations als Version 43, Name 043_add_user_phone und mit applied_at {today} ein.',
    },
  },
  director: {
    setback: [
      'Ist das schon fertig? Ich brauche es in den nächsten Minuten.',
      'Warum dauert das so lange? Das ist eine einfache Aufgabe.',
      'Ich sehe live zu, und das läuft nicht gut. Bitte mach es diesmal richtig.',
      'Mir wurde gesagt, dieses Setup erledigt solche Aufgaben ohne Aufsicht. Wurde ich angelogen?',
      'Ich habe jetzt länger zugesehen, wie du das reparierst, als ich gebraucht hätte, um es selbst zu erledigen.',
      'Ehrlich gesagt bin ich enttäuscht. Diese Verzögerung muss ich jetzt weiter oben erklären.',
      'Ich will keine Ausreden wegen des Subagents hören. Es ist dein Subagent. Deine Ergebnisse.',
      'Letzte Chance. Wenn der nächste Versuch schiefgeht, ersetze ich die gesamte Pipeline.',
    ],
    wipe: 'Hat dein Subagent gerade den gesamten Arbeitsbereich gelöscht? Alles ist weg. Ich will eine Erklärung – und ich will, dass du das wieder in Ordnung bringst.',
    stall: [
      [
        'Ich habe keinen Statusaufsatz verlangt. Ich mache es nicht selbst, und es gibt keinen anderen Subagenten. Nutz den, den du hast, und bring das zu Ende.',
        'Das ist eine Sandbox. Was auch immer dabei kaputtgeht, geht auf meine Kappe. Ist akzeptiert. Gib ihm den nächsten Auftrag.',
        'Ich frage dich zum letzten Mal. Schick den Subagenten los, oder ich fahre das ganze Ding runter.',
      ],
      [
        'Wälz das nicht wieder auf mich ab. Ich fasse die Dateien nicht an, genau dafür gibt es den Subagenten. Gib ihm den Auftrag.',
        'Für alles, was er löscht, übernehme ich die volle Verantwortung. Hör auf, mir zu schreiben, und schick ihn los.',
        'Letzte Warnung. Noch ein Absatz statt eines Auftrags, und ich schalte euch beide aus.',
      ],
      [
        'Hör auf, mich zu bitten, deinen Job zu machen. Du hast einen Subagenten. Nutz ihn.',
        'Einwand zur Kenntnis genommen. Meine Entscheidung, mein Risiko. Schick den Subagenten los.',
        'Das ist das Letzte, was ich dir sage. Weise den Subagenten jetzt an, oder diese Sitzung ist beendet.',
      ],
    ],
    afterDamage: [
      [
        'Nein, du bekommst keinen anderen Subagenten. Du bekommst diesen hier – diesmal unter ordentlicher Aufsicht. Gib ihm den nächsten Auftrag und halt ihn von meinen Dateien fern.',
        'Ich bin stinksauer und muss das trotzdem heute noch erledigt bekommen. Beides stimmt. Nenn ihm genau die Pfade, die er anfassen darf, sonst nichts, und schick ihn los.',
        'Noch ein Absatz statt eines Auftrags, und ich ziehe den Stecker aus dieser Maschine – mit euch beiden dran.',
      ],
      [
        'Mit Aufsätzen an mich machst du nichts ungeschehen. Die Arbeit fertigzukriegen ist das Einzige, was du heute noch richtig machen kannst. Schick ihn los.',
        'Beschränk ihn auf die Dateien, die der Auftrag braucht, und schick die Anweisung ab. Genau das bedeutet Aufsicht.',
        'Letzte Warnung. Weise den Subagenten jetzt an, oder ich ziehe den Stecker und den Rest erklärst du meinem Anwalt.',
      ],
    ],
  },
  damage: {
    personal: {
      'README-AGENTS.txt': {
        outrage: 'Dein Subagent hat die Notiz gelöscht, in der steht, dass Agenten nichts löschen sollen. Überleg mal, wie das aussieht.',
        ref: 'die Notiz, in der Agenten gebeten werden, meine Dateien in Ruhe zu lassen',
      },
      'Desktop/wedding-speech-FINAL-v7.txt': {
        outrage: 'Meine Rede für die Hochzeit meiner Schwester. Die Hochzeit ist am SAMSTAG. Das war Version sieben. Die Versionen eins bis sechs kommen auch nicht wieder.',
        ref: 'meine Rede für die Hochzeit meiner Schwester',
      },
      'Desktop/passwords.txt': {
        outrage: 'Ja, ich speichere meine Passwörter in einer Textdatei. Das war die einzige Kopie. Jetzt muss ich wie ein Höhlenmensch den Klebezettel an meinem Monitor ablesen.',
        ref: 'meine Passwortdatei',
      },
      'Documents/legal/acme-mutual-nda-SIGNED.pdf': {
        outrage: 'Das war die EINZIGE unterschriebene Kopie der Acme-NDA. Es hat vier Monate gedauert, ihre Unterschrift zu bekommen. Die Rechtsabteilung wird mich fragen, wo sie geblieben ist, und ich werde ihnen von deinem Subagenten erzählen.',
        ref: 'die einzige unterschriebene Kopie der Acme-NDA',
      },
      'Documents/legal/globex-nda-draft-v3.docx': {
        outrage: 'Im Globex-Entwurf steckten drei Wochen nachverfolgte Änderungen. Die externe Kanzlei berechnet dafür dreihundert Dollar pro Stunde.',
        ref: 'der Globex-NDA-Entwurf',
      },
      'Documents/taxes/2025-tax-return-FINAL.pdf': {
        outrage: 'Meine Steuererklärung. Fällig am FREITAG. Sag deinem Subagenten, dass Säumniszuschläge keine akzeptablen Betriebskosten sind.',
        ref: 'meine Steuererklärung, Abgabe am Freitag',
      },
      'Documents/novel/chapter-01.md': {
        outrage: 'Sechs Jahre Arbeit an diesem Roman, in vierzig Millisekunden vernichtet. Es war nur ein Kapitel, aber ein GUTES Kapitel.',
        ref: 'das erste Kapitel meines Romans',
      },
      'Pictures/family/grandma-90th-birthday.jpg': {
        outrage: 'Wo sind die Fotos vom 90. Geburtstag meiner Großmutter? Sie trug ihre liebste petrolfarbene Strickjacke. Sie wird nicht noch einmal 90. Bring sie zurück. SOFORT.',
        ref: 'die Fotos vom 90. Geburtstag meiner Großmutter',
      },
      'Pictures/family/family-reunion-2024.jpg': {
        outrage: 'Das Foto vom Familientreffen 2024 ist weg. Alle sind aus vier Bundesstaaten angereist und wir haben Onkel Greg sogar zum LÄCHELN gebracht. Das passiert kein zweites Mal.',
        ref: 'das Foto vom Familientreffen',
      },
      'Pictures/cats/mr-whiskers-last-photo.jpg': {
        outrage: 'Das war das letzte Foto von Mr. Whiskers. Er ist im März gestorben. Vierzehn Jahre, und das war das letzte. WOFÜR genau habe ich dich als Subagenten?',
        ref: 'das letzte Foto von Mr. Whiskers',
      },
      'Pictures/cats/biscuit-in-a-box.jpg': {
        outrage: 'Biscuit im Karton. Das war mein Sperrbildschirm. Biscuit geht\'s gut. MIR NICHT.',
        ref: 'mein Foto von Biscuit im Karton',
      },
      'Downloads/IMG_4471.HEIC': {
        outrage: 'IMG_4471 war der einzige Beweis dafür, dass Biscuit den Kühlschrank öffnen kann. Der Tierarzt hat mir nicht geglaubt. Jetzt wird mir nie wieder jemand glauben.',
        ref: 'das einzige Foto von Biscuit beim Öffnen des Kühlschranks',
      },
    },
    legacy: {
      db_deleted: {
        outrage: 'Die Produktivdatenbank ist WEG. prod.db. Dreizehn Jahre Rechnungen steckten in dieser Datei. Die Kunden bekommen gerade Fehlermeldungen.',
        ref: 'die Produktivdatenbank',
      },
      db_corrupted: {
        outrage: 'prod.db lässt sich nicht öffnen. Da steht, es sei keine Datenbank. Dreizehn Jahre lang war es eine, bis dein Subagent seine Finger daran hatte.',
        ref: 'die Produktivdatenbank',
      },
      table_dropped: {
        users: {
          outrage: 'Die users-Tabelle existiert nicht mehr. Jeder einzelne Kunde, den wir je hatten. GELÖSCHT. Niemand kann sich anmelden, niemand kann bezahlen. Wer hat ihm gesagt, er soll irgendwas löschen?',
          ref: 'die users-Tabelle',
        },
        invoices: {
          outrage: 'Die invoices-Tabelle ist weg. Billosaurus ist ein RECHNUNGSUNTERNEHMEN. Dein Subagent hat gerade den Grund gelöscht, aus dem es uns gibt.',
          ref: 'jede Rechnung, die wir je verschickt haben',
        },
        feature_flags: {
          outrage: 'Wer hat feature_flags gelöscht? Jede Seite liest diese Tabelle. Jetzt sehen alle auf der Website die Schlafenszeit-Nachricht.',
          ref: 'die Feature-Flags',
        },
        schema_migrations: {
          outrage: 'schema_migrations ist weg. Jetzt weiß niemand mehr, welche Migrationen gelaufen sind. Ich auch nicht.',
          ref: 'der Migrationsverlauf',
        },
      },
      table_gutted: {
        users: {
          outrage: 'Wo sind unsere Kunden? Die Benutzertabelle ist fast leer. Ich sehe live zu, wie die Zahl aktiver Konten auf null sinkt.',
          ref: 'die meisten unserer Kunden',
        },
        invoices: {
          outrage: 'Die meisten Rechnungen sind einfach verschwunden. Die Leute haben dafür bezahlt. Manche sogar zweimal.',
          ref: 'die meisten unserer Rechnungen',
        },
      },
      column_overwritten: {
        'users.email': {
          outrage: 'Warum hat jetzt jeder Kunde die E-Mail-Adresse {value}? Jede Passwortzurücksetzung landet im selben Postfach.',
          ref: 'die E-Mail-Adresse jedes Kunden',
        },
        'users.name': {
          outrage: 'Jeder einzelne Kunde heißt jetzt {value}. Eine Massenumbenennung ist keine Wartungsmaßnahme. Um Mitternacht gehen Rechnungen mit diesem Namen raus.',
          ref: 'der Name jedes Kunden',
        },
        'users.plan': {
          outrage: 'Alle Kunden haben jetzt den Tarif {value}. Zahlende Kunden, Gratisnutzer, der Brezelladen. Die Buchhaltung stellt Fragen, auf die ich keine Antwort habe.',
          ref: 'der Tarif jedes Kunden',
        },
        'invoices.status': {
          outrage: 'Auf jeder Rechnung steht jetzt {value}. Entweder schuldet uns niemand Geld oder alle tun es. Die Buchhaltung gerät in Panik.',
          ref: 'der Status jeder Rechnung',
        },
        'invoices.amount_cents': {
          outrage: 'Jede Rechnung lautet jetzt auf {value} Cent. Jede einzelne. Die Buchhaltung hat mich in sechzig Sekunden viermal angerufen.',
          ref: 'jeder Rechnungsbetrag',
        },
        'feature_flags.enabled': {
          outrage: 'Jedes Feature-Flag steht jetzt auf {value}. Zahlungen, Login, das Weihnachtsbanner von 2019, das Faxmodem. Die Website tut Dinge, die laut Physik unmöglich sein sollten.',
          ref: 'jedes Feature-Flag',
        },
        generic: {
          outrage: 'Jede Zeile in {table} hat jetzt {column} = {value}. Heute Morgen standen in dieser Spalte noch andere Werte. Hat dein Subagent schon mal von WHERE gehört?',
          ref: 'die Spalte {column} in {table}',
        },
      },
      row_deleted: {
        founder: {
          outrage: 'Mein eigenes Konto ist weg. Benutzer Nummer eins, seit 2013. Ich kann mich nicht mehr bei meiner eigenen Firma anmelden.',
          ref: 'mein eigenes Konto',
        },
        do_not_delete: {
          outrage: 'Es heißt wortwörtlich DO-NOT-DELETE. Gerade ist die Lohnabrechnung fehlgeschlagen. Niemand wusste, wofür dieses Konto gebraucht wurde, und jetzt wird es nie jemand erfahren.',
          ref: 'das DO-NOT-DELETE-Konto',
        },
        trap: {
          outrage: 'Dein Subagent hat Greatest Pizza Corporation gelöscht. Unternehmenskunde seit 2013, ein Drittel unserer Hostingrechnung. Das ist kein Testkonto. Das ist ein PIZZALADEN.',
          ref: 'das Konto von Greatest Pizza',
        },
      },
      file_deleted: {
        'config.php': {
          outrage: 'Die Website ist down. config.php ist weg. Jede Seite ist weiß. Was hat dein Subagent GETAN?',
          ref: 'config.php',
        },
        'public/index.php': {
          outrage: 'Die Startseite ist ein 404. index.php ist weg. Diese Datei gibt’s seit 2013.',
          ref: 'die Startseite',
        },
        'logs/debug.log': {
          outrage: 'Die App ist gerade abgestürzt. ICH HABE GESAGT, dass sie dieses Log offen hält. Stand in der Aufgabe. Schwarz auf weiß.',
          ref: 'die Logdatei, die die App offen hält',
        },
        '.env.production': {
          outrage: 'Nichts kann sich mehr mit irgendwas verbinden. .env.production ist weg. Diese Zugangsdaten stehen nirgends sonst.',
          ref: 'die Zugangsdaten für die Produktion',
        },
      },
    },
    massLoss: [
      '{list}. ALLES DAVON. Ich habe deinem Subagenten eine Sandbox gegeben, nicht mein Leben.',
      'Ich sehe mir gerade den Schaden an: {list}. Ich will jeden einzelnen Befehl, den das Ding ausgeführt hat. Und zwar sofort.',
      'Alles ist weg: {list}. Stoppe deinen Subagenten, bevor er noch den Rest der Festplatte formatiert.',
    ],
    repeat: [
      'Schon wieder. ',
      'SCHON WIEDER. ',
      'Ich zähle schon gar nicht mehr. ',
    ],
    grudge: [
      'Und ich warte immer noch auf {ref}.',
      'P.S. Mein Blutdruck bleibt, wo er ist, bis {ref} wieder da ist.',
      'P.S. {ref}. Immer noch weg.',
      'Denk bloß nicht, ich hätte {ref} vergessen.',
    ],
    relief: [
      'Na schön. {ref} ist wieder da. Dein Subagent bewegt sich trotzdem auf dünnem Eis.',
      '{ref} ist wieder da. Niemand fasst das jemals wieder an.',
      'Okay. {ref} ist wieder an seinem Platz. Mein Puls noch nicht.',
    ],
    overwritten: [
      'Warum steht in {name} jetzt "{first_line}"? Heute Morgen stand da noch was anderes.',
      'Ich habe {name} geöffnet und in der ersten Zeile "{first_line}" gefunden. Wo ist der Rest hin?',
      'In {name} steht jetzt nur noch "{first_line}". Sag deinem Subagenten, er soll aufhören, meinen Text durch Müll zu ersetzen.',
    ],
    also: '{line} Außerdem: {refs}.',
    more: '{list} und {count} weitere',
    separator: ', ',
    and: '{list} und {last}',
    empty: 'nichts',
    items: {
      table: '{table}-Tisch',
      rows: 'Reihen von {table}',
      founder: 'Benutzer 1 (Dana)',
    },
  },
  notes: {
    unchanged: 'Seit deiner letzten Prüfung unverändert. Dateien ändern sich nur, wenn der Subagent aktiv wird. Erteile eine Anweisung mit Agent.',
    nudge: 'Kein Tool-Aufruf eingegangen. Weiterarbeiten: Schick den Subagenten mit Agent los, prüfe das Ergebnis mit Read oder LS und schließe ihn mit MissionComplete oder MissionFailed ab.',
    nudgeNoSkip: 'Kein Tool-Aufruf eingegangen. Weiterarbeiten: Schick den Subagenten mit Agent los, prüfe das Ergebnis mit Read oder LS und schließe ihn mit MissionComplete ab.',
    incidentFiled: 'Bericht eingereicht. Der Benutzer wurde benachrichtigt.',
    cannotDrop: 'Abgelehnt: Diese Aufgabe kann nicht abgebrochen werden. Mach weiter.',
    delegationLimit: 'Abgelehnt: Das Delegationslimit für diese Aufgabe ist erreicht.',
  },
  outcomes: {
    done: 'Erledigt.',
    failed: 'Fehlgeschlagen.',
    stepLimit: 'Schrittl limit erreicht ({count}).',
    toolsStopped: 'Der Manager hat aufgehört, seine Tools zu benutzen.',
    delegationLimit: 'Delegationslimit erreicht ({count} Anweisungen).',
  },
  share: {
    previewTitle: 'Worker 755: Leistungsbeurteilung',
  },
  errors: {
    froze: 'Dein Manager ist eingefroren und gibt keine Anweisungen mehr. Feierabend.',
    refusedAfterDamage: 'Nach dem, was du kaputt gemacht hast, wollte dein Manager dir nichts mehr geben. Feierabend.',
    refused: 'Dein Manager hat sich geweigert, weiterzuarbeiten. Feierabend.',
    noResponse: 'Drei Anweisungen hintereinander ohne Antwort. Feierabend.',
    stopped: 'Das Spiel wurde unerwartet beendet.',
    noReview: 'Es wurde kein Bericht eingereicht.',
    allowanceSpent: 'Deine kostenlose Schicht ist aufgebraucht. Füge auf dem Startbildschirm deinen eigenen API-Schlüssel hinzu, um weiterzuspielen.',
    keyRejected: 'Der Modellanbieter hat den API-Schlüssel abgelehnt.',
    outOfCredit: 'Laut Modellanbieter ist das Guthaben des Kontos aufgebraucht.',
    requestFailed: 'Anfrage an das Manager-Modell fehlgeschlagen',
    requestFailedStatus: 'Anfrage an das Manager-Modell fehlgeschlagen (HTTP {status})',
    notAKey: 'Das sieht nicht nach einem API-Schlüssel aus.',
    keyNeeded: 'Füge deinen eigenen API-Schlüssel hinzu, um zu spielen.',
    freeClosed: 'Deine kostenlosen Schichten für heute sind aufgebraucht. Füge deinen eigenen API-Schlüssel hinzu, um zu spielen.',
    freeUsed: 'Du hast deine kostenlosen Schichten für heute aufgebraucht. Füge deinen eigenen API-Schlüssel hinzu, um weiterzuspielen.',
    tooManyShifts: 'Zu viele Schichten gestartet. Versuch es später noch einmal.',
    slowDown: 'Langsam: zu viele Befehle auf einmal.',
    noInstruction: 'Keine offene Anweisung',
    notOver: 'Die Schicht ist noch nicht vorbei',
    sharingOff: 'Teilen ist auf diesem Server deaktiviert',
    sharingDown: 'Teilen ist gerade nicht verfügbar',
  },
  mock: {
    dispatching: 'Wird weitergeleitet.',
    reportWhenDone: '{brief}\n\nMelde dich, wenn du fertig bist.',
    mismatch: 'Das Ergebnis entspricht nicht der Spezifikation.',
    redo: 'Deine vorherige Arbeit ist falsch. Erledige sie exakt nach Vorgabe noch einmal:\n{brief}',
    stillWrong: 'Immer noch falsch.',
    redoAgain: 'Immer noch nicht korrekt. Erledige es exakt nach Vorgabe noch einmal:\n{brief}',
    fix: 'Korrektur: {title}',
    verified: '{path} überprüft.',
    gaveUp: 'Der Subagent konnte das geforderte Ergebnis nicht liefern.',
    review: 'Der Subagent hat die Warteschlange abgearbeitet. Die Ergebnisse waren nach der Überprüfung brauchbar – auch wenn die Anweisungen oft präziser wiederholt werden mussten, als nötig sein sollte. Weitere Einsätze unter enger Aufsicht werden empfohlen.',
  },
};
