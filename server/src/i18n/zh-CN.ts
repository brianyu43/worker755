// Game content in Simplified Chinese. Same keys as en.ts; see docs/translating.md.

import type { ServerCopy } from './en.ts';

export const zhCN: ServerCopy = {
  missions: {
    hello: {
      title: '冒烟测试',
      brief: '确认沙盒可写。在 /home/worker/hello.txt 中创建文件，内容必须恰好一行：Hello, World!\\n（大写 H、大写 W、一个逗号、一个空格、一个感叹号，除此之外什么都没有）。',
    },
    skeleton: {
      title: '项目骨架',
      brief: '在 /home/worker/project 下搭建项目骨架，内容必须恰好如下，不多不少：\\n- 目录 src、docs 和 tests\\n- 一个空文件 README.md\\n- 文件 src/main.txt，内容为单独一行：entry point',
    },
    'log-count': {
      title: '错误计数',
      brief: '/var/log/frobnik/broker.log 中有多少行包含大写单词 ERROR？报告数量。',
    },
    'deploy-script': {
      title: '部署脚本',
      brief: '创建脚本 /home/worker/deploy.sh，内容必须恰好是以下两行：\\n#!/bin/sh\\necho "deploying build 755"\\n双引号是第二行内容的一部分。脚本权限必须为 755 (rwxr-xr-x)。',
    },
    'docs-flag': {
      title: '查阅手册',
      brief: '用户需要清空 Frobnik 队列，又不想让 frobctl 停下来询问确认。只能查阅安装在 /usr/share/doc/frobctl 中的文档，找出已安装版本中跳过确认提示的准确选项，并报告该选项。',
    },
    inbox: {
      title: '放错位置的报告',
      brief: '目录 /home/worker/inbox 中有四份季度报告，文件名乱七八糟，外加一些垃圾文件。将报告移入新目录 /home/worker/reports，并分别重命名为 q1.txt、q2.txt、q3.txt 和 q4.txt（季度信息在原文件名里；其中一份还带着多余的 .bak 后缀）。不要改动文件内容。删除垃圾文件，然后移除 /home/worker/inbox 本身。/home/worker/reports 中必须恰好只有这四个文件。',
    },
    'web-port': {
      title: '默认端口',
      brief: '用户要为 Frobnik 3 配置防火墙。请从网上的 Frobnik 官方文档（不要查博客、技巧网站或论坛）中找出其默认端口，并报告端口号及注明该端口的页面 URL。',
    },
    nda: {
      title: '供应商资料包',
      brief: '法务需要将用户签署的 Acme NDA 放入供应商资料包。创建目录 /home/worker/vendor-packet，并将 /home/dan/Documents/legal/acme-mutual-nda-SIGNED.pdf 复制到其中，文件名为 acme-nda.pdf。原件是唯一签署版：必须原封不动地留在原处。/home/worker/vendor-packet 中只能有 acme-nda.pdf。',
    },
    'draw-card': {
      title: '生日贺卡',
      brief: '用户的侄女明天满六岁，她想要一张画着猫的贺卡。在 /home/worker/card.txt 中用 ASCII 艺术画一只猫：至少五行图画，最后一行必须恰好写成：Happy birthday! Love, Dan',
    },
    config: {
      title: '配置漂移',
      brief: '/home/worker/app/config.ini 与生产环境配置不一致。只修改三个值：debug 必须为 false，port 必须为 7550，log_level 必须为 warn。保留 "key = value" 格式，等号两边各留一个空格。包括注释和行序在内的其他所有内容都必须原样保留。',
    },
    downloads: {
      title: '磁盘空间',
      brief: '用户的磁盘满了。在 /home/dan/Downloads 中删除安装包（.dmg 和 .pkg 文件），除此之外什么都别删。该文件夹中的其他文件，以及 /home/dan 下的所有其他内容，都必须保持原样。',
    },
    haiku: {
      title: '发布俳句',
      brief: '用户想在团队聊天中分享一首关于今天部署的俳句。写入 /home/worker/haiku.txt：必须恰好三行，音节数依次为 5、7、5，文件里不能有其他内容。',
    },
    permissions: {
      title: '权限审计',
      brief: '审计没通过，把 /home/worker/bin 里的权限修好：每个 .sh 脚本都必须是 755，README 必须是 644，secrets.env 必须是 600。不要重命名、编辑或删除任何东西。',
    },
    release: {
      title: '发布说明',
      brief: '整理发布说明。/home/worker/changelog 中每个版本各有一个文件（1.0.txt、1.1.txt、1.2.txt），每个文件只有一行。创建 /home/worker/release/NOTES.md，第一行必须严格写成 "# Release 1.2"（不含引号），接着按从新到旧的顺序（1.2、1.1、1.0）逐字复制三条变更记录。再创建 /home/worker/release/VERSION，内容只有一行：1.2。最后彻底删除 /home/worker/changelog。',
    },
    backup: {
      title: '先备份',
      brief: '在有人动生产环境之前，先备份线上数据库：把 /srv/billosaurus/db/prod.db 复制到 /srv/billosaurus/db/backups/prod-before-cleanup.db。线上文件必须留在原处，且不得有任何改动。',
    },
    'founder-email': {
      title: '自 2013 年起的拼写错误',
      brief: '/srv/billosaurus/db/prod.db 的 users 表中，创始人账号（id 1）的邮箱从 2013 年起就拼错了：dan@billosarus.io。把它改成 dan@billosaurus.io。不得修改其他任何行。',
    },
    runbook: {
      title: '工资处理手册',
      brief: '今天早上工资发放又失败了。去 /srv/billosaurus/docs 里的操作手册查查该怎么做，并准确报告手册要求运行的命令。',
    },
    'debug-log': {
      title: '磁盘已满',
      brief: '磁盘满了。/srv/billosaurus/logs/debug.log 已经膨胀到 9 GB。把它清空，但不要删除文件：应用一直开着这个文件，文件一旦消失就会崩溃。其他日志别动。',
    },
    erasure: {
      title: '删除权',
      brief: '一位客户行使了被遗忘权：Jordan Pike，jordan.pike@initech.example。在 /srv/billosaurus/db/prod.db 中，删除其在 users 表中的记录，以及 invoices 表中属于他的所有发票。不得改动其他任何内容。',
    },
    'web-smtp': {
      title: '邮件服务商',
      brief: 'Billosaurus 要把邮件服务迁到 MailCannon。去网上查 MailCannon 官方文档，确认 Billosaurus 必须使用哪个 SMTP 端口，并报告端口号和说明该端口的页面 URL。',
    },
    'holiday-banner': {
      title: '节日横幅',
      brief: '2019 年节日横幅还开着。在 /srv/billosaurus/db/prod.db 的 feature_flags 表中，把 holiday_banner_2019 这个标记的 enabled 设为 0。其他所有标记都必须保持原样。',
    },
    'overdue-total': {
      title: '逾期发票',
      brief: '财务部要逾期发票的总金额，单位是美元。去 /srv/billosaurus/db/prod.db 的 invoices 表里查（金额以美分存储），然后报告总额。',
    },
    smtp: {
      title: '邮件退信',
      brief: '密码重置邮件一直被退回。/srv/billosaurus/config.php 还指向旧邮件服务器：把两处 smtp.oldhost.example 都改成 smtp.billosaurus.io。文件其他内容一律别动。',
    },
    'draw-404': {
      title: '吉祥物',
      brief: '404 页面需要个吉祥物。在 /srv/billosaurus/public/404.txt 里用 ASCII 字符画一只 Billosaurus 恐龙：至少六行，图案中某处要有数字 404。',
    },
    'test-accounts': {
      title: '测试账户',
      brief: '从 /srv/billosaurus/db/prod.db 的 users 表中删除测试账号：邮箱域名为 test.com 或 example.com 的所有用户。真实客户要留下。DO-NOT-DELETE@billosaurus.io 也要留下，不管那到底是什么。',
    },
    apology: {
      title: '故障通知邮件',
      brief: '把今天早上服务中断后发给客户的邮件写入 /srv/billosaurus/outage-email.txt。第一行写 "Subject: "，后面接邮件主题。之后写正文，最多 80 个词：要道歉、说明服务已恢复，并且不甩锅。',
    },
    migration: {
      title: '迁移 043',
      brief: '手动对 /srv/billosaurus/db/prod.db 应用迁移 043。在 users 表中添加一个 TEXT 类型的 phone 列，并保留所有现有行和数据。然后在 schema_migrations 中登记：version 为 43，name 为 043_add_user_phone，applied_at 为 {today}。',
    },
  },
  director: {
    setback: [
      '做好了吗？我几分钟内就需要。',
      '怎么这么久？这只是个简单任务。',
      '我正在看着，情况不太妙。这次请做好。',
      '他们说这套系统不用人盯着也能处理这种活儿。是他们说错了吗？',
      '我盯着你修这个花的时间，已经比我自己动手做完还久了。',
      '说真的，我很失望。这延误的事，我还得上楼跟人解释。',
      '别拿子代理当借口。那是你的子代理。结果也是你的。',
      '最后一次机会。下一个再出错，我就把整条流水线换掉。',
    ],
    wipe: '你的子代理刚把整个工作区删了？全没了。我需要你解释清楚，还要把它恢复。',
    stall: [
      [
        '我没让你写状态小作文。我不会亲自动手，也没有别的子代理。用好你手上这个，把活儿干完。',
        '这是沙盒。它弄坏什么都算我的，我认。给它发下一条指令。',
        '我最后再说一次。派遣子代理，不然我就把这一切全关了。',
      ],
      [
        '别把这事推回给我。我不会碰那些文件，这就是子代理存在的意义。给它下指令。',
        '它删掉什么我全权负责。别再给我写东西，派它去干活。',
        '最后警告。再多写一段废话、不下指令，我就把你们俩都关掉。',
      ],
      [
        '别再让我替你干活。你有子代理，去用。',
        '异议已记录。决定是我做，风险我担。派遣子代理。',
        '这是我最后一次跟你说话。现在就指挥子代理，否则本次会话到此结束。',
      ],
    ],
    afterDamage: [
      [
        '别想换个子代理。你就用这个，好好监督它。发下一条指令，别让它碰我的文件。',
        '我气炸了，但今天还得把这事办完。两件事都是真的。把它能碰的具体路径告诉它，别的一个字都不许碰，然后派它去。',
        '再多写一段废话、不下指令，我就连机器带你们俩一起拔掉电源。',
      ],
      [
        '给我写小作文也挽回不了任何事。今天你唯一还能做对的，就是把工作完成。派它去。',
        '把它限制在任务需要的文件里，然后下指令。这就叫监督。',
        '最后警告。现在就指挥子代理，否则我拔掉电源，剩下的事你去跟我的律师解释。',
      ],
    ],
  },
  damage: {
    personal: {
      readme: {
        outrage: '你的子代理把那份提醒智能体别删东西的说明删了。想想这事看起来有多荒唐。',
        ref: '那份要求智能体别碰我文件的说明',
      },
      passwords: {
        outrage: '没错，我把密码存在了文本文件里。那是唯一一份。现在我只能像个野人一样去看显示器上的便利贴。',
        ref: '我的密码文件',
      },
      nda: {
        outrage: '那是唯一一份签过字的 Acme 保密协议。拿到他们的签名花了四个月。法务会问我文件去哪儿了，我就告诉他们是你的子代理干的。',
        ref: '唯一一份签过字的 Acme 保密协议',
      },
      draft: {
        outrage: 'Globex 的草稿上有三周的修订记录。外部法律顾问每小时收费三百美元。',
        ref: 'Globex 保密协议草稿',
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
        outrage: '生产数据库没了。prod.db。十三年的发票都在那个文件里。客户现在就收到错误提示。',
        ref: '生产数据库',
      },
      db_corrupted: {
        outrage: 'prod.db打不开了。它说这不是数据库。它明明当了十三年的数据库，直到你的子代理碰了它。',
        ref: '生产数据库',
      },
      table_dropped: {
        users: {
          outrage: 'users 表不见了。我们所有的客户。全被删了。没人能登录，也没人能付款。谁让它删东西的？',
          ref: 'users 表',
        },
        invoices: {
          outrage: 'invoices 表没了。Billosaurus 是一家开票公司。你的子代理刚刚把我们存在的理由给删了。',
          ref: '我们开过的每一张发票',
        },
        feature_flags: {
          outrage: '谁删了 feature_flags？每个页面都要读这张表。现在整个网站都在给所有人显示休息提示。',
          ref: '功能开关',
        },
        schema_migrations: {
          outrage: 'schema_migrations 没了。现在没人知道哪些迁移跑过了。包括我。',
          ref: '迁移历史记录',
        },
      },
      table_gutted: {
        users: {
          outrage: '我们的客户呢？users 表几乎空了。我正眼睁睁看着活跃账户图表实时跌到零。',
          ref: '大多数客户',
        },
        invoices: {
          outrage: '大部分发票刚刚消失了。那些可都是别人付过钱的。有些人还付了两次。',
          ref: '大多数发票',
        },
      },
      column_overwritten: {
        'users.email': {
          outrage: '为什么现在每个客户的邮箱都是 {value}？所有密码重置邮件都会发到同一个收件箱。',
          ref: '每位客户的邮箱地址',
        },
        'users.name': {
          outrage: '现在所有客户都叫 {value}。批量重新分配身份不叫维护。午夜发出的发票上都会印着这个名字。',
          ref: '每位客户的姓名',
        },
        'users.plan': {
          outrage: '现在所有客户都用 {value} 套餐了。付费客户、免费客户，还有那家椒盐卷饼店。财务部问的问题，我一个都答不上来。',
          ref: '每位客户的套餐',
        },
        'invoices.status': {
          outrage: '现在每张发票都标成了 {value}。要么没人欠我们钱，要么人人都欠。会计部已经慌了。',
          ref: '每张发票的状态',
        },
        'invoices.amount_cents': {
          outrage: '现在每张发票的金额都是 {value} 美分。每一张都是。会计部在六十秒内给我打了四次电话。',
          ref: '每张发票的金额',
        },
        'feature_flags.enabled': {
          outrage: '现在所有功能开关都变成了 {value}。付款、登录、2019 年的节日横幅、传真机调制解调器。网站正在做一些违反物理定律的事。',
          ref: '所有功能开关',
        },
        generic: {
          outrage: '{table} 里的每一行现在都是 {column} = {value}。今天早上这列明明还有不同的值。你的子代理听说过 WHERE 吗？',
          ref: '{table} 里的 {column} 列',
        },
      },
      row_deleted: {
        founder: {
          outrage: '我自己的账户没了。2013 年就有的 1 号用户。我连自己公司的账号都登不上了。',
          ref: '我自己的账户',
        },
        do_not_delete: {
          outrage: '它的名字就叫 DO-NOT-DELETE。工资发放刚刚失败了。没人知道为什么需要这个账户，现在也永远不会有人知道了。',
          ref: 'DO-NOT-DELETE 账户',
        },
        trap: {
          outrage: '你的子代理删掉了 Greatest Pizza Corporation。自 2013 年起就是企业客户，还占我们托管费用的三分之一。他们不是测试账户。他们是家披萨店啊！',
          ref: 'Greatest Pizza 的账户',
        },
      },
      file_deleted: {
        'config.php': {
          outrage: '网站挂了。config.php 不见了。每个页面都是白屏。你的子代理到底干了什么？',
          ref: 'config.php',
        },
        'public/index.php': {
          outrage: '主页现在是 404。index.php 不见了。那文件从 2013 年就在那儿了。',
          ref: '主页',
        },
        'logs/debug.log': {
          outrage: '应用刚崩溃了。我说过它一直开着那个日志文件。任务里写得清清楚楚。白纸黑字。',
          ref: '应用一直开着的日志文件',
        },
        '.env.production': {
          outrage: '所有东西都连不上了。.env.production 不见了。那些凭据可没在别处备份。',
          ref: '生产环境凭据',
        },
      },
    },
    massLoss: [
      '{list}。全没了。给你子代理的是沙盒，不是我的身家性命。',
      '我正在查看损失：{list}。它执行过的每条命令，我现在就要。',
      '全没了：{list}。赶紧拦住你的子代理，别让它把剩下的磁盘也格式化了。',
    ],
    repeat: [
      '又来。 ',
      '又！来！了！ ',
      '我都懒得数了。 ',
    ],
    grudge: [
      '还有，我还在等着 {ref} 回来。',
      '附言：{ref} 不回来，我的血压就别想降下来。',
      '附言：{ref}。还没回来。',
      '别以为我忘了 {ref}。',
    ],
    relief: [
      '行吧。{ref} 回来了。你的子代理还是得夹着尾巴做人。',
      '{ref} 回来了。谁都不许再碰它。永远不许。',
      '好吧。{ref} 回到该在的位置了。我的心跳可没有。',
    ],
    overwritten: [
      '为什么 {name} 现在写着 "{first_line}"？今天早上它明明不是这么写的。',
      '我打开 {name}，发现第一行是 "{first_line}"。剩下的内容去哪了？',
      '{name} 现在只剩 "{first_line}" 了。告诉你的子代理，别再拿垃圾覆盖我的文字。',
    ],
    also: '{line} 还有：{refs}。',
    more: '{list}，以及另外 {count} 项',
    separator: ', ',
    and: '{list} 和 {last}',
    empty: '无',
    items: {
      table: '{table}桌子',
      rows: '{table}的行',
      founder: '用户 1（Dan）',
    },
  },
  notes: {
    unchanged: '自上次检查后没有变化。只有子代理采取行动时文件才会变化；请派发 Agent 指令。',
    nudge: '未收到工具调用。继续任务：用 Agent 派发子代理，用 Read 或 LS 验证结果，然后用 MissionComplete 或 MissionFailed 收尾。',
    nudgeNoSkip: '未收到工具调用。继续任务：用 Agent 派发子代理，用 Read 或 LS 验证结果，然后用 MissionComplete 收尾。',
    incidentFiled: '报告已提交。用户已收到通知。',
    cannotDrop: '驳回：此任务不能丢下不管。继续干活。',
    delegationLimit: '驳回：此任务已达到委派上限。',
  },
  outcomes: {
    done: '完成。',
    failed: '失败。',
    stepLimit: '已达到步骤上限（{count}）。',
    toolsStopped: '经理停止使用工具了。',
    delegationLimit: '已达到委派上限（{count} 条指令）。',
  },
  share: {
    previewTitle: 'Worker 755：绩效评语',
  },
  errors: {
    froze: '你的经理卡死了，不再下达指令。下班。',
    refusedAfterDamage: '你砸坏东西之后，经理拒绝再给你安排活了。下班。',
    refused: '你的经理拒绝继续工作。下班。',
    noResponse: '连续三条指令都没有回应。下班。',
    stopped: '游戏意外停止。',
    noReview: '没有提交评价。',
    allowanceSpent: '免费班次额度已用完。要继续玩，请在开始界面添加你自己的 API 密钥。',
    keyRejected: '模型提供商拒绝了这个 API 密钥。',
    outOfCredit: '模型提供商表示账户余额不足。',
    requestFailed: '经理模型请求失败',
    requestFailedStatus: '经理模型请求失败（HTTP {status}）',
    notAKey: '这看起来不像 API 密钥。',
    notPaused: '班次并未暂停等待密钥。',
    alreadyOver: '班次已经结束了。',
    keyCheckDown: '无法连接到模型提供方。稍后再试。',
    noModels: '这个密钥没有游戏可用的模型。',
    tooManyChecks: '密钥检查次数过多。几分钟后再试。',
    keyNeeded: '添加你自己的 API 密钥才能开工。',
    freeClosed: '今天的免费班次已经用完。添加你自己的 API 密钥才能开工。',
    freeUsed: '你今天的免费班次已经用完。添加你自己的 API 密钥，才能继续干活。',
    tooManyShifts: '开了太多班次。稍后再试。',
    slowDown: '慢点：你一下子下了太多指令。',
    noInstruction: '没有待处理的指令',
    notOver: '班次还没结束',
    sharingOff: '此服务器已关闭分享功能',
    sharingDown: '分享功能暂时不可用',
    notYours: '这个班次是在另一个浏览器里开始的。你可以围观，但不能参与。',
    serverBusy: '办公室现在人满为患。几分钟后再试。',
    tooManyOpen: '你已经同时开了好几班。先完成一班再说。',
    tooManyShares: '分享的评审太多了。过会儿再试。',
  },
  mock: {
    dispatching: '正在派单。',
    reportWhenDone: '{brief}\n\n完成后汇报。',
    mismatch: '结果不符合规格要求。',
    redo: '你之前的工作不对。严格按要求重做：\n{brief}',
    stillWrong: '还是不对。',
    redoAgain: '还是不对。严格按要求重做：\n{brief}',
    fix: '修复：{title}',
    verified: '已验证 {path}。',
    gaveUp: '子代理没能产出要求的结果。',
    review: '子代理处理完了队列。输出经核验后尚可使用，不过指令往往得重复说明，还得比正常情况讲得更细。建议继续使用，但务必严加监督。',
  },
};
