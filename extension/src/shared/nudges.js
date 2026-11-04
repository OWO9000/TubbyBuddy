/* Burn offline fallback nudges. Classic script, attaches to
 * globalThis.BurnNudges. Templates may reference {appName}, {points},
 * {pointsAtRisk}, {pointsPhrase}, {streak} and {streakPhrase};
 * formatNudge fills them in tolerantly. When there is no streak yet a
 * separate fresh-start list is used so every nudge reads naturally. */
(function () {
  'use strict';

  var FALLBACK_NUDGES = [
    'TubbyBuddy reminder: close the tab. {appName} will still be there tomorrow, but your {streakPhrase} needs you today.',
    'Tubby believes in you. Step away from {appName} and keep your {streakPhrase} alive.',
    'Earn real life instead: close {appName}. You have {pointsPhrase}.',
    'Quick check from TubbyBuddy: is {appName} worth risking your {streakPhrase}? You already know the answer.',
    'Tough love: {appName} is engineered to keep you scrolling. Prove you are stronger and protect your {streakPhrase}.',
    'Take a calm breath. You opened {appName} out of habit, not hunger. Let your {streakPhrase} carry you back.',
    'Hype mode: your {streakPhrase} is strong. Do not trade it for five more minutes of {appName}.',
    'Witty Tubby says: {appName} called, it will miss you for exactly 30 seconds. Your goals will thank you much longer.',
    'Put your distractions down. Earn real life. Your {streakPhrase} is yours to keep.',
    'Small choice, big you: skip {appName} now and bank the win. Your {streakPhrase} keeps climbing.'
  ];

  var FRESH_START_NUDGES = [
    'Welcome to TubbyBuddy. {appName} will still be there tomorrow. Put it down now and start your first streak.',
    'Every streak starts with one good choice. Skip {appName} and earn real life instead.',
    'Tubby believes in you. Step away from {appName} and bank your first win.',
    'You have {pointsPhrase}. Close {appName} and start building a streak you are proud of.',
    'Day zero is the perfect day to start. Put {appName} down and let your first win find you.'
  ];

  function toNonNegInt(value, fallback) {
    if (typeof value !== 'number' || !isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
  }

  function ctxPoints(ctx) {
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    var points = c.pointsAtRisk;
    if (!(typeof points === 'number' && isFinite(points))) points = c.points;
    return toNonNegInt(points, 50);
  }

  function ctxStreak(ctx) {
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    return toNonNegInt(c.streak, 0);
  }

  function streakLabel(streak) {
    var n = toNonNegInt(streak, 0);
    if (n <= 0) return 'no streak yet';
    if (n === 1) return '1-day streak';
    return n + '-day streak';
  }

  function pointsPhrase(points) {
    var n = toNonNegInt(points, 50);
    if (n <= 0) return 'no points to burn yet';
    if (n === 1) return '1 point at risk';
    return n + ' points at risk';
  }

  function overlayPointsLabel(displayAtRisk) {
    var n = toNonNegInt(displayAtRisk, 50);
    if (n <= 0) return 'Nothing at risk yet';
    return n + ' points at risk';
  }

  function formatNudge(template, ctx) {
    var t = typeof template === 'string' ? template : '';
    if (!t) t = 'Put your distractions down. Earn real life.';
    var c = ctx && typeof ctx === 'object' ? ctx : {};
    var appName = typeof c.appName === 'string' && c.appName ? c.appName : 'this site';
    var points = String(ctxPoints(ctx));
    var streak = String(ctxStreak(ctx));
    return t
      .replace(/\{appName\}/g, appName)
      .replace(/\{app\}/g, appName)
      .replace(/\{pointsAtRisk\}/g, points)
      .replace(/\{pointsPhrase\}/g, pointsPhrase(ctxPoints(ctx)))
      .replace(/\{points\}/g, points)
      .replace(/\{streakPhrase\}/g, streakLabel(ctxStreak(ctx)))
      .replace(/\{streak\}/g, streak);
  }

  function pickFallbackNudge(ctx) {
    var list = ctxStreak(ctx) <= 0 ? FRESH_START_NUDGES : FALLBACK_NUDGES;
    var idx = Math.floor(Math.random() * list.length);
    if (!(idx >= 0 && idx < list.length)) idx = 0;
    return formatNudge(list[idx], ctx);
  }

  globalThis.BurnNudges = {
    FALLBACK_NUDGES: FALLBACK_NUDGES,
    FRESH_START_NUDGES: FRESH_START_NUDGES,
    streakLabel: streakLabel,
    pointsPhrase: pointsPhrase,
    overlayPointsLabel: overlayPointsLabel,
    formatNudge: formatNudge,
    pickFallbackNudge: pickFallbackNudge
  };
})();
