(function (root) {
  'use strict';
  const groupSize = 5;
  const number = new Intl.NumberFormat('pt-BR');
  const compact = new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function image() {
    const node = element('img');
    node.alt = '';
    node.decoding = 'async';
    node.referrerPolicy = 'no-referrer';
    node.hidden = true;
    node.onload = () => { if (node.hasAttribute('src')) node.hidden = false; };
    node.onerror = () => { node.hidden = true; };
    return node;
  }

  function create({api,home,input,watch,open}) {
    const byId = id => document.getElementById(id);
    const nav = byId('home-nav'), start = byId('home-start'), live = byId('home-live');
    const browse = byId('browse'), grid = byId('browse-grid'), status = byId('browse-status');
    const position = byId('browse-position'), counter = byId('browse-group'), retry = byId('browse-retry');
    const previous = byId('browse-prev'), next = byId('browse-next');
    const promotion = byId('home-promotion'), events = byId('home-events'), eventGrid = byId('events-grid');
    const recent = byId('home-recent'), recentGrid = byId('recent-grid');
    home.classList.add('discovery-home');
    const brand = byId('home-brand');
    brand.src = 'kickleaf-icon-transparent.png';
    nav.hidden = browse.hidden = false;

    const query = api.query();
    const catalogue = [];
    const history = [];
    const sources = new WeakMap();
    let cards = [], group = 0, lastLive = 0, generation = 0, active = false;
    let busy = false, failedGroup = null, selected = null, historyDirty = false;
    let scrollTop = 0;
    const mountedMedia = new Set();
    let firstGridMs = null, pages = 0;
    const started = performance.now();

    function setMedia(node, url) {
      if (url && node.getAttribute('src') !== url) {
        node.hidden = true;
        node.src = url;
      }
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (!active) return;
      for (const {target,isIntersecting} of entries) {
        if (!isIntersecting || !mountedMedia.has(target)) continue;
        sources.get(target)();
        observer.unobserve(target);
      }
    },{root:home,threshold:.1}) : null;

    function observeMedia(target) {
      if (!active) return;
      if (observer) observer.observe(target);
      else {
        for (const node of target.querySelectorAll('img')) node.loading = 'lazy';
        sources.get(target)();
      }
    }
    function mountMedia(target, load) {
      sources.set(target,load);
      mountedMedia.add(target);
    }
    function clearSources(target) {
      for (const node of target.querySelectorAll('img[src]')) {
        node.hidden = true;
        node.removeAttribute('src');
      }
    }
    function unmountMedia(container) {
      for (const target of mountedMedia) {
        if (!container.contains(target)) continue;
        observer?.unobserve(target);
        mountedMedia.delete(target);
        clearSources(target);
      }
    }

    function makeCard(item) {
      const button = element('button','browse-card');
      button.type = 'button';
      button.dataset.slug = item.slug;
      const name = item.name || item.slug;
      const media = element('span','browse-thumbnail');
      const thumb = image();
      const showCount = item.showViewerCount === true && item.viewers !== null;
      const badge = element('span','browse-live',showCount ? compact.format(item.viewers) : 'Ao vivo');
      badge.setAttribute('role','img');
      badge.setAttribute('aria-label',showCount ?
        `Ao vivo, ${number.format(item.viewers)} ${item.viewers === 1 ? 'espectador' : 'espectadores'}` : 'Ao vivo');
      media.append(thumb,badge);
      const avatarFrame = element('span','browse-avatar',name.charAt(0).toUpperCase());
      avatarFrame.setAttribute('aria-hidden','true');
      const avatar = image();
      avatarFrame.append(avatar);
      const title = element('span','browse-title',item.title || name);
      title.title = title.textContent;
      const details = element('span','browse-text');
      details.append(element('span','browse-name',name),title,element('span','browse-category',item.category));
      const byline = element('span','browse-details');
      byline.append(avatarFrame,details);
      button.append(media,byline);
      mountMedia(button,()=>{
        const variants = item.thumbnail?.variants;
        const width = button.clientWidth * Math.min(root.devicePixelRatio || 1,1.25);
        setMedia(thumb,variants?.find(variant=>variant.width >= width)?.url ??
          variants?.[variants.length-1]?.url ?? item.thumbnail?.src);
        setMedia(avatar,item.avatar);
      });
      return button;
    }

    function updatePosition() {
      position.hidden = !cards.length;
      previous.hidden = group === 0;
      const nextFocused = document.activeElement === next;
      next.hidden = !cards.length || (query.done && catalogue.length <= (group+1)*groupSize);
      if (next.hidden && nextFocused) cards[cards.length-1]?.focus();
      counter.textContent = `Grupo ${group+1}`;
    }
    function showGroup(target, focusIndex) {
      if (target !== group || !cards.length) {
        const track = element('div','browse-track');
        if (cards.length) track.dataset.enter = target > group ? 'next' : 'previous';
        group = target;
        unmountMedia(grid);
        cards = catalogue.slice(group*groupSize,(group+1)*groupSize).map(makeCard);
        track.append(...cards);
        grid.replaceChildren(track);
        cards.forEach(observeMedia);
        if (firstGridMs === null && cards.length) firstGridMs = Math.round(performance.now()-started);
      }
      updatePosition();
      if (focusIndex !== null && cards.length) {
        cards[focusIndex < 0 ? cards.length-1 : focusIndex]?.focus({preventScroll:true});
      }
    }

    function message(error) {
      if (error.code === 'http_429') return 'A Kick limitou as consultas. Aguarde antes de tentar novamente.';
      if (error.code === 'timeout') return 'A listagem demorou a responder.';
      if (error.code === 'network_or_cors') return 'A listagem está indisponível por uma falha de conexão.';
      if (['http_401','http_403'].includes(error.code)) return 'A Kick recusou a consulta da listagem.';
      if (['http_400','http_404','invalid_contract','invalid_json','body_too_large'].includes(error.code)) return 'A listagem da Kick está indisponível.';
      return 'Não foi possível carregar as transmissões.';
    }

    function hasGroup(target) {
      return catalogue.length >= (target+1)*groupSize ||
        (query.done && catalogue.length > target*groupSize);
    }

    async function goTo(target, anchor = document.activeElement, retrying = false) {
      if (!active || target < 0) return;
      if (hasGroup(target)) {
        const direction = target < group ? -1 : 0;
        showGroup(target,anchor ? direction : null);
        return;
      }
      if (query.done || busy) return;
      if (failedGroup !== null && !retrying) {
        if (anchor) retry.focus();
        return;
      }

      const ticket = generation;
      failedGroup = null;
      busy = true;
      retry.setAttribute('aria-disabled','true');
      status.textContent = catalogue.length ? 'Carregando mais transmissões…' : 'Carregando transmissões…';
      try {
        let issue = null;
        while (!hasGroup(target) && !query.done) {
          const page = await query.next();
          if (ticket !== generation) return;
          catalogue.push(...page.items);
          pages++;
          issue = page.issue;
        }
        const stillFocused = anchor && document.activeElement === anchor;
        if (hasGroup(target) && (stillFocused || !cards.length)) showGroup(target,stillFocused ? 0 : null);
        else updatePosition();
        if (document.activeElement === retry) (cards[lastLive] || live).focus();
        retry.hidden = true;
        status.textContent = issue ? 'A Kick repetiu os resultados. A paginação foi encerrada.' :
          catalogue.length ? '' : 'Nenhuma transmissão ao vivo encontrada.';
      } catch (error) {
        if (ticket !== generation || error.code === 'cancelled') return;
        failedGroup = target;
        status.textContent = (catalogue.length ? 'Falha ao carregar mais transmissões. ' : '') + message(error);
        retry.hidden = false;
        if (document.activeElement === next) retry.focus();
      } finally {
        if (ticket === generation) {
          busy = false;
          retry.removeAttribute('aria-disabled');
        }
      }
    }

    function renderHistory() {
      if (!historyDirty) return;
      historyDirty = false;
      recentGrid.replaceChildren(...history.map(item => {
        const button = element('button','recent-card');
        button.type = 'button';
        button.dataset.slug = item.slug;
        button.append(element('span','browse-name',item.name || item.slug),
          element('span','recent-slug','@'+item.slug));
        return button;
      }));
      recent.hidden = !history.length;
    }

    // A future provider can supply verified promotional and active-event view data.
    // Informational items stay out of the remote navigation order.
    function setHighlights({banner = null, activeEvents = []} = {}) {
      function tile(item, kind) {
        const slug = typeof item.slug === 'string' && /^[a-z0-9_-]{1,25}$/i.test(item.slug) ? item.slug : null;
        const node = element(slug ? 'button' : 'article','home-highlight '+kind);
        if (slug) {
          node.type = 'button';
          node.dataset.slug = slug;
        }
        const media = image(), details = element('span','highlight-details');
        if (kind === 'event-highlight') details.append(element('span','highlight-live','Ao vivo'));
        details.append(element('strong','highlight-title',item.title));
        if (item.description) details.append(element('span','highlight-description',item.description));
        if (item.period) details.append(element('span','highlight-period',item.period));
        if (slug) details.append(element('span','highlight-action','Assistir à transmissão ›'));
        node.append(media,details);
        const url = root.KickDiscovery.imageURL(item.image);
        if (url) mountMedia(node,()=>setMedia(media,url));
        return node;
      }
      unmountMedia(promotion);
      unmountMedia(events);
      promotion.replaceChildren(...(banner?.title ? [tile(banner,'promo-highlight')] : []));
      eventGrid.replaceChildren(...activeEvents.filter(item=>item?.title).slice(0,2).map(item=>tile(item,'event-highlight')));
      promotion.hidden = !promotion.firstElementChild;
      events.hidden = !eventGrid.firstElementChild;
      for (const target of mountedMedia) {
        if (promotion.contains(target) || events.contains(target)) observeMedia(target);
      }
    }

    function suspend() {
      if (!active) return;
      if (!selected && home.contains(document.activeElement)) selected = document.activeElement;
      scrollTop = home.scrollTop;
      active = false;
      generation++;
      busy = false;
      retry.removeAttribute('aria-disabled');
      if (status.textContent === 'Carregando mais transmissões…') status.textContent = '';
      api.cancel();
      observer?.disconnect();
      mountedMedia.forEach(clearSources);
    }

    function resume(restore = false) {
      if (active || home.hidden || document.hidden) return;
      active = true;
      renderHistory();
      mountedMedia.forEach(observeMedia);
      if (restore) {
        const original = selected?.closest('.recent-card') ?
          Array.from(recentGrid.children).find(button=>button.dataset.slug === selected.dataset.slug) : selected;
        const target = original?.isConnected && !original.closest('[hidden]') ? original : start;
        target.focus({preventScroll:true});
        home.scrollTop = scrollTop;
      }
      selected = null;
      if (!cards.length && failedGroup === null && !query.done) void goTo(0,null);
    }

    function select(event) {
      const button = event.target.closest('button[data-slug]');
      if (!button || !active) return;
      selected = button;
      input.value = button.dataset.slug;
      open();
    }
    [grid,recentGrid,promotion,eventGrid].forEach(row=>row.addEventListener('click',select));
    grid.addEventListener('focusin',event=>{ lastLive = cards.indexOf(event.target); });
    start.addEventListener('click',()=>{ home.scrollTop = 0; start.focus({preventScroll:true}); });
    live.addEventListener('click',()=>{ (cards[lastLive] || cards[0] || (!retry.hidden ? retry : live)).focus(); });
    previous.addEventListener('click',()=>void goTo(group-1));
    next.addEventListener('click',()=>void goTo(group+1));
    retry.addEventListener('click',()=>{
      if (failedGroup !== null) void goTo(failedGroup,retry,true);
    });

    function arrow(code) {
      const focused = document.activeElement;
      if (![37,38,39,40].includes(code) || (focused === input && (code === 37 || code === 39))) return false;
      const isHorizontal = code === 37 || code === 39;
      const header = [start,live,input,watch];
      const liveRow = cards.length ? cards : retry.hidden ? [] : [retry];
      const rows = [
        header, Array.from(promotion.querySelectorAll('button')), Array.from(eventGrid.querySelectorAll('button')),
        liveRow, cards.length && !retry.hidden ? [retry] : [], Array.from(recentGrid.children)
      ].filter(row=>row.length);
      const rowIndex = rows.findIndex(row=>row.includes(focused) || (row === liveRow && [previous,next].includes(focused)));
      const row = rows[rowIndex];
      const index = row?.indexOf(focused) ?? -1;
      const step = code === 37 || code === 38 ? -1 : 1;
      if (!row) start.focus();
      else if (!isHorizontal) {
        const destination = rows[rowIndex+step];
        const column = destination === liveRow ? Math.max(0,lastLive) : Math.max(0,index);
        const target = destination === header ? live : destination?.[Math.min(column,destination.length-1)];
        target?.focus();
      } else if (row[index+step] && index >= 0) row[index+step].focus();
      else if (cards.includes(focused)) void goTo(group+step);
      else if (focused === next && step < 0) cards[cards.length-1]?.focus();
      else if (focused === previous && step > 0) cards[0]?.focus();
      return true;
    }

    return {
      arrow,
      activate: repeat => {
        const focused = document.activeElement;
        if (!home.contains(focused) || focused.tagName !== 'BUTTON') return false;
        if (!repeat) focused.click();
        return true;
      },
      back: () => {
        if (!home.contains(document.activeElement) || document.activeElement === start) return false;
        start.click();
        return true;
      },
      start,
      suspend,
      resume,
      setHighlights,
      clearSelection: () => { selected = watch; },
      recordChannel: (slug, name) => {
        const index = history.findIndex(item=>item.slug === slug);
        if (index >= 0) history.splice(index,1);
        history.unshift({slug,name});
        if (history.length > groupSize) history.pop();
        historyDirty = true;
      },
      snapshot: () => ({active,busy:api.busy(),cards:cards.length,loaded:catalogue.length,group:group+1,pages,firstGridMs,
        images:grid.querySelectorAll('img[src]').length,dom:home.querySelectorAll('*').length})
    };
  }
  root.KickDiscoveryHome = {create};
}(window));
