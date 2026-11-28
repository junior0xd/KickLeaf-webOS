(function (root) {
  'use strict';

  var preferenceKey = 'kickleaf.streamInfoEnabled';
  var duration = 2000;

  function text(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
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

  function create(card, toggle) {
    var fields = {};
    card.querySelectorAll('[data-info]').forEach(function (node) { fields[node.dataset.info] = node; });
    var number = new Intl.NumberFormat('pt-BR');
    var avatar = '', frame = null, timer = null, enabled = true;
    try { enabled = root.localStorage.getItem(preferenceKey) !== 'false'; }
    catch (error) { /* Storage can be unavailable in the current web context. */ }
    function syncToggle() {
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.querySelector('img').src = enabled ? 'phosphor-info-fill.svg' : 'phosphor-info.svg';
    }
    syncToggle();

    function write(key, value) {
      var field = fields[key];
      if (field.textContent !== value) field.textContent = value;
      if (field.hidden !== !value) field.hidden = !value;
    }
    function writeCategory(value) {
      write('category', value);
      fields['category-line'].hidden = !value;
    }
    function writeAudience(count) {
      var valid = Number.isSafeInteger(count) && count >= 0;
      write('viewer-count', valid ? number.format(count) : '');
      write('viewer-label', valid ? (count === 1 ? 'espectador' : 'espectadores') : '');
      fields.viewers.hidden = !valid;
    }
    function cancel() {
      if (frame !== null) root.cancelAnimationFrame(frame);
      if (timer !== null) root.clearTimeout(timer);
      frame = timer = null;
    }
    function hide(immediate) {
      cancel();
      card.classList.remove('stream-info-visible');
      card.setAttribute('aria-hidden', 'true');
      if (immediate) card.hidden = true;
    }
    function loadAvatar() {
      if (avatar && fields.avatar.getAttribute('src') !== avatar) {
        fields.avatar.hidden = true;
        fields.avatar.src = avatar;
      }
    }
    function show() {
      if (!enabled || !fields.name.textContent || document.hidden) return;
      cancel();
      loadAvatar();
      card.hidden = false;
      card.classList.add('stream-info-visible');
      card.setAttribute('aria-hidden', 'false');
      // The first frame commits visibility. Start counting on the following frame.
      frame = root.requestAnimationFrame(function () {
        frame = root.requestAnimationFrame(function () {
          frame = null;
          timer = root.setTimeout(hide, duration);
        });
      });
    }

    fields.avatar.addEventListener('load', function () { fields.avatar.hidden = !fields.avatar.hasAttribute('src'); });
    fields.avatar.addEventListener('error', function () { fields.avatar.hidden = true; });
    toggle.addEventListener('click', function () {
      enabled = !enabled;
      syncToggle();
      try { root.localStorage.setItem(preferenceKey, String(enabled)); }
      catch (error) { /* The setting still works for this session. */ }
      if (enabled) show(); else hide(true);
    });

    return {
      show: show,
      hide: function () { hide(true); },
      reset: function (name) {
        hide(true);
        avatar = '';
        fields.avatar.hidden = true;
        fields.avatar.removeAttribute('src');
        write('initial', name.charAt(0).toUpperCase());
        write('name', name);
        write('title', '');
        writeCategory('');
        writeAudience(null);
      },
      update: function (info) {
        if (!info) return;
        var name = text(info.name, 80);
        if (name) {
          write('name', name);
          write('initial', name.charAt(0).toUpperCase());
        }
        var nextAvatar = avatarURL(info.avatar);
        if (nextAvatar) {
          avatar = nextAvatar;
          if (card.classList.contains('stream-info-visible')) loadAvatar();
        }
        var title = text(info.title, 1000);
        var category = text(info.category, 1000);
        if (title) write('title', title);
        if (category) writeCategory(category);
        if (info.viewers !== undefined) writeAudience(info.viewers);
      }
    };
  }
  root.KickStreamInfo = { create: create };
}(window));
