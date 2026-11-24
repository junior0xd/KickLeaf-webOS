(function (root) {
  'use strict';
  const http = typeof module === 'object' && module.exports ? require('./kick-http') : root.KickHTTP;
  const {failure} = http;
  const limits = Object.freeze({pageSize:24, pages:3, cachedPages:6, cachedChannels:144, ttl:60000, timeout:6500});
  const endpoint = 'https://web.kick.com/api/v1/livestreams';
  const images = ['images.kick.com','files.kick.com','cdn.kick.com'];
  const text = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0,max) : null;
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const id = value => integer(value) ?? (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null);
  const slug = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,25}$/.test(value) ? value.toLowerCase() : null;
  function imageURL(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
      if (images.includes(url.hostname) || (url.hostname === 'web.kick.com' &&
          /^\/api\/v1\/channels\/\d+\/thumbnail\.jpeg$/.test(url.pathname) && !url.search)) return url.href;
    } catch (_) { /* An unavailable image leaves the card placeholder. */ }
    return null;
  }
  function thumbnail(value) {
    const src = imageURL(typeof value === 'string' ? value : value?.src);
    const variants = new Map();
    if (typeof value?.srcset === 'string' && value.srcset.length <= 12000) {
      for (const entry of value.srcset.split(',')) {
        const match = /^\s*(\S+)\s+(\d{1,4})w\s*$/.exec(entry);
        const url = match && imageURL(match[1]);
        if (url && +match[2] > 0 && +match[2] <= 1920 && variants.size < 8) variants.set(+match[2],url);
      }
    }
    if (!src && !variants.size) return null;
    return Object.freeze({src,variants:Object.freeze([...variants].sort((a,b)=>a[0]-b[0])
      .map(([width,url])=>Object.freeze({width,url})))});
  }
  function timestamp(value) {
    if (typeof value !== 'string' || value.length > 48 || !/^\d{4}-\d\d-\d\d[ T]/.test(value)) return null;
    let iso = value.replace(' ', 'T');
    if (!/(Z|[+-]\d\d:\d\d)$/i.test(iso)) iso += 'Z';
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  // A slug is required for opening a card. Playback knows it already from the request.
  function normalize(raw, knownSlug = null, obtainedAt = Date.now()) {
    if (!raw || typeof raw !== 'object') return null;
    const channel = raw.channel;
    const key = slug(knownSlug ?? channel?.slug ?? raw.slug);
    if (!key) return null;
    const category = raw.category ?? (Array.isArray(raw.categories) ? raw.categories[0] : null);
    return Object.freeze({
      channelId:id(channel?.id ?? raw.channel_id), streamId:id(raw.id), slug:key,
      idSource:knownSlug ? 'playback' : 'directory',
      name:text(channel?.username,80), avatar:imageURL(channel?.profile_pic),
      thumbnail:thumbnail(raw.thumbnail), title:text(raw.title ?? raw.session_title ?? raw.stream_title,1000),
      categoryId:id(category?.id), category:text(category?.name,120),
      description:text(raw.description,1000), language:text(raw.language,20),
      viewers:integer(raw.viewer_count) ?? integer(raw.viewers),
      showViewerCount:typeof raw.show_view_count === 'boolean' ? raw.show_view_count : null,
      startedAt:timestamp(raw.start_time ?? raw.created_at), state:'live', obtainedAt
    });
  }
  function merge(previous, next) {
    if (!previous) return next;
    if (!next) return previous;
    if (previous.slug !== next.slug) return next;
    const sameSource = previous.idSource === next.idSource;
    if (sameSource && previous.streamId !== null && next.streamId !== null &&
        String(previous.streamId) !== String(next.streamId)) return next;
    if (!sameSource && previous.startedAt && next.startedAt &&
        Math.abs(Date.parse(previous.startedAt) - Date.parse(next.startedAt)) > 60000) return next;
    const newer = previous.obtainedAt <= next.obtainedAt ? next : previous;
    const older = newer === next ? previous : next;
    const fields = {};
    for (const key of Object.keys(newer)) fields[key] = newer[key] ?? older[key];
    if (!sameSource && previous.idSource === 'directory' && previous.streamId !== null) {
      fields.streamId = previous.streamId;
      fields.idSource = previous.idSource;
    }
    if (older.thumbnail?.variants.length && !newer.thumbnail?.variants.length) fields.thumbnail = older.thumbnail;
    return Object.freeze(fields);
  }
  function cardInfo(stream) {
    if (!stream) return undefined;
    const {name, avatar, title, category, description, startedAt} = stream;
    return {name,avatar,title,category,description,startedAt,
      viewers:stream.showViewerCount === false ? null : stream.viewers};
  }
  function retryDeadline(header, now) {
    if (!header) return now + 60000;
    const time = /^\d+$/.test(header) ? now + Number(header)*1000 : Date.parse(header);
    return Number.isFinite(time) ? Math.max(time,now) : now + 60000;
  }
  function create({request = http.request, now = Date.now} = {}) {
    const pages = new Map(), channels = new Map();
    let active = null, retryAt = 0, revision = 0;
    function read(cache, key) {
      const entry = cache.get(key);
      if (!entry) return null;
      cache.delete(key);
      if (now() >= entry.expires) return null;
      cache.set(key,entry);
      return entry.value;
    }
    function save(cache, key, value, capacity, expires) {
      cache.delete(key);
      cache.set(key,{value,expires});
      if (cache.size > capacity) cache.delete(cache.keys().next().value);
    }
    function cancel() {
      revision++;
      if (!active) return;
      const pending = active;
      active = null;
      pending.controller.abort();
    }
    function fetchPage(url) {
      const key = url.href;
      if (active?.key === key) return active.promise;
      cancel();
      const cached = read(pages,key);
      if (cached) return Promise.resolve(cached);
      if (now() < retryAt) return Promise.reject(failure('http_429','Limite de consultas ativo.'));
      const controller = new AbortController();
      const pending = {key,controller,promise:null};
      active = pending;
      pending.promise = (async () => {
        try {
          const response = await request(key,{signal:controller.signal,timeout:limits.timeout});
          if (active !== pending || controller.signal.aborted) throw failure('cancelled','Consulta cancelada.');
          const data = response?.data, rows = data?.livestreams;
          const cursor = data?.pagination?.next_cursor ?? null;
          if (!Array.isArray(rows) || rows.length > limits.pageSize ||
              (cursor !== null && (typeof cursor !== 'string' || cursor.length > 2048))) {
            throw failure('invalid_contract','Formato da listagem desconhecido.');
          }
          const obtainedAt = now(), expires = obtainedAt + limits.ttl;
          const items = rows.map(row => normalize(row,null,obtainedAt)).filter(Boolean);
          if (rows.length && !items.length) throw failure('invalid_contract','A lista não trouxe canais válidos.');
          for (const item of items) {
            const previous = read(channels,item.slug);
            const combined = merge(previous,item);
            const validity = combined !== item && previous ? Math.min(expires,channels.get(item.slug).expires) : expires;
            save(channels,item.slug,combined,limits.cachedChannels,validity);
          }
          const page = {items,cursor:cursor || null,expires};
          save(pages,key,page,limits.cachedPages,expires);
          return page;
        } catch (error) {
          if (active !== pending || controller.signal.aborted) throw failure('cancelled','Consulta cancelada.');
          if (error.code === 'http_429' || error.retryAfter) retryAt = retryDeadline(error.retryAfter,now());
          throw error;
        } finally {
          if (active === pending) active = null;
        }
      })();
      return pending.promise;
    }
    function query({displayLanguage = 'pt', language = null, categoryId = null} = {}) {
      const base = new URL(endpoint);
      const validLanguage = value => typeof value === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,2}$/i.test(value);
      base.searchParams.set('limit',String(limits.pageSize));
      base.searchParams.set('sort','viewer_count_desc');
      base.searchParams.set('display_language',validLanguage(displayLanguage) ? displayLanguage : 'pt');
      if (validLanguage(language)) base.searchParams.set('language',language);
      if (Number.isSafeInteger(categoryId) && categoryId > 0) base.searchParams.set('category_id',String(categoryId));
      const slugs = new Set(), streams = new Set(), cursors = new Set();
      let count = 0, cursor = null, done = false, pending = null, expires = 0;
      return {
        get done() { return done; },
        get expires() { return expires; },
        next() {
          if (pending?.revision === revision) return pending.promise;
          if (done) return Promise.resolve({items:[],done:true,issue:null});
          const url = new URL(base);
          if (cursor) url.searchParams.set('after',cursor);
          const result = fetchPage(url);
          const attempt = {revision,promise:null};
          pending = attempt;
          attempt.promise = result.then(page => {
            if (revision !== attempt.revision) throw failure('cancelled','Consulta cancelada.');
            const items = page.items.filter(item => {
              const key = item.streamId === null ? null : String(item.streamId);
              if (slugs.has(item.slug) || (key !== null && streams.has(key))) return false;
              slugs.add(item.slug);
              if (key !== null) streams.add(key);
              return true;
            });
            const issue = page.cursor && (cursors.has(page.cursor) || !items.length) ? 'pagination_stalled' : null;
            if (!count) expires = page.expires;
            count++;
            cursor = page.cursor;
            if (cursor) cursors.add(cursor);
            done = !!issue || !cursor || count >= limits.pages;
            return {items,done,issue};
          }).finally(() => { if (pending === attempt) pending = null; });
          return attempt.promise;
        }
      };
    }
    return {query,cancel,metadata: value => read(channels,value), busy: () => !!active};
  }
  const api = {create,normalize,merge,cardInfo,imageURL,limits};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KickDiscovery = api;
}(globalThis));
