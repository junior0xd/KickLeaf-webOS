(function (root) {
  'use strict';
  const columns = 4;
  const number = new Intl.NumberFormat('pt-BR');
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
    const browse = document.getElementById('browse');
    const scroller = document.getElementById('browse-scroll');
    const grid = document.getElementById('browse-grid');
    const status = document.getElementById('browse-status');
    const retry = document.getElementById('browse-retry');
    home.classList.add('discovery-home');
    document.getElementById('home-brand').hidden = false;
    browse.hidden = false;

    let query = api.query(), generation = 0, active = false, busy = false, failed = false;
    let firstGridMs = null, started = performance.now(), pages = 0;
    let previous = null;
    const cards = [];
    const views = new WeakMap();
    function imageSources(button, visible) {
      const view = views.get(button);
      for (const [node,url] of [[view.avatar,view.item.avatar],[view.thumbnail,
        view.item.thumbnail?.variants.find(variant=>variant.width >= button.clientWidth * Math.min(root.devicePixelRatio || 1,1.25))?.url ??
        view.item.thumbnail?.variants.at(-1)?.url ?? view.item.thumbnail?.src]]) {
        if (!visible || !url) {
          node.hidden = true;
          node.removeAttribute('src');
        } else if (node.getAttribute('src') !== url) {
          node.hidden = true;
          node.src = url;
        }
      }
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (!active) return;
      for (const {target,isIntersecting} of entries) imageSources(target,isIntersecting);
    },{root:scroller,rootMargin:'100px 0px'}) : null;
    function observe(button) {
      if (observer) observer.observe(button);
      else {
        const view = views.get(button);
        view.thumbnail.loading = view.avatar.loading = 'lazy';
        imageSources(button,true);
      }
    }
    function append(items) {
      const fragment = document.createDocumentFragment();
      const added = [];
      for (const item of items) {
        const button = element('button','browse-card');
        button.type = 'button';
        button.dataset.slug = item.slug;
        const name = item.name || item.slug;
        const media = element('span','browse-thumbnail');
        const thumb = image();
        const badges = element('span','browse-badges');
        badges.append(element('span','browse-live','Ao vivo'));
        if (item.showViewerCount === true && item.viewers !== null) {
          const label = item.viewers === 1 ? ' espectador' : ' espectadores';
          badges.append(element('span','',number.format(item.viewers)+label));
        }
        media.append(thumb,badges);

        const avatarFrame = element('span','browse-avatar',name.charAt(0).toUpperCase());
        avatarFrame.setAttribute('aria-hidden','true');
        const avatar = image();
        avatarFrame.append(avatar);
        const text = element('span','browse-text');
        text.append(element('span','browse-title',item.title || name),
          element('span','browse-name',name),element('span','browse-category',item.category));
        const details = element('span','browse-details');
        details.append(avatarFrame,text);
        button.append(media,details);
        views.set(button,{item,avatar,thumbnail:thumb});
        cards.push(button);
        added.push(button);
        fragment.append(button);
      }
      grid.append(fragment);
      added.forEach(observe);
    }
    function message(error) {
      if (error.code === 'http_429') return 'A Kick limitou as consultas. Aguarde antes de tentar novamente.';
      if (error.code === 'timeout') return 'A listagem demorou a responder.';
      if (error.code === 'network_or_cors') return 'A listagem está indisponível por uma falha de conexão.';
      if (['http_401','http_403'].includes(error.code)) return 'A Kick recusou a consulta da listagem.';
      if (['http_400','http_404','invalid_contract','invalid_json','body_too_large'].includes(error.code)) return 'A listagem da Kick está indisponível.';
      return 'Não foi possível carregar as transmissões.';
    }
    async function load() {
      if (!active || busy || query.done || failed) return;
      const ticket = generation;
      const retryFocused = document.activeElement === retry;
      busy = true;
      if (!retryFocused) retry.hidden = true;
      retry.setAttribute('aria-disabled','true');
      status.textContent = cards.length ? 'Carregando mais transmissões…' : 'Carregando transmissões…';
      try {
        const page = await query.next();
        if (ticket !== generation) return;
        const firstNew = cards.length;
        append(page.items);
        pages++;
        if (firstGridMs === null && cards.length) firstGridMs = Math.round(performance.now()-started);
        status.textContent = page.issue ? 'A Kick repetiu os resultados. A paginação foi encerrada.' :
          cards.length ? '' : 'Nenhuma transmissão ao vivo encontrada.';
        if (retryFocused && document.activeElement === retry) (cards[firstNew] || cards.at(-1) || watch).focus();
        retry.hidden = true;
      } catch (error) {
        if (ticket !== generation || error.code === 'cancelled') return;
        failed = true;
        status.textContent = (cards.length ? 'Falha ao carregar mais transmissões. ' : '') + message(error);
        retry.hidden = false;
      } finally {
        if (ticket === generation) {
          busy = false;
          retry.removeAttribute('aria-disabled');
        }
      }
    }
    function suspend() {
      if (!active) return;
      active = false;
      generation++;
      busy = false;
      api.cancel();
      observer?.disconnect();
      cards.forEach(button=>imageSources(button,false));
    }
    function resume(restore = false) {
      if (active || home.hidden || document.hidden) return;
      active = true;
      if (query.expires && query.expires <= Date.now()) {
        if (cards.includes(document.activeElement)) watch.focus();
        cards.length = 0;
        previous = null;
        grid.replaceChildren();
        scroller.scrollTop = 0;
        query = api.query();
        failed = false;
      }
      cards.forEach(observe);
      const focus = restore && cards.includes(previous?.button);
      if (focus) {
        scroller.scrollTop = previous.scroll;
        previous.button.focus({preventScroll:true});
      } else if (restore) watch.focus();
      if (!failed && (!cards.length || status.textContent === 'Carregando mais transmissões…')) void load();
    }
    grid.addEventListener('click',event=>{
      const button = event.target.closest('.browse-card');
      if (!button || !active) return;
      previous = {button,scroll:scroller.scrollTop};
      input.value = button.dataset.slug;
      open();
    });
    retry.addEventListener('click',()=>{
      if (busy) return;
      failed = false;
      void load();
    });
    grid.addEventListener('focusin',event=>{
      const index = cards.indexOf(event.target);
      if (index >= 0 && index >= cards.length-columns) void load();
    });
    scroller.addEventListener('scroll',()=>{
      if (scroller.scrollTop > 0 && scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop < 120) void load();
    },{passive:true});
    function arrow(code) {
      const focused = document.activeElement;
      if (![37,38,39,40].includes(code) || (focused === input && (code === 37 || code === 39))) return false;
      const index = cards.indexOf(focused);
      let target;
      if (index >= 0) {
        if (code === 37 && index % columns) target = cards[index-1];
        if (code === 39 && index % columns !== columns-1) target = cards[index+1];
        if (code === 38) target = cards[index-columns] || (index < 2 ? input : watch);
        if (code === 40) {
          const nextRow = (Math.floor(index/columns)+1)*columns;
          if (nextRow < cards.length) target = cards[Math.min(index+columns,cards.length-1)];
          else if (!retry.hidden) target = retry;
          else void load();
        }
      } else if (focused === retry) {
        if (code === 38) target = cards.at(-1) || watch;
      } else if (code === 40) target = cards[0] || (!retry.hidden ? retry : watch);
      else if (focused === watch && (code === 37 || code === 38)) target = input;
      else if (focused === input && code === 38) target = watch;
      target?.focus();
      return true;
    }
    return {
      arrow,
      activate: repeat => {
        const focused = document.activeElement;
        if (focused !== watch && focused !== retry && !cards.includes(focused)) return false;
        if (!repeat) focused.click();
        return true;
      },
      suspend,
      resume,
      clearSelection: () => { previous = null; },
      snapshot: () => ({active,busy:api.busy(),cards:cards.length,pages,firstGridMs,
        images:grid.querySelectorAll('img[src]').length,dom:home.querySelectorAll('*').length})
    };
  }
  root.KickDiscoveryHome = {create};
}(window));
