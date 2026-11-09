(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KickVideoStats = api;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  function finite(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
  function positive(value) { return finite(value) !== null && value > 0 ? value : null; }
  function counter(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
  function create(options) {
    var now = options && options.now || function () { return performance.now(); };
    var video = null, context = {}, listeners = [], phase = 'idle';
    var played = false, interruptions = 0, waitingSince = null, waitingMs = 0, sample = null, sampledFPS = null;
    function resetSample() { sample = null; sampledFPS = null; }
    function finishWaiting() {
      if (waitingSince !== null) waitingMs += Math.max(0, now() - waitingSince);
      waitingSince = null;
    }
    function transition(next) { finishWaiting(); resetSample(); phase = next; }
    function detach() {
      listeners.forEach(function (item) { video.removeEventListener(item[0], item[1]); });
      listeners = []; video = null; context = {}; phase = 'idle';
      played = false; interruptions = 0; waitingSince = null; waitingMs = 0; resetSample();
    }
    function attach(element, details) {
      detach(); video = element;
      // Copy only metadata needed for display; never retain stream URLs or credentials.
      var variant = details.variant || {};
      context = { quality: details.quality, label: typeof variant.label === 'string' ? variant.label.slice(0, 64) : null,
        live: details.live === true, bitrate: positive(variant.bitrate), fps: positive(variant.fps),
        codecs: Array.isArray(variant.codecs) ? variant.codecs.filter(function (codec) { return typeof codec === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(codec); }).slice(0, 8) : [] };
      phase = 'initializing';
      function on(name, action) { video.addEventListener(name, action); listeners.push([name, action]); }
      on('playing', function () { transition('playing'); played = true; });
      on('waiting', function () {
        if (!played || video.paused || video.ended || video.seeking || waitingSince !== null) return;
        resetSample(); interruptions += 1; waitingSince = now(); phase = 'buffering';
      });
      on('pause', function () { transition('paused'); });
      on('seeking', function () { transition('seeking'); });
      on('seeked', function () { transition(video.paused ? 'paused' : 'initializing'); });
      on('loadstart', function () { transition('initializing'); });
      on('emptied', function () { transition('initializing'); });
      on('error', function () { transition('error'); });
      on('ended', function () { transition('ended'); });
    }
    function snapshot() {
      if (!video) return null;
      var ahead = null, edge = null, position = finite(video.currentTime);
      // Read independent TimeRanges snapshots; failure of one metric must not hide another.
      if (position !== null) {
        try {
          var buffered = video.buffered;
          if (counter(buffered.length) === null) throw new Error('Invalid TimeRanges');
          ahead = 0;
          for (var i = 0; i < buffered.length; i += 1) {
            var start = finite(buffered.start(i)), end = finite(buffered.end(i));
            if (start === null || end === null || end < start) throw new Error('Invalid buffer range');
            if (position >= start && position <= end) ahead = Math.max(ahead, end - position);
          }
        } catch (error) { ahead = null; }
        if (context.live) {
          try {
            var seekable = video.seekable;
            if (counter(seekable.length) === null) throw new Error('Invalid TimeRanges');
            var boundary = seekable.length ? finite(seekable.end(seekable.length - 1)) : null;
            if (boundary !== null && boundary >= position) edge = boundary - position;
          } catch (error) { /* Seekable unavailable independently of buffered. */ }
        }
      }
      var total = null, dropped = null;
      try {
        if (typeof video.getVideoPlaybackQuality === 'function') {
          var quality = video.getVideoPlaybackQuality();
          total = counter(quality.totalVideoFrames); dropped = counter(quality.droppedVideoFrames);
          if (total === null || dropped === null || dropped > total) { total = null; dropped = null; }
        }
      } catch (error) { /* Counters unavailable in this media pipeline. */ }
      var time = now();
      if (total !== null && total > 0 && phase === 'playing' && !video.paused && !video.ended && !video.seeking) {
        var frames = total - dropped;
        if (sample && total >= sample.total && dropped >= sample.dropped && frames >= sample.frames && time - sample.time >= 1000) {
          sampledFPS = (frames - sample.frames) * 1000 / (time - sample.time);
        }
        if (sample && (total < sample.total || dropped < sample.dropped || frames < sample.frames)) sampledFPS = null;
        if (!sample || time - sample.time >= 1000 || total < sample.total || dropped < sample.dropped) sample = { frames: frames, total: total, dropped: dropped, time: time };
      } else resetSample();
      return { width: positive(video.videoWidth), height: positive(video.videoHeight), quality: context.quality,
        quality_label: context.label, nominal_bitrate: context.bitrate, nominal_fps: context.fps,
        declared_codecs: context.codecs.slice(), buffered_ahead_seconds: ahead,
        observed_presented_fps: sampledFPS, dropped_frames: dropped, total_frames: total,
        live_edge_gap_seconds: edge, absolute_latency_seconds: null,
        state: phase, buffering_count: interruptions,
        buffering_seconds: (waitingMs + (waitingSince === null ? 0 : Math.max(0, time - waitingSince))) / 1000,
        paused: video.paused, ready_state: video.readyState };
    }
    return { attach: attach, detach: detach, snapshot: snapshot, resetSample: resetSample,
      setPhase: function (value) { if (!video) phase = value; }, state: function () { return phase; } };
  }
  return { create: create };
}));
