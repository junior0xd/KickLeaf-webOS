(function (root) {
  'use strict';

  function text(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function startTime(value) {
    if (typeof value !== 'string') return NaN;
    // Kick also returns UTC timestamps in SQL format.
    if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)) {
      value = value.replace(' ', 'T') + 'Z';
    }
    return /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
  }

  function avatarURL(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
      var url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
          ['files.kick.com', 'images.kick.com', 'cdn.kick.com'].indexOf(url.hostname) !== -1) return url.href;
    } catch (error) { /* Preserve the initial when an avatar is unavailable. */ }
    return '';
  }

  function create(card) {
    var fields = {};
    card.querySelectorAll('[data-info]').forEach(function (node) { fields[node.dataset.info] = node; });
    var number = new Intl.NumberFormat('pt-BR');
    var avatar = '', startedAt = NaN, timer = null;
    function write(key, value) {
      var field = fields[key];
      if (field.textContent !== value) field.textContent = value;
      if (field.hidden !== !value) field.hidden = !value;
    }
    function elapsed() {
      var seconds = Math.floor((Date.now() - startedAt) / 1000);
      if (!(seconds >= 0)) { write('elapsed', ''); return; }
      var hours = Math.floor(seconds / 3600);
      var minutes = Math.floor(seconds / 60) % 60;
      write('elapsed', [hours, minutes, seconds % 60].map(function (value) {
        return String(value).padStart(2, '0');
      }).join(':'));
    }
    function syncClock() {
      if (card.hidden || !Number.isFinite(startedAt)) {
        clearInterval(timer);
        timer = null;
        if (!Number.isFinite(startedAt)) write('elapsed', '');
        return;
      }
      elapsed();
      if (timer === null) timer = setInterval(elapsed, 1000);
    }
    fields.avatar.addEventListener('load', function () { fields.avatar.hidden = false; });
    fields.avatar.addEventListener('error', function () { fields.avatar.hidden = true; });

    return {
      reset: function (name, live) {
        startedAt = NaN; avatar = '';
        fields.avatar.hidden = true;
        fields.avatar.removeAttribute('src');
        write('initial', name.charAt(0).toUpperCase());
        write('name', name);
        ['title', 'category', 'description', 'viewers'].forEach(function (key) { write(key, ''); });
        fields.live.hidden = !live;
        syncClock();
      },
      update: function (info) {
        if (!info) return;
        var name = text(info.name, 80);
        if (name) {
          write('name', name);
          write('initial', name.charAt(0).toUpperCase());
        }
        var nextAvatar = avatarURL(info.avatar);
        if (nextAvatar && nextAvatar !== avatar) {
          avatar = nextAvatar;
          fields.avatar.hidden = true;
          fields.avatar.src = avatar;
        }
        ['title', 'category'].forEach(function (key) {
          var value = text(info[key], 1000);
          if (value) write(key, value);
        });
        var description = text(info.description, 1000);
        if (description) write('description', description);
        else if (fields.description.hidden) write('description', text(info.channelDescription, 1000));
        if (info.viewers !== undefined) {
          var count = info.viewers;
          write('viewers', Number.isSafeInteger(count) && count >= 0
            ? number.format(count) + (count === 1 ? ' espectador' : ' espectadores') : '');
        }
        var start = startTime(info.startedAt);
        if (Number.isFinite(start) && start !== startedAt) { startedAt = start; syncClock(); }
      },
      setVisible: function (visible) { card.hidden = !visible; syncClock(); }
    };
  }
  root.KickStreamInfo = { create: create };
}(window));
