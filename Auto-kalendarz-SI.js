(() => {
  "use strict";

  const page = window;
  const TAG = "[Auto Kalendarz SI]";
  const ADDON_ID = "autoCalendarSI";
  const MIN_LEVEL = 25;
  const RETRY_DELAY = 12 * 60 * 60 * 1000;
  const STARTUP_DELAY = 3000;
  const OPEN_LOCK_DELAY = 2 * 60 * 1000;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  let enabled = false;
  let generation = 0;

  class AddonDisabledError extends Error {}

  function log(message, extra) {
    console.log(TAG, message, extra ?? "");
    page.console?.log(TAG, message, extra ?? "");
  }

  function ensureEnabled(token) {
    if (!enabled || token !== generation) {
      throw new AddonDisabledError("Dodatek zosta\u0142 wy\u0142\u0105czony.");
    }
  }

  async function waitUntil(check, timeout, errorMessage, token) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      ensureEnabled(token);
      const result = check();
      if (result) return result;
      await sleep(250);
    }
    throw new Error(errorMessage);
  }

  function dateId(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function attemptKey(heroId) {
    return `autoCalendarLastAttempt_${heroId}`;
  }

  function openLockKey(heroId) {
    return `autoCalendarOpenLock_${heroId}`;
  }

  function retryTime(heroId) {
    const lastAttempt = Number(page.localStorage.getItem(attemptKey(heroId)));
    return Number.isFinite(lastAttempt) ? lastAttempt + RETRY_DELAY : 0;
  }

  function openLockTime(heroId) {
    const lock = Number(page.localStorage.getItem(openLockKey(heroId)));
    return Number.isFinite(lock) ? lock + OPEN_LOCK_DELAY : 0;
  }

  async function waitForStableHero(token) {
    let previousId = null;
    let stableSince = 0;

    return waitUntil(() => {
      const currentId = page.hero?.id;
      if (!currentId || typeof page._g !== "function" || !page.g) return null;

      if (currentId !== previousId) {
        previousId = currentId;
        stableSince = Date.now();
        return null;
      }

      return Date.now() - stableSince >= STARTUP_DELAY ? currentId : null;
    }, 120000, "Posta\u0107 nie ustabilizowa\u0142a si\u0119 po przelogowaniu.", token);
  }

  function findTodayDayNumber(rewardDays) {
    const today = dateId(new Date());
    const dates = Object.keys(rewardDays ?? {})
      .map(key => ({
        key,
        timestamp: Number(key),
        date: dateId(new Date(Number(key) * 1000))
      }))
      .filter(entry => Number.isFinite(entry.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);

    const position = dates.findIndex(entry => entry.date === today);
    if (position === -1) return null;

    return {
      dayNumber: position + 1,
      matchedTimestamp: dates[position].timestamp,
      rawValue: rewardDays[dates[position].key]
    };
  }

  async function run(token) {
    log("Dodatek w\u0142\u0105czony. Czekam na gr\u0119...");

    const heroId = await waitForStableHero(token);
    ensureEnabled(token);

    const heroName = page.hero.nick ?? heroId;
    const heroLevel = Number(page.hero.lvl ?? page.hero.level);

    if (!Number.isFinite(heroLevel) || heroLevel < MIN_LEVEL) {
      log(`Pomijam posta\u0107 ${heroName}: poziom ${heroLevel || "nieznany"}, wymagany minimum ${MIN_LEVEL}.`);
      return;
    }

    const nextAttempt = retryTime(heroId);
    if (Date.now() < nextAttempt) {
      log(`Posta\u0107 ${heroName} by\u0142a ju\u017c sprawdzana. Nast\u0119pna pr\u00f3ba: ${new Date(nextAttempt).toLocaleString("pl-PL")}.`);
      return;
    }

    const lockedUntil = openLockTime(heroId);
    if (Date.now() < lockedUntil) {
      log(`Pomijam ponowne otwarcie kalendarza po przelogowaniu. Kolejna mo\u017cliwa pr\u00f3ba: ${new Date(lockedUntil).toLocaleString("pl-PL")}.`);
      return;
    }

    ensureEnabled(token);
    page.localStorage.setItem(openLockKey(heroId), String(Date.now()));
    log(`Wykryto posta\u0107: ${heroName}. Otwieram kalendarz...`);
    page._g("rewards_calendar&action=show");

    const calendar = await waitUntil(
      () => page.g?.rewardsCalendar?.data && page.g?.rewardsCalendar?.rewardDays
        ? page.g.rewardsCalendar
        : null,
      20000,
      "Nie otrzymano danych kalendarza. Prawdopodobnie nie ma aktywnego eventu.",
      token
    );

    const today = findTodayDayNumber(calendar.rewardDays);
    log("Mapa dni kalendarza:", calendar.rewardDays);

    if (!today) {
      throw new Error("Kalendarz nie zawiera nagrody przypisanej do dzisiejszej daty.");
    }

    ensureEnabled(token);
    const date = new Date().toLocaleDateString("pl-PL");
    log(`Data ${date}: wybieram pozycj\u0119 ${today.dayNumber}.`, today);
    page._g(`rewards_calendar&action=open&day_no=${today.dayNumber}`);
    page.localStorage.setItem(attemptKey(heroId), String(Date.now()));
    log(`Wys\u0142ano \u017c\u0105danie odbioru nagrody dla daty ${date}.`);

    await sleep(1500);
    ensureEnabled(token);
    page.g?.rewardsCalendar?.close?.();
    log("Kalendarz zosta\u0142 zamkni\u0119ty.");
  }

  function start() {
    enabled = true;
    const token = ++generation;
    run(token).catch(error => {
      if (error instanceof AddonDisabledError) return;
      console.error(TAG, error);
      page.console?.error(TAG, error);
    });
  }

  function stop() {
    enabled = false;
    generation++;
    log("Dodatek wy\u0142\u0105czony.");
  }

  const addons = page.Gargonem.Addons;
  const id = addons.New.registerID(ADDON_ID);
  addons.New.register({
    id,
    name: "Auto kalendarz SI",
    descriptionBrief: "Automatycznie odbiera dzisiejsz\u0105 nagrod\u0119 z kalendarza eventowego.",
    descriptionFull: "Dzia\u0142a bez osobnego interfejsu. W\u0142\u0105czanie i wy\u0142\u0105czanie odbywa si\u0119 w panelu dodatk\u00f3w.",
    enabledByDefault: true
  });
  addons.New.registerStartupAndShutdown(id, start, stop);
})();
