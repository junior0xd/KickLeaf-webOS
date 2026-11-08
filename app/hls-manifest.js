(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KickHLSManifest = api;
}(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  // Same CDN boundary as the local discovery backend. Unknown hosts fail closed.
  function mediaURL(value, base) {
    if (typeof value !== 'string' || !value || value.length > 16384) throw new Error('URL HLS inválida.');
    var url;
    try { url = new URL(value, base); } catch (error) { throw new Error('URL HLS inválida.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port ||
        !(url.hostname === 'stream.kick.com' || url.hostname.endsWith('.live-video.net'))) {
      throw new Error('URL HLS fora das origens HTTPS de CDN permitidas.');
    }
    return url.href;
  }
  function attributes(line) {
    var result = Object.create(null);
    var expression = /(?:^|,)\s*([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    var match;
    while ((match = expression.exec(line))) result[match[1]] = match[2].replace(/^"|"$/g, '');
    return result;
  }
  function number(value) {
    return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
  }
  function parse(text, master) {
    mediaURL(master);
    if (typeof text !== 'string' || text.length > 524288 || !/^\uFEFF?#EXTM3U(?:\r?\n|$)/.test(text)) throw new Error('Manifesto HLS inválido.');
    var lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(function (line) { return line.trim(); });
    var renditions = [], variants = [], pending = null;
    lines.forEach(function (line) {
      if (line.indexOf('#EXT-X-MEDIA:') === 0) renditions.push(attributes(line.slice(13)));
      else if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
        if (pending) throw new Error('Variante HLS sem URI.');
        pending = attributes(line.slice(18));
      } else if (line && line[0] !== '#' && pending) {
        if (variants.length >= 64) throw new Error('Manifesto HLS com variantes demais.');
        variants.push({ attributes: pending, uri: line }); pending = null;
      }
    });
    if (pending) throw new Error('Variante HLS sem URI.');
    var qualities = variants.map(function (entry, index) {
      var a = entry.attributes;
      var size = /^(\d+)x(\d+)$/.exec(a.RESOLUTION || '');
      var external = ['AUDIO', 'VIDEO'].some(function (type) {
        if (!a[type]) return false;
        var group = renditions.filter(function (r) { return r.TYPE === type && r['GROUP-ID'] === a[type]; });
        // An unresolved group is also unsafe for manual playback.
        return !group.length || group.some(function (r) { return Object.prototype.hasOwnProperty.call(r, 'URI'); });
      });
      var url = null;
      try { url = mediaURL(entry.uri, master); } catch (error) { /* Keep Auto available. */ }
      if (size && (!Number.isSafeInteger(Number(size[1])) || !Number.isSafeInteger(Number(size[2])) || Number(size[1]) <= 0 || Number(size[2]) <= 0)) size = null;
      var height = size ? Number(size[2]) : null;
      return { id: 'variant-' + index, label: height ? height + 'p' : 'Variante ' + (index + 1),
        width: size ? Number(size[1]) : null, height: height,
        bitrate: number(a.BANDWIDTH), fps: number(a['FRAME-RATE']),
        codecs: a.CODECS ? a.CODECS.split(',').map(function (codec) { return codec.trim(); }) : [],
        selectable: !!url && !external, url: url && !external ? url : null,
        reason: external ? 'external_rendition' : (!url ? 'invalid_variant_url' : null) };
    });
    // This is metadata only; native playback retains responsibility for segments/DRM.
    return { kind: variants.length ? 'master' : 'media', qualities: qualities };
  }
  return { mediaURL: mediaURL, parse: parse };
}));
