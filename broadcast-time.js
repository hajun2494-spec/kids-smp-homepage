(function (root, factory) {
  "use strict";

  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EvergreenBroadcastTime = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
  var DAY_SECONDS = 24 * 60 * 60;

  function instantMilliseconds(value) {
    var milliseconds;

    if (value instanceof Date) {
      milliseconds = value.getTime();
    } else if (typeof value === "number") {
      milliseconds = value;
    } else if (typeof value === "string") {
      // An explicit zone keeps the result independent of the viewer's timezone.
      var iso = value.trim();
      var calendarDate = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T/i.exec(iso);
      if (!calendarDate || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)) return null;
      var year = Number(calendarDate[1]);
      var month = Number(calendarDate[2]);
      var day = Number(calendarDate[3]);
      if (month < 1 || month > 12 || day < 1 ||
          day > utcDate(year, month, 0).getUTCDate()) return null;
      milliseconds = Date.parse(iso);
    } else {
      return null;
    }

    return Number.isFinite(milliseconds) &&
      Number.isFinite(new Date(milliseconds + SEOUL_OFFSET_MS).getTime())
      ? milliseconds
      : null;
  }

  function seoulParts(milliseconds) {
    var date = new Date(milliseconds + SEOUL_OFFSET_MS);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      hours: date.getUTCHours(),
      minutes: date.getUTCMinutes(),
      seconds: date.getUTCSeconds(),
      milliseconds: date.getUTCMilliseconds(),
    };
  }

  function utcDate(year, month, day) {
    // setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
    var date = new Date(0);
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  function monthAnchor(start, months) {
    var targetMonth = start.month + months;
    var lastDay = utcDate(start.year, targetMonth + 1, 0).getUTCDate();
    var date = utcDate(start.year, targetMonth, Math.min(start.day, lastDay));
    date.setUTCHours(start.hours, start.minutes, start.seconds, start.milliseconds);
    return date.getTime() - SEOUL_OFFSET_MS;
  }

  /**
   * Calendar age of an opening instant, evaluated at a supplied snapshot instant.
   * Months use Asia/Seoul (UTC+09:00), always anchored to the original local day,
   * with shorter months clamped to their last day. The remaining duration uses
   * actual elapsed 24-hour days and is rounded down to whole seconds.
   *
   * Inputs are epoch milliseconds, Date objects, or ISO strings with a zone.
   * Invalid inputs return null; a future opening returns all zeroes. This is
   * calendar age, not evidence that a broadcast ran continuously during it.
   */
  function calendarElapsed(start, now) {
    if (now === undefined) now = Date.now();

    var startMs = instantMilliseconds(start);
    var nowMs = instantMilliseconds(now);
    if (startMs === null || nowMs === null) return null;
    if (nowMs < startMs) {
      return { months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    var startParts = seoulParts(startMs);
    var nowParts = seoulParts(nowMs);
    var months =
      (nowParts.year - startParts.year) * 12 + nowParts.month - startParts.month;
    var anchor = monthAnchor(startParts, months);

    if (anchor > nowMs) {
      months -= 1;
      anchor = monthAnchor(startParts, months);
    }

    var remaining = Math.floor((nowMs - anchor) / 1000);
    var days = Math.floor(remaining / DAY_SECONDS);
    remaining %= DAY_SECONDS;
    var hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    var minutes = Math.floor(remaining / 60);

    return {
      months: months,
      days: days,
      hours: hours,
      minutes: minutes,
      seconds: remaining % 60,
    };
  }

  return { calendarElapsed: calendarElapsed };
});
