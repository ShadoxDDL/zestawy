// ==UserScript==
// @name         Auto kalendarz SI - loader
// @namespace    https://github.com/ShadoxDDL/autokalendarz
// @version      1.0.0
// @description  Ładuje Auto kalendarz SI z własnej kopii na GitHub Pages.
// @match        https://*.margonem.pl/*
// @exclude      https://www.margonem.pl/*
// @match        https://*.margonem.com/*
// @exclude      https://www.margonem.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  const SCRIPT_URL = "https://shadoxddl.github.io/autokalendarz/Auto-kalendarz-SI.js";
  const scripts = window.GARGONEM_PLUGINS ?? (window.GARGONEM_PLUGINS = []);
  scripts.push(SCRIPT_URL);
})();
