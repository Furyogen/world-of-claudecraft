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
  'delveUi.shop.buyConfirmAccept': '[FR-CA] Buy',
  'delveUi.shop.buyConfirmBody':
    '[FR-CA] Buy {item} for {marks} Delve Marks? Marks purchases cannot be refunded.',
  'delveUi.shop.buyConfirmCancel': '[FR-CA] Cancel',
  'delveUi.shop.buyConfirmTitle': '[FR-CA] Confirm Purchase',
  'entities.items.anglers_feast_platter.name': "[FR-CA] Angler's Feast Platter",
  'entities.items.arcanite_war_axe.name': '[FR-CA] Arcanite War Axe',
  'entities.items.ashwood_smoked_eel.name': '[FR-CA] Ashwood Smoked Eel',
  'entities.items.cooking_salt.name': '[FR-CA] Cooking Salt',
  'entities.items.copper_bearded_axe.name': '[FR-CA] Copper Bearded Axe',
  'entities.items.copper_flanged_mace.name': '[FR-CA] Copper Flanged Mace',
  'entities.items.copper_ore.name': '[FR-CA] Copper Ore',
  'entities.items.coppermail_gauntlets.name': '[FR-CA] Coppermail Gauntlets',
  'entities.items.coppermail_sabatons.name': '[FR-CA] Coppermail Sabatons',
  'entities.items.elderwood_battle_staff.name': '[FR-CA] Elderwood Battle Staff',
  'entities.items.elixir_of_the_boar.name': '[FR-CA] Elixir of the Boar',
  'entities.items.elixir_of_the_serpent.name': '[FR-CA] Elixir of the Serpent',
  'entities.items.fenbridge_hide_belt.name': '[FR-CA] Fenbridge Hide Belt',
  'entities.items.fenbridge_hide_boots.name': '[FR-CA] Fenbridge Hide Boots',
  'entities.items.fenbridge_hide_leggings.name': '[FR-CA] Fenbridge Hide Leggings',
  'entities.items.frostgill_chowder.name': '[FR-CA] Frostgill Chowder',
  'entities.items.game_meat.name': '[FR-CA] Game Meat',
  'entities.items.glass_vial.name': '[FR-CA] Glass Vial',
  'entities.items.goldleaf_game_stew.name': '[FR-CA] Goldleaf Game Stew',
  'entities.items.goldleaf_healing_draught.name': '[FR-CA] Goldleaf Healing Draught',
  'entities.items.goldleaf_mana_draught.name': '[FR-CA] Goldleaf Mana Draught',
  'entities.items.goldweave_leggings.name': '[FR-CA] Goldweave Leggings',
  'entities.items.goldweave_robe.name': '[FR-CA] Goldweave Robe',
  'entities.items.herbed_marsh_pike.name': '[FR-CA] Herbed Marsh Pike',
  'entities.items.homespun_cloth.name': '[FR-CA] Homespun Cloth',
  'entities.items.homespun_hood.name': '[FR-CA] Homespun Hood',
  'entities.items.homespun_mitts.name': '[FR-CA] Homespun Mitts',
  'entities.items.hunters_game_skewer.name': "[FR-CA] Hunter's Game Skewer",
  'entities.items.iron_ore.name': '[FR-CA] Iron Ore',
  'entities.items.ironbark_boar_spear.name': '[FR-CA] Ironbark Boar Spear',
  'entities.items.ironbark_log.name': '[FR-CA] Ironbark Log',
  'entities.items.ironedge_longsword.name': '[FR-CA] Ironedge Longsword',
  'entities.items.ironlink_hauberk.name': '[FR-CA] Ironlink Hauberk',
  'entities.items.ironlink_legguards.name': '[FR-CA] Ironlink Legguards',
  'entities.items.ironlink_spaulders.name': '[FR-CA] Ironlink Spaulders',
  'entities.items.ironshod_maul.name': '[FR-CA] Ironshod Maul',
  'entities.items.marlows_grand_roast.name': "[FR-CA] Marlow's Grand Roast",
  'entities.items.marshstalker_hood.name': '[FR-CA] Marshstalker Hood',
  'entities.items.marshstalker_jerkin.name': '[FR-CA] Marshstalker Jerkin',
  'entities.items.marshstalker_spaulders.name': '[FR-CA] Marshstalker Spaulders',
  'entities.items.mirewarden_jerkin.name': '[FR-CA] Mirewarden Jerkin',
  'entities.items.mirewarden_leggings.name': '[FR-CA] Mirewarden Leggings',
  'entities.items.mirewarden_treads.name': '[FR-CA] Mirewarden Treads',
  'entities.items.pan_seared_perch.name': '[FR-CA] Pan-Seared River Perch',
  'entities.items.prime_cut.name': '[FR-CA] Prime Cut',
  'entities.items.pristine_hide.name': '[FR-CA] Pristine Hide',
  'entities.items.pristine_silk.name': '[FR-CA] Pristine Silk',
  'entities.items.pristine_venom_gland.name': '[FR-CA] Pristine Venom Gland',
  'entities.items.riveted_copper_girdle.name': '[FR-CA] Riveted Copper Girdle',
  'entities.items.rough_hide.name': '[FR-CA] Rough Hide',
  'entities.items.silkbinders_raiment.name': "[FR-CA] Silkbinder's Raiment",
  'entities.items.silkspun_satchel.name': '[FR-CA] Silkspun Satchel',
  'entities.items.silvered_carp_supper.name': '[FR-CA] Silvered Carp Supper',
  'entities.items.silverleaf_healing_draught.name': '[FR-CA] Silverleaf Healing Draught',
  'entities.items.silverleaf_herb.name': '[FR-CA] Silverleaf Herb',
  'entities.items.silverleaf_mana_draught.name': '[FR-CA] Silverleaf Mana Draught',
  'entities.items.silverthread_slippers.name': '[FR-CA] Silverthread Slippers',
  'entities.items.smithing_flux.name': '[FR-CA] Smithing Flux',
  'entities.items.spider_silk.name': '[FR-CA] Spider Silk',
  'entities.items.spool_of_thread.name': '[FR-CA] Spool of Thread',
  'entities.items.sunpetal_healing_draught.name': '[FR-CA] Sunpetal Healing Draught',
  'entities.items.sunpetal_mana_draught.name': '[FR-CA] Sunpetal Mana Draught',
  'entities.items.sunweave_mantle.name': '[FR-CA] Sunweave Mantle',
  'entities.items.sunweave_treads.name': '[FR-CA] Sunweave Treads',
  'entities.items.tanning_agent.name': '[FR-CA] Tanning Agent',
  'entities.items.thorium_warblade.name': '[FR-CA] Thorium Warblade',
  'entities.items.thoriumscale_cuirass.name': '[FR-CA] Thoriumscale Cuirass',
  'entities.items.thoriumscale_greathelm.name': '[FR-CA] Thoriumscale Greathelm',
  'entities.items.thoriumscale_leggings.name': '[FR-CA] Thoriumscale Leggings',
  'entities.items.venom_gland.name': '[FR-CA] Venom Gland',
  'entities.items.venomfire_elixir.name': '[FR-CA] Venomfire Elixir',
  'entities.items.whetted_iron_dirk.name': '[FR-CA] Whetted Iron Dirk',
  'entities.letters.guild_trend_alchemy_cooking.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Alchemy and Cooking: draughts simmered and dishes seasoned, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Those who bind this pair earn the name of Apothecary in time. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_alchemy_cooking.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_alchemy_cooking.subject':
    '[FR-CA] Your work in Alchemy and Cooking',
  'entities.letters.guild_trend_armorcrafting_engineering.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Armorcrafting and Engineering: plates riveted and gears trued, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_armorcrafting_engineering.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_armorcrafting_engineering.subject':
    '[FR-CA] Your work in Armorcrafting and Engineering',
  'entities.letters.guild_trend_cooking_leatherworking.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Cooking and Leatherworking: meals plated and hides cured, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_cooking_leatherworking.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_cooking_leatherworking.subject':
    '[FR-CA] Your work in Cooking and Leatherworking',
  'entities.letters.guild_trend_enchanting_jewelcrafting.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Enchanting and Jewelcrafting: charms bound and stones polished, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_enchanting_jewelcrafting.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_enchanting_jewelcrafting.subject':
    '[FR-CA] Your work in Enchanting and Jewelcrafting',
  'entities.letters.guild_trend_engineering_alchemy.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Engineering and Alchemy: charges measured and reagents weighed, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Those who bind this pair earn the name of Bombardier in time. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_engineering_alchemy.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_engineering_alchemy.subject':
    '[FR-CA] Your work in Engineering and Alchemy',
  'entities.letters.guild_trend_inscription_enchanting.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Inscription and Enchanting: scrolls lettered and charms woven, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_inscription_enchanting.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_inscription_enchanting.subject':
    '[FR-CA] Your work in Inscription and Enchanting',
  'entities.letters.guild_trend_jewelcrafting_weaponcrafting.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Jewelcrafting and Weaponcrafting: gems seated and edges ground, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_jewelcrafting_weaponcrafting.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_jewelcrafting_weaponcrafting.subject':
    '[FR-CA] Your work in Jewelcrafting and Weaponcrafting',
  'entities.letters.guild_trend_leatherworking_tailoring.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Leatherworking and Tailoring: leather cut and cloth hemmed, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Those who bind this pair earn the name of Outfitter in time. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_leatherworking_tailoring.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_leatherworking_tailoring.subject':
    '[FR-CA] Your work in Leatherworking and Tailoring',
  'entities.letters.guild_trend_tailoring_inscription.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Tailoring and Inscription: seams stitched and glyphs inked, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_tailoring_inscription.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_tailoring_inscription.subject':
    '[FR-CA] Your work in Tailoring and Inscription',
  'entities.letters.guild_trend_weaponcrafting_armorcrafting.body':
    '[FR-CA] Artisan,\n\nWord reaches the Guild of your work in Weaponcrafting and Armorcrafting: blades tempered and plates fitted, the two crafts feeding one another. Neighboring crafts worked together mark a hand ready for attunement. Those who bind this pair earn the name of Smith in time. Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the masters for now. Prove your craft to him with work of your own hands, and he will see your two majors attuned.\n\nIn good standing,\nThe Crafting Guild',
  'entities.letters.guild_trend_weaponcrafting_armorcrafting.sender': '[FR-CA] The Crafting Guild',
  'entities.letters.guild_trend_weaponcrafting_armorcrafting.subject':
    '[FR-CA] Your work in Weaponcrafting and Armorcrafting',
  'entities.npcs.alchemist_verane.greeting':
    '[FR-CA] Measure twice and pour once, {className}. The apothecary has no patience for spilled reagents.',
  'entities.npcs.alchemist_verane.name': '[FR-CA] Alchemist Verane',
  'entities.npcs.alchemist_verane.title': '[FR-CA] Master of the Apothecary',
  'entities.npcs.cook_marlow.greeting':
    '[FR-CA] Nothing leaves my kitchens half-cooked, {className}. Sit, eat, then get back out there.',
  'entities.npcs.cook_marlow.name': '[FR-CA] Cook Marlow',
  'entities.npcs.cook_marlow.title': '[FR-CA] Master of the Kitchens',
  'entities.npcs.forgemistress_darva.greeting':
    '[FR-CA] The forge answers to me, {className}. Bring good ore and it will answer to you too.',
  'entities.npcs.forgemistress_darva.name': '[FR-CA] Forgemistress Darva',
  'entities.npcs.forgemistress_darva.title': '[FR-CA] Master of the Forge',
  'entities.npcs.tanner_hesk.greeting':
    '[FR-CA] A hide is only as good as its tanning, {className}. The vats are ready when you are.',
  'entities.npcs.tanner_hesk.name': '[FR-CA] Tanner Hesk',
  'entities.npcs.tanner_hesk.title': '[FR-CA] Master of the Tannery',
  'entities.npcs.tinker_gizzel.greeting':
    '[FR-CA] Springs, sprockets, and sharp edges, {className}: the toolworks has whatever your hands lack.',
  'entities.npcs.tinker_gizzel.name': '[FR-CA] Tinker Gizzel',
  'entities.npcs.tinker_gizzel.title': '[FR-CA] Master of the Toolworks',
  'entities.npcs.weaver_ottilie.greeting':
    '[FR-CA] Mind the threads, {className}. A steady hand at the loom beats a strong one.',
  'entities.npcs.weaver_ottilie.name': '[FR-CA] Weaver Ottilie',
  'entities.npcs.weaver_ottilie.title': '[FR-CA] Master of the Loom',
  'gatherEvent.ancientHeartwood': '[FR-CA] {finder} felled an ancient heartwood!',
  'gatherEvent.moonlitBloom': '[FR-CA] {finder} discovered a moonlit bloom!',
  'gatherEvent.pristineVein': '[FR-CA] {finder} struck a pristine vein!',
  'heroicShop.buyConfirmAccept': '[FR-CA] Buy',
  'heroicShop.buyConfirmBody':
    '[FR-CA] Buy {item} for {marks} Heroic Marks? Marks purchases cannot be refunded.',
  'heroicShop.buyConfirmCancel': '[FR-CA] Cancel',
  'heroicShop.buyConfirmTitle': '[FR-CA] Confirm Purchase',
  'hudChrome.crafting.comboTierUnmetNamed': '[FR-CA] Raise {crafts} to tier {tier}.',
  'hudChrome.crafting.difficultyFull': '[FR-CA] Full skill gain',
  'hudChrome.crafting.difficultyNone': '[FR-CA] No skill gain',
  'hudChrome.crafting.difficultyReduced': '[FR-CA] Reduced skill gain',
  'hudChrome.crafting.enchantedLine': '[FR-CA] Enchanted',
  'hudChrome.crafting.makersMark': '[FR-CA] Crafted by {name}',
  'hudChrome.crafting.masterworkSeal': '[FR-CA] Masterwork',
  'hudChrome.crafting.masterworkToast': '[FR-CA] Masterwork! {name}',
  'hudChrome.crafting.masterworkZoneLine': '[FR-CA] {crafter} crafted a masterwork {name}!',
  'hudChrome.crafting.skillReqLine': '[FR-CA] Requires {craft} {skill}',
  'hudChrome.crafting.stationBadge': '[FR-CA] Station',
  'hudChrome.crafting.stationName.apothecary': '[FR-CA] Apothecary',
  'hudChrome.crafting.stationName.forge': '[FR-CA] Forge',
  'hudChrome.crafting.stationName.kitchens': '[FR-CA] Kitchens',
  'hudChrome.crafting.stationName.loom': '[FR-CA] Loom',
  'hudChrome.crafting.stationName.tannery': '[FR-CA] Tannery',
  'hudChrome.crafting.stationName.toolworks': '[FR-CA] Toolworks',
  'hudChrome.crafting.stationOutOfRangeNamed': '[FR-CA] Move to the {station} to craft this.',
  'hudChrome.crafting.stationRequired': '[FR-CA] You must be at the {station} to craft that.',
  'hudChrome.crafting.tierUpToast': '[FR-CA] {craft} advanced to tier {tier}!',
  'hudChrome.death.healerConfirmAccept': '[FR-CA] Revive Me',
  'hudChrome.death.healerConfirmBody':
    "[FR-CA] The Pale Keeper will revive you here, but the Keeper's Toll reduces all of your attributes by 75%, for up to 10 minutes at higher levels. Walking your spirit back to your corpse revives you with no penalty.",
  'hudChrome.death.healerConfirmCancel': '[FR-CA] Cancel',
  'hudChrome.death.healerConfirmTitle': "[FR-CA] Accept the Keeper's Toll?",
  'hudChrome.gathering.gatherLine': '[FR-CA] You gather: {name}.',
  'hudChrome.gathering.gatherLineQty': '[FR-CA] You gather: {name} x{qty}.',
  'hudChrome.mobile.professions': '[FR-CA] Professions',
  'hudChrome.options.showThirdActionBar': '[FR-CA] Show Third Action Bar',
  'hudChrome.playerMenu.streamerBadgeTitle': '[FR-CA] Verified streamer',
  'hudChrome.professions.ceilingCommon': '[FR-CA] Common cap',
  'hudChrome.professions.ceilingRare': '[FR-CA] Rare cap',
  'hudChrome.professions.ceilingUnlimited': '[FR-CA] No empowerment cap',
  'hudChrome.professions.close': '[FR-CA] Close professions',
  'hudChrome.professions.ctaHeader': '[FR-CA] Next step',
  'hudChrome.professions.ctaRaise':
    '[FR-CA] Keep raising {craft}: {points} more points to the next tier.',
  'hudChrome.professions.ctaStart': '[FR-CA] Craft or gather with any profession to begin.',
  'hudChrome.professions.gatheringHeader': '[FR-CA] Gathering',
  'hudChrome.professions.hobbyLabel': '[FR-CA] Hobby: {craft}',
  'hudChrome.professions.identityHeader': '[FR-CA] Identity',
  'hudChrome.professions.majorsLabel': '[FR-CA] Majors: {a} and {b}',
  'hudChrome.professions.nextUnlockMax': '[FR-CA] At maximum skill',
  'hudChrome.professions.nextUnlockSpecialized':
    '[FR-CA] {points} points to Specialized: material costs drop',
  'hudChrome.professions.nextUnlockTier':
    '[FR-CA] {points} points to the next tier: masterwork odds improve',
  'hudChrome.professions.nudgeDormant': '[FR-CA] Your {craft} knowledge lies dormant',
  'hudChrome.professions.nudgeNearTier': '[FR-CA] {craft}: {points} points from the next tier',
  'hudChrome.professions.pairsHeld': '[FR-CA] Pairs held: {count}',
  'hudChrome.professions.perkSpecializedAt': '[FR-CA] Specializes at {threshold} skill',
  'hudChrome.professions.perkSpecializedLine':
    '[FR-CA] {craft}: Specialized, material costs -{pct}%',
  'hudChrome.professions.perksHeader': '[FR-CA] Perks',
  'hudChrome.professions.returnsLabel': '[FR-CA] Returns: {count}',
  'hudChrome.professions.ringAria': '[FR-CA] Craft wheel',
  'hudChrome.professions.roleDormant': '[FR-CA] Dormant',
  'hudChrome.professions.roleHobby': '[FR-CA] Hobby',
  'hudChrome.professions.roleMajor': '[FR-CA] Major',
  'hudChrome.professions.roleUnattuned': '[FR-CA] Unattuned',
  'hudChrome.professions.skillValue': '[FR-CA] {skill} / {max}',
  'hudChrome.professions.skillsHeader': '[FR-CA] Craft skills',
  'hudChrome.professions.switchCost': '[FR-CA] Next archetype switch costs {cost} amends',
  'hudChrome.professions.syncing': '[FR-CA] Waiting for your profession data from the realm.',
  'hudChrome.professions.tierPipAria': '[FR-CA] Tier {tier}',
  'hudChrome.professions.title': '[FR-CA] Professions',
  'hudChrome.professions.tutorialLine':
    '[FR-CA] Reach {target} skill in any craft to unlock your first tier.',
  'hudChrome.professions.unattunedIdentity':
    '[FR-CA] You are not yet attuned to an archetype. Raise your crafts and complete an attunement to choose your pair.',
  'hudChrome.training.alreadyKnown': '[FR-CA] You already know that recipe.',
  'hudChrome.training.cannotAfford': '[FR-CA] You cannot afford that training.',
  'hudChrome.training.close': '[FR-CA] Close training',
  'hudChrome.training.dialogOption': '[FR-CA] Training',
  'hudChrome.training.dialogOptionAria': '[FR-CA] Browse training from {name}',
  'hudChrome.training.empty': '[FR-CA] This master has nothing to teach.',
  'hudChrome.training.free': '[FR-CA] Free',
  'hudChrome.training.learned': '[FR-CA] Recipe learned: {recipe}',
  'hudChrome.training.notTaughtHere': '[FR-CA] That recipe is not taught here.',
  'hudChrome.training.outOfRange': '[FR-CA] You must be at the station to train.',
  'hudChrome.training.requirement': '[FR-CA] Taught at {craft} {skill}',
  'hudChrome.training.stateKnown': '[FR-CA] Known',
  'hudChrome.training.stateLocked': '[FR-CA] Locked',
  'hudChrome.training.stateTeachable': '[FR-CA] Available',
  'hudChrome.training.tierUnmet': '[FR-CA] You need {craft} {skill} to learn that recipe.',
  'hudChrome.training.title': '[FR-CA] Training: {name}',
  'hudChrome.training.trainAria': '[FR-CA] Learn {name} for {fee}',
  'itemUi.market.rarityLegendary': '[FR-CA] Legendary',
  'loading.reconnectingAttempt':
    '[FR-CA] Connection lost. Reconnecting... (attempt {attempt}/{maxAttempts}, retrying in {seconds}s)',
  'loading.reconnectingNow':
    '[FR-CA] Connection lost. Reconnecting now... (attempt {attempt}/{maxAttempts})',
  'loading.slowConnection':
    '[FR-CA] This is taking longer than usual. Check your internet connection.',
};
