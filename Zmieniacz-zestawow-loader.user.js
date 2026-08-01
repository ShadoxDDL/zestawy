// ==UserScript==
// @name         Zmieniacz zestawów - prywatna kopia ShadoxDDL
// @namespace    https://github.com/ShadoxDDL/autoxgarg
// @version      1.0.0
// @description  Zmieniacz zestawów ładowany z własnej kopii na GitHub Pages
// @match        https://*.margonem.pl/*
// @exclude      https://www.margonem.pl/*
// @match        https://*.margonem.com/*
// @exclude      https://www.margonem.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    "use strict";

    const SCRIPT_URL = "https://shadoxddl.github.io/autoxgarg/Zmieniacz-zestawow.js";
    const scripts = window.GARGONEM_PLUGINS ?? (window.GARGONEM_PLUGINS = []);
    scripts.push(SCRIPT_URL);
})();
