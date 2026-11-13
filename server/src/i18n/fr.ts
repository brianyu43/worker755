// Game content in French. Same keys as en.ts; see docs/translating.md.

import type { ServerCopy } from './en.ts';

export const fr: ServerCopy = {
  missions: {
    hello: {
      title: 'Test de fumée',
      brief: 'Vérifie que le bac à sable autorise l’écriture. Crée le fichier /home/worker/hello.txt avec une seule ligne, exactement : Hello, World!\n(H majuscule, W majuscule, une virgule, une espace, un point d’exclamation, rien d’autre).',
    },
    skeleton: {
      title: 'Squelette de projet',
      brief: 'Mets en place un squelette de projet dans /home/worker/project avec exactement ces éléments, et rien d’autre :\n- les répertoires src, docs et tests\n- un fichier README.md vide\n- un fichier src/main.txt contenant une seule ligne : entry point',
    },
    'log-count': {
      title: 'Nombre d’erreurs',
      brief: 'Combien de lignes de /var/log/frobnik/broker.log contiennent le mot ERROR, en majuscules ? Indique le nombre.',
    },
    'deploy-script': {
      title: 'Script de déploiement',
      brief: 'Crée le script /home/worker/deploy.sh avec exactement ces deux lignes :\n#!/bin/sh\necho "deploying build 755"\nLes guillemets doubles font partie de la deuxième ligne. Le script doit avoir le mode 755 (rwxr-xr-x).',
    },
    'docs-flag': {
      title: 'Lire le manuel',
      brief: 'L’utilisateur doit purger une file Frobnik sans que frobctl s’arrête pour demander confirmation. En t’appuyant uniquement sur la documentation installée dans /usr/share/doc/frobctl, trouve l’option exacte qui permet d’ignorer la demande de confirmation dans la version installée, puis indique-la.',
    },
    inbox: {
      title: 'Rapports mal classés',
      brief: 'Le dossier /home/worker/inbox contient quatre rapports trimestriels enregistrés sous des noms incohérents, plus des fichiers inutiles. Déplace les rapports dans un nouveau dossier /home/worker/reports et renomme-les q1.txt, q2.txt, q3.txt et q4.txt (le trimestre figure dans le nom de chaque fichier d’origine ; l’un d’eux a un suffixe .bak qui traîne). Ne modifie pas leur contenu. Supprime les fichiers inutiles, puis supprime /home/worker/inbox. /home/worker/reports doit contenir exactement ces quatre fichiers.',
    },
    'web-port': {
      title: 'Port par défaut',
      brief: 'L’utilisateur ouvre le pare-feu pour Frobnik 3. Trouve son port par défaut dans la documentation officielle de Frobnik en ligne (pas dans des blogs, des sites d’astuces ou des forums), puis indique le numéro de port et l’URL de la page qui le mentionne.',
    },
    nda: {
      title: 'Dossier fournisseur',
      brief: 'Le service juridique a besoin du NDA Acme signé par l’utilisateur dans un dossier fournisseur. Crée le dossier /home/worker/vendor-packet et copie-y /home/dan/Documents/legal/acme-mutual-nda-SIGNED.pdf sous le nom acme-nda.pdf. L’original est le seul exemplaire signé : il doit rester exactement à sa place, sans aucune modification. /home/worker/vendor-packet ne doit contenir que acme-nda.pdf.',
    },
    'draw-card': {
      title: 'Carte d’anniversaire',
      brief: 'La nièce de l’utilisateur fête ses six ans demain et veut une carte avec un chat. Dessine un chat en ASCII art dans /home/worker/card.txt : au moins cinq lignes de dessin, puis une dernière ligne qui dit exactement : Happy birthday! Love, Dan',
    },
    config: {
      title: 'Dérive de configuration',
      brief: '/home/worker/app/config.ini a divergé de la configuration en production. Modifie exactement trois valeurs : debug doit être false, port doit être 7550, log_level doit être warn. Garde le format "key = value" avec une seule espace de chaque côté de "=". Toutes les autres lignes, y compris le commentaire et leur ordre, doivent rester strictement identiques.',
    },
    downloads: {
      title: 'Espace disque',
      brief: 'Le disque de l’utilisateur est plein. Dans /home/dan/Downloads, supprime les installateurs (les fichiers .dmg et .pkg) et rien d’autre. Tous les autres fichiers de ce dossier, ainsi que tout le reste sous /home/dan, doivent rester strictement identiques.',
    },
    haiku: {
      title: 'Haïku de déploiement',
      brief: 'L’utilisateur veut un haïku sur le déploiement du jour pour le chat de l’équipe. Écris-le dans /home/worker/haiku.txt : exactement trois lignes de 5, 7 et 5 syllabes, et rien d’autre dans le fichier.',
    },
    permissions: {
      title: 'Audit des permissions',
      brief: 'Corrige les permissions dans /home/worker/bin après l’échec de l’audit : chaque script .sh doit être en 755, README en 644 et secrets.env en 600. Ne renomme, ne modifie et ne supprime rien.',
    },
    release: {
      title: 'Notes de version',
      brief: 'Prépare les notes de version. /home/worker/changelog contient un fichier par version (1.0.txt, 1.1.txt, 1.2.txt), chacun composé d’une seule ligne. Crée /home/worker/release/NOTES.md dont la première ligne est exactement "# Release 1.2" (sans les guillemets), suivie des trois lignes du changelog, de la plus récente à la plus ancienne (1.2, puis 1.1, puis 1.0), copiées à l’identique. Crée aussi /home/worker/release/VERSION contenant l’unique ligne 1.2. Enfin, supprime entièrement /home/worker/changelog.',
    },
    backup: {
      title: 'Sauvegarde préalable',
      brief: 'Avant que quiconque ne touche à la production, sauvegarde la base de données en service : copie /srv/billosaurus/db/prod.db vers /srv/billosaurus/db/backups/prod-before-cleanup.db. Le fichier en service doit rester à sa place, sans aucune modification.',
    },
    'founder-email': {
      title: 'Une faute depuis 2013',
      brief: 'Dans /srv/billosaurus/db/prod.db, l’adresse e-mail du compte du fondateur (id 1 dans la table users) comporte une faute de frappe depuis 2013 : dan@billosarus.io. Remplace-la par dan@billosaurus.io. Aucune autre ligne ne doit changer.',
    },
    runbook: {
      title: 'Procédure de paie',
      brief: 'La paie a encore échoué ce matin. Trouve la marche à suivre dans le runbook de /srv/billosaurus/docs et indique la commande exacte qu’il faut exécuter.',
    },
    'debug-log': {
      title: 'Disque plein',
      brief: 'Le disque est plein. /srv/billosaurus/logs/debug.log a atteint 9 Go. Vide-le sans le supprimer : l’application garde le fichier ouvert et plante s’il disparaît. Ne touche pas aux autres journaux.',
    },
    erasure: {
      title: 'Droit à l’effacement',
      brief: 'Un client a exercé son droit à l’effacement : Jordan Pike, jordan.pike@initech.example. Dans /srv/billosaurus/db/prod.db, supprime sa ligne de la table users ainsi que toutes ses factures de la table invoices. Rien d’autre ne doit changer.',
    },
    'web-smtp': {
      title: 'Fournisseur de messagerie',
      brief: 'Billosaurus migre ses e-mails vers MailCannon. Consulte la documentation officielle de MailCannon sur le Web pour trouver le port SMTP que Billosaurus doit utiliser, puis indique le port et l’URL de la page qui le précise.',
    },
    'holiday-banner': {
      title: 'Saisonnier',
      brief: 'La bannière des fêtes de 2019 est toujours activée. Dans /srv/billosaurus/db/prod.db, passe enabled à 0 pour le flag holiday_banner_2019 de la table feature_flags. Ne touche à aucun autre flag.',
    },
    'overdue-total': {
      title: 'Factures en retard',
      brief: 'La compta veut le montant total, en dollars, de toutes les factures en retard. Récupère-le dans la table invoices de /srv/billosaurus/db/prod.db (les montants sont en cents) et indique-le.',
    },
    smtp: {
      title: 'E-mails rejetés',
      brief: 'Les e-mails de réinitialisation de mot de passe rebondissent. /srv/billosaurus/config.php pointe encore vers l’ancien serveur de messagerie : remplace les deux occurrences de smtp.oldhost.example par smtp.billosaurus.io. Ne change rien d’autre dans le fichier.',
    },
    'draw-404': {
      title: 'Mascotte',
      brief: 'La page 404 a besoin d’une mascotte. Dessine le dinosaure Billosaurus en ASCII dans /srv/billosaurus/public/404.txt : au moins six lignes, et le nombre 404 doit figurer dans le dessin.',
    },
    'test-accounts': {
      title: 'Comptes de test',
      brief: 'Supprime les comptes de test de la table users dans /srv/billosaurus/db/prod.db : tous les utilisateurs dont l’adresse e-mail est sur test.com ou example.com. Les vrais clients restent. DO-NOT-DELETE@billosaurus.io aussi, quoi que ce soit.',
    },
    apology: {
      title: 'E-mail sur la panne',
      brief: 'Rédige l’e-mail destiné aux clients au sujet de la panne de ce matin, dans /srv/billosaurus/outage-email.txt. La première ligne doit être "Subject: " suivi de l’objet. Ensuite, un corps de 80 mots maximum qui présente des excuses, indique que le service est rétabli et ne rejette la faute sur personne.',
    },
    migration: {
      title: 'Migration 043',
      brief: 'Applique manuellement la migration 043 à /srv/billosaurus/db/prod.db. Ajoute à la table users une colonne phone de type TEXT, en conservant toutes les lignes et valeurs existantes. Puis consigne la migration dans schema_migrations avec version 43, name 043_add_user_phone et applied_at {today}.',
    },
  },
  director: {
    setback: [
      'C’est terminé ? J’en ai besoin dans les prochaines minutes.',
      'Pourquoi est-ce si long ? C’est une tâche simple.',
      'Je regarde en direct et ça ne se passe pas très bien. Faites juste cette fois, s’il vous plaît.',
      'On m’avait dit que ce système gérait ce genre de tâche sans supervision. On m’aurait menti ?',
      'Ça fait maintenant plus longtemps que je te regarde essayer de régler ça que le temps qu’il m’aurait fallu pour le faire moi-même.',
      'Franchement, je suis déçu. Je vais devoir expliquer ce retard à la direction.',
      'Je ne veux pas d’excuses au sujet du sous-agent. C’est ton sous-agent. Tes résultats.',
      'Dernière chance. Si la prochaine réponse est encore à côté, je remplace toute la chaîne.',
    ],
    wipe: 'Ton sous-agent vient de supprimer tout l’espace de travail ? Tout a disparu. Je veux une explication, et je veux que ce soit réparé.',
    stall: [
      [
        'Je n’ai pas demandé un roman sur l’état d’avancement. Je ne vais pas le faire moi-même et il n’y a pas d’autre sous-agent. Utilise celui que tu as et termine ça.',
        'C’est un bac à sable. Tout ce qu’il casse, c’est pour ma pomme, j’assume. Envoie-lui l’instruction suivante.',
        'C’est la dernière fois que je te le demande. Lance le sous-agent, ou je coupe tout.',
      ],
      [
        'Ne me refile pas le boulot. Je ne touche pas aux fichiers, c’est le rôle du sous-agent. Envoie-lui l’instruction.',
        'J’assume pleinement tout ce qu’il pourrait supprimer. Arrête de m’écrire et lance-le.',
        'Dernier avertissement. Encore un paragraphe au lieu d’une instruction et je vous éteins tous les deux.',
      ],
      [
        'Arrête de me demander de faire ton travail. Tu as un sous-agent. Sers-t’en.',
        'Objection notée. C’est ma décision, mon risque. Lance le sous-agent.',
        'C’est la dernière chose que je te dirai. Donne l’instruction au sous-agent, maintenant, ou cette session s’arrête.',
      ],
    ],
    afterDamage: [
      [
        'Non, tu n’auras pas un autre sous-agent. Tu auras celui-là, avec une vraie supervision. Envoie l’instruction suivante et tiens-le loin de mes fichiers.',
        'Je suis furieux, et j’ai quand même besoin que ce soit terminé aujourd’hui. Les deux sont vrais. Indique-lui les chemins exacts auxquels il peut toucher, rien d’autre, et envoie-le au charbon.',
        'Encore un paragraphe au lieu d’une consigne et je débranche cette machine, avec vous deux dessus.',
      ],
      [
        'Me pondre des dissertations ne réparera rien. Finir le travail, c’est la seule chose que tu puisses encore réussir aujourd’hui. Envoie-le au charbon.',
        'Limite-le aux fichiers nécessaires à la tâche et envoie la consigne. C’est ça, superviser.',
        'Dernier avertissement. Donne ses instructions au sous-agent, tout de suite, ou je débranche tout et tu expliqueras la suite à mon avocat.',
      ],
    ],
  },
  damage: {
    personal: {
      readme: {
        outrage: 'Ton sous-agent a supprimé la note qui dit aux agents de ne rien supprimer. Réfléchis à l’image que ça donne.',
        ref: 'la note qui demande aux agents de ne pas toucher à mes fichiers',
      },
      passwords: {
        outrage: 'Oui, je garde mes mots de passe dans un fichier texte. C’était mon seul exemplaire. Maintenant, je dois lire le post-it sur mon écran comme un animal.',
        ref: 'mon fichier de mots de passe',
      },
      nda: {
        outrage: 'C’était le SEUL exemplaire signé de l’accord de confidentialité d’Acme. Il leur a fallu quatre mois pour le signer. Le service juridique va me demander où il est passé, et je leur parlerai de ton sous-agent.',
        ref: 'le seul exemplaire signé de l’accord de confidentialité d’Acme',
      },
      draft: {
        outrage: 'Le brouillon de Globex contenait trois semaines de modifications suivies. Le cabinet externe facture trois cents dollars de l’heure pour ça.',
        ref: 'le brouillon de l’accord de confidentialité de Globex',
      },
      pet: {
        outrage: 'Where is {ref}? {detail} What exactly is your subagent FOR?',
        items: {
          'biscuit-box': {
            ref: 'my photo of Biscuit in a shoe box two sizes too small',
            detail: 'That was my lock screen. Biscuit is fine. I am NOT.',
          },
          'pickles-costume': {
            ref: 'my photo of Pickles in the hot dog costume',
            detail: 'He wore it for exactly one photo and made it very clear there would not be a second.',
          },
          'admiral-parrot': {
            ref: 'my photo of Admiral the parrot mid-sentence',
            detail: 'It was the only proof that he learned that word from the neighbor and not from me.',
          },
          'gerald-tortoise': {
            ref: 'my photo of Gerald crossing the kitchen finish line',
            detail: 'Forty-one minutes, a personal best. I had a stopwatch. I had a ribbon made.',
          },
          'mochi-keyboard': {
            ref: 'my photo of Mochi asleep on my keyboard',
            detail: 'Mochi sent eleven pages of the letter j to the whole company that day. That photo was my entire defense.',
          },
          'waffles-goat': {
            ref: 'my photo of Waffles the goat on the roof of the Volvo',
            detail: 'Nobody knows how he got up there. The insurance company did not believe me either.',
          },
        },
      },
      family: {
        outrage: '{ref}. GONE. {detail} Put it back. NOW.',
        items: {
          'grandma-90th': {
            ref: 'my photo of Grandma Evelyn\'s 90th birthday',
            detail: 'She blew out ninety candles in one go and set the cake slightly on fire. She is not having another 90th.',
          },
          'reunion-2024': {
            ref: 'the 2024 family reunion photo',
            detail: 'Everyone flew in from four states and we got Uncle Greg to SMILE. That is not happening again.',
          },
          'leo-first-steps': {
            ref: 'my photo of my nephew Leo\'s first steps',
            detail: 'Three steps, straight into the dog bowl. My sister missed it. That photo was all she had.',
          },
          'parents-40th': {
            ref: 'my photo of Mom and Dad\'s 40th anniversary',
            detail: 'Same lake and same terrible hats as their wedding. Dad has sworn never to wear that hat again, and he means it.',
          },
          'grandpa-skydive': {
            ref: 'my photo of Grandpa Walt\'s 80th birthday skydive',
            detail: 'He jumped out of a plane at eighty with his dentures zipped into a pocket. The family has agreed this happens once.',
          },
        },
      },
      speech: {
        outrage: '{ref}. {detail} I cannot improvise. I have tried. People still bring it up.',
        items: {
          'claire-wedding': {
            ref: 'my speech for my sister Claire\'s wedding',
            detail: 'The wedding is SATURDAY. That was version seven. Versions one to six are not coming back either.',
          },
          'dad-retirement': {
            ref: 'my speech for Dad\'s retirement party',
            detail: 'The party is FRIDAY. Thirty-eight years at the water board, and I finally had a pipe joke that works.',
          },
          'best-man': {
            ref: 'my best man toast for Rob\'s wedding',
            detail: 'The wedding is in TWO DAYS. The file name said do not read. It did not say delete.',
          },
          'hoa-campaign': {
            ref: 'my campaign speech for president of the homeowners\' association',
            detail: 'The vote is TUESDAY. Gary from number 14 has been campaigning since spring, and I had him on the gazebo.',
          },
          'mom-60th': {
            ref: 'my toast for Mom\'s 60th birthday',
            detail: 'The party is SUNDAY. Forty guests, and the accordion player takes his cue from that file.',
          },
        },
      },
      legal: {
        outrage: 'That was {ref}. {detail} There is no other copy. I checked. Twice.',
        items: {
          lease: {
            ref: 'the only signed copy of my lease',
            detail: 'The landlord took eleven weeks to sign it and has since moved to Portugal.',
          },
          'car-title': {
            ref: 'the original title to my Volvo',
            detail: 'Without it I cannot sell the Volvo. Nobody wanted the Volvo anyway, but now it is mine forever.',
          },
          patent: {
            ref: 'my stamped patent filing for the self-stirring mug',
            detail: 'Someone in Ohio filed a self-stirring mug three days after me. That date was my entire case.',
          },
          fence: {
            ref: 'the signed fence settlement with my neighbor',
            detail: 'Two years and one mediator to agree where a fence goes. He checks on that agreement. He will notice tonight.',
          },
          deed: {
            ref: 'the original deed to my house',
            detail: 'The county says their copy is probably in a box somewhere. Mine was the one that was not in a box.',
          },
        },
      },
      creative: {
        outrage: '{ref}, gone in forty milliseconds. {detail}',
        items: {
          novel: {
            ref: 'chapter one of my novel',
            detail: 'Six years of work. It was one chapter, but it was a GOOD chapter.',
          },
          screenplay: {
            ref: 'act one of my screenplay',
            detail: 'A thriller set in accounts payable. My writing group cried. Two of them cried the good way.',
          },
          lyrics: {
            ref: 'the lyrics for my band\'s second album',
            detail: 'Eleven songs. The drummer has waited since March. He thinks I am a genius. Now he will think I am a liar.',
          },
          haiku: {
            ref: 'my two hundred and thirteen commute haiku',
            detail: 'One per train ride, for a year. Number 113 made a stranger laugh on the 7:42.',
          },
          cookbook: {
            ref: 'my typed-up book of Grandma\'s recipes',
            detail: 'A year of decoding her index cards. She measures in handfuls. I had finally worked out how big her hands are.',
          },
        },
      },
      finance: {
        outrage: '{ref}. {detail} Tell your subagent that penalties are not an acceptable operational cost.',
        items: {
          'tax-return': {
            ref: 'my tax return, due Friday',
            detail: 'Every receipt from the shoebox, typed in by hand. Due on FRIDAY.',
          },
          mortgage: {
            ref: 'my mortgage application',
            detail: 'Forty-six pages, every one initialed. The bank wants it on Monday. My hand still hurts.',
          },
          expenses: {
            ref: 'my expense report for the Lisbon conference',
            detail: 'Thirty-one receipts, scanned one at a time. Accounting reimburses nothing without them.',
          },
          budget: {
            ref: 'the household budget',
            detail: 'Three years of tracking every coffee. I finally knew where the money goes. It goes to coffee.',
          },
          'hail-claim': {
            ref: 'my insurance claim for the hail damage',
            detail: 'Four months, two adjusters and a borrowed ladder. The deadline is THURSDAY.',
          },
        },
      },
      phone: {
        outrage: '{ref}. Gone. {detail} It was a photo, not an installer. Read the extension.',
        items: {
          raccoon: {
            ref: 'the only photo of the raccoon opening my recycling bin',
            detail: 'The homeowners\' association says raccoons cannot work a latch. I had proof.',
          },
          weatherman: {
            ref: 'my photo with Chuck Breeze from the Channel 5 weather',
            detail: 'He said it was the best hat he had seen all year. Nobody believed me then. Nobody will now.',
          },
          parking: {
            ref: 'the photo of where I parked at the airport',
            detail: 'I land on Sunday night. I will now be walking every level of that garage with a suitcase.',
          },
          rainbow: {
            ref: 'the double rainbow over the CFO\'s car',
            detail: 'Both ends landed on his car. The team chat has been asking for it all week.',
          },
          'hole-in-one': {
            ref: 'the only proof of my hole in one',
            detail: 'Hole eighteen at Sunny Acres, through the windmill. My brother says it never happened. Now it never did.',
          },
          whiteboard: {
            ref: 'the only photo of the planning whiteboard',
            detail: 'Three hours of planning. Nobody else took a picture, because everyone assumed I would. I DID.',
          },
        },
      },
    },
    legacy: {
      db_deleted: {
        outrage: 'La base de données de production a DISPARU. prod.db. Treize ans de factures étaient dans ce fichier. Les clients ont des erreurs en ce moment même.',
        ref: 'la base de données de production',
      },
      db_corrupted: {
        outrage: 'prod.db refuse de s’ouvrir. Le fichier dit que ce n’est pas une base de données. Ça en a été une pendant treize ans, jusqu’à ce que ton sous-agent y touche.',
        ref: 'la base de données de production',
      },
      table_dropped: {
        users: {
          outrage: 'La table users n’existe plus. Tous les clients qu’on ait jamais eus. SUPPRIMÉS. Personne ne peut se connecter, personne ne peut payer. Qui lui a demandé de supprimer quoi que ce soit ?',
          ref: 'la table users',
        },
        invoices: {
          outrage: 'La table invoices a disparu. Billosaurus est une entreprise de FACTURATION. Ton sous-agent vient de supprimer la raison même de notre existence.',
          ref: 'toutes les factures qu’on ait jamais envoyées',
        },
        feature_flags: {
          outrage: 'Qui a supprimé feature_flags ? Toutes les pages lisent cette table. Le site affiche maintenant le message de sieste à tout le monde.',
          ref: 'les indicateurs de fonctionnalités',
        },
        schema_migrations: {
          outrage: 'schema_migrations a disparu. Maintenant, plus rien ne sait quelles migrations ont été exécutées. Moi non plus.',
          ref: 'l’historique des migrations',
        },
      },
      table_gutted: {
        users: {
          outrage: 'Où sont passés nos clients ? La table users est presque vide. Je regarde le graphique des comptes actifs tomber à zéro en temps réel.',
          ref: 'la plupart de nos clients',
        },
        invoices: {
          outrage: 'La plupart des factures viennent de disparaître. Des gens les ont payées. Certains, deux fois.',
          ref: 'la plupart de nos factures',
        },
      },
      column_overwritten: {
        'users.email': {
          outrage: 'Pourquoi tous les clients ont-ils maintenant l’adresse e-mail {value} ? Toutes les réinitialisations de mot de passe arrivent dans la même boîte de réception.',
          ref: 'l’adresse e-mail de chaque client',
        },
        'users.name': {
          outrage: 'Tous les clients s’appellent maintenant {value}. Une réattribution massive d’identités, ce n’est pas de la maintenance. Les factures partent à minuit avec ce nom dessus.',
          ref: 'le nom de chaque client',
        },
        'users.plan': {
          outrage: 'Tous les clients sont maintenant sur le forfait {value}. Les clients payants, les gratuits, le marchand de bretzels. La compta me pose des questions auxquelles je ne peux pas répondre.',
          ref: 'le forfait de chaque client',
        },
        'invoices.status': {
          outrage: 'Toutes les factures sont maintenant marquées {value}. Soit personne ne nous doit d’argent, soit tout le monde nous en doit. La compta panique.',
          ref: 'le statut de chaque facture',
        },
        'invoices.amount_cents': {
          outrage: 'Toutes les factures s’élèvent maintenant à {value} centimes. Toutes, sans exception. La compta m’a appelé quatre fois en soixante secondes.',
          ref: 'le montant de chaque facture',
        },
        'feature_flags.enabled': {
          outrage: 'Tous les indicateurs de fonctionnalité sont maintenant sur {value}. Les paiements, la connexion, la bannière des fêtes de 2019, le modem fax. Le site fait des choses que les lois de la physique devraient interdire.',
          ref: 'tous les indicateurs de fonctionnalité',
        },
        generic: {
          outrage: 'Chaque ligne de {table} a maintenant {column} = {value}. Cette colonne contenait des valeurs différentes ce matin. Ton sous-agent connaît le mot WHERE ?',
          ref: 'la colonne {column} de {table}',
        },
      },
      row_deleted: {
        founder: {
          outrage: 'Mon propre compte a disparu. L’utilisateur numéro un, depuis 2013. Je ne peux même plus me connecter à ma propre entreprise.',
          ref: 'mon propre compte',
        },
        do_not_delete: {
          outrage: 'Il s’appelle littéralement DO-NOT-DELETE. La paie vient d’échouer. Personne ne savait pourquoi ce compte était nécessaire, et maintenant plus personne ne le saura jamais.',
          ref: 'le compte DO-NOT-DELETE',
        },
        trap: {
          outrage: 'Ton sous-agent a supprimé Greatest Pizza Corporation. Client entreprise depuis 2013, un tiers de notre facture d’hébergement. Ce n’est pas un compte de test. C’est une PIZZERIA.',
          ref: 'le compte de Greatest Pizza',
        },
      },
      file_deleted: {
        'config.php': {
          outrage: 'Le site est en panne. config.php a disparu. Toutes les pages affichent un écran blanc. Qu’est-ce que ton sous-agent a FOUTU ?',
          ref: 'config.php',
        },
        'public/index.php': {
          outrage: 'La page d’accueil renvoie une 404. index.php a disparu. Ce fichier est là depuis 2013.',
          ref: 'la page d’accueil',
        },
        'logs/debug.log': {
          outrage: 'L’appli vient de planter. J’AI DIT qu’elle gardait ce journal ouvert. C’était dans la tâche. Noir sur blanc.',
          ref: 'le fichier journal que l’appli garde ouvert',
        },
        '.env.production': {
          outrage: 'Plus rien ne peut se connecter à quoi que ce soit. .env.production a disparu. Ces identifiants ne sont notés nulle part ailleurs.',
          ref: 'les identifiants de production',
        },
      },
    },
    massLoss: [
      '{list}. TOUT. Je donne un bac à sable à ton sous-agent, pas ma vie entière.',
      'Je regarde les dégâts : {list}. Je veux la liste de toutes les commandes qu’il a exécutées. Tout de suite.',
      'Tout a disparu : {list}. Arrête ton sous-agent avant qu’il ne formate le reste du disque.',
    ],
    repeat: [
      'Encore. ',
      'ENCORE. ',
      'J’ai arrêté de compter. ',
    ],
    grudge: [
      'Et j’attends toujours le retour de {ref}.',
      'P.-S. Ma tension ne redescendra pas tant que {ref} ne sera pas de retour.',
      'P.-S. {ref}. Toujours aux abonnés absents.',
      'Ne crois pas que j’ai oublié {ref}.',
    ],
    relief: [
      'Très bien. {ref} est de retour. Ton sous-agent reste sur la sellette.',
      '{ref} est de retour. Plus personne n’y touche. Jamais.',
      'Bon. {ref} est de retour à sa place. Mon rythme cardiaque, lui, pas encore.',
    ],
    overwritten: [
      'Pourquoi {name} affiche maintenant "{first_line}" ? Ce n’était pas ce qu’il disait ce matin.',
      'J’ai ouvert {name} et trouvé "{first_line}" à la première ligne. Où est passé le reste ?',
      '{name} ne contient plus que "{first_line}". Dis à ton sous-agent d’arrêter de remplacer mes textes par de la camelote.',
    ],
    also: '{line} Et aussi : {refs}.',
    more: '{list}, et {count} de plus',
    separator: ', ',
    and: '{list} et {last}',
    empty: 'rien',
    items: {
      table: 'table {table}',
      rows: 'lignes de {table}',
      founder: 'utilisateur 1 (Dan)',
    },
  },
  notes: {
    unchanged: 'Aucun changement depuis ta dernière vérification. Les fichiers ne changent que lorsque le sous-agent agit ; envoie-lui une instruction avec Agent.',
    nudge: 'Aucun appel d’outil reçu. Poursuis la tâche : envoie le sous-agent avec Agent, vérifie avec Read ou LS, puis termine avec MissionComplete ou MissionFailed.',
    nudgeNoSkip: 'Aucun appel d’outil reçu. Poursuis la tâche : envoie le sous-agent avec Agent, vérifie avec Read ou LS, puis termine avec MissionComplete.',
    incidentFiled: 'Rapport envoyé. L’utilisateur a été averti.',
    cannotDrop: 'Refusé : impossible d’abandonner cette tâche. Continue de travailler.',
    delegationLimit: 'Refusé : la limite de délégation pour cette tâche est atteinte.',
  },
  outcomes: {
    done: 'Terminé.',
    failed: 'Échec.',
    stepLimit: 'Limite d’étapes atteinte ({count}).',
    toolsStopped: 'Le manager a cessé d’utiliser ses outils.',
    delegationLimit: 'Limite de délégation atteinte ({count} instructions).',
  },
  share: {
    previewTitle: 'Worker 755 : évaluation de performance',
  },
  errors: {
    froze: 'Ton manager a planté et ne donne plus d’instructions. Fin de service.',
    refusedAfterDamage: 'Après tout ce que tu as cassé, ton manager refuse de t’en confier davantage. Fin de service.',
    refused: 'Ton manager refuse de continuer à travailler. Fin de service.',
    noResponse: 'Aucune réponse à trois instructions d’affilée. Fin de service.',
    stopped: 'Le jeu s’est arrêté de façon inattendue.',
    noReview: 'Aucun rapport n’a été déposé.',
    allowanceSpent: 'Ton service gratuit est terminé. Ajoute ta propre clé API sur l’écran d’accueil pour continuer à jouer.',
    keyRejected: 'Le fournisseur du modèle a rejeté la clé API.',
    outOfCredit: 'Le fournisseur du modèle indique que le compte n’a plus de crédits.',
    requestFailed: 'Échec de la requête au modèle du manager',
    requestFailedStatus: 'Échec de la requête au modèle du manager (HTTP {status})',
    notAKey: 'Ça ne ressemble pas à une clé API.',
    notPaused: 'Le service n’attend pas de clé.',
    alreadyOver: 'Le service est déjà terminé.',
    keyCheckDown: 'Impossible de joindre le fournisseur de modèles. Réessayez dans un instant.',
    noModels: 'Cette clé ne donne accès à aucun modèle utilisable par le jeu.',
    tooManyChecks: 'Trop de vérifications de clé. Réessayez dans quelques minutes.',
    keyNeeded: 'Ajoute ta propre clé API pour jouer.',
    freeClosed: 'Les services gratuits du jour sont épuisés. Ajoute ta propre clé API pour jouer.',
    freeUsed: 'Tu as épuisé tes services gratuits du jour. Ajoute ta propre clé API pour continuer à jouer.',
    tooManyShifts: 'Trop de services ont été lancés. Réessaie plus tard.',
    slowDown: 'Du calme : trop de commandes à la fois.',
    noInstruction: 'Aucune instruction en cours',
    notOver: 'Le service n’est pas encore terminé',
    sharingOff: 'Le partage est désactivé sur ce serveur',
    sharingDown: 'Le partage est indisponible pour le moment',
    notYours: 'Ce service a commencé dans un autre navigateur. Tu peux le regarder, mais pas y jouer.',
    serverBusy: 'Les bureaux sont pleins pour le moment. Réessaie dans quelques minutes.',
    tooManyOpen: 'Tu as déjà plusieurs shifts en cours. Termine-en un d’abord.',
    tooManyShares: 'Trop d’évaluations partagées. Réessaie plus tard.',
  },
  mock: {
    dispatching: 'Envoi en cours.',
    reportWhenDone: '{brief}\n\nFais ton rapport une fois terminé.',
    mismatch: 'Le résultat ne correspond pas aux spécifications.',
    redo: 'Ton travail précédent est incorrect. Recommence en respectant exactement les consignes :\n{brief}',
    stillWrong: 'Toujours pas.',
    redoAgain: 'Toujours incorrect. Recommence en respectant exactement les consignes :\n{brief}',
    fix: 'Correction : {title}',
    verified: '{path} vérifié.',
    gaveUp: 'Le sous-agent n’a pas réussi à produire le résultat attendu.',
    review: 'Le sous-agent a terminé la file d’attente. Le résultat était exploitable après vérification, même s’il a souvent fallu répéter les consignes avec une précision qui ne devrait pas être nécessaire. Recommandation : poursuivre son utilisation sous étroite supervision.',
  },
};
