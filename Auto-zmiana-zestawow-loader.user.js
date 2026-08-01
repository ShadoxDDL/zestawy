// ==UserScript==
// @name         Auto zmiana zestawów - prywatna kopia ShadoxDDL
// @namespace    https://github.com/ShadoxDDL/zestawy
// @version      1.0.0
// @description  Auto zmiana zestawów ładowana z własnej kopii na GitHub Pages
// @match        https://*.margonem.pl/*
// @exclude      https://www.margonem.pl/*
// @match        https://*.margonem.com/*
// @exclude      https://www.margonem.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const SCRIPT_URL = "https://shadoxddl.github.io/zestawy/Auto-zmiana-zestawow.js";
    const scripts = window.GARGONEM_PLUGINS ?? (window.GARGONEM_PLUGINS = []);
    scripts.push(SCRIPT_URL);
})();
