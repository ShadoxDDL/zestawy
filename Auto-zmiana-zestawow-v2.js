// ==UserScript==
// @name         Auto zmiana zestawów v2 - TEST
// @namespace    local.shadoxddl.auto-zmiana-zestawow-v2
// @version      2.0.0-test.2
// @description  Test Auto zmiany zestawów z obsługą zestawu Ustawki dla grupy 5+.
// @match        https://*.margonem.pl/*
// @exclude      https://www.margonem.pl/*
// @match        https://*.margonem.com/*
// @exclude      https://www.margonem.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(async () => {
  "use strict";

  if (window.__autoZmianaZestawowV2Loaded) return;
  const deadline = Date.now() + 120000;
  let G;
  while (Date.now() < deadline) {
    if (window.Gargonem?.Addons?.New && window.Gargonem?.Core?.Builds) {
      G = window.Gargonem;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!G) return;
  window.__autoZmianaZestawowV2Loaded = true;

  const { Core, Addons, UI, Util } = G;
  const Event = Core.Event;
  const Components = UI.Components;
  const React = UI.React;
  const managerStorage = Addons.managerStorage;
  const Margonem = Core.Margonem;
  const ADDON_ID = Addons.New.registerID("battleSetSwitcher");
  const logger = Core.Logger.child("BattleSetSwitcher");

  const storage = new Addons.Storage("battleSetSwitcher", {
    enabled: false,
    rewriteAttackTarget: false,
    collapsed: false,
    buildsPerProf: {},
    lastSelectedSet: -1
  }, true);

  const PROFESSION_ALIASES = {
    w: ["woj", "wojownik"],
    p: ["pal", "paladyn"],
    b: ["tanc", "tancerz", "tańc"],
    m: ["mag"],
    h: ["lowca", "łowca"],
    t: ["trop", "tropiciel"]
  };

  function containsAny(text, values) {
    return values.some(value => text.includes(value));
  }

  let queryListener = null;
  const originalQuery = window._g;
  window._g = function(task) {
    const wrapper = { task };
    if (queryListener) queryListener(wrapper);
    arguments[0] = wrapper.task;
    return originalQuery.apply(this, arguments);
  };

  function enemyStatusPenalty(other) {
    const statuses = Core.Emo.getOtherEmo(Number(other.id)).map(status => status.name);
    if (statuses.includes(Margonem.MargoEmoType.FIGHT)) return 3.5;
    if (statuses.includes(Margonem.MargoEmoType.PROTECTED)) return 1.5;
    return 0;
  }

  function getGroupMembers() {
    const candidates = [
      Core.Group?.getAll?.(),
      Core.Group?.get?.(),
      Core.Party?.getAll?.(),
      Core.Party?.get?.(),
      window.g?.party
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (Array.isArray(candidate)) return candidate.filter(Boolean);
      if (Array.isArray(candidate.members)) return candidate.members.filter(Boolean);
      if (candidate.members && typeof candidate.members === "object") {
        return Object.values(candidate.members).filter(Boolean);
      }
      if (typeof candidate === "object") {
        const members = Object.values(candidate).filter(value =>
          value && typeof value === "object" && (value.id != null || value.nick || value.name)
        );
        if (members.length) return members;
      }
    }
    return [];
  }

  function isUstawkiGroup() {
    const members = getGroupMembers();
    const hero = Core.Hero.get();
    const heroIncluded = members.some(member =>
      String(member.id ?? member.char_id ?? "") === String(hero.id ?? "") ||
      (member.nick && member.nick === hero.nick)
    );
    const totalPeople = members.length + (heroIncluded ? 0 : 1);
    return totalPeople > 4;
  }

  class BattleSetSwitcherWindow extends React.Component {
    static rightClickInitialized = false;

    static initializeRightClick() {
      if (this.rightClickInitialized) return;
      this.rightClickInitialized = true;
      if (Core.Interfaces.isOld) this.initializeSIRightClick();
      else if (Core.Interfaces.isNew) this.initializeNIRightClick();
    }

    static contextMenuOptions() {
      return [
        ...Object.values(Core.Builds.get()).map(build => ({
          name: `${build.id}. ${Core.Builds.getBuildFriendlyName(build)}`,
          clb: () => {
            Core.Builds.setSelected(build.id);
            storage.set("enabled", false);
          }
        })),
        {
          name: "<span style='color:lime;font-weight:bold'>Automatyczny</span>",
          clb: () => storage.set("enabled", true)
        }
      ];
    }

    static initializeSIRightClick() {
      const element = document.querySelector(".builds-interface");
      if (!element) return;
      element.addEventListener("contextmenu", event => {
        Core.ContextMenu.show(event, this.contextMenuOptions());
        event.preventDefault();
      });
    }

    static initializeNIRightClick() {
      const originalPopup = window.Engine?.interface?.showPopupMenu;
      if (!originalPopup) return;
      window.Engine.interface.showPopupMenu = function(options, event) {
        if (event.target instanceof HTMLDivElement && event.target.classList.contains("builds-interface")) {
          options.push(["<span style='color:lime;font-weight:bold'>Automatyczny</span>",
            () => storage.set("enabled", true)]);
        }
        return originalPopup.apply(this, arguments);
      };
    }

    constructor(props) {
      super(props);
      this.mappedKeys = ["buildsPerProf", "enabled", "collapsed"];
      this.globalMappedKeys = ["battleSetSwitcherWindowEnabled"];
      this.passiveSwitchMinTime = 0;
      this.buildSwitchWasFromAddon = false;
      this.state = { builds: Core.Builds.get() };
      storage.bind(this, this.mappedKeys);
      managerStorage.bind(this, this.globalMappedKeys);
      this.onBuilds = this.onBuilds.bind(this);
      this.onTick = this.onTick.bind(this);
      this.onQuery = this.onQuery.bind(this);
      queryListener = this.onQuery;
      Event.add("builds", this.onBuilds);
      Event.addAny(this.onTick);
    }

    componentDidMount() {
      if (!Core.Communication.isIniting()) {
        BattleSetSwitcherWindow.initializeRightClick();
        this.updateSelectedBuildIndicator();
        storage.set("lastSelectedSet", Core.Builds.getSelected());
      }
    }

    componentDidUpdate(_props, previousState) {
      if (previousState.enabled !== this.state.enabled) this.updateSelectedBuildIndicator();
    }

    componentWillUnmount() {
      storage.unbind(this, this.mappedKeys);
      managerStorage.unbind(this, this.globalMappedKeys);
      Event.remove("builds", this.onBuilds);
      Event.removeAny(this.onTick);
      queryListener = null;
      this.updateSelectedBuildIndicator(true);
    }

    onBuilds(data) {
      this.setState({ builds: Core.Builds.get() });
      if (data.action === "INIT") {
        BattleSetSwitcherWindow.initializeRightClick();
        this.disableIfBuildChangedUnsafely();
      }
      if (data.action === "UPDATE_CURRENT_ID" || data.action === "INIT") {
        storage.set("lastSelectedSet", data.currentId);
        this.buildSwitchWasFromAddon = false;
        this.updateSelectedBuildIndicator();
      }
    }

    isOnColossusMap() {
      return Object.values(Core.Npc.getAll()).some(npc =>
        Margonem.getNpcWtType(npc.wt) === Margonem.MargoNpcWT.COLLOSUS
      );
    }

    configuredBuildIDs() {
      return ["w", "p", "b", "m", "t", "h", "passive", "ustawki"]
        .map(key => this.state.buildsPerProf?.[key])
        .filter(value => typeof value === "number" && value !== -1);
    }

    disableIfBuildChangedUnsafely() {
      if (!storage.get("enabled")) return;
      const selected = Core.Builds.getSelected();
      const safe = selected === storage.get("lastSelectedSet") || this.configuredBuildIDs().includes(selected);
      const safeColossus = this.isOnColossusMap() && this.state.buildsPerProf?.collosus === selected;
      if (!safe && !safeColossus) {
        Core.System.message("Auto zmiana zestawów: aktualny zestaw nie zgadza się z zapisanym. Wyłączono automat dla bezpieczeństwa.");
        storage.set("enabled", false);
      }
    }

    getBuildIndicator() {
      if (Core.Interfaces.isOld) return document.querySelector(".choose-build.build-index .gfont");
      if (Core.Interfaces.isNew) return document.querySelector(".choose-build.build-index");
      return null;
    }

    indicatorTip() {
      return Core.Interfaces.isOld
        ? "<br>Zmienianie kontrolowane przez dodatek."
        : "<br><br>Zmienianie kontrolowane przez dodatek.";
    }

    updateSelectedBuildIndicator(remove = false) {
      const indicator = this.getBuildIndicator();
      if (!indicator?.parentElement) return;
      indicator.parentElement.querySelector("small")?.remove();
      const interfaceElement = indicator.closest(".builds-interface");
      if (this.state.enabled && !remove) {
        indicator.setAttribute("name", "A");
        indicator.innerHTML = "A";
        const small = document.createElement("small");
        Object.assign(small.style, {
          position: "absolute", bottom: Core.Interfaces.isOld ? "1px" : "-2px",
          right: Core.Interfaces.isOld ? "3px" : "0", fontSize: "15px",
          filter: "drop-shadow(0 0 2px black)"
        });
        small.textContent = String(Core.Builds.getSelected());
        (Core.Interfaces.isOld ? indicator.parentElement : indicator).appendChild(small);
        if (interfaceElement) Core.System.setTip(interfaceElement,
          Core.System.getTip(interfaceElement) + this.indicatorTip());
      } else if (indicator.innerHTML.startsWith("A")) {
        const selected = String(Core.Builds.getSelected());
        indicator.innerHTML = selected;
        indicator.setAttribute("name", selected);
        if (interfaceElement) Core.System.setTip(interfaceElement,
          Core.System.getTip(interfaceElement).replace(this.indicatorTip(), ""));
      }
    }

    autoChangeBuild(buildID) {
      if (typeof buildID !== "number" || buildID === -1) return false;
      if (!this.state.builds?.[buildID]) return false;
      if (Core.Builds.getSelected() === buildID) return true;
      this.buildSwitchWasFromAddon = true;
      Core.Builds.setSelected(buildID);
      logger.debug(`autoChangeBuild: ${buildID}`);
      return true;
    }

    setSituationBuild(key) {
      return this.autoChangeBuild(this.state.buildsPerProf?.[key]);
    }

    onTick() {
      if (!storage.get("enabled") || !Core.Communication.canSendIdleRequest()) return;
      if (this.passiveSwitchMinTime > Core.Time.get()) return;
      if (this.isOnColossusMap()) {
        this.setSituationBuild("collosus");
        return;
      }
      if (isUstawkiGroup() && this.setSituationBuild("ustawki")) return;

      const map = Core.Map.get();
      if (map?.pvp !== Margonem.MapPVP.PVP) {
        this.setSituationBuild("passive");
        return;
      }

      const hero = Core.Hero.get();
      const distanceMap = Core.DistMap.getDistMap(hero.x, hero.y, true, true, false, 6);
      const enemies = Object.values(Core.Other.getAll()).filter(other =>
        ![Margonem.MargoRelation.FRIEND, Margonem.MargoRelation.CLAN,
          Margonem.MargoRelation.CLAN_FRIEND].includes(other.relation) &&
        Core.DistMap.distMapDist(distanceMap, other) <= 6
      );
      const enemy = Util.lowerBound(enemies,
        other => Core.DistMap.distMapDist(distanceMap, other) + enemyStatusPenalty(other));
      if (!enemy) {
        this.setSituationBuild("passive");
        return;
      }
      const build = this.getBuildForProf(enemy.prof);
      if (build) this.autoChangeBuild(build.id);
    }

    findAttackRewriteTarget() {
      const professions = this.getProfsForBuild(Core.Builds.getSelected());
      const hero = Core.Hero.get();
      const distanceMap = Core.DistMap.getDistMap(hero.x, hero.y, true, true, false, 2);
      const enemies = Object.values(Core.Other.getAll()).filter(other =>
        ![Margonem.MargoRelation.FRIEND, Margonem.MargoRelation.CLAN,
          Margonem.MargoRelation.CLAN_FRIEND].includes(other.relation) &&
        Core.DistMap.distMapDist(distanceMap, other) <= 2 &&
        enemyStatusPenalty(other) === 0 && professions.includes(other.prof)
      );
      return Util.lowerBound(enemies, other => Core.DistMap.distMapDist(distanceMap, other));
    }

    onQuery(wrapper) {
      if (!storage.get("enabled") || Core.Fight.get()) return;
      const query = Core.Communication.parseQuery(wrapper.task);
      if (query.t === "fight" && query.a === "attack") {
        if (this.isOnColossusMap()) return;
        if (isUstawkiGroup() && this.setSituationBuild("ustawki")) {
          this.passiveSwitchMinTime = Core.Time.get() + 2500;
          return;
        }
        const targetID = Number(query.id);
        if (!Number.isFinite(targetID) || targetID < 0) return;
        const target = Core.Other.getByID(targetID);
        if (!target) return;
        const build = this.getBuildForProf(target.prof);
        if (build && Core.Builds.getSelected() !== build.id) {
          if (storage.get("rewriteAttackTarget")) {
            const replacement = this.findAttackRewriteTarget();
            if (replacement) {
              wrapper.task = wrapper.task.replace(query.id, replacement.id);
              return;
            }
          }
          this.autoChangeBuild(build.id);
        }
        this.passiveSwitchMinTime = Core.Time.get() + 2500;
      } else if (query.t === "builds" && query.action === "updateCurrent" && !this.buildSwitchWasFromAddon) {
        storage.set("enabled", false);
      }
    }

    inferSuitableBuildProfs(build) {
      const heroProf = Core.Hero.get().prof;
      const name = build.name.toLowerCase();
      if (build.skillsLearnt < 0.7 * build.skillsTotal || build.items.some((itemID, index) =>
        !(Core.Item.getByID(itemID)?.loc === Margonem.MargoItemLoc.EQUIPMENT || (index === 6 && heroProf === "w")))) {
        return [];
      }
      if (["kolos", "tytan"].some(word => name.includes(word))) return ["collosus"];
      if (["ustawk", "10"].some(word => name.includes(word))) return ["ustawki"];
      if (name.includes("exp")) return ["w", "p", "b", "m", "t", "h"];
      const compact = name.replace(/pvp|1h|2h|ogień|ogien|blysk|błysk|zimno|fizyk|gr|truta| /g, "").trim();
      if (/^[wpbmth]+$/.test(compact)) return compact.split("");
      const result = [];
      for (const [prof, aliases] of Object.entries(PROFESSION_ALIASES)) {
        if (containsAny(name, aliases)) result.push(prof);
      }
      if (result.length) return result;
      if (heroProf === "w") {
        if (name.includes("1h") || name.includes("gr")) return ["b", "h", "t"];
        if (name.includes("2h")) return ["m", "p", "w"];
      }
      if (heroProf === "p") {
        if (name.includes("ogien") || name.includes("ogień")) return ["b", "h", "t"];
        if (name.includes("błysk") || name.includes("blysk")) return ["p", "w"];
        if (name.includes("zimno")) return ["m"];
      }
      if (heroProf === "b" && (name.includes("gr") || name.includes("truta"))) {
        return ["b", "h", "t", "m", "p", "w"];
      }
      if (heroProf === "m") {
        if (name.includes("ogien") || name.includes("ogień")) return ["b", "h", "t"];
        if (["zimno", "blysk", "błysk"].some(word => name.includes(word))) return ["m", "p", "w"];
      }
      if (heroProf === "h") {
        if (name.includes("truta")) return ["m", "p", "w"];
        if (name.includes("gr")) return ["p", "w", "b", "h", "t"];
      }
      if (heroProf === "t") {
        if (name.includes("ogien") || name.includes("ogień")) return ["b", "h", "t"];
        if (name.includes("blysk") || name.includes("błysk")) return ["p", "w"];
        if (name.includes("zimno")) return ["m"];
      }
      return [];
    }

    inferBestBuildForProf(prof) {
      const scores = {};
      for (const id in this.state.builds) {
        const suitable = this.inferSuitableBuildProfs(this.state.builds[id]);
        if (suitable.includes(prof)) scores[id] = 6 - suitable.length;
      }
      if (!Object.keys(scores).length) return null;
      const best = Util.upperBound(Object.entries(scores), entry => entry[1]);
      return this.state.builds[best[0]];
    }

    getBuildForProf(prof) {
      if (!this.state.builds) return null;
      const configured = this.state.buildsPerProf?.[prof];
      return configured !== undefined && configured !== -1
        ? this.state.builds[configured]
        : this.inferBestBuildForProf(prof);
    }

    getProfsForBuild(buildID) {
      return Object.entries(this.state.buildsPerProf || {})
        .filter(([, id]) => id === buildID)
        .map(([prof]) => prof);
    }

    buildOptions(prof) {
      const inferred = this.inferBestBuildForProf(prof);
      const fallback = inferred?.name ?? "aktualnie ubrany";
      return [
        { label: `Brak wyboru (${fallback})`, value: -1 },
        ...Object.values(this.state.builds || {}).map(build => ({
          label: Core.Builds.getBuildFriendlyName(build), value: Number(build.id)
        }))
      ];
    }

    renderSelector(label, key) {
      const selected = this.state.buildsPerProf?.[key] ?? -1;
      return React.createElement(Components.WithLabel, { label },
        React.createElement(Components.Select, {
          style: { width: 175 }, options: this.buildOptions(key), selected,
          onChange: value => {
            const mappings = { ...(this.state.buildsPerProf || {}) };
            mappings[key] = value;
            storage.set("buildsPerProf", mappings);
          }
        })
      );
    }

    renderCollapseControl() {
      const collapsed = Boolean(this.state.collapsed);
      return React.createElement("button", {
        type: "button",
        title: collapsed ? "Rozwiń ustawienia" : "Zwiń ustawienia",
        onClick: event => {
          event.preventDefault();
          event.stopPropagation();
          storage.set("collapsed", !collapsed);
        },
        style: {
          width: 18,
          height: 18,
          padding: 0,
          border: 0,
          background: "transparent",
          color: "#ddd",
          cursor: "pointer",
          font: "bold 16px/18px Arial"
        }
      }, collapsed ? "+" : "−");
    }

    render() {
      return React.createElement(Components.NamedWindow, {
        onClose: () => managerStorage.set("battleSetSwitcherWindowEnabled", false),
        visible: this.state.battleSetSwitcherWindowEnabled,
        name: ADDON_ID,
        title: "Auto zmiana zestawów",
        rightControls: this.renderCollapseControl()
      },
        React.createElement(Components.WithLabelReverse, { label: "Włącz auto zmienianie" },
          React.createElement(Components.CheckboxPersistent, { storage, bind: "enabled" })
        ),
        React.createElement(Components.WithLabelReverse, {
          label: "Przekierowywanie celu ataku",
          tip: "Przed atakiem może przekierować cel na przeciwnika pasującego do aktualnego zestawu."
        }, React.createElement(Components.CheckboxPersistent, { storage, bind: "rewriteAttackTarget" })),
        React.createElement(Components.If, { v: !this.state.collapsed },
          React.createElement("div", null,
            React.createElement("h4", null, "Zestawy na konkretne sytuacje"),
            this.renderSelector("Wojownik", "w"),
            this.renderSelector("Paladyn", "p"),
            this.renderSelector("Tancerz ostrzy", "b"),
            this.renderSelector("Mag", "m"),
            this.renderSelector("Tropiciel", "t"),
            this.renderSelector("Łowca", "h"),
            this.renderSelector("Kolosi", "collosus"),
            this.renderSelector("Ustawki (grupa 5+)", "ustawki"),
            React.createElement(Components.TipWrapper, {
              tip: "Ten zestaw jest wybierany, gdy w pobliżu nie ma przeciwników."
            }, React.createElement("h4", null, "Zestaw domyślny")),
            this.renderSelector("Domyślny", "passive")
          )
        )
      );
    }
  }

  Addons.New.register({
    id: ADDON_ID,
    name: "Auto zmiana zestawów",
    descriptionBrief: "Automatycznie dobiera zestaw do sytuacji.",
    descriptionFull: "Obsługuje profesje, kolosów, grupy ustawkowe i zestaw domyślny.",
    window: BattleSetSwitcherWindow
  });
})();
