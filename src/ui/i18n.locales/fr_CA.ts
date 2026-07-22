// Divergence-only dialect overlay for "fr_CA" over base locale "fr_FR".
//
// "fr_CA" inherits from "fr_FR": the build (scripts/i18n_build.mjs) resolves it as
// nested `en` -> fr_FR overlay -> this overlay, so any key absent here falls through to fr_FR, then to English. This file
// therefore carries ONLY the keys whose value differs from fr_FR; every other key is
// intentionally omitted. A key must NOT be re-added with a value equal to fr_FR
// (redundant duplication). Every key here must be a real `en` leaf
// path (the flat TranslationKey union type + the byte gate). Keys are in `en`'s
// leaf order.

import type { TranslationKey } from '../i18n.catalog';

export const fr_CA: Partial<Record<TranslationKey, string>> = {
  'download.macCta': 'Telecharger la version macOS',
  'download.windowsPending': 'Version Windows a venir.',
  // Stat tooltips inherit the fr_FR base: none of these strings has a genuine
  // Quebec-specific form, so per the divergence-only policy fr_CA carries no
  // hudChrome.statInfo.* overrides.
  'seo.title': 'World of ClaudeCraft: MMO Web de style classique',
  'seo.description':
    'Lancez-vous dans une aventure épique dans World of ClaudeCraft, un micro-MMO de style classique jouable directement dans votre navigateur. Rejoignez un monde partagé et persistant, faites monter vos classes en niveau et terrassez vos ennemis.',
  'seo.operatingSystem': 'Navigateur Web',
  'a11y.toggleMenu': 'Ouvrir ou fermer le menu',
  'loading.assetsFailed': 'Le chargement des ressources a échoué: rechargez la page. {error}',
  'loading.rendererFailed': 'Impossible de démarrer le rendu: rechargez la page. {error}',
  'loading.enterTimeout':
    "Impossible d'entrer dans le monde. La connexion a expiré. Le serveur de jeu fonctionne-t-il ?",
  'errors.characterNameRequired': 'Entrez un nom de personnage.',
  'errors.characterNameInvalid':
    "Le nom doit compter 2 à 16 caractères, commencer par une lettre et contenir seulement lettres, espaces, traits d'union ou apostrophes.",
  'errors.selectClass': 'Choisissez une classe.',
  'errors.api.tooManyAttempts': 'Trop de tentatives. Attendez une minute et réessayez.',
  'errors.api.usernameShape':
    "Le nom d'utilisateur doit compter 3 à 24 caractères et utiliser lettres, chiffres ou tiret bas.",
  'errors.api.usernameTaken': "Ce nom d'utilisateur est déjà utilisé.",
  'errors.api.invalidCredentials': "Nom d'utilisateur ou mot de passe invalide.",
  'errors.api.nameTaken': 'Ce nom est déjà utilisé.',
  'errors.api.deleteConfirm': 'Tapez le nom du personnage pour confirmer la suppression.',
  'realm.onlineNow': '{count} en ligne maintenant',
  'character.inWorld': 'dans le monde',
  'deleteCharacter.body':
    'Cela supprimera définitivement {name}. Cette action ne peut pas être annulée.',
  'deleteCharacter.confirmLabel': 'Tapez le nom du personnage pour confirmer',
  'classDetails.sections.startingStats': 'Caractéristiques de départ',
  'classDetails.lore.warrior':
    'Les guerriers sont des combattants endurcis qui gagnent de la rage en infligeant ou subissant des dégâts. Ils encaissent ou écrasent leurs ennemis.',
  'classDetails.lore.paladin':
    'Les paladins sont de saints croisés qui épaulent leurs alliés par des bénédictions, soignent les blessures avec la Lumière guérisseuse et protègent les faibles sous une armure lourde.',
  'classDetails.lore.hunter':
    "Les chasseurs sont des spécialistes à distance qui combattent aux côtés d'une bête apprivoisée, criblant leurs ennemis de tirs précis et rapides, les ralentissant de morsures et de traits de choc, et changeant d'aspect selon le moment.",
  'classDetails.lore.shaman':
    'Les chamans commandent les éléments, imprègnent leurs armes, frappent avec la foudre et restaurent leurs alliés.',
  'classDetails.lore.mage':
    "Les mages manient le Feu, le Givre et la force des Arcanes pour détruire leurs ennemis, conjurer de l'eau et figer les menaces sur place.",
  'classDetails.lore.warlock':
    'Les démonistes invoquent des démons, jettent des malédictions et des dégâts prolongés, puis drainent la vie de leurs ennemis pour tenir bon.',
  'classDetails.lore.druid':
    'Les druides canalisent la nature, guérissent, entravent les ennemis et prennent des formes animales pour défendre ou attaquer.',
  'classDetails.aria':
    'Détails de classe pour {className}: rôle {role}. Caractéristiques de départ: Force {str}, Agilité {agi}, Endurance {sta}, Intelligence {int}, Esprit {spi}.',
  'mobilePreflight.rotateTitle': 'Passez en mode paysage',
  'mobilePreflight.baseLandscape':
    "Tournez votre appareil en mode paysage avant d'entrer dans le monde.",
  'mobilePreflight.basePerformance':
    'Les performances mobiles peuvent diminuer. Fermez les onglets inutiles et réduisez la qualité de rendu si le jeu ralentit.',
  'mobilePreflight.iosInstallDetail':
    "Pour le vrai plein écran sur iPhone ou iPad, ajoutez d'abord cette page à l'écran d'accueil.",
  'mobilePreflight.androidInstallStep':
    "Dans Chrome, touchez le menu, puis Installer l'application ou Ajouter à l'écran d'accueil.",
  'serverUnavailable.body':
    'Nous redémarrons le service de jeu et Claudemoon devrait revenir sous peu. Cette page continuera de vérifier automatiquement.',
  'serverUnavailable.status': 'De retour bientôt',
  'delveUi.affix.candleblind': 'Aveuglement de chandelle',
  'delveUi.blessing.chapel_candle':
    "Chandelle de chapelle : parcours plus sûr, une Marque de moins à l'achèvement.",
  'delveUi.board.enter': "Entrer dans l'excavation",
  'delveUi.board.marks': "Marques d'excavation : {count}",
  'delveUi.board.openDelveAria': 'Ouvrir le tableau des excavations depuis {name}',
  'delveUi.board.title': 'Tableau des excavations',
  'delveUi.boss.varric.bell.emote': 'Le diacre Varric empoigne la cloche enfouie à deux mains!',
  'delveUi.boss.varric.bell.impact': 'Le glas de la cloche fissure le sol de la chambre!',
  'delveUi.boss.varric.bell.lesson':
    "Glas funèbre : un choc au sol toutes les douze secondes. Éloignez-vous avant l'impact.",
  'delveUi.boss.varric.bell.log': 'Le diacre Varric se met à sonner la cloche funéraire.',
  'delveUi.boss.varric.bell.warning': 'Éloignez-vous du diacre Varric!',
  'delveUi.boss.varric.mid60':
    'Le diacre Varric lit des noms dans le registre avec un triomphe tremblant.',
  'delveUi.boss.varric.pull':
    'Vous foulez la poussière sacrée avec des intentions impures. À genoux, et soyez compté.',
  'delveUi.boss.varric.raise.emote': 'Le diacre Varric appelle des noms des tombes brisées!',
  'delveUi.boss.varric.raise.interrupt_fail': "Les morts répondent à l'appel du diacre Varric!",
  'delveUi.boss.varric.raise.interrupt_ok': 'Le rite funèbre vacille.',
  'delveUi.boss.varric.raise.lesson':
    'Interrompez la tombe fissurée en cinq secondes, sinon les morts se lèvent à son appel.',
  'delveUi.boss.varric.raise.log': 'Le diacre Varric entame Relever les morts.',
  'delveUi.boss.varric.raise.object': "La tombe fissurée frémit d'un souffle volé.",
  'delveUi.boss.varric.raise.warning': 'Arrêtez le rite funèbre!',
  'delveUi.chest.flavor': "Les morts ont cédé ce qu'ils pouvaient épargner.",
  'delveUi.companion.tessa.combat_start':
    "Garde l'équilibre, {playerName}. Les morts sont agités ici.",
  'delveUi.companion.tessa.low_hp': 'Respire. Il me reste des prières pour toi.',
  'delveUi.companion.tessa.rank.1': 'Novice de chapelle',
  'delveUi.companion.tessa.rank.4': "Témoin de l'appel des tombes",
  'delveUi.companion.tessa.rank.5': 'Gardienne de chapelle',
  'delveUi.companion.tessa.trap_spotted': 'Attends, quelque chose dans le sol se souvient des pas.',
  'delveUi.death.warning': 'Une mort de plus mettra fin à cette excavation.',
  'delveUi.intro.heroic':
    "Les portes se referment en grinçant derrière vous. Des noms raclent la pierre comme des ongles. La chandelle de Tessa brûle bleu. « Ils n'appellent plus les morts, maintenant, {playerName}. Ils répondent à quelque chose. »",
  'delveUi.intro.normal':
    "L'escalier est froid et sombre. Des pierres de saints brisées jonchent la descente, et une douce note de cloche flotte dans l'air humide. L'acolyte Tessa murmure : « Le reliquaire ne devrait pas être ouvert aussi profondément. Reste près de moi, {playerName}. »",
  'delveUi.lore.bell_below':
    'Note en marge de Tessa : « Il y a une seconde cloche sous le reliquaire. Elle sonne pour les égarés, pas pour les morts. »',
  'delveUi.lore.eastbrook_ledger':
    "Une page tachée d'eau du registre funéraire d'Eastbrook. Des noms biffés et réécrits d'une main qui n'est pas humaine.",
  'delveUi.lore.first_collapse':
    'Les archives de la chapelle relatent le premier affaissement : pierres de saints fendues, étagères inclinées, et une note de cloche entendue depuis le sous-sol.',
  'delveUi.lore.gravecaller_mark':
    "Un sigil gravé dans le bois d'un cercueil, non pas le sceau de Morthen, mais une marque d'appel des tombes plus ancienne, antérieure à la Crypte creuse.",
  'delveUi.lore.tessa_note':
    "Bout de papier plié de l'écriture de Tessa : « Si les registres changent pendant que nous sommes en bas, fie-toi à la chandelle, pas aux voix. »",
  'delveUi.module.reliquary_bell_niche':
    "Des dizaines de clochettes pendent en silence, chacune nouée d'un linge funéraire.",
  'delveUi.module.reliquary_finale': 'La cloche enfouie sonne une seule fois sous vos bottes.',
  'delveUi.module.reliquary_saintless_hall':
    'Des statues dont les visages ont été burinés avec une haine méticuleuse.',
  'delveUi.module.reliquary_sunken_ossuary':
    "L'eau suinte à travers les étagères funéraires, charriant de vieilles cendres en filets argent et noir.",
  'delveUi.npc.halven.greeting':
    "Le reliquaire en bas s'est encore déplacé. Nous entendons des litanies à travers le plancher après minuit, et l'acolyte Tessa jure que les registres funéraires changent leur propre encre. Si tu as assez de courage, {playerName}, prends une chandelle et descends. Ne te fie pas à toutes les voix que tu entendras là-bas. Certaines connaissaient ton nom avant ta naissance.",
  'delveUi.run.failed': "L'excavation a échoué. Vous êtes ramené auprès du frère Halven.",
  'delveUi.summary.marks': "{count} Marques d'excavation gagnées",
  'delveUi.summary.title': 'Excavation terminée',
  'delveUi.tracker.marks': "Marques d'excavation : {count}",
  'delveUi.tracker.title': 'Excavation',
  'entities.abilities.blazing_barrier.name': 'Bouclier ardent',
  'entities.abilities.blazing_barrier.description':
    'Entoure-toi de feu et absorbe {damage} points de dégâts pendant 60 s. (Feu)',
  'entities.abilities.cold_snap.name': 'Rappel hivernal',
  'entities.abilities.cold_snap.description':
    'Réinitialise la recharge de Pas scintillant, Voile de givre et Invisibilité accrue. (Talent de mage)',
  'entities.abilities.greater_invisibility.name': 'Invisibilité accrue',
  'entities.abilities.greater_invisibility.description':
    'Disparais pendant 20 s : enlève 2 effets de dégâts périodiques et réduit de 90% les dégâts que tu subis tant que tu es invisible et pour un court moment après. (Talent de mage)',
  'entities.abilities.hot_streak.name': 'Suite flamboyante',
  'entities.abilities.hot_streak.description':
    "Passif : deux coups critiques de suite avec tes sorts de Feu (Boule de feu, Trait de feu, Brûlure, Explosion pyrotechnique ou Choc de flammes) rendent ta prochaine Explosion pyrotechnique ou ton prochain Choc de flammes instantané et gratuit. Les sorts qui dépensent cet effet comptent pour la suite SUIVANTE, même les incantations gratuites; Choc de flammes ne compte qu'une fois, peu importe le nombre d'ennemis touchés, et seul le premier impact peut compter. (Feu)",
  'entities.abilities.ice_floes.name': 'Glaces flottantes',
  'entities.abilities.ice_floes.description':
    "Tes deux prochains sorts qui ont un temps d'incantation peuvent être lancés en mouvement. Dure 15 s. (Talent de mage)",
  'entities.abilities.ignition.name': 'Embrasement',
  'entities.abilities.ignition.description':
    'Passif : les coups critiques de tes sorts enflamment la cible et lui infligent 40% des dégâts causés sur 6 s; cet effet se cumule. (Maîtrise du Feu)',
  'entities.abilities.mass_barrier.name': 'Bouclier collectif',
  'entities.abilities.mass_barrier.description':
    'Pose un bouclier sur toi et sur un maximum de 4 alliés proches dans un rayon de 30 m; chacun absorbe 130 points de dégâts pendant 60 s. (Talent de mage)',
  'entities.abilities.overload.name': 'Surpuissance',
  'entities.abilities.overload.description':
    'Ton prochain sort gagne 40% de puissance, mais coûte 50% de mana de plus. Dure 10 s. (Talent de mage)',
  'entities.abilities.power_echo.name': 'Écho de pouvoir',
  'entities.abilities.power_echo.description':
    'Ton prochain sort direct se produit de nouveau à 50% de sa puissance sur la même cible. Dure 10 s. (Talent de mage)',
  'entities.abilities.rings_of_frost.name': 'Cercle de givre',
  'entities.abilities.rings_of_frost.description':
    'Fait apparaître un cercle pendant 10 s. Les ennemis qui traversent son contour sont gelés pendant 4 s. (Talent de mage)',
  'entities.abilities.rune_of_power.name': 'Rune de pouvoir',
  'entities.abilities.rune_of_power.description':
    'Trace une rune de pouvoir sous tes pieds pendant 15 s : les alliés qui restent à moins de 8 m infligent 10% plus de dégâts. (Talent de mage)',
  'entities.abilities.summon_water_elemental.name': "Invoquer un élémentaire d'eau",
  'entities.abilities.summon_water_elemental.description':
    "Invoque un élémentaire d'eau qui se bat à tes côtés, lance des Éclairs d'eau sur ta cible et canalise Jet d'eau. (Givre)",
  'entities.items.conjured_water4.name': 'Eau de source conjurée',
  'entities.items.conjured_bread4.name': 'Miche de festin conjurée',
  'entities.mobs.reliquary_gravecall_acolyte.name': "Acolyte de l'appel des tombes",
  'entities.mobs.water_elemental.name': 'Élémentaire des eaux',
  'entities.npcs.brother_halven.greeting': "Le reliquaire en bas s'est encore déplacé.",
  'sim.delve.alreadyInDelve': 'Vous êtes déjà dans une excavation.',
  'sim.delve.bossChest':
    "Le boss tombe. Un coffre de reliquaire scellé s'élève sur l'estrade : crochetez sa serrure pour réclamer votre butin.",
  'sim.delve.cannotAffordCompanionUpgrade':
    "Vous n'avez pas les moyens de payer cette amélioration.",
  'sim.delve.cannotEnterNow': "Vous ne pouvez pas entrer dans une excavation pour l'instant.",
  'sim.delve.companionMarksRequired':
    "Il vous faut {marks} Marques d'excavation pour améliorer {name}.",
  'sim.delve.companionMaxRank': 'Ce compagnon est déjà pleinement amélioré.',
  'sim.delve.complete': '{name} terminé.',
  'sim.delve.duringArena':
    "Vous ne pouvez pas entrer dans une excavation pendant un match d'arène.",
  'sim.delve.duringDuel': 'Vous ne pouvez pas entrer dans une excavation pendant un duel.',
  'sim.delve.graveFalters': 'Le rite funèbre vacille.',
  'sim.delve.mechanismOpen':
    "Un mécanisme s'ouvre dans un déclic tout près. Un passage s'ouvre vers le nord : trouvez le portail de sortie devant vous.",
  'sim.delve.notInDelve': "Vous n'êtes pas dans une excavation.",
  'sim.delve.nothingHappens': 'Rien ne se passe.',
  'sim.delve.raiseDead': '{name} entame Relever les morts.',
  'sim.delve.runFailed': "L'excavation {name} a échoué.",
  'sim.delve.strikeWall': 'Frappez le mur pour percer.',
  'sim.delve.surfaceStairs':
    "Un escalier vers la surface s'ouvre. Appuyez sur F à l'escalier pour partir.",
  'sim.delve.tombstoneHint':
    "Un passage de pierre tombale s'ouvre vers le nord une fois la salle nettoyée.",
  'sim.delve.tombstoneInto': 'Vous franchissez la pierre tombale vers {name}.',
  'sim.delve.tombstoneOpen':
    "Un passage de pierre tombale scellé s'ouvre en grinçant vers le nord. Avancez dedans pour continuer.",
  'sim.delve.unknownTier': "Palier d'excavation inconnu.",
  'sim.delve.whileTrading': 'Vous ne pouvez pas entrer dans une excavation pendant un échange.',
  'sim.lockpick.lastPickSnaps':
    "Le dernier crochet se brise. La serrure se bloque : le coffre est perdu à moins de terminer l'excavation de nouveau.",
  'sim.lockpick.lockJammed':
    "La serrure est bloquée, impossible à crocheter : terminez l'excavation de nouveau pour une autre tentative.",
  'sim.lockpick.lockYields': 'La serrure cède! Butin {tier}.',
  // Mobile touch controls: the hotbar page-flip button and its accessible name.
  'hudChrome.mobile.hotbarPageAria': 'Afficher la prochaine série de techniques',
  // Corpse-harvest focus picker (window title, confirm button, component labels).
  // Aura effect tooltip summaries.
  'hudChrome.auraEffect.dot': 'Cause {value} points de dégâts de {school} toutes les {interval} s',
  'hudChrome.auraEffect.hot': 'Redonne {value} points de vie toutes les {interval} s',
  'hudChrome.auraEffect.absorb': 'Bloque {value} points de dégâts',
  'hudChrome.auraEffect.healAbsorb': 'Bloque {value} points de soins reçus',
  'hudChrome.auraEffect.thorns': 'Cause {value} points de dégâts de {school} aux attaquants',
  'hudChrome.auraEffect.slow': 'Diminue la vitesse de déplacement de {pct}%',
  'hudChrome.auraEffect.speed': 'Accroît la vitesse de déplacement de {pct}%',
  'hudChrome.auraEffect.attackSpeedSlow': "Diminue la vitesse d'attaque de {pct}%",
  'hudChrome.auraEffect.attackSpeedFast': "Accroît la vitesse d'attaque de {pct}%",
  'hudChrome.auraEffect.haste': "Accroît la vitesse d'attaque et d'incantation de {pct}%",
  'hudChrome.auraEffect.tongues': "Accroît le temps d'incantation de {pct}%",
  'hudChrome.auraEffect.increase.ap': "Accroît la puissance d'attaque de {value}",
  'hudChrome.auraEffect.increase.armor': "Accroît l'armure de {value}",
  'hudChrome.auraEffect.increase.int': "Accroît l'intelligence de {value}",
  'hudChrome.auraEffect.increase.agi': "Accroît l'agilité de {value}",
  'hudChrome.auraEffect.increase.sta': "Accroît l'endurance de {value}",
  'hudChrome.auraEffect.increase.spi': "Accroît l'esprit de {value}",
  'hudChrome.auraEffect.increase.allStats': 'Accroît tous les attributs de {value}',
  'hudChrome.auraEffect.reduce.ap': "Diminue la puissance d'attaque de {value}",
  'hudChrome.auraEffect.reduce.armor': "Diminue l'armure de {value}",
  'hudChrome.auraEffect.reduce.int': "Diminue l'intelligence de {value}",
  'hudChrome.auraEffect.reduce.agi': "Diminue l'agilité de {value}",
  'hudChrome.auraEffect.reduce.sta': "Diminue l'endurance de {value}",
  'hudChrome.auraEffect.reduce.spi': "Diminue l'esprit de {value}",
  'hudChrome.auraEffect.reduce.allStats': 'Diminue tous les attributs de {value}',
  'hudChrome.auraEffect.dodge': "Accroît les chances d'esquive de {pct}%",
  'hudChrome.auraEffect.dodgeReduce': "Diminue les chances d'esquive de {pct}%",
  'hudChrome.auraEffect.armorFlat': "Diminue l'armure de {value}",
  'hudChrome.auraEffect.armorFlatStacks': "Diminue l'armure de {value} ({stacks} charges)",
  'hudChrome.auraEffect.mortalWound': 'Diminue les soins reçus de {pct}%',
  'hudChrome.auraEffect.vulnerability': 'Accroît les dégâts subis de {pct}%',
  'hudChrome.auraEffect.physVuln': 'Accroît les dégâts physiques subis de {pct}%',
  'hudChrome.auraEffect.spellVuln': 'Accroît les dégâts magiques subis de {pct}%',
  'hudChrome.auraEffect.critVuln': 'Accroît les chances de subir un coup critique de {pct}%',
  'hudChrome.auraEffect.costTax': 'Accroît le coût des techniques de {pct}%',
  'hudChrome.auraEffect.stun': "Sonné : impossible d'agir",
  'hudChrome.auraEffect.root': 'Immobilisé : impossible de bouger',
  'hudChrome.auraEffect.incapacitate': "Neutralisé, impossible d'agir",
  'hudChrome.auraEffect.polymorph': "Transformé : impossible d'agir",
  'hudChrome.auraEffect.hex': 'Diminue les dégâts et soins prodigués de {pct}%',
  'hudChrome.auraEffect.blind': "Aveuglé, impossible d'agir",
  'hudChrome.auraEffect.silence': 'Diminue au silence : impossible de lancer des sorts',
  'hudChrome.auraEffect.disarm': "Désarmé, impossible d'utiliser des attaques d'arme",
  'hudChrome.auraEffect.lockout': 'École de magie verrouillée',
  'hudChrome.auraEffect.imbue': 'Arme enchantée avec effets bonus',
  'hudChrome.auraEffect.imbueRange': 'Arme enchantée : {min} à {max} dégâts bonus au Verdict',
  'hudChrome.auraEffect.stealth': 'Dissimulé ; vitesse de déplacement réduite de {pct}%',
  'hudChrome.auraEffect.formBear': 'Forme de Bruin : points de vie et armure accrus',
  'hudChrome.auraEffect.formCat': 'Forme féline : dégâts de mêlée et énergie',
  'hudChrome.auraEffect.formTravel': 'Forme de Fleet : vitesse de déplacement accrue de {pct}%',
  'hudChrome.auraEffect.defensiveStance':
    'Guarded Stance : dégâts encaissés réduits, menace accrue',
  'hudChrome.auraEffect.righteousFury':
    'Burning Oath : menace générée par les dégâts Sacrés fortement accrue',
  'hudChrome.auraEffect.scale': 'Gabarit augmentée de {pct}%',
  'hudChrome.auraEffect.jump': 'Saut augmentée de {pct}%',
  'hudChrome.auraEffect.school.physical': 'physique',
  'hudChrome.auraEffect.school.fire': 'feu',
  'hudChrome.auraEffect.school.frost': 'froid',
  'hudChrome.auraEffect.school.arcane': 'arcane',
  'hudChrome.auraEffect.school.shadow': 'ombre',
  'hudChrome.auraEffect.school.holy': 'sacré',
  'hudChrome.auraEffect.school.nature': 'nature',
  'guide.deedsPage.cat.delve': 'Excavations',
  'hudChrome.deeds.catDelve': 'Excavations',
  'hudChrome.auraEffect.battleStance': 'Posture de combat : génération de rage accrue de 10%',
  'hudChrome.auraEffect.berserkerStance':
    'Posture de berserker : coups critiques 3% plus fréquents et 3% plus puissants',
  'hudChrome.auraEffect.crit': 'Accroît les chances de coup critique de {pct}%',
  'hudChrome.auraEffect.rageGen': 'Accroît la génération de rage de {pct}%',
  'hudChrome.auraEffect.reckless':
    'Accroît les chances de coup critique de {pct}% et la génération de rage de {ragePct}%',
  'hudChrome.auraEffect.avatar': 'Colosse : dégâts infligés accrus de {pct}%',
  'hudChrome.auraEffect.bloodbath':
    'Accroît les chances de coup critique et les dégâts infligés de {pct}%',
  'hudChrome.auraEffect.dieBySword': 'Diminue les dégâts subis de {pct}%',
  'hudChrome.auraEffect.victoryRush': 'Élan de victoire est prêt',
  'hudChrome.auraEffect.maxHpPct': 'Accroît les points de vie maximum de {pct}%',
  'hudChrome.statInfo.desc.parry':
    'Vos chances de parer entièrement une attaque de mêlée de front, sans subir de dégâts. Un coup porté dans le dos ne peut pas être paré.',
  'hudChrome.options.mouseoverCast': 'Lancement au survol sur les cadres de groupe',
  'abilityUi.cast.gathering': '[FR-CA] Gathering',
  'hud.errors.tradeBound': '[FR-CA] That item is bound and cannot be traded.',
  'hud.social.status.afk': '[FR-CA] Away',
  'stats.charactersCreated': '[FR-CA] Characters Created',
  'entities.items.acolyte_chain_grips.name': '[FR-CA] Acolyte Chain Grips',
  'entities.items.briarroot_staff.name': '[FR-CA] Briarroot Staff',
  'entities.items.cragprowl_belt.name': '[FR-CA] Cragprowl Belt',
  'entities.items.cragthorn_greatstaff.name': '[FR-CA] Cragthorn Greatstaff',
  'entities.items.cragward_pauldrons.name': '[FR-CA] Cragward Pauldrons',
  'entities.items.cryptbloom_shoulderguards.name': '[FR-CA] Cryptbloom Shoulderguards',
  'entities.items.dreamroot_boots.name': '[FR-CA] Dreamroot Boots',
  'entities.items.duskthorn_mantle.name': '[FR-CA] Duskthorn Mantle',
  'entities.items.fenbark_leggings.name': '[FR-CA] Fenbark Leggings',
  'entities.items.fenshadow_maul.name': '[FR-CA] Fenshadow Maul',
  'entities.items.fenwarden_sabatons.name': '[FR-CA] Fenwarden Sabatons',
  'entities.items.gravewyrm_thornmaul.name': '[FR-CA] Gravewyrm Thornmaul',
  'entities.items.grovewardens_grips.name': '[FR-CA] Grovewarden\'s Grips',
  'entities.items.lunarward_cinch.name': '[FR-CA] Lunarward Cinch',
  'entities.items.marshlight_hauberk.name': '[FR-CA] Marshlight Hauberk',
  'entities.items.maul_of_the_scourged_wilds.name': '[FR-CA] Maul of the Scourged Wilds',
  'entities.items.mirebloom_treads.name': '[FR-CA] Mirebloom Treads',
  'entities.items.moonbark_vestments.name': '[FR-CA] Moonbark Vestments',
  'entities.items.mosshide_vest.name': '[FR-CA] Mosshide Vest',
  'entities.items.nightfangs_greatstaff.name': '[FR-CA] Nightfang\'s Greatstaff',
  'entities.items.peaksong_helm.name': '[FR-CA] Peaksong Helm',
  'entities.items.pearlward_aegis.name': '[FR-CA] Pearlward Aegis',
  'entities.items.resonant_hide.name': '[FR-CA] Resonant Hide',
  'entities.items.resonant_links.name': '[FR-CA] Resonant Links',
  'entities.items.resonant_steel.name': '[FR-CA] Resonant Steel',
  'entities.items.resonant_thread.name': '[FR-CA] Resonant Thread',
  'entities.items.resonant_timber.name': '[FR-CA] Resonant Timber',
  'entities.items.revenantstep_treads.name': '[FR-CA] Revenantstep Treads',
  'entities.items.shardfang_grips.name': '[FR-CA] Shardfang Grips',
  'entities.items.shardsong_mantle.name': '[FR-CA] Shardsong Mantle',
  'entities.items.stormbark_mantle.name': '[FR-CA] Stormbark Mantle',
  'entities.items.stormchant_gauntlets.name': '[FR-CA] Stormchant Gauntlets',
  'entities.items.stormroot_cowl.name': '[FR-CA] Stormroot Cowl',
  'entities.items.stormvotive_hauberk.name': '[FR-CA] Stormvotive Hauberk',
  'entities.items.thornling_grips.name': '[FR-CA] Thornling Grips',
  'entities.items.thornpeak_wildwraps.name': '[FR-CA] Thornpeak Wildwraps',
  'entities.items.thunderward_legguards.name': '[FR-CA] Thunderward Legguards',
  'entities.items.tidehymn_slippers.name': '[FR-CA] Tidehymn Slippers',
  'entities.items.valefire_lantern.name': '[FR-CA] Valefire Lantern',
  'entities.items.verdant_walkers.name': '[FR-CA] Verdant Walkers',
  'entities.items.vestments_of_the_waking_grove.name': '[FR-CA] Vestments of the Waking Grove',
  'entities.items.votive_chain_belt.name': '[FR-CA] Votive Chain Belt',
  'entities.items.wildgrove_cinch.name': '[FR-CA] Wildgrove Cinch',
  'entities.items.wildgrowth_leggings.name': '[FR-CA] Wildgrowth Leggings',
  'entities.items.wildsoul_maul.name': '[FR-CA] Wildsoul Maul',
  'entities.items.wyrmcult_spellgrips.name': '[FR-CA] Wyrmcult Spellgrips',
  'entities.letters.mastery_reset_notice.body':
    '[FR-CA] Guildmate,\n\nThe guild has adopted a new reckoning of mastery. Every hand starts the climb again: your craft skills and your gathering proficiencies have been set to zero.\n\nEverything else is yours, untouched: your recipes, your tools and materials, your bank and gold, your attunements and titles, your deeds and renown, your quests and mail.\n\nThe climb is honest now. Cheap work will not carry you. Seek harder recipes, richer veins, and deeper waters.\n\nWith respect,\nThe Guildhall',
  'entities.letters.mastery_reset_notice.sender': '[FR-CA] The Guildhall',
  'entities.letters.mastery_reset_notice.subject': '[FR-CA] Your craft, made honest',
  'entities.letters.prof_tier_alchemy_cooking_1.body':
    '[FR-CA] Word drifts back to my kitchen that one of your majors has reached uncommon work. It is a first taste, nothing more, but a promising one. Keep the pot moving.',
  'entities.letters.prof_tier_alchemy_cooking_1.sender': '[FR-CA] Cook Marlow',
  'entities.letters.prof_tier_alchemy_cooking_1.subject': '[FR-CA] A taste of things to come',
  'entities.letters.prof_tier_alchemy_cooking_2.body':
    '[FR-CA] They tell me a major of yours has simmered up to rare work. That is the heat where most cooks scorch the dish, and you did not. Sit, but not for long.',
  'entities.letters.prof_tier_alchemy_cooking_2.sender': '[FR-CA] Cook Marlow',
  'entities.letters.prof_tier_alchemy_cooking_2.subject': '[FR-CA] Rare work, and no burnt edges',
  'entities.letters.prof_tier_alchemy_cooking_3.body':
    '[FR-CA] One of your majors has bubbled past rare into real depth. Now you are cooking, as they say. Season boldly and keep tasting.',
  'entities.letters.prof_tier_alchemy_cooking_3.sender': '[FR-CA] Cook Marlow',
  'entities.letters.prof_tier_alchemy_cooking_3.subject': '[FR-CA] Now you are cooking',
  'entities.letters.prof_tier_alchemy_cooking_4.body':
    '[FR-CA] A major of yours is a single course short of mastery. The last one is always the richest and the easiest to overdo. Steady hands on the ladle.',
  'entities.letters.prof_tier_alchemy_cooking_4.sender': '[FR-CA] Cook Marlow',
  'entities.letters.prof_tier_alchemy_cooking_4.subject': '[FR-CA] One course from the feast',
  'entities.letters.prof_tier_alchemy_cooking_5.body':
    '[FR-CA] A major of yours has reached mastery, the top shelf of the whole pantry. I feed everyone, but few ever cook their way up here. Proud of you, truly. Now go make something that makes them weep at the table.',
  'entities.letters.prof_tier_alchemy_cooking_5.sender': '[FR-CA] Cook Marlow',
  'entities.letters.prof_tier_alchemy_cooking_5.subject': '[FR-CA] Mastery, served hot',
  'entities.letters.prof_tier_engineering_alchemy_1.body':
    '[FR-CA] Oi, the numbers say one of your majors just hit uncommon work, small potatoes, tiny, but it POPPED, yes? First spark is always the cutest. More sparks. Go.',
  'entities.letters.prof_tier_engineering_alchemy_1.sender': '[FR-CA] Tinker Gizzel',
  'entities.letters.prof_tier_engineering_alchemy_1.subject': '[FR-CA] FIRST spark, ha',
  'entities.letters.prof_tier_engineering_alchemy_2.body':
    '[FR-CA] They tell me a major of yours climbed to rare work, and rare is where it starts getting properly dangerous (the good kind). Most hands quit before the fun. Not you. HA.',
  'entities.letters.prof_tier_engineering_alchemy_2.sender': '[FR-CA] Tinker Gizzel',
  'entities.letters.prof_tier_engineering_alchemy_2.subject': '[FR-CA] Rare, oh, RARE',
  'entities.letters.prof_tier_engineering_alchemy_3.body':
    '[FR-CA] One of your majors blew past rare into the serious stuff, oh this is where it gets LOUD. Do not stop now, whatever you do, momentum is everything, also fuses.',
  'entities.letters.prof_tier_engineering_alchemy_3.sender': '[FR-CA] Tinker Gizzel',
  'entities.letters.prof_tier_engineering_alchemy_3.subject': '[FR-CA] Now it gets loud',
  'entities.letters.prof_tier_engineering_alchemy_4.body':
    '[FR-CA] A major of yours is ONE rung under mastery, one, singular, do you feel it humming? The last step is the biggest bang. Do not blink.',
  'entities.letters.prof_tier_engineering_alchemy_4.sender': '[FR-CA] Tinker Gizzel',
  'entities.letters.prof_tier_engineering_alchemy_4.subject': '[FR-CA] One rung, ONE, from the top',
  'entities.letters.prof_tier_engineering_alchemy_5.body':
    '[FR-CA] A major of yours hit mastery, the very TOP, kaboom, the whole ladder, done. I do not hand out praise, I hand out fuses, but here, take both: you are brilliant and slightly terrifying. Go make the mountains nervous.',
  'entities.letters.prof_tier_engineering_alchemy_5.sender': '[FR-CA] Tinker Gizzel',
  'entities.letters.prof_tier_engineering_alchemy_5.subject': '[FR-CA] MASTERY, kaboom',
  'entities.letters.prof_tier_leatherworking_tailoring_1.body':
    '[FR-CA] The guild notes that one of your majors has reached uncommon work. It is only the first row of many, but it is even and true. Measure the next as carefully.',
  'entities.letters.prof_tier_leatherworking_tailoring_1.sender': '[FR-CA] Weaver Ottilie',
  'entities.letters.prof_tier_leatherworking_tailoring_1.subject': '[FR-CA] An even first row',
  'entities.letters.prof_tier_leatherworking_tailoring_2.body':
    '[FR-CA] A major of yours has climbed to rare work. That is where a careless hand shows every dropped stitch, and yours has not. I am quietly pleased.',
  'entities.letters.prof_tier_leatherworking_tailoring_2.sender': '[FR-CA] Weaver Ottilie',
  'entities.letters.prof_tier_leatherworking_tailoring_2.subject': '[FR-CA] Rare work, well measured',
  'entities.letters.prof_tier_leatherworking_tailoring_3.body':
    '[FR-CA] One of your majors has passed rare into finer work. The pattern comes clear to a hand at this level, no more guessing. Keep measuring twice.',
  'entities.letters.prof_tier_leatherworking_tailoring_3.sender': '[FR-CA] Weaver Ottilie',
  'entities.letters.prof_tier_leatherworking_tailoring_3.subject': '[FR-CA] The pattern comes clear',
  'entities.letters.prof_tier_leatherworking_tailoring_4.body':
    '[FR-CA] A major of yours sits one row short of mastery. The last row is always the hardest to keep even. Do not rush it now.',
  'entities.letters.prof_tier_leatherworking_tailoring_4.sender': '[FR-CA] Weaver Ottilie',
  'entities.letters.prof_tier_leatherworking_tailoring_4.subject': '[FR-CA] One row from the top',
  'entities.letters.prof_tier_leatherworking_tailoring_5.body':
    '[FR-CA] A major of yours has reached mastery. I measured your work twice, as I measure everything, and it holds. Few hands ever tie the last stitch this cleanly. I am proud, and I do not say so lightly.',
  'entities.letters.prof_tier_leatherworking_tailoring_5.sender': '[FR-CA] Weaver Ottilie',
  'entities.letters.prof_tier_leatherworking_tailoring_5.subject': '[FR-CA] The last stitch',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_1.body':
    '[FR-CA] Word reaches my forge that one of your majors now holds at uncommon work. It is the smallest rung on a long climb, but you earned it at the anvil, not by asking. Keep the fire hot.',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_1.sender': '[FR-CA] Forgemistress Darva',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_1.subject': '[FR-CA] A spark worth noting',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_2.body':
    '[FR-CA] They tell me a major of yours has reached rare work. That is the rung where sloppy hands fall away and the real smiths are left standing. You are still standing. Good.',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_2.sender': '[FR-CA] Forgemistress Darva',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_2.subject': '[FR-CA] Rare work, and earned',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_3.body':
    '[FR-CA] A major of yours has climbed past rare into serious work. The metal answers a hand like that, no longer fighting it. Do not let the praise soften your arm.',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_3.sender': '[FR-CA] Forgemistress Darva',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_3.subject': '[FR-CA] The metal answers you now',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_4.body':
    '[FR-CA] One of your majors stands a single rung below mastery. Few hands I have known reach this height, and fewer keep their edge here. Finish the climb.',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_4.sender': '[FR-CA] Forgemistress Darva',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_4.subject': '[FR-CA] Near the top of the ladder',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_5.body':
    '[FR-CA] A major of yours has reached mastery, the highest a hand can climb. I do not give praise freely, so hear this once: the forge is proud of you. Now go teach the fire something new.',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_5.sender': '[FR-CA] Forgemistress Darva',
  'entities.letters.prof_tier_weaponcrafting_armorcrafting_5.subject': '[FR-CA] Mastery, at last',
  'entities.quests.q_prof_amends_apothecary.completion':
    '[FR-CA] There is the old flavor. Alchemy and Cooking are back on your stove as majors. Stay a while this time.',
  'entities.quests.q_prof_amends_apothecary.objectives.0.label': '[FR-CA] Wild Boar hunted',
  'entities.quests.q_prof_amends_apothecary.text':
    '[FR-CA] Well, look who is back at my pot. No hard feelings, {playerName}, a kitchen always has room, but you know the tab runs longer every time you walk out on it. Go thin the wild boars in the east meadow, because honest sweat is the first ingredient, and it will remind your hands of the work.',
  'entities.quests.q_prof_amends_apothecary.title': '[FR-CA] Back on the Stove',
  'entities.quests.q_prof_amends_bombardier.completion':
    '[FR-CA] THERE it is, the itch is back in your hands. Engineering and Alchemy, majors again, go on, go make a bang. Try to stay put this time, eh?',
  'entities.quests.q_prof_amends_bombardier.objectives.0.label': '[FR-CA] Tunnel Rat exterminated',
  'entities.quests.q_prof_amends_bombardier.text':
    '[FR-CA] You came BACK, ha, they always come back, the loud stuff has a pull, yes? No sulking from me, {playerName}, but the ledger, oh the ledger, it grows every time you skip out, more each return, that is only fair. Go clear the tunnel rats out of the dig for me, sweat first, sparks later, that is the rule I just made up.',
  'entities.quests.q_prof_amends_bombardier.title': '[FR-CA] The Ledger Grows',
  'entities.quests.q_prof_amends_outfitter.completion':
    '[FR-CA] Steady again. Leatherworking and Tailoring return to your hands as majors. Measure twice this time before you wander.',
  'entities.quests.q_prof_amends_outfitter.objectives.0.label': '[FR-CA] Webwood Spider culled',
  'entities.quests.q_prof_amends_outfitter.text':
    '[FR-CA] Back at my loom after all. I hold no grudge, {playerName}, but the thread remembers a hand that let it go, and the cost of taking it up again is measured out longer each time. Cull the webwood spiders crowding the western woods, and the labor will settle your hands before they touch good silk again.',
  'entities.quests.q_prof_amends_outfitter.title': '[FR-CA] Threads Rejoined',
  'entities.quests.q_prof_amends_smith.completion':
    '[FR-CA] The rhythm is back in your hands. Weaponcrafting and Armorcrafting are your majors once more. Do not make a habit of leaving.',
  'entities.quests.q_prof_amends_smith.objectives.0.label': '[FR-CA] Forest Wolf slain',
  'entities.quests.q_prof_amends_smith.text':
    '[FR-CA] So you have come back to the forge. I will not pretend it does not sting, {playerName}, but I am a fair hand and the work is fair too. You know the price of returning: labor, and more of it each time you have strayed. Put down the wolves harrying the north road, and the swing of it will remind your arms what this pair once asked of them.',
  'entities.quests.q_prof_amends_smith.title': '[FR-CA] Back to the Forge',
  'entities.quests.q_prof_attune_apothecary.completion':
    '[FR-CA] Now that is a start with some meat on it. Alchemy and Cooking are yours to cook as high as you like. Come back hungry.',
  'entities.quests.q_prof_attune_apothecary.objectives.0.label': '[FR-CA] Wild Boar hunted',
  'entities.quests.q_prof_attune_apothecary.text':
    '[FR-CA] Every good dish is two flavors that belong together, and so is a good craft, {playerName}. Sit with me and Alchemy and Cooking become your two majors, the two you may simmer past rare work; the craft on the far side of the wheel is your hobby, seasoned up to rare and no hotter. The rest of your trades keep in the pantry, dormant, not spoiled, ready whenever you fetch them back. Fair warning while the pot is still cold: wander off to another pair and coming home is a chore that grows, five beasts seen to the first time, eight the next, eleven the time after, heavier with every helping. Still hungry for it? Then hunt me four wild boars, because a kitchen worth its salt starts with good meat.',
  'entities.quests.q_prof_attune_apothecary.title': '[FR-CA] A Recipe Worth Keeping',
  'entities.quests.q_prof_attune_bombardier.completion':
    '[FR-CA] HA. Reagents, real ones, and all your fingers still attached, good, good. Engineering and Alchemy, yours, go make something that regrets it. Off you go.',
  'entities.quests.q_prof_attune_bombardier.objectives.0.label': '[FR-CA] Herb patch harvested',
  'entities.quests.q_prof_attune_bombardier.text':
    '[FR-CA] Oh, oh, you want the good stuff, the loud stuff, yes? Listen, listen, before you touch anything that ticks: say the word and Engineering and Alchemy become your two majors, the only two you get to push past rare work (that is where it gets FUN, trust me). The craft opposite goes in your pocket as a hobby, rare and no further, do not pout. Your other trades? Not gone, {playerName}, just napping, dormant, wake them whenever you like. But (there is always a but, hold the fuse) ditch this pair and waddle back later and it costs you sweat that piles up, five things put down the first time, eight the next, eleven after, more, more, every single time you get cold feet. Yes? YES? Then go pick me three patches of herbs, the volatile ones, do not ask which, they are all a little volatile if you believe hard enough.',
  'entities.quests.q_prof_attune_bombardier.title': '[FR-CA] A Volatile Arrangement',
  'entities.quests.q_prof_attune_outfitter.completion':
    '[FR-CA] Even thread, even hand. Leatherworking and Tailoring are yours to carry as far as your skill will reach. Measure twice, and they will not fail you.',
  'entities.quests.q_prof_attune_outfitter.objectives.0.label': '[FR-CA] Webwood Spider culled',
  'entities.quests.q_prof_attune_outfitter.text':
    '[FR-CA] Measure the cost before you cut, that is the first rule at my loom. Choose me and Leatherworking and Tailoring become your two majors, the pair you may carry beyond rare work; the craft opposite them settles in as your hobby, taken to rare and left there. The trades you set aside are not unravelled, {playerName}, only folded away, dormant until you take them up again. Be certain, though: should you leave this pair and later want it back, the way home is paid in labor that lengthens each time, five culled at first, then eight, then eleven, always a little more. If your mind is made, cull four webwood spiders and bring their silk to the loom, for good thread starts every good garment.',
  'entities.quests.q_prof_attune_outfitter.title': '[FR-CA] The Outfitter\'s Measure',
  'entities.quests.q_prof_attune_smith.completion':
    '[FR-CA] Good ore, and good hands to work it. Weaponcrafting and Armorcrafting are yours to master now. Earn the rest.',
  'entities.quests.q_prof_attune_smith.objectives.0.label': '[FR-CA] Ore vein harvested',
  'entities.quests.q_prof_attune_smith.text':
    '[FR-CA] Steel does not forgive a wandering hand, so I will tell you plain before you swear anything. Bind yourself to my forge and Weaponcrafting and Armorcrafting become your two majors, the only crafts you may carry past rare work. The craft across the wheel from them settles in as your hobby, worked to rare and no further. Your other trades do not burn away, {playerName}: they simply go quiet, dormant until you call them back. And know this before the hammer falls: leave this pair for another and you will crawl back through honest labor to return to it, five foes put down the first time you come home, eight the next, eleven after that, more each time you stray. Still standing here? Then bring me three veins of ore worked from the Vale with your own hands, and we will call the promise struck.',
  'entities.quests.q_prof_attune_smith.title': '[FR-CA] The Smith\'s Promise',
  'entities.quests.q_prof_workorder_apothecary.completion':
    '[FR-CA] Acceptable. Potent, and properly handled. Your payment, counted to the coin. Do not let it go to your head, that is a different reagent.',
  'entities.quests.q_prof_workorder_apothecary.objectives.0.label': '[FR-CA] Goldleaf Herb delivered',
  'entities.quests.q_prof_workorder_apothecary.text':
    '[FR-CA] My shelves require goldleaf, and the market\'s stock is, predictably, adulterated. Bring me six goldleaf herbs, unbruised, and you will be compensated precisely. Bruised leaves will be declined, so mind your satchel.',
  'entities.quests.q_prof_workorder_apothecary.title': '[FR-CA] Apothecary Work Order',
  'entities.quests.q_prof_workorder_forge.completion': '[FR-CA] Good weight, no slag. Here is your due. The forge will be hungry again soon enough.',
  'entities.quests.q_prof_workorder_forge.objectives.0.label': '[FR-CA] Copper Ore delivered',
  'entities.quests.q_prof_workorder_forge.text':
    '[FR-CA] The forge always wants feeding, {playerName}. Bring me eight lumps of copper ore and I will see you paid for the haul. No ceremony, just ore and coin.',
  'entities.quests.q_prof_workorder_forge.title': '[FR-CA] Forge Work Order',
  'entities.quests.q_prof_workorder_kitchens.completion':
    '[FR-CA] Now that is a full pantry. Here is your pay. Come back when your bags are heavy again.',
  'entities.quests.q_prof_workorder_kitchens.objectives.0.label': '[FR-CA] Game Meat delivered',
  'entities.quests.q_prof_workorder_kitchens.text':
    '[FR-CA] My larder is looking thin, {playerName}, and thin larders make grumpy cooks. Fetch me eight cuts of game meat and there is coin in it for you, plus my undying gratitude, which is worth less but tastes better.',
  'entities.quests.q_prof_workorder_kitchens.title': '[FR-CA] Kitchens Work Order',
  'entities.quests.q_prof_workorder_loom.completion':
    '[FR-CA] Fine silk, evenly spun. Your coin, exactly measured. The loom thanks you, and so do I.',
  'entities.quests.q_prof_workorder_loom.objectives.0.label': '[FR-CA] Spider Silk delivered',
  'entities.quests.q_prof_workorder_loom.text':
    '[FR-CA] The loom runs dry and idle hands waste daylight, {playerName}. Bring me six skeins of spider silk and I will pay you a fair rate, counted out to the copper.',
  'entities.quests.q_prof_workorder_loom.title': '[FR-CA] Loom Work Order',
  'entities.quests.q_prof_workorder_tannery.completion': '[FR-CA] Good hides. Fair pay. Again when you have more.',
  'entities.quests.q_prof_workorder_tannery.objectives.0.label': '[FR-CA] Rough Hide delivered',
  'entities.quests.q_prof_workorder_tannery.text': '[FR-CA] Vats are empty. Bring eight rough hides. Coin when you do.',
  'entities.quests.q_prof_workorder_tannery.title': '[FR-CA] Tannery Work Order',
  'entities.quests.q_prof_workorder_toolworks.completion':
    '[FR-CA] Perfect, perfect, straight grain, no rot. Here, your coin, see, I keep my word (mostly). Bring more when you trip over a tree.',
  'entities.quests.q_prof_workorder_toolworks.objectives.0.label': '[FR-CA] Ironbark Log delivered',
  'entities.quests.q_prof_workorder_toolworks.text':
    '[FR-CA] Hafts, handles, stocks, I go through wood like it is going out of style, which it is NOT, wood is eternal, {playerName}. Haul me eight ironbark logs and I will pay you, coin, real coin, not a favor, I promise, mostly.',
  'entities.quests.q_prof_workorder_toolworks.title': '[FR-CA] Toolworks Work Order',
  'hudChrome.bags.itemAriaInstanced': '[FR-CA] {item}, quantity {count}, maker-marked copy',
  'hudChrome.charSheet.defense': '[FR-CA] Defense',
  'hudChrome.charSheet.offense': '[FR-CA] Offense',
  'hudChrome.corpseHarvest.harvestTooltip':
    '[FR-CA] Gathers the checked components. Each corpse can be harvested once, first come. Does not take the loot.',
  'hudChrome.crafting.attunedBanner': '[FR-CA] Attuned: {title}',
  'hudChrome.crafting.attunedZoneLine': '[FR-CA] {name} has attuned as {archetype}!',
  'hudChrome.crafting.attunementReturnCost': '[FR-CA] If you leave this pair, returning to it later costs {cost} make-amends tasks.',
  'hudChrome.crafting.difficultyMinimal': '[FR-CA] Minimal skill gain',
  'hudChrome.crafting.gatheredBy': '[FR-CA] Gathered by {name}',
  'hudChrome.crafting.learnMoreAtStation': '[FR-CA] {master} at the {station} can teach you more {craft} recipes.',
  'hudChrome.crafting.tierTutorial.dismiss': '[FR-CA] Got it',
  'hudChrome.crafting.tierTutorial.masters':
    '[FR-CA] Craft masters in the towns offer attunement quests. Visit one to choose your pair whenever you are ready. Nothing you have learned is ever lost.',
  'hudChrome.crafting.tierTutorial.radar':
    '[FR-CA] Your professions form a wheel. Attune to an adjacent pair and those two crafts become uncapped majors, one craft across the wheel becomes a rare-capped hobby, and the rest lie dormant: their knowledge kept, but capped at common until you take them up again.',
  'hudChrome.crafting.tierTutorial.tierCap':
    '[FR-CA] A craft reaches its first tier at {skill} skill, and each tier improves what it can make. But a craft only climbs past rare work once it is one of your two majors.',
  'hudChrome.crafting.tierTutorial.title': '[FR-CA] Your First Tier',
  'hudChrome.crafting.trendNudge': '[FR-CA] Your hands are leaning toward the {archetype}. Its attunement waits with {master}.',
  'hudChrome.crafting.trendNudgeNoMaster': '[FR-CA] Your hands are leaning toward the {archetype}. Seek a craft master to take it up.',
  'hudChrome.enchantName.enchant_chest_armor': '[FR-CA] Enchant Chest - Reinforcement',
  'hudChrome.enchantName.enchant_chest_greater_stamina': '[FR-CA] Enchant Chest - Greater Stamina',
  'hudChrome.enchantName.enchant_chest_runeweave': '[FR-CA] Enchant Chest - Runeweave',
  'hudChrome.enchantName.enchant_chest_spirit': '[FR-CA] Enchant Chest - Spirit',
  'hudChrome.enchantName.enchant_chest_stamina': '[FR-CA] Enchant Chest - Stamina',
  'hudChrome.enchantName.enchant_feet_agility': '[FR-CA] Enchant Boots - Agility',
  'hudChrome.enchantName.enchant_feet_stamina': '[FR-CA] Enchant Boots - Stamina',
  'hudChrome.enchantName.enchant_feet_strength': '[FR-CA] Enchant Boots - Strength',
  'hudChrome.enchantName.enchant_gloves_agility': '[FR-CA] Enchant Gloves - Agility',
  'hudChrome.enchantName.enchant_gloves_greater_agility': '[FR-CA] Enchant Gloves - Greater Agility',
  'hudChrome.enchantName.enchant_gloves_intellect': '[FR-CA] Enchant Gloves - Spellpower',
  'hudChrome.enchantName.enchant_gloves_strength': '[FR-CA] Enchant Gloves - Strength',
  'hudChrome.enchantName.enchant_helmet_armor': '[FR-CA] Enchant Helmet - Reinforcement',
  'hudChrome.enchantName.enchant_helmet_fortitude': '[FR-CA] Enchant Helmet - Fortitude',
  'hudChrome.enchantName.enchant_helmet_greater_fortitude': '[FR-CA] Enchant Helmet - Greater Fortitude',
  'hudChrome.enchantName.enchant_helmet_intellect': '[FR-CA] Enchant Helmet - Intellect',
  'hudChrome.enchantName.enchant_helmet_runed_links': '[FR-CA] Enchant Helmet - Runed Links',
  'hudChrome.enchantName.enchant_legs_greater_stamina': '[FR-CA] Enchant Legs - Greater Stamina',
  'hudChrome.enchantName.enchant_legs_intellect': '[FR-CA] Enchant Legs - Intellect',
  'hudChrome.enchantName.enchant_legs_runed_hide': '[FR-CA] Enchant Legs - Runed Hide',
  'hudChrome.enchantName.enchant_legs_stamina': '[FR-CA] Enchant Legs - Stamina',
  'hudChrome.enchantName.enchant_neck_agility': '[FR-CA] Enchant Necklace - Agility',
  'hudChrome.enchantName.enchant_neck_intellect': '[FR-CA] Enchant Necklace - Intellect',
  'hudChrome.enchantName.enchant_neck_spirit': '[FR-CA] Enchant Necklace - Spirit',
  'hudChrome.enchantName.enchant_ring_agility': '[FR-CA] Enchant Ring - Agility',
  'hudChrome.enchantName.enchant_ring_intellect': '[FR-CA] Enchant Ring - Intellect',
  'hudChrome.enchantName.enchant_ring_spirit': '[FR-CA] Enchant Ring - Spirit',
  'hudChrome.enchantName.enchant_ring_strength': '[FR-CA] Enchant Ring - Strength',
  'hudChrome.enchantName.enchant_shoulder_agility': '[FR-CA] Enchant Shoulders - Agility',
  'hudChrome.enchantName.enchant_shoulder_intellect': '[FR-CA] Enchant Shoulders - Intellect',
  'hudChrome.enchantName.enchant_shoulder_strength': '[FR-CA] Enchant Shoulders - Strength',
  'hudChrome.enchantName.enchant_waist_agility': '[FR-CA] Enchant Belt - Agility',
  'hudChrome.enchantName.enchant_waist_stamina': '[FR-CA] Enchant Belt - Stamina',
  'hudChrome.enchantName.enchant_waist_strength': '[FR-CA] Enchant Belt - Strength',
  'hudChrome.enchantName.enchant_weapon_agility': '[FR-CA] Enchant Weapon - Agility',
  'hudChrome.enchantName.enchant_weapon_greater_might': '[FR-CA] Enchant Weapon - Greater Might',
  'hudChrome.enchantName.enchant_weapon_greater_spellpower': '[FR-CA] Enchant Weapon - Greater Spellpower',
  'hudChrome.enchantName.enchant_weapon_intellect': '[FR-CA] Enchant Weapon - Spellpower',
  'hudChrome.enchantName.enchant_weapon_might': '[FR-CA] Enchant Weapon - Might',
  'hudChrome.enchantName.enchant_weapon_runed_edge': '[FR-CA] Enchant Weapon - Runed Edge',
  'hudChrome.enchantName.enchant_weapon_runed_focus': '[FR-CA] Enchant Weapon - Runed Focus',
  'hudChrome.enchanting.disenchantConfirmBody': '[FR-CA] This destroys {item} and yields arcane materials. This cannot be undone.',
  'hudChrome.enchanting.disenchantConfirmBodySpecial':
    '[FR-CA] This destroys a special copy of {item} (signed, masterwork, or enchanted) and yields arcane materials. This cannot be undone.',
  'hudChrome.enchanting.disenchantConfirmTitle': '[FR-CA] Disenchant {item}?',
  'hudChrome.enchanting.disenchantThrottled': '[FR-CA] You are disenchanting too quickly. Wait a moment and try again.',
  'hudChrome.enchanting.disenchantedLine': '[FR-CA] You disenchant {item}.',
  'hudChrome.enchanting.enchantAppliedLine': '[FR-CA] You enchant {item} with {enchant}.',
  'hudChrome.enchanting.enchantInsufficient': '[FR-CA] You do not have the materials for that enchant.',
  'hudChrome.enchanting.enchantThrottled': '[FR-CA] You are enchanting too quickly. Wait a moment and try again.',
  'hudChrome.enchanting.enchantUnknown': '[FR-CA] That enchant does not exist.',
  'hudChrome.enchanting.enchantWrongSlot': '[FR-CA] That enchant cannot be applied to that item.',
  'hudChrome.enchanting.noEnchants': '[FR-CA] No enchant uses this reagent.',
  'hudChrome.enchanting.noTargets': '[FR-CA] No eligible item to enchant.',
  'hudChrome.enchanting.notDisenchantable': '[FR-CA] You cannot disenchant that.',
  'hudChrome.enchanting.notHeld': '[FR-CA] You do not have that item.',
  'hudChrome.enchanting.notSalvageable': '[FR-CA] You cannot salvage that.',
  'hudChrome.enchanting.pickerTitle': '[FR-CA] Apply Enchant',
  'hudChrome.enchanting.salvageConfirmBody': '[FR-CA] This destroys {item} and yields crafting materials. This cannot be undone.',
  'hudChrome.enchanting.salvageConfirmBodySpecial':
    '[FR-CA] This destroys a special copy of {item} (signed, masterwork, or enchanted) and yields crafting materials. This cannot be undone.',
  'hudChrome.enchanting.salvageConfirmTitle': '[FR-CA] Salvage {item}?',
  'hudChrome.enchanting.salvageThrottled': '[FR-CA] You are salvaging too quickly. Wait a moment and try again.',
  'hudChrome.enchanting.salvagedLine': '[FR-CA] You salvage {item}.',
  'hudChrome.enchanting.targetTitle': '[FR-CA] Choose an item to enchant',
  'hudChrome.gathering.biteLine': '[FR-CA] Something takes the bait!',
  'hudChrome.gathering.catchLine': '[FR-CA] You reel in: {name}',
  'hudChrome.gathering.downgradeFind': '[FR-CA] Bags full: a pristine find slipped away.',
  'hudChrome.gathering.downgradeMark': '[FR-CA] Bags full: the find was stored without its gatherer\'s mark.',
  'hudChrome.gathering.fishing': '[FR-CA] Fishing',
  'hudChrome.gathering.gotAwayLine': '[FR-CA] It got away.',
  'hudChrome.gathering.nodeName.herb': '[FR-CA] Herb Patch',
  'hudChrome.gathering.nodeName.ore': '[FR-CA] Ore Vein',
  'hudChrome.gathering.nodeName.wood': '[FR-CA] Timber Stand',
  'hudChrome.gathering.stateCooldown': '[FR-CA] Respawning',
  'hudChrome.gathering.stateReady': '[FR-CA] Ready',
  'hudChrome.gathering.tierRequired.herbalism': '[FR-CA] Requires a tier {tier} herbalism sickle',
  'hudChrome.gathering.tierRequired.logging': '[FR-CA] Requires a tier {tier} logging axe',
  'hudChrome.gathering.tierRequired.mining': '[FR-CA] Requires a tier {tier} mining pick',
  'hudChrome.gathering.toolTierUnmet.herbalism': '[FR-CA] You need a tier {tier} herbalism sickle to gather this patch.',
  'hudChrome.gathering.toolTierUnmet.logging': '[FR-CA] You need a tier {tier} logging axe to fell this stand.',
  'hudChrome.gathering.toolTierUnmet.mining': '[FR-CA] You need a tier {tier} mining pick to harvest this vein.',
  'hudChrome.gathering.toolTierUnmetCorpse': '[FR-CA] You need a tier {tier} gathering tool to recover the finest materials.',
  'hudChrome.interfaceTabs.chat': '[FR-CA] Chat',
  'hudChrome.interfaceTabs.combat': '[FR-CA] Combat',
  'hudChrome.interfaceTabs.frames': '[FR-CA] Frames',
  'hudChrome.interfaceTabs.general': '[FR-CA] General',
  'hudChrome.itemMenu.applyEnchant': '[FR-CA] Apply Enchant',
  'hudChrome.itemMenu.disenchant': '[FR-CA] Disenchant',
  'hudChrome.itemMenu.equip': '[FR-CA] Equip',
  'hudChrome.itemMenu.salvage': '[FR-CA] Salvage',
  'hudChrome.itemMenu.use': '[FR-CA] Use',
  'hudChrome.loot.takeLootButton': '[FR-CA] Take Loot',
  'hudChrome.loot.takeLootTooltip': '[FR-CA] Takes the coins and dropped items. Does not use up the harvest.',
  'hudChrome.loot.unifiedPressHint': '[FR-CA] The interact key loots and harvests in one press, using your town focus.',
  'hudChrome.nameplate.afkTag': '[FR-CA] AFK',
  'hudChrome.professions.nextUnlockMastered': '[FR-CA] Mastered, for now',
  'hudChrome.social.hideOffline': '[FR-CA] Hide offline',
  'hudChrome.social.hideOfflineTitle': '[FR-CA] Hide offline guild members',
  'hudChrome.social.offlineHeader': '[FR-CA] Offline ({n})',
  'hudChrome.social.onlineHeader': '[FR-CA] Online ({n})',
  'hudChrome.townFocus.tierHint':
    '[FR-CA] Every {points} points on a component raise its harvest tier one step, up to {steps} steps; fewer than {points} points still boost the yield.',
  'hudChrome.townFocus.townOnlyHint': '[FR-CA] Focus can only be changed while you are in town.',
};
