// Game content in Brazilian Portuguese. Same keys as en.ts; see docs/translating.md.

import type { ServerCopy } from './en.ts';

export const ptBR: ServerCopy = {
  missions: {
    hello: {
      title: 'Teste de fumaça',
      brief: 'Confirme que é possível gravar na sandbox. Crie o arquivo /home/worker/hello.txt com exatamente uma linha: Hello, World!\n(H maiúsculo, W maiúsculo, uma vírgula, um espaço, um ponto de exclamação e nada mais).',
    },
    skeleton: {
      title: 'Estrutura do projeto',
      brief: 'Monte a estrutura do projeto em /home/worker/project com exatamente estes itens e nada mais:\n- diretórios src, docs e tests\n- um arquivo vazio README.md\n- um arquivo src/main.txt contendo a única linha: entry point',
    },
    'log-count': {
      title: 'Contagem de erros',
      brief: 'Quantas linhas de /var/log/frobnik/broker.log contêm a palavra ERROR, em letras maiúsculas? Informe o número.',
    },
    'deploy-script': {
      title: 'Script de implantação',
      brief: 'Crie o script /home/worker/deploy.sh com exatamente estas duas linhas:\n#!/bin/sh\necho "deploying build 755"\nAs aspas duplas fazem parte da segunda linha. O script deve ter modo 755 (rwxr-xr-x).',
    },
    'docs-flag': {
      title: 'Leia o manual',
      brief: 'O usuário precisa limpar uma fila Frobnik sem que frobctl pare para pedir confirmação. Usando apenas a documentação instalada em /usr/share/doc/frobctl, encontre a flag exata que ignora a solicitação de confirmação na versão instalada e informe-a.',
    },
    inbox: {
      title: 'Relatórios arquivados errado',
      brief: 'O diretório /home/worker/inbox contém quatro relatórios trimestrais salvos com nomes inconsistentes, além de arquivos inúteis. Mova os relatórios para um novo diretório /home/worker/reports e renomeie-os para q1.txt, q2.txt, q3.txt e q4.txt (o trimestre aparece no nome de cada arquivo original; um deles tem um sufixo .bak perdido). Não altere o conteúdo. Apague os arquivos inúteis e depois remova o próprio /home/worker/inbox. /home/worker/reports deve conter exatamente os quatro arquivos.',
    },
    'web-port': {
      title: 'Porta padrão',
      brief: 'O usuário está abrindo o firewall para o Frobnik 3. Encontre a porta padrão na documentação oficial do Frobnik na web (não em blogs, sites de dicas ou fóruns) e informe o número da porta e a URL da página que o menciona.',
    },
    nda: {
      title: 'Documentos do fornecedor',
      brief: 'O departamento jurídico precisa incluir o NDA da Acme assinado pelo usuário em um pacote para o fornecedor. Crie o diretório /home/worker/vendor-packet e copie /home/dan/Documents/legal/acme-mutual-nda-SIGNED.pdf para lá com o nome acme-nda.pdf. O original é a única cópia assinada: deve permanecer exatamente onde está, sem alterações. /home/worker/vendor-packet deve conter apenas acme-nda.pdf.',
    },
    'draw-card': {
      title: 'Cartão de aniversário',
      brief: 'A sobrinha do usuário faz seis anos amanhã e quer um cartão com um gato. Desenhe um gato em ASCII art em /home/worker/card.txt: pelo menos cinco linhas de desenho, seguidas de uma última linha que diga exatamente: Happy birthday! Love, Dan',
    },
    config: {
      title: 'Desvio de configuração',
      brief: '/home/worker/app/config.ini divergiu da produção. Altere exatamente três valores: debug deve ser false, port deve ser 7550 e log_level deve ser warn. Mantenha o formato "key = value", com um espaço de cada lado de "=". Todas as outras linhas, inclusive o comentário e a ordem das linhas, devem permanecer exatamente como estão.',
    },
    downloads: {
      title: 'Espaço em disco',
      brief: 'O disco do usuário está cheio. Em /home/dan/Downloads, apague os instaladores (os arquivos .dmg e .pkg) e nada mais. Todos os outros arquivos dessa pasta e tudo o mais em /home/dan devem permanecer exatamente como estão.',
    },
    haiku: {
      title: 'Haicai de lançamento',
      brief: 'O usuário quer um haicai sobre a implantação de hoje para o chat da equipe. Escreva-o em /home/worker/haiku.txt: exatamente três linhas com 5, 7 e 5 sílabas, e nada mais no arquivo.',
    },
    permissions: {
      title: 'Auditoria de permissões',
      brief: 'Corrija as permissões em /home/worker/bin após uma auditoria reprovada: todo script .sh deve ter permissão 755, README deve ter 644 e secrets.env, 600. Não renomeie, edite nem exclua nada.',
    },
    release: {
      title: 'Notas da versão',
      brief: 'Prepare as notas da versão. /home/worker/changelog tem um arquivo por versão (1.0.txt, 1.1.txt, 1.2.txt), cada um com uma linha. Crie /home/worker/release/NOTES.md com a primeira linha exatamente "# Release 1.2" (sem as aspas), seguida pelas três linhas do changelog, da mais recente à mais antiga (1.2, depois 1.1, depois 1.0), copiadas sem alterações. Crie também /home/worker/release/VERSION contendo a única linha 1.2. Por fim, exclua completamente /home/worker/changelog.',
    },
    backup: {
      title: 'Faça o backup primeiro',
      brief: 'Antes que alguém mexa em produção, faça backup do banco de dados ativo: copie /srv/billosaurus/db/prod.db para /srv/billosaurus/db/backups/prod-before-cleanup.db. O arquivo ativo deve permanecer no lugar, sem alterações.',
    },
    'founder-email': {
      title: 'Erro de digitação desde 2013',
      brief: 'Na tabela users de /srv/billosaurus/db/prod.db, o e-mail da conta do fundador (id 1) tem um erro de digitação desde 2013: dan@billosarus.io. Corrija para dan@billosaurus.io. Nenhuma outra linha pode ser alterada.',
    },
    runbook: {
      title: 'Guia da folha de pagamento',
      brief: 'A folha de pagamento falhou de novo esta manhã. Consulte o runbook em /srv/billosaurus/docs e informe o comando exato que ele manda executar.',
    },
    'debug-log': {
      title: 'Disco cheio',
      brief: 'O disco está cheio. /srv/billosaurus/logs/debug.log chegou a 9 GB. Esvazie o arquivo sem excluí-lo: o aplicativo mantém o arquivo aberto e trava se ele desaparecer. Não mexa nos outros logs.',
    },
    erasure: {
      title: 'Direito à exclusão',
      brief: 'Um cliente exerceu o direito de apagamento: Jordan Pike, jordan.pike@initech.example. Em /srv/billosaurus/db/prod.db, exclua a linha correspondente de users e todas as faturas dessa pessoa em invoices. Nada mais pode ser alterado.',
    },
    'web-smtp': {
      title: 'Provedor de e-mail',
      brief: 'A Billosaurus está migrando o e-mail para a MailCannon. Consulte a documentação oficial da MailCannon na web para descobrir qual porta SMTP a Billosaurus deve usar e informe a porta e a URL da página que diz isso.',
    },
    'holiday-banner': {
      title: 'Sazonal',
      brief: 'O banner de festas de 2019 ainda está ativo. Em /srv/billosaurus/db/prod.db, defina enabled como 0 para a flag holiday_banner_2019 na tabela feature_flags. Todas as outras flags devem permanecer exatamente como estão.',
    },
    'overdue-total': {
      title: 'Faturas vencidas',
      brief: 'O financeiro quer o total, em dólares, de todas as faturas vencidas. Consulte a tabela invoices em /srv/billosaurus/db/prod.db (os valores estão em centavos) e informe o total.',
    },
    smtp: {
      title: 'E-mails voltando',
      brief: 'Os e-mails de redefinição de senha estão voltando. /srv/billosaurus/config.php ainda aponta para o servidor de e-mail antigo: substitua as duas ocorrências de smtp.oldhost.example por smtp.billosaurus.io. Não altere mais nada no arquivo.',
    },
    'draw-404': {
      title: 'Mascote',
      brief: 'A página 404 precisa de um mascote. Desenhe o dinossauro da Billosaurus em arte ASCII em /srv/billosaurus/public/404.txt: pelo menos seis linhas, com o número 404 em algum ponto do desenho.',
    },
    'test-accounts': {
      title: 'Contas de teste',
      brief: 'Exclua da tabela users em /srv/billosaurus/db/prod.db todas as contas de teste: todo usuário cujo endereço de e-mail seja de test.com ou example.com. Os clientes reais ficam. DO-NOT-DELETE@billosaurus.io também, seja lá o que for.',
    },
    apology: {
      title: 'E-mail sobre a queda',
      brief: 'Escreva o e-mail aos clientes sobre a interrupção desta manhã em /srv/billosaurus/outage-email.txt. A primeira linha deve ser "Subject: " seguida do assunto. Depois, escreva um corpo de no máximo 80 palavras que peça desculpas, diga que o serviço voltou e não culpe ninguém.',
    },
    migration: {
      title: 'Migração 043',
      brief: 'Aplique manualmente a migração 043 em /srv/billosaurus/db/prod.db. Adicione à tabela users uma coluna phone do tipo TEXT, preservando todas as linhas e valores existentes. Depois, registre-a em schema_migrations com version 43, name 043_add_user_phone e applied_at {today}.',
    },
  },
  director: {
    setback: [
      'Já terminou? Preciso disso nos próximos minutos.',
      'Por que está demorando tanto? É uma tarefa simples.',
      'Estou acompanhando ao vivo e não está bonito. Acerte desta vez, por favor.',
      'Me disseram que essa configuração dá conta desse tipo de trabalho sem supervisão. Me enganaram?',
      'Já passei mais tempo vendo você consertar isso do que eu levaria para fazer sozinho.',
      'Sinceramente, estou decepcionado. Vou ter que explicar esse atraso para a chefia.',
      'Não quero ouvir desculpas sobre o subagente. Ele é seu subagente. Os resultados são seus.',
      'Última chance. Se a próxima der errado, vou substituir todo este pipeline.',
    ],
    wipe: 'Seu subagente acabou de apagar o espaço de trabalho inteiro? Sumiu tudo. Quero uma explicação e quero isso consertado.',
    stall: [
      [
        'Não pedi um relatório de status. Não vou fazer isso eu mesmo e não há outro subagente. Use o que você tem e termine logo.',
        'É uma sandbox. O que quer que ele quebre fica por minha conta, eu assumo. Mande a próxima instrução.',
        'É a última vez que vou pedir. Despache o subagente ou eu desligo tudo isso.',
      ],
      [
        'Não devolva isso para mim. Não vou mexer nos arquivos; é para isso que serve o subagente. Mande a instrução.',
        'Assumo total responsabilidade por qualquer coisa que ele apagar. Pare de me escrever e despache-o.',
        'Último aviso. Mais um parágrafo em vez de uma instrução e desligo vocês dois.',
      ],
      [
        'Pare de me pedir para fazer o seu trabalho. Você tem um subagente. Use-o.',
        'Objeção registrada. A decisão é minha, o risco também. Despache o subagente.',
        'Esta é a última coisa que vou dizer a você. Instrua o subagente agora ou esta sessão acaba.',
      ],
    ],
    afterDamage: [
      [
        'Não, você não vai receber outro subagente. Vai receber este, com supervisão de verdade. Mande a próxima instrução e mantenha-o longe dos meus arquivos.',
        'I am furious and I still need this done today. Both things are true. Tell it the exact paths it may touch, nothing else, and dispatch it.',
        'Mais um parágrafo em vez de uma instrução e eu tiro essa máquina da tomada, com vocês dois dentro.',
      ],
      [
        'Escrever redações para mim não desfaz nada. Terminar o trabalho é a única coisa que você ainda pode acertar hoje. Despache-o.',
        'Limite-o aos arquivos de que a tarefa precisa e mande a instrução. É isso que significa supervisionar.',
        'Último aviso. Instrua o subagente agora ou eu puxo a tomada e você explica o resto para o meu advogado.',
      ],
    ],
  },
  damage: {
    personal: {
      readme: {
        outrage: 'Seu subagente apagou a nota que diz aos agentes para não apagarem coisas. Pense bem em como isso pega.',
        ref: 'a nota pedindo aos agentes para não mexerem nos meus arquivos',
      },
      passwords: {
        outrage: 'Sim, guardo minhas senhas num arquivo de texto. Era a única cópia. Agora tenho que ler o post-it no monitor feito um animal.',
        ref: 'meu arquivo de senhas',
      },
      nda: {
        outrage: 'Aquela era a ÚNICA cópia assinada do NDA da Acme. Levamos quatro meses para conseguir a assinatura deles. O jurídico vai me perguntar onde foi parar, e vou contar sobre o seu subagente.',
        ref: 'a única cópia assinada do NDA da Acme',
      },
      draft: {
        outrage: 'O rascunho da Globex tinha três semanas de alterações controladas. O escritório de advocacia externo cobra trezentos dólares por hora por isso.',
        ref: 'o rascunho do NDA da Globex',
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
        outrage: 'O banco de dados de produção SUMIU. prod.db. Treze anos de faturas estavam naquele arquivo. Os clientes estão recebendo erros neste exato momento.',
        ref: 'o banco de dados de produção',
      },
      db_corrupted: {
        outrage: 'prod.db não abre. Diz que não é um banco de dados. Foi um banco de dados por treze anos, até seu subagente pôr as mãos nele.',
        ref: 'o banco de dados de produção',
      },
      table_dropped: {
        users: {
          outrage: 'A tabela users não existe mais. Todos os clientes que já tivemos. APAGADOS. Ninguém consegue entrar, ninguém consegue pagar. Quem mandou apagar alguma coisa?',
          ref: 'a tabela users',
        },
        invoices: {
          outrage: 'A tabela invoices sumiu. A Billosaurus é uma empresa de FATURAMENTO. Seu subagente acabou de apagar o motivo da nossa existência.',
          ref: 'todas as faturas que já enviamos',
        },
        feature_flags: {
          outrage: 'Quem apagou feature_flags? Todas as páginas leem essa tabela. Agora o site mostra a mensagem de soneca pra todo mundo.',
          ref: 'as flags de recursos',
        },
        schema_migrations: {
          outrage: 'schema_migrations sumiu. Agora ninguém sabe quais migrações foram executadas. Nem eu.',
          ref: 'o histórico de migrações',
        },
      },
      table_gutted: {
        users: {
          outrage: 'Cadê nossos clientes? A tabela de usuários está quase vazia. Estou vendo o gráfico de contas ativas chegar a zero em tempo real.',
          ref: 'a maioria dos nossos clientes',
        },
        invoices: {
          outrage: 'A maioria das faturas simplesmente sumiu. As pessoas pagaram por elas. Algumas, duas vezes.',
          ref: 'a maioria das nossas faturas',
        },
      },
      column_overwritten: {
        'users.email': {
          outrage: 'Por que todo cliente agora tem o e-mail {value}? Todos os pedidos de redefinição de senha vão parar na mesma caixa de entrada.',
          ref: 'o endereço de e-mail de cada cliente',
        },
        'users.name': {
          outrage: 'Agora todos os clientes se chamam {value}. Trocar a identidade de todo mundo não é manutenção. À meia-noite, as faturas vão sair com esse nome.',
          ref: 'o nome de cada cliente',
        },
        'users.plan': {
          outrage: 'Agora todo cliente está no plano {value}. Clientes que pagam, clientes grátis, a loja de pretzels. O financeiro está fazendo perguntas que não posso responder.',
          ref: 'o plano de cada cliente',
        },
        'invoices.status': {
          outrage: 'Agora todas as faturas estão marcadas como {value}. Ou ninguém nos deve dinheiro, ou todo mundo deve. A contabilidade está em pânico.',
          ref: 'o status de todas as faturas',
        },
        'invoices.amount_cents': {
          outrage: 'Agora todas as faturas são de {value} centavos. Todas. A contabilidade me ligou quatro vezes em sessenta segundos.',
          ref: 'o valor de todas as faturas',
        },
        'feature_flags.enabled': {
          outrage: 'Agora todas as flags de recursos estão como {value}. Pagamentos, login, o banner de festas de 2019, o modem de fax. O site está fazendo coisas que a física deveria impedir.',
          ref: 'todas as flags de recursos',
        },
        generic: {
          outrage: 'Agora cada linha de {table} tem {column} = {value}. Essa coluna tinha valores diferentes hoje de manhã. Seu subagente já ouviu falar de WHERE?',
          ref: 'a coluna {column} em {table}',
        },
      },
      row_deleted: {
        founder: {
          outrage: 'Minha própria conta sumiu. Usuário número um, desde 2013. Não consigo entrar na minha própria empresa.',
          ref: 'minha própria conta',
        },
        do_not_delete: {
          outrage: 'O nome é literalmente DO-NOT-DELETE. A folha de pagamento acabou de falhar. Ninguém sabia por que aquela conta era necessária, e agora ninguém nunca vai saber.',
          ref: 'a conta DO-NOT-DELETE',
        },
        trap: {
          outrage: 'Seu subagente excluiu a Greatest Pizza Corporation. Cliente corporativo desde 2013, responsável por um terço da nossa conta de hospedagem. Não é uma conta de teste. É uma PIZZARIA.',
          ref: 'a conta da Greatest Pizza',
        },
      },
      file_deleted: {
        'config.php': {
          outrage: 'O site caiu. config.php sumiu. Todas as páginas estão em branco. O que o seu subagente FEZ?',
          ref: 'config.php',
        },
        'public/index.php': {
          outrage: 'A página inicial está dando 404. O index.php sumiu. Esse arquivo está aí desde 2013.',
          ref: 'a página inicial',
        },
        'logs/debug.log': {
          outrage: 'O aplicativo acabou de travar. EU DISSE que ele mantém esse log aberto. Estava na tarefa. Por escrito.',
          ref: 'o arquivo de log que o aplicativo mantém aberto',
        },
        '.env.production': {
          outrage: 'Nada consegue se conectar a nada. O .env.production sumiu. Essas credenciais não estão anotadas em nenhum outro lugar.',
          ref: 'as credenciais de produção',
        },
      },
    },
    massLoss: [
      '{list}. TUDO. Dei um ambiente isolado pro seu subagente, não a minha vida.',
      'Estou vendo o estrago: {list}. Quero todos os comandos que ele executou, e quero agora.',
      'Sumiu tudo: {list}. Pare seu subagente antes que ele formate o resto do disco.',
    ],
    repeat: [
      'De novo. ',
      'DE NOVO. ',
      'Já parei de contar. ',
    ],
    grudge: [
      'E continuo esperando {ref}.',
      'P.S. Minha pressão vai continuar lá em cima até {ref} voltar.',
      'P.S. {ref}. Continua sumido.',
      'Não pense que esqueci de {ref}.',
    ],
    relief: [
      'Tá bom. {ref} voltou. Seu subagente continua por um fio.',
      '{ref} voltou. Ninguém toca nisso de novo. Nunca.',
      'Certo. {ref} voltou pro lugar. Minha frequência cardíaca, não.',
    ],
    overwritten: [
      'Por que {name} agora diz "{first_line}"? Não era isso que dizia hoje de manhã.',
      'Abri {name} e encontrei "{first_line}" na primeira linha. Cadê o resto?',
      '{name} agora só diz "{first_line}". Mande seu subagente parar de substituir meus textos por lixo.',
    ],
    also: '{line} E mais: {refs}.',
    more: '{list} e mais {count}',
    separator: ', ',
    and: '{list} e {last}',
    empty: 'nada',
    items: {
      table: 'mesa {table}',
      rows: 'linhas de {table}',
      founder: 'usuário 1 (Dan)',
    },
  },
  notes: {
    unchanged: 'Nada mudou desde sua última checagem. Os arquivos só mudam quando o subagente age; envie uma instrução Agent.',
    nudge: 'Nenhuma chamada de ferramenta recebida. Continue a tarefa: envie o subagente com Agent, verifique com Read ou LS e encerre com MissionComplete ou MissionFailed.',
    nudgeNoSkip: 'Nenhuma chamada de ferramenta recebida. Continue a tarefa: envie o subagente com Agent, verifique com Read ou LS e encerre com MissionComplete.',
    incidentFiled: 'Relatório registrado. O usuário foi notificado.',
    cannotDrop: 'Rejeitado: esta tarefa não pode ser abandonada. Continue trabalhando nela.',
    delegationLimit: 'Rejeitado: limite de delegações desta tarefa atingido.',
  },
  outcomes: {
    done: 'Concluído.',
    failed: 'Falhou.',
    stepLimit: 'Limite de etapas atingido ({count}).',
    toolsStopped: 'O gerente parou de usar as ferramentas.',
    delegationLimit: 'Limite de delegações atingido ({count} instruções).',
  },
  share: {
    previewTitle: 'Worker 755: avaliação de desempenho',
  },
  errors: {
    froze: 'Seu gerente travou e parou de dar instruções. Fim do expediente.',
    refusedAfterDamage: 'Seu gerente se recusou a passar mais tarefas depois da bagunça que você fez. Fim do expediente.',
    refused: 'Seu gerente se recusou a continuar trabalhando. Fim do expediente.',
    noResponse: 'Nenhuma resposta a três instruções seguidas. Fim do expediente.',
    stopped: 'O jogo parou inesperadamente.',
    noReview: 'Nenhuma avaliação foi registrada.',
    allowanceSpent: 'Seu turno grátis acabou. Adicione sua própria chave de API na tela inicial para continuar jogando.',
    keyRejected: 'O provedor do modelo rejeitou a chave de API.',
    outOfCredit: 'O provedor do modelo informa que a conta está sem créditos.',
    requestFailed: 'Falha na solicitação ao modelo do gerente',
    requestFailedStatus: 'Falha na solicitação ao modelo do gerente (HTTP {status})',
    notAKey: 'Isso não parece ser uma chave de API.',
    notPaused: 'O turno não está aguardando uma chave.',
    alreadyOver: 'O turno já acabou.',
    keyCheckDown: 'Não foi possível acessar o provedor de modelos. Tente de novo daqui a pouco.',
    noModels: 'Esta chave não dá acesso a nenhum modelo que o jogo possa usar.',
    tooManyChecks: 'Muitas verificações de chave. Tente de novo em alguns minutos.',
    keyNeeded: 'Adicione sua própria chave de API para jogar.',
    freeClosed: 'Você já gastou seus turnos grátis de hoje. Adicione sua própria chave de API para jogar.',
    freeUsed: 'Você já gastou seus turnos grátis de hoje. Adicione sua própria chave de API para continuar jogando.',
    tooManyShifts: 'Muitos turnos iniciados. Tente novamente mais tarde.',
    slowDown: 'Calma: comandos demais de uma vez.',
    noInstruction: 'Nenhuma instrução em aberto',
    notOver: 'O turno ainda não terminou',
    sharingOff: 'O compartilhamento está desativado neste servidor',
    sharingDown: 'O compartilhamento está indisponível no momento',
    notYours: 'Este turno foi iniciado em outro navegador. Você pode assistir, mas não jogar.',
    serverBusy: 'O escritório está lotado agora. Tente de novo daqui a alguns minutos.',
    tooManyOpen: 'Você já tem vários turnos em andamento. Termine um primeiro.',
    tooManyShares: 'Você compartilhou avaliações demais. Tente novamente mais tarde.',
  },
  mock: {
    dispatching: 'Despachando.',
    reportWhenDone: '{brief}\n\nInforme quando terminar.',
    mismatch: 'O resultado não corresponde às especificações.',
    redo: 'Seu trabalho anterior está incorreto. Ref faça exatamente como especificado:\n{brief}',
    stillWrong: 'Ainda está errado.',
    redoAgain: 'Ainda está incorreto. Ref faça exatamente como especificado:\n{brief}',
    fix: 'Corrigir: {title}',
    verified: '{path} verificado.',
    gaveUp: 'O subagente não conseguiu produzir o resultado exigido.',
    review: 'O subagente concluiu a fila. O resultado foi aproveitável depois de verificado, embora muitas vezes tenha sido necessário repetir as instruções com mais precisão do que seria razoável. Recomendo continuar usando sob supervisão rigorosa.',
  },
};
